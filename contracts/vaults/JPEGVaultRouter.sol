// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "../interfaces/INFTVault.sol";
import "../interfaces/IVaultHelper.sol";

contract JPEGVaultRouter is ReentrancyGuardUpgradeable, OwnableUpgradeable {
    error InvalidLength();
    error UnknownAction(uint8 action);
    error UnknownVault(INFTVault vault);
    error IncompatibleVaults(INFTVault sourceVault, INFTVault destVault);

    event PositionMigrated(
        uint256 indexed nftIndex,
        INFTVault indexed sourceVault,
        INFTVault indexed destVault
    );

    struct BatchAction {
        address target;
        uint8[] actions;
        bytes[] data;
    }

    uint8 private constant ACTION_MIGRATE = 200;

    mapping(INFTVault => bool) public whitelistedVaults;
    mapping(INFTVault => bool) internal wrappedVaults;

    function initialize() external initializer {
        __Ownable_init();
        __ReentrancyGuard_init();
    }

    /// @notice Executes multiple actions on the specified vaults in one transaction.
    /// @dev If `_actions.target` equals `address(this)`, executes actions locally.
    function batchExecute(
        BatchAction[] calldata _actions
    ) external nonReentrant {
        uint256 _length = _actions.length;
        if (_length == 0) revert InvalidLength();

        for (uint256 i = 0; i < _length; ++i) {
            address _target = _actions[i].target;
            if (_target == address(this)) {
                _batchExecuteSelf(_actions[i].actions, _actions[i].data);
            } else if (whitelistedVaults[INFTVault(_target)]) {
                INFTVault(_target).doActionsFor(
                    msg.sender,
                    _actions[i].actions,
                    _actions[i].data
                );
            } else {
                revert UnknownVault(INFTVault(_target));
            }
        }
    }

    /// @notice Executes multiple (local) actions at once.
    function batchExecuteSelf(
        uint8[] calldata _actions,
        bytes[] calldata _data
    ) external nonReentrant {
        _batchExecuteSelf(_actions, _data);
    }

    function whitelistVault(
        address _vault,
        bool _isWrapped
    ) external onlyOwner {
        if (_vault == address(0)) revert();

        whitelistedVaults[INFTVault(_vault)] = true;
        wrappedVaults[INFTVault(_vault)] = _isWrapped;
    }

    function removeVault(INFTVault _vault) external onlyOwner {
        delete whitelistedVaults[_vault];
        delete wrappedVaults[_vault];
    }

    function _batchExecuteSelf(
        uint8[] calldata _actions,
        bytes[] calldata _data
    ) internal {
        if (_actions.length != _data.length) revert InvalidLength();
        for (uint256 i; i < _actions.length; ++i) {
            uint8 _action = _actions[i];
            if (_action == ACTION_MIGRATE) {
                (
                    INFTVault _sourceVault,
                    INFTVault _destVault,
                    uint256 _nftIndex
                ) = abi.decode(_data[i], (INFTVault, INFTVault, uint256));
                _migratePosition(_sourceVault, _destVault, _nftIndex);
            } else revert UnknownAction(_action);
        }
    }

    /// @notice Migrates the position at `_nftIndex` from `_sourceVault` to `_destVault`.
    /// Both vaults must be whitelisted, use the same collection as collateral and the same stablecoin.
    /// In case of wrapped NFTs, the underlying `nftAddress` is compared.
    /// Insurance is kept after the migration.
    function _migratePosition(
        INFTVault _sourceVault,
        INFTVault _destVault,
        uint256 _nftIndex
    ) internal {
        if (_sourceVault == _destVault) revert();

        if (!whitelistedVaults[_sourceVault]) revert UnknownVault(_sourceVault);
        if (!whitelistedVaults[_destVault]) revert UnknownVault(_destVault);

        if (_sourceVault.stablecoin() != _destVault.stablecoin())
            revert IncompatibleVaults(_sourceVault, _destVault);

        bool _isWrapped = wrappedVaults[_sourceVault];
        if (_isWrapped != wrappedVaults[_destVault])
            revert IncompatibleVaults(_sourceVault, _destVault);

        INFTVault.Position memory _position = _sourceVault.positions(_nftIndex);
        address _strategy;
        if (
            _position.strategy != address(0) &&
            _destVault.hasStrategy(_position.strategy)
        ) _strategy = _position.strategy;

        address _sourceNft = _sourceVault.nftContract();
        address _destNft = _destVault.nftContract();

        uint256 _debt;
        if (_isWrapped) {
            if (
                IVaultHelper(_sourceNft).nftContract() !=
                IVaultHelper(_destNft).nftContract()
            ) revert IncompatibleVaults(_sourceVault, _destVault);

            _debt = _sourceVault.forceClosePosition(
                msg.sender,
                _nftIndex,
                _strategy == address(0) ? _destNft : _strategy
            );
        } else if (_sourceNft != _destNft) {
            revert IncompatibleVaults(_sourceVault, _destVault);
        } else
            _debt = _sourceVault.forceClosePosition(
                msg.sender,
                _nftIndex,
                _strategy == address(0) ? address(_destVault) : _strategy
            );

        _destVault.importPosition(
            msg.sender,
            _nftIndex,
            _debt,
            _position.borrowType == INFTVault.BorrowType.USE_INSURANCE,
            _strategy
        );

        emit PositionMigrated(_nftIndex, _sourceVault, _destVault);
    }
}
