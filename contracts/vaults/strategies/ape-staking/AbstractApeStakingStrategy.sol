// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/ClonesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";

import "../../../interfaces/IStandardNFTStrategy.sol";
import "../../../interfaces/IApeStaking.sol";
import "../../../interfaces/ISimpleUserProxy.sol";

abstract contract AbstractApeStakingStrategy is
    AccessControlUpgradeable,
    PausableUpgradeable,
    IStandardNFTStrategy
{
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using AddressUpgradeable for address;

    error ZeroAddress();
    error InvalidLength();
    error Unauthorized();
    error FlashLoanFailed();

    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");
    bytes32 public constant BAKC_STRATEGY_ROLE =
        keccak256("BAKC_STRATEGY_ROLE");

    IApeStaking public apeStaking;
    IERC20Upgradeable public ape;
    address public mainNftContract;
    IERC721Upgradeable public bakcContract;
    uint256 public mainPoolId;
    uint256 public bakcPoolId;

    address public clonesImplementation;

    function initialize(
        address _apeStaking,
        address _ape,
        address _mainNftContract,
        address _bakcContract,
        uint256 _mainPoolId,
        uint256 _backPoolId,
        address _clonesImplementation
    ) external initializer {
        if (_apeStaking == address(0)) revert ZeroAddress();

        if (_ape == address(0)) revert ZeroAddress();

        if (_mainNftContract == address(0)) revert ZeroAddress();

        if (_bakcContract == address(0)) revert ZeroAddress();

        if (_clonesImplementation == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        apeStaking = IApeStaking(_apeStaking);
        ape = IERC20Upgradeable(_ape);
        mainNftContract = _mainNftContract;
        bakcContract = IERC721Upgradeable(_bakcContract);
        mainPoolId = _mainPoolId;
        bakcPoolId = _backPoolId;
        clonesImplementation = _clonesImplementation;
    }

    function kind() external pure override returns (Kind) {
        return Kind.STANDARD;
    }

    /// @return The user proxy address for `_account`
    function depositAddress(
        address _account
    ) public view override returns (address) {
        return
            ClonesUpgradeable.predictDeterministicAddress(
                clonesImplementation,
                _salt(_account)
            );
    }

    function isDeposited(
        address _owner,
        uint256 _nftIndex
    ) external view override returns (bool) {
        return
            IERC721Upgradeable(mainNftContract).ownerOf(_nftIndex) ==
            ClonesUpgradeable.predictDeterministicAddress(
                clonesImplementation,
                _salt(_owner)
            );
    }

    /// @notice Function called by the NFT Vault after sending NFTs to the address calculated by {depositAddress}.
    /// Deploys a clone contract at `depositAddress(_owner)` if it doesn't exist and stakes APE tokens
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

        uint256[] memory amounts = abi.decode(_data, (uint256[]));
        uint256 length = amounts.length;
        if (length != _nftIndexes.length) revert InvalidLength();

        nfts = new IApeStaking.SingleNft[](length);

        for (uint256 i; i < length; ++i) {
            uint256 amount = amounts[i];
            totalAmount += amount;
            nfts[i] = IApeStaking.SingleNft({
                tokenId: uint32(_nftIndexes[i]),
                amount: uint224(amount)
            });
        }

        address implementation = clonesImplementation;
        bytes32 salt = _salt(_owner);
        address clone = ClonesUpgradeable.predictDeterministicAddress(
            implementation,
            salt
        );

        IERC20Upgradeable _ape = ape;
        _ape.safeTransferFrom(_owner, clone, totalAmount);

        IApeStaking _apeStaking = apeStaking;

        if (!clone.isContract()) {
            ClonesUpgradeable.cloneDeterministic(implementation, salt);
            ISimpleUserProxy(clone).initialize(address(this));
            ISimpleUserProxy(clone).doCall(
                address(_ape),
                abi.encodeWithSelector(
                    IERC20Upgradeable.approve.selector,
                    address(_apeStaking),
                    2 ** 256 - 1
                )
            );
        }

        ISimpleUserProxy(clone).doCall(
            address(_apeStaking),
            abi.encodeWithSelector(_depositSelector(), nfts)
        );
    }

    /// @notice Function called by the NFT Vault to withdraw a NFT from the strategy.
    /// Staked APE tokens (including the ones from the BAKC pool, if any) are sent back to `_owner`.
    /// Any paired BAKC will have to be withdrawn manually by the user by interacting with {BAKCApeStakingStrategy}
    /// @param _owner The owner of the NFT to withdraw
    /// @param _recipient The address to send the NFT to
    /// @param _nftIndex Index of the NFT to withdraw
    function withdraw(
        address _owner,
        address _recipient,
        uint256 _nftIndex
    ) external override onlyRole(VAULT_ROLE) {
        address clone = _getCloneOrRevert(_owner);

        IApeStaking _apeStaking = apeStaking;
        uint256 _mainPoolId = mainPoolId;

        {
            (uint256 stakedAmount, ) = _apeStaking.nftPosition(
                _mainPoolId,
                _nftIndex
            );
            if (stakedAmount > 0) {
                IApeStaking.SingleNft[]
                    memory nfts = new IApeStaking.SingleNft[](1);
                nfts[0] = IApeStaking.SingleNft({
                    tokenId: uint32(_nftIndex),
                    amount: uint224(stakedAmount)
                });

                ISimpleUserProxy(clone).doCall(
                    address(_apeStaking),
                    abi.encodeWithSelector(_withdrawSelector(), nfts, _owner)
                );
            }
        }

        {
            (uint256 bakcIndex, bool isPaired) = _apeStaking.mainToBakc(
                _mainPoolId,
                _nftIndex
            );
            if (isPaired) {
                {
                    (uint256 stakedAmount, ) = _apeStaking.nftPosition(
                        bakcPoolId,
                        bakcIndex
                    );
                    IApeStaking.PairNftWithdrawWithAmount[]
                        memory nfts = new IApeStaking.PairNftWithdrawWithAmount[](
                            1
                        );
                    nfts[0] = IApeStaking.PairNftWithdrawWithAmount({
                        mainTokenId: uint32(_nftIndex),
                        bakcTokenId: uint32(bakcIndex),
                        amount: uint184(stakedAmount),
                        isUncommit: true
                    });
                    ISimpleUserProxy(clone).doCall(
                        address(_apeStaking),
                        _withdrawBAKCCalldata(nfts)
                    );
                }

                IERC20Upgradeable _ape = ape;
                uint256 balance = _ape.balanceOf(clone);

                ISimpleUserProxy(clone).doCall(
                    address(_ape),
                    abi.encodeWithSelector(
                        _ape.transfer.selector,
                        _owner,
                        balance
                    )
                );
            }
        }

        ISimpleUserProxy(clone).doCall(
            mainNftContract,
            abi.encodeWithSelector(
                IERC721Upgradeable.transferFrom.selector,
                clone,
                _recipient,
                _nftIndex
            )
        );
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
        if (_length == 0) revert InvalidLength();

        address _clone = _getCloneOrRevert(_owner);
        address _nftContract = mainNftContract;
        for (uint256 i; i < _length; ++i) {
            ISimpleUserProxy(_clone).doCall(
                _nftContract,
                abi.encodeWithSelector(
                    IERC721Upgradeable.transferFrom.selector,
                    _clone,
                    _recipient,
                    _nftIndexes[i]
                )
            );
        }

        return _clone;
    }

    /// @dev Flash loan end function. Due to the stateless nature of this strategy
    /// it's a noop. The vault already checks if all the NFTs have been returned to the correct address.
    function flashLoanEnd(
        address,
        uint256[] calldata,
        bytes calldata
    ) external view override onlyRole(VAULT_ROLE) {}

    /// @notice Allows users to deposit additional tokens for NFTs that have already been deposited in the strategy
    /// @param _nfts NFT IDs and token amounts to deposit
    function depositTokens(IApeStaking.SingleNft[] calldata _nfts) external {
        uint256 length = _nfts.length;
        if (length == 0) revert InvalidLength();

        address clone = _getCloneOrRevert(msg.sender);

        uint256 totalAmount;
        for (uint256 i; i < length; ++i) {
            totalAmount += _nfts[i].amount;
        }

        ape.safeTransferFrom(msg.sender, clone, totalAmount);

        ISimpleUserProxy(clone).doCall(
            address(apeStaking),
            abi.encodeWithSelector(_depositSelector(), _nfts)
        );
    }

    /// @notice Allows users to withdraw tokens from NFTs that have been deposited in the strategy
    /// @param _nfts NFT IDs and token amounts to withdraw
    /// @param _recipient The address to send the tokens to
    function withdrawTokens(
        IApeStaking.SingleNft[] calldata _nfts,
        address _recipient
    ) external {
        if (_nfts.length == 0) revert InvalidLength();

        ISimpleUserProxy clone = ISimpleUserProxy(
            _getCloneOrRevert(msg.sender)
        );

        clone.doCall(
            address(apeStaking),
            abi.encodeWithSelector(_withdrawSelector(), _nfts, _recipient)
        );
    }

    /// @notice Allows users to claim rewards from the Ape staking contract
    /// @param _nfts NFT IDs to claim tokens for
    function claimRewards(uint256[] memory _nfts, address _recipient) external {
        uint256 length = _nfts.length;
        if (length == 0) revert InvalidLength();

        ISimpleUserProxy clone = ISimpleUserProxy(
            _getCloneOrRevert(msg.sender)
        );
        clone.doCall(
            address(apeStaking),
            abi.encodeWithSelector(_claimSelector(), _nfts, _recipient)
        );
    }

    /// @notice Allows {BAKCApeStakingStrategy} to pair a BAKC (if unpaired) and deposit tokens.
    /// BAKC NFTs and the tokens need to already be transferred to the clone contract.
    /// @param _owner The owner of the NFTs
    /// @param _nfts Pair indexes and apecoin amounts to deposit
    function depositTokensBAKC(
        address _owner,
        IApeStaking.PairNftDepositWithAmount[] calldata _nfts
    ) external onlyRole(BAKC_STRATEGY_ROLE) {
        address _clone = _getCloneOrRevert(_owner);

        ISimpleUserProxy(_clone).doCall(
            address(apeStaking),
            _depositBAKCCalldata(_nfts)
        );
    }

    /// @notice Allows {BAKCApeStakingStrategy} to withdraw tokens from the BAKC pool.
    /// The tokens are only withdrawn from the ape staking contract, withdrawing them from the clone
    /// contract requires a call to {transferApeCoin}.
    /// @param _owner The owner of the NFT pairs.
    /// @param _nfts The pairs to withdraw tokens from and the amount of tokens to withdraw
    function withdrawTokensBAKC(
        address _owner,
        IApeStaking.PairNftWithdrawWithAmount[] calldata _nfts
    ) external onlyRole(BAKC_STRATEGY_ROLE) {
        address _clone = _getCloneOrRevert(_owner);

        ISimpleUserProxy(_clone).doCall(
            address(apeStaking),
            _withdrawBAKCCalldata(_nfts)
        );
    }

    /// @notice Allows {BAKCApeStakingStrategy} to transfer tokens from the clone contract.
    /// The entire apecoin balance of the clone contract is transferred.
    /// @param _owner The owner of the tokens to transfer
    /// @param _recipient Token transfer recipient
    function transferApeCoin(
        address _owner,
        address _recipient
    ) external onlyRole(BAKC_STRATEGY_ROLE) {
        address _clone = _getCloneOrRevert(_owner);

        IERC20Upgradeable _ape = ape;
        uint256 _apeBalance = _ape.balanceOf(_clone);

        if (_apeBalance > 0)
            ISimpleUserProxy(_clone).doCall(
                address(_ape),
                abi.encodeWithSelector(
                    _ape.transfer.selector,
                    _recipient,
                    _apeBalance
                )
            );
    }

    /// @notice Allows {BAKCApeStakingStrategy} to transfer BAKC nfts from the clone contract.
    /// @param _owner The owner of the BAKC nfts
    /// @param _nftIndexes The BAKC nfts to transfer
    /// @param _recipient The address to send the BAKC nfts to.
    function transferBAKC(
        address _owner,
        uint256[] memory _nftIndexes,
        address _recipient
    ) external onlyRole(BAKC_STRATEGY_ROLE) {
        address _clone = _getCloneOrRevert(_owner);

        uint256 _length = _nftIndexes.length;
        if (_length == 0) revert InvalidLength();

        address _bakcContract = address(bakcContract);
        for (uint256 i; i < _length; ++i) {
            ISimpleUserProxy(_clone).doCall(
                _bakcContract,
                abi.encodeWithSelector(
                    IERC721Upgradeable.transferFrom.selector,
                    _clone,
                    _recipient,
                    _nftIndexes[i]
                )
            );
        }
    }

    /// @notice Allows {BAKCApeStakingStrategy} to claim ape rewards from the BAKC pool.
    /// @param _owner The owner of the NFT pairs to claim from
    /// @param _nfts The nft pairs to claim from
    /// @param _recipient The address to send the claimed tokens to
    function claimRewardsBAKC(
        address _owner,
        IApeStaking.PairNft[] calldata _nfts,
        address _recipient
    ) external onlyRole(BAKC_STRATEGY_ROLE) {
        ISimpleUserProxy _clone = ISimpleUserProxy(_getCloneOrRevert(_owner));
        _clone.doCall(
            address(apeStaking),
            _claimBAKCCalldata(_nfts, _recipient)
        );
    }

    function _getCloneOrRevert(
        address _account
    ) internal view returns (address clone) {
        clone = depositAddress(_account);
        if (!clone.isContract()) revert Unauthorized();
    }

    function _salt(address _address) internal pure returns (bytes32) {
        return keccak256(abi.encode(_address));
    }

    function _depositSelector() internal view virtual returns (bytes4);

    function _withdrawSelector() internal view virtual returns (bytes4);

    function _claimSelector() internal view virtual returns (bytes4);

    function _depositBAKCCalldata(
        IApeStaking.PairNftDepositWithAmount[] calldata _nfts
    ) internal view virtual returns (bytes memory);

    function _withdrawBAKCCalldata(
        IApeStaking.PairNftWithdrawWithAmount[] memory _nfts
    ) internal view virtual returns (bytes memory);

    function _claimBAKCCalldata(
        IApeStaking.PairNft[] memory _nfts,
        address _recipient
    ) internal view virtual returns (bytes memory);
}
