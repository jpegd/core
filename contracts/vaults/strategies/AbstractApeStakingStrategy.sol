// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";

import "../../interfaces/INFTStrategy.sol";
import "../../interfaces/IApeStaking.sol";
import "../../interfaces/ISimpleUserProxy.sol";

abstract contract AbstractApeStakingStrategy is
    AccessControlUpgradeable,
    PausableUpgradeable,
    INFTStrategy
{
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using AddressUpgradeable for address;

    error ZeroAddress();
    error InvalidLength();
    error Unauthorized();

    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");

    IApeStaking public apeStaking;
    IERC20Upgradeable public ape;
    address public nftContract;
    uint256 public poolId;

    address public clonesImplementation;

    function initialize(
        address _apeStaking,
        address _ape,
        address _nftContract,
        uint256 _poolId,
        address _clonesImplementation
    ) external initializer {
        if (_apeStaking == address(0)) revert ZeroAddress();

        if (_ape == address(0)) revert ZeroAddress();

        if (_nftContract == address(0)) revert ZeroAddress();

        if (_clonesImplementation == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        apeStaking = IApeStaking(_apeStaking);
        ape = IERC20Upgradeable(_ape);
        nftContract = _nftContract;
        poolId = _poolId;
        clonesImplementation = _clonesImplementation;

        _pause();
    }

    function kind() external pure override returns (INFTStrategy.Kind) {
        return INFTStrategy.Kind.STANDARD;
    }

    /// @return The user proxy address for `_account`
    function depositAddress(address _account)
        external
        view
        override
        returns (address)
    {
        return
            ClonesUpgradeable.predictDeterministicAddress(
                clonesImplementation,
                _salt(_account)
            );
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Function called by the NFT Vault after sending NFTs to the address calculated by {depositAddress}
    /// @param _owner The owner of the NFTs that have been deposited
    /// @param _nftIndexes The indexes of the NFTs that have been deposited
    /// @param _data Array containing the amounts of tokens to stake with the NFTs
    function afterDeposit(
        address _owner,
        uint256[] calldata _nftIndexes,
        bytes calldata _data
    ) external override onlyRole(VAULT_ROLE) {
        uint256 totalAmount;
        IApeStaking.SingleNft[] memory nfts;

        {
            uint256[] memory amounts = abi.decode(_data, (uint256[]));
            uint256 length = amounts.length;

            if (length != _nftIndexes.length) revert InvalidLength();

            nfts = new IApeStaking.SingleNft[](length);

            for (uint256 i; i < length; ++i) {
                uint256 amount = amounts[i];
                totalAmount += amount;
                nfts[i] = IApeStaking.SingleNft({
                    tokenId: _nftIndexes[i],
                    amount: amount
                });
            }
        }

        address clone;

        address[] memory targets;
        bytes[] memory data;
        uint256[] memory values;

        {
            address implementation = clonesImplementation;
            bytes32 salt = _salt(_owner);
            clone = ClonesUpgradeable.predictDeterministicAddress(
                implementation,
                salt
            );

            IERC20Upgradeable _ape = ape;
            _ape.safeTransferFrom(_owner, clone, totalAmount);

            IApeStaking _apeStaking = apeStaking;

            if (!clone.isContract()) {
                ClonesUpgradeable.cloneDeterministic(implementation, salt);
                ISimpleUserProxy(clone).initialize(address(this));
                targets = new address[](2);
                data = new bytes[](2);
                values = new uint256[](2);

                targets[0] = address(_ape);
                data[0] = abi.encodeWithSelector(
                    IERC20Upgradeable.approve.selector,
                    address(_apeStaking),
                    2**256 - 1
                );
            } else {
                targets = new address[](1);
                data = new bytes[](1);
                values = new uint256[](1);
            }

            targets[targets.length - 1] = address(_apeStaking);
            data[data.length - 1] = abi.encodeWithSelector(
                _depositSelector(),
                nfts
            );
        }

        ISimpleUserProxy(clone).doCalls(targets, data, values);
    }

    /// @notice Function called by the NFT Vault to withdraw an NFT from the strategy.
    /// @param _owner The owner of the NFT to withdraw
    /// @param _recipient The address to send the NFT to
    /// @param _nftIndex Index of the NFT to withdraw
    function withdraw(
        address _owner,
        address _recipient,
        uint256 _nftIndex
    ) external override onlyRole(VAULT_ROLE) {
        address clone = ClonesUpgradeable.predictDeterministicAddress(
            clonesImplementation,
            _salt(_owner)
        );
        if (!clone.isContract()) revert Unauthorized();

        IApeStaking _apeStaking = apeStaking;
        (uint256 stakedAmount, ) = _apeStaking.nftPosition(poolId, _nftIndex);

        address[] memory targets;
        bytes[] memory data;
        uint256[] memory values;

        if (stakedAmount > 0) {
            IApeStaking.SingleNft[] memory nfts = new IApeStaking.SingleNft[](
                1
            );
            nfts[0] = IApeStaking.SingleNft({
                tokenId: _nftIndex,
                amount: stakedAmount
            });

            targets = new address[](2);
            data = new bytes[](2);
            values = new uint256[](2);

            targets[0] = address(_apeStaking);
            data[0] = abi.encodeWithSelector(_withdrawSelector(), nfts, _owner);
        } else {
            targets = new address[](1);
            data = new bytes[](1);
            values = new uint256[](1);
        }

        targets[targets.length - 1] = nftContract;
        data[data.length - 1] = abi.encodeWithSelector(
            IERC721Upgradeable.transferFrom.selector,
            clone,
            _recipient,
            _nftIndex
        );

        ISimpleUserProxy(clone).doCalls(targets, data, values);
    }

    /// @notice Allows users to stake additional tokens for NFTs that have already been deposited in the strategy
    /// @param _nfts NFT IDs and token amounts to deposit 
    function stakeTokens(IApeStaking.SingleNft[] calldata _nfts) external {
        address clone = ClonesUpgradeable.predictDeterministicAddress(
            clonesImplementation,
            _salt(msg.sender)
        );
        if (!clone.isContract()) revert Unauthorized();

        uint256 length = _nfts.length;
        uint256 totalAmount;
        for (uint256 i; i < length; ++i) {
            totalAmount += _nfts[i].amount;
        }

        ape.safeTransferFrom(msg.sender, clone, totalAmount);

        _apeStakingCall(ISimpleUserProxy(clone), abi.encodeWithSelector(_depositSelector(), _nfts));
    }

    /// @notice Allows users to withdraw tokens from NFTs that have been deposited in the strategy
    /// @param _nfts NFT IDs and token amounts to withdraw
    /// @param _recipient The address to send the tokens to
    function withdrawStakedTokens(
        IApeStaking.SingleNft[] calldata _nfts,
        address _recipient
    ) external {
        _apeStakingCall(
            abi.encodeWithSelector(_withdrawSelector(), _nfts, _recipient)
        );
    }

    /// @notice Allows users to claim rewards from the Ape staking contract
    /// @param _nfts NFT IDs to claim tokens for 
    function claim(uint256[] memory _nfts, address _recipient) external {
        _apeStakingCall(
            abi.encodeWithSelector(_claimSelector(), _nfts, _recipient)
        );
    }

    function _apeStakingCall(bytes memory _data) internal {
        address clone = ClonesUpgradeable.predictDeterministicAddress(
            clonesImplementation,
            _salt(msg.sender)
        );
        if (!clone.isContract()) revert Unauthorized();

        _apeStakingCall(ISimpleUserProxy(clone), _data);
    }

    function _apeStakingCall(ISimpleUserProxy _clone, bytes memory _data)
        internal
    {
        address[] memory targets = new address[](1);
        bytes[] memory data = new bytes[](1);
        uint256[] memory values = new uint256[](1);

        targets[0] = address(apeStaking);
        data[0] = _data;

        _clone.doCalls(targets, data, values);
    }

    function _salt(address _address) internal pure returns (bytes32) {
        return keccak256(abi.encode(_address));
    }

    function _depositSelector() internal view virtual returns (bytes4);

    function _withdrawSelector() internal view virtual returns (bytes4);

    function _claimSelector() internal view virtual returns (bytes4);
}
