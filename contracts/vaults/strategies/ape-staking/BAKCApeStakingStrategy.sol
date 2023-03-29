// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../../../interfaces/IApeStakingStrategy.sol";

contract BAKCApeStakingStrategy is
    AccessControlUpgradeable,
    IStandardNFTStrategy
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    error InvalidLength();
    error InvalidAmount();
    error AlreadyDeposited(uint256 idx);
    error NotDirectDeposit(uint256 idx);

    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IApeStakingStrategy public immutable MAIN_STRATEGY;
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    uint256 public immutable MAIN_ID;
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IERC20Upgradeable public immutable APE;
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IApeStaking public immutable APE_STAKING;

    /// @notice This mapping only keeps track of NFTs deposited through the vault.
    /// NFTs deposited before the launch of the BAKC vault aren't tracked here.
    /// This is needed to allow direct withdrawals for NFTs not deposited through the vault
    mapping(uint256 => bool) public depositedNFTs;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(
        IApeStakingStrategy _mainStrategy,
        IERC20Upgradeable _ape,
        IApeStaking _apeStaking
    ) {
        MAIN_STRATEGY = _mainStrategy;
        APE = _ape;
        APE_STAKING = _apeStaking;

        MAIN_ID = _mainStrategy.mainPoolId();
    }

    function initialize() external initializer {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function kind() external pure override returns (Kind) {
        return Kind.STANDARD;
    }

    function depositAddress(
        address _account
    ) external view override returns (address) {
        return MAIN_STRATEGY.depositAddress(_account);
    }

    function isDeposited(
        address,
        uint256 _nftIndex
    ) external view override returns (bool) {
        return depositedNFTs[_nftIndex];
    }

    /// @notice Function called by the NFT Vault after sending NFTs to the address calculated by {depositAddress}.
    /// Requires the clone contract at `depositAddress(_owner)` to exist (BAYC/MAYC need to already be staked).
    /// @param _owner The owner of the NFTs that have been deposited
    /// @param _nftIndexes The indexes of the NFTs that have been deposited
    /// @param _data Array of `IApeStaking.SingleNft` containing the main NFT indexes to pair with the deposited BAKCs and the amount of tokens
    function afterDeposit(
        address _owner,
        uint256[] calldata _nftIndexes,
        bytes calldata _data
    ) external override onlyRole(VAULT_ROLE) {
        IApeStaking.SingleNft[] memory _main = abi.decode(
            _data,
            (IApeStaking.SingleNft[])
        );

        uint256 _length = _main.length;
        if (_nftIndexes.length != _length) revert InvalidLength();

        uint256 _apeAmount;
        IApeStaking.PairNftDepositWithAmount[]
            memory _nfts = new IApeStaking.PairNftDepositWithAmount[](_length);
        for (uint256 i; i < _length; ++i) {
            if (_main[i].amount == 0) revert InvalidAmount();

            _nfts[i] = IApeStaking.PairNftDepositWithAmount({
                mainTokenId: _main[i].tokenId,
                bakcTokenId: uint32(_nftIndexes[i]),
                amount: uint184(_main[i].amount)
            });

            _apeAmount += _main[i].amount;
            depositedNFTs[_nftIndexes[i]] = true;
        }

        APE.safeTransferFrom(
            _owner,
            MAIN_STRATEGY.depositAddress(_owner),
            _apeAmount
        );

        MAIN_STRATEGY.depositTokensBAKC(_owner, _nfts);
    }

    /// @notice Function called by the NFT Vault to withdraw an NFT from the strategy.
    /// Staked APE tokens (if any) are sent back to `_owner`.
    /// @param _owner The owner of the NFT to withdraw
    /// @param _recipient The address to send the NFT to
    /// @param _nftIndex Index of the NFT to withdraw
    function withdraw(
        address _owner,
        address _recipient,
        uint256 _nftIndex
    ) external override onlyRole(VAULT_ROLE) {
        (uint248 _mainIndex, bool _isPaired) = APE_STAKING.bakcToMain(
            _nftIndex,
            MAIN_ID
        );

        if (_isPaired) {
            IApeStaking.PairNftWithdrawWithAmount[]
                memory _nfts = new IApeStaking.PairNftWithdrawWithAmount[](1);
            _nfts[0] = IApeStaking.PairNftWithdrawWithAmount({
                mainTokenId: uint32(_mainIndex),
                bakcTokenId: uint32(_nftIndex),
                amount: 0,
                isUncommit: true
            });

            MAIN_STRATEGY.withdrawTokensBAKC(_owner, _nfts);
            MAIN_STRATEGY.transferApeCoin(_owner, _owner);
        }

        uint256[] memory _idxs = new uint256[](1);
        _idxs[0] = _nftIndex;
        MAIN_STRATEGY.transferBAKC(_owner, _idxs, _recipient);

        delete depositedNFTs[_nftIndex];
    }

    /// @dev Allows the vault to flash loan the NFTs without having to withdraw them from this strategy.
    /// Useful for claiming airdrops. Can only be called by the vault.
    /// It's not an actual flash loan function as it doesn't expect the NFTs to be returned at the end of the call,
    /// but instead it trusts the vault to do the necessary safety checks.
    /// @param _owner The owner of the NFTs to flash loan
    /// @param _recipient The address to send the NFTs to
    /// @param _nftIndexes The NFTs to send
    function flashLoanStart(
        address _owner,
        address _recipient,
        uint256[] calldata _nftIndexes,
        bytes calldata
    ) external override onlyRole(VAULT_ROLE) returns (address) {
        MAIN_STRATEGY.transferBAKC(_owner, _nftIndexes, _recipient);

        return MAIN_STRATEGY.depositAddress(_owner);
    }

    /// @dev Flash loan end function. Due to the (almost) stateless nature of this strategy
    /// it's a noop. The vault already checks if all the NFTs have been returned to the correct address.
    function flashLoanEnd(
        address,
        uint256[] calldata,
        bytes calldata
    ) external override onlyRole(VAULT_ROLE) {}

    /// @notice Allows users to deposit additional tokens for NFTs that have already been deposited in the strategy
    /// @param _nfts Pair IDs and token amounts to deposit
    function depositTokens(
        IApeStaking.PairNftDepositWithAmount[] calldata _nfts
    ) external {
        uint256 _length = _nfts.length;
        if (_length == 0) revert InvalidLength();

        uint256 _totalAmount;
        for (uint256 i; i < _length; ++i) {
            _totalAmount += _nfts[i].amount;
        }

        APE.safeTransferFrom(
            msg.sender,
            MAIN_STRATEGY.depositAddress(msg.sender),
            _totalAmount
        );

        MAIN_STRATEGY.depositTokensBAKC(msg.sender, _nfts);
    }

    /// @notice Allows users to withdraw tokens from NFTs that have been deposited in the strategy
    /// @param _nfts Pair IDs and token amounts to withdraw
    /// @param _recipient The address to send the tokens to
    function withdrawTokens(
        IApeStaking.PairNftWithdrawWithAmount[] calldata _nfts,
        address _recipient
    ) external {
        if (_nfts.length == 0) revert InvalidLength();

        MAIN_STRATEGY.withdrawTokensBAKC(msg.sender, _nfts);
        MAIN_STRATEGY.transferApeCoin(msg.sender, _recipient);
    }

    /// @notice Allows users to claim rewards
    /// @param _nfts Pair IDs to claim for
    /// @param _recipient The address to send the tokens to
    function claimRewards(
        IApeStaking.PairNft[] calldata _nfts,
        address _recipient
    ) external {
        if (_nfts.length == 0) revert InvalidLength();

        MAIN_STRATEGY.claimRewardsBAKC(msg.sender, _nfts, _recipient);
    }

    /// @notice Allows users with legacy BAKC deposits to withdraw their NFTs.
    /// Legacy deposits were done directly to the strategy instead of going through the vault.
    /// Reverts if called for a non legacy deposit
    /// @param _nfts The NFTs to withdraw
    /// @param _recipient The address to send the NFTs (and apecoin tokens, if any) to
    function withdrawNFTs(
        uint256[] calldata _nfts,
        address _recipient
    ) external {
        uint256 _length = _nfts.length;

        if (_length == 0) revert InvalidLength();

        for (uint256 i; i < _length; ++i) {
            if (depositedNFTs[_nfts[i]]) revert NotDirectDeposit(_nfts[i]);

            (uint248 _mainIndex, bool _isPaired) = APE_STAKING.bakcToMain(
                _nfts[i],
                MAIN_ID
            );

            if (_isPaired) {
                IApeStaking.PairNftWithdrawWithAmount[]
                    memory _pairNfts = new IApeStaking.PairNftWithdrawWithAmount[](
                        1
                    );
                _pairNfts[0] = IApeStaking.PairNftWithdrawWithAmount({
                    mainTokenId: uint32(_mainIndex),
                    bakcTokenId: uint32(_nfts[i]),
                    amount: 0,
                    isUncommit: true
                });
                MAIN_STRATEGY.withdrawTokensBAKC(msg.sender, _pairNfts);
            }
        }

        MAIN_STRATEGY.transferBAKC(msg.sender, _nfts, _recipient);
        MAIN_STRATEGY.transferApeCoin(msg.sender, _recipient);
    }
}
