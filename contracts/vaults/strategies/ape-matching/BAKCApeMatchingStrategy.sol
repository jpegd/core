// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";

import "../../../interfaces/IStandardNFTStrategy.sol";
import "../../../interfaces/IApeMatchingMarketplace.sol";

contract BAKCApeMatchingStrategy is
    IStandardNFTStrategy,
    AccessControlUpgradeable
{
    using SafeCastUpgradeable for uint256;

    error InvalidLength();

    struct DepositBAKCParams {
        uint24 nonce;
        uint16 bakcTokenId;
        uint80 apeAmount;
    }

    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");

    uint8 internal constant ACTION_DEPOSIT_BAKC = 101;
    uint8 internal constant ACTION_WITHDRAW_BAKC = 103;
    uint8 internal constant ACTION_TRANSFER_BAKC = 105;

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IApeMatchingMarketplace public immutable APE_MATCHING;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IApeMatchingMarketplace _apeMatching) {
        APE_MATCHING = _apeMatching;
    }

    function initialize() external initializer {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function kind() external pure override returns (Kind) {
        return Kind.STANDARD;
    }

    function depositAddress(address) public view override returns (address) {
        return address(APE_MATCHING);
    }

    function isDeposited(
        address,
        uint256 _nftIndex
    ) external view override returns (bool) {
        return APE_MATCHING.bakcDeposits(_nftIndex.toUint16()).isDeposited;
    }

    /// @notice Function called by the NFT Vault after sending NFTs to the address returned by {depositAddress}.
    /// Calls {doStrategyActions} with `ACTION_DEPOSIT_BAKC`.
    /// @param _owner The owner of the NFTs that have been deposited
    /// @param _nftIndexes The indexes of the NFTs that have been deposited
    /// @param _data Array of `DepositBAKCParams`
    function afterDeposit(
        address _owner,
        uint256[] calldata _nftIndexes,
        bytes calldata _data
    ) external override onlyRole(VAULT_ROLE) {
        DepositBAKCParams[] memory _params = abi.decode(
            _data,
            (DepositBAKCParams[])
        );
        uint256 _length = _params.length;
        if (_length != _nftIndexes.length) revert InvalidLength();

        uint8[] memory _actions = new uint8[](_length);
        bytes[] memory _depositData = new bytes[](_length);
        for (uint256 i; i < _length; ++i) {
            _actions[i] = ACTION_DEPOSIT_BAKC;
            _depositData[i] = abi.encode(
                _params[i].nonce,
                _params[i].bakcTokenId,
                _params[i].apeAmount
            );
        }

        APE_MATCHING.doStrategyActions(_owner, _actions, _depositData);
    }

    /// @notice Function called by the NFT Vault to withdraw a NFT from the marketplace.
    /// @param _owner The owner of the NFT to withdraw
    /// @param _recipient The address to send the NFT to
    /// @param _nftIndex Index of the NFT to withdraw
    function withdraw(
        address _owner,
        address _recipient,
        uint256 _nftIndex
    ) external override onlyRole(VAULT_ROLE) {
        uint8[] memory _actions = new uint8[](1);
        bytes[] memory _data = new bytes[](1);

        _actions[0] = ACTION_WITHDRAW_BAKC;
        _data[0] = abi.encode(_nftIndex.toUint16(), _recipient);
        APE_MATCHING.doStrategyActions(_owner, _actions, _data);
    }

    /// @dev Allows the vault to flash loan NFTs without having to withdraw them from this strategy.
    /// Useful for claiming airdrops. Can only be called by the vault.
    /// It's not an actual flash loan function as it doesn't expect the NFTs to be returned at the end of the call,
    /// but instead it trusts the vault to do the necessary safety checks.
    /// @param _owner The owner of the NFTs to flash loan
    /// @param _recipient The address to send the NFTs to
    /// @param _nftIndexes The NFTs to send
    function flashLoanStart(
        address _owner,
        address _recipient,
        uint256[] memory _nftIndexes,
        bytes calldata
    ) external override onlyRole(VAULT_ROLE) returns (address) {
        uint256 _length = _nftIndexes.length;

        uint8[] memory _actions = new uint8[](_length);
        bytes[] memory _data = new bytes[](_length);
        for (uint256 i; i < _length; ++i) {
            _actions[i] = ACTION_TRANSFER_BAKC;
            _data[i] = abi.encode(_nftIndexes[i], _recipient);
        }

        APE_MATCHING.doStrategyActions(_owner, _actions, _data);

        return address(APE_MATCHING);
    }

    /// @dev Flash loan end function. Due to the stateless nature of this strategy
    /// it's a noop. The vault already checks if all the NFTs have been returned to the correct address.
    function flashLoanEnd(
        address,
        uint256[] calldata,
        bytes calldata
    ) external view override onlyRole(VAULT_ROLE) {}
}
