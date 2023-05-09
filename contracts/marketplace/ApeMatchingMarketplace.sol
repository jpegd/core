// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "../interfaces/IApeStaking.sol";
import "../utils/ApeStakingLib.sol";

/// @custom:oz-upgrades-unsafe-allow external-library-linking
contract ApeMatchingMarketplace is
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    error InvalidLength();
    error InvalidAmount();
    error InvalidRewardShare();
    error InvalidOffer(uint24 nonce);
    error NoRewards();
    error Unauthorized();
    error InvalidNFT();
    error UnknownAction(uint8 action);

    event OfferCreated(
        address indexed owner,
        uint256 indexed nonce,
        uint256 indexed tokenId,
        ApeStakingLib.Collections collection
    );

    event ApeDeposited(
        address indexed account,
        uint256 indexed nonce,
        uint256 amount
    );

    event ApeWithdrawn(
        address indexed account,
        uint256 indexed nonce,
        uint256 amount
    );

    event RewardsClaimed(
        address indexed account,
        uint256 indexed nonce,
        uint256 amount
    );

    event MainWithdrawn(
        address indexed account,
        uint256 indexed nonce,
        uint256 indexed tokenId,
        ApeStakingLib.Collections collection
    );

    event BAKCDeposited(
        address indexed account,
        uint256 indexed nonce,
        uint256 indexed bakcId
    );

    event BAKCWithdrawn(
        address indexed account,
        uint256 indexed nonce,
        uint256 indexed bakcId
    );

    enum OfferType {
        NONE,
        MAIN,
        BAKC,
        SINGLE_SIDE
    }

    struct MainNFT {
        ApeStakingLib.Collections collection;
        uint16 tokenId;
    }

    struct Offer {
        OfferType offerType;
        MainNFT mainNft;
        uint16 bakcTokenId;
        uint80 apeAmount;
        uint16 apeRewardShareBps;
        uint16 bakcRewardShareBps;
        bool isPaired;
        uint80 lastSingleStakingRewardPerShare;
    }

    struct MainNFTDeposit {
        uint24 mainOfferNonce;
        uint24 bakcOfferNonce;
        bool isDeposited;
    }

    struct BAKCDeposit {
        uint24 offerNonce;
        bool isDeposited;
    }

    struct SingleStakingPool {
        uint176 apeAmount;
        uint80 rewardsPerShare;
    }

    struct Position {
        uint80 apeAmount;
        uint80 lastRewardsPerShare;
        bool isOwner;
        bool isBAKCOwner;
        bool isSingleStaking;
    }

    struct OfferRewards {
        uint80 rewardsPerShare;
        uint80 ownerRewards;
        uint80 bakcRewards;
    }

    bytes32 internal constant STRATEGY_ROLE = keccak256("STRATEGY_ROLE");

    /// @dev `REWARDS_PRECISION` being equal to `MIN_APE` prevents
    /// the calculations in {_calculateAdditionalRewards} and {_calculateAdditionalSingleSidedRewards} from ever overflowing
    uint256 internal constant REWARDS_PRECISION = MIN_APE;

    uint80 internal constant MIN_APE = 1 ether;

    uint80 internal constant MAX_APE_BAYC = 10094 ether;
    uint80 internal constant MAX_APE_MAYC = 2042 ether;
    uint80 internal constant MAX_APE_BAKC = 856 ether;

    uint256 internal constant APE_POOL_ID = 0;
    uint256 internal constant BAYC_POOL_ID = 1;
    uint256 internal constant MAYC_POOL_ID = 2;
    uint256 internal constant BAKC_POOL_ID = 3;

    //public actions
    uint8 internal constant ACTION_DEPOSIT_APE = 0;
    uint8 internal constant ACTION_WITHDRAW_APE = 1;
    uint8 internal constant ACTION_CLAIM_APE = 2;

    //strategy actions
    uint8 internal constant ACTION_DEPOSIT_MAIN = 100;
    uint8 internal constant ACTION_DEPOSIT_BAKC = 101;
    uint8 internal constant ACTION_WITHDRAW_MAIN = 102;
    uint8 internal constant ACTION_WITHDRAW_BAKC = 103;
    uint8 internal constant ACTION_TRANSFER_MAIN = 104;
    uint8 internal constant ACTION_TRANSFER_BAKC = 105;

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IERC20Upgradeable internal immutable APE;
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IApeStaking internal immutable APE_STAKING;

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IERC721Upgradeable internal immutable BAYC;
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IERC721Upgradeable internal immutable MAYC;
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IERC721Upgradeable internal immutable BAKC;

    uint24 public nextNonce;

    SingleStakingPool internal singleStakingPool;

    mapping(uint24 => Offer) public offers;
    mapping(uint24 => mapping(address => Position)) public positions;

    mapping(ApeStakingLib.Collections => mapping(uint16 => MainNFTDeposit))
        public mainDeposits;
    mapping(uint16 => BAKCDeposit) public bakcDeposits;

    mapping(uint24 => OfferRewards) internal rewards;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(
        address _apeStaking,
        address _ape,
        address _bayc,
        address _mayc,
        address _bakc
    ) {
        if (_apeStaking == address(0)) revert();
        if (_ape == address(0)) revert();
        if (_bayc == address(0)) revert();
        if (_mayc == address(0)) revert();
        if (_bakc == address(0)) revert();

        APE_STAKING = IApeStaking(_apeStaking);

        APE = IERC20Upgradeable(_ape);

        BAYC = IERC721Upgradeable(_bayc);
        MAYC = IERC721Upgradeable(_mayc);
        BAKC = IERC721Upgradeable(_bakc);
    }

    function initialize() external initializer {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        APE.approve(address(APE_STAKING), type(uint256).max);
    }

    /// @return _userRewards Pending rewards for the position for account `_user` and offer nonce `_nonce`
    /// @param _nonce The offer nonce
    /// @param _user The owner of the position
    function pendingRewards(
        uint24 _nonce,
        address _user
    ) external view returns (uint256 _userRewards) {
        Offer memory _offer = offers[_nonce];
        Position memory _position = positions[_nonce][_user];
        OfferRewards memory _offerRewards = rewards[_nonce];

        if (
            _offer.offerType == OfferType.MAIN ||
            _offer.offerType == OfferType.BAKC
        )
            (, , , _userRewards, ) = _calculateUpdatedRewardsData(
                _position,
                _offerRewards,
                _offer
            );
        else if (_offer.offerType == OfferType.SINGLE_SIDE) {
            if (!_position.isSingleStaking) {
                (, , _userRewards) = _calculateUpdatedPositionRewards(
                    _position,
                    _offerRewards.rewardsPerShare,
                    _offerRewards.ownerRewards,
                    _offerRewards.bakcRewards
                );

                _position.lastRewardsPerShare = _offer
                    .lastSingleStakingRewardPerShare;
            }

            (
                ,
                uint256 _tempRewards,

            ) = _calculateUpdatedSingleSidedRewardsData(
                    _position,
                    singleStakingPool
                );

            _userRewards += _tempRewards;
        }
    }

    /// @notice Allows users to execute multiple actions in a single transaction.
    /// @param _actions The actions to execute.
    /// @param _data The abi encoded parameters for the actions to execute.
    function doActions(
        uint8[] calldata _actions,
        bytes[] calldata _data
    ) external nonReentrant {
        uint256 _length = _actions.length;
        if (_length != _data.length) revert InvalidLength();

        for (uint256 i; i < _length; ++i) {
            uint8 _action = _actions[i];

            if (_action == ACTION_DEPOSIT_APE) {
                (uint24 _nonce, uint80 _apeAmount) = abi.decode(
                    _data[i],
                    (uint24, uint80)
                );
                _depositApe(_nonce, _apeAmount);
            } else if (_action == ACTION_WITHDRAW_APE) {
                (uint24 _nonce, uint80 _apeAmount) = abi.decode(
                    _data[i],
                    (uint24, uint80)
                );
                _withdrawApe(_nonce, _apeAmount);
            } else if (_action == ACTION_CLAIM_APE) {
                uint24 _nonce = abi.decode(_data[i], (uint24));
                _claimApe(_nonce);
            } else revert UnknownAction(_action);
        }
    }

    /// @notice Allows strategies to execute multiple actions in a single transaction.
    /// @param _actions The actions to execute.
    /// @param _data The abi encoded parameters for the actions to execute.
    function doStrategyActions(
        address _caller,
        uint8[] calldata _actions,
        bytes[] calldata _data
    ) external nonReentrant {
        _checkRole(STRATEGY_ROLE, msg.sender);

        uint256 _length = _actions.length;
        if (_length != _data.length) revert InvalidLength();

        for (uint256 i; i < _length; ++i) {
            uint8 _action = _actions[i];

            if (_action == ACTION_DEPOSIT_MAIN) {
                (
                    MainNFT memory _nft,
                    uint80 _apeAmountMain,
                    uint80 _apeAmountBAKC,
                    uint16 _mainPoolApeShareBps,
                    uint16 _bakcPoolApeShareBps,
                    uint16 _bakcPoolBAKCShareBps
                ) = abi.decode(
                        _data[i],
                        (MainNFT, uint80, uint80, uint16, uint16, uint16)
                    );
                _depositMain(
                    _caller,
                    _nft,
                    _apeAmountMain,
                    _apeAmountBAKC,
                    _mainPoolApeShareBps,
                    _bakcPoolApeShareBps,
                    _bakcPoolBAKCShareBps
                );
            } else if (_action == ACTION_DEPOSIT_BAKC) {
                (uint24 _nonce, uint16 _bakcTokenId, uint80 _apeAmount) = abi
                    .decode(_data[i], (uint24, uint16, uint80));
                _depositBAKC(_caller, _nonce, _bakcTokenId, _apeAmount);
            } else if (_action == ACTION_WITHDRAW_MAIN) {
                (
                    ApeStakingLib.Collections _collection,
                    uint16 _tokenId,
                    address _recipient
                ) = abi.decode(
                        _data[i],
                        (ApeStakingLib.Collections, uint16, address)
                    );
                _withdrawMain(_caller, _collection, _tokenId, _recipient);
            } else if (_action == ACTION_WITHDRAW_BAKC) {
                (uint16 _bakcTokenId, address _recipient) = abi.decode(
                    _data[i],
                    (uint16, address)
                );
                _withdrawBAKC(_caller, _bakcTokenId, _recipient);
            } else if (_action == ACTION_TRANSFER_MAIN) {
                (
                    ApeStakingLib.Collections _collection,
                    uint16 _tokenId,
                    address _recipient
                ) = abi.decode(
                        _data[i],
                        (ApeStakingLib.Collections, uint16, address)
                    );

                if (_collection == ApeStakingLib.Collections.BAYC)
                    _transferNFT(BAYC, address(this), _recipient, _tokenId);
                else _transferNFT(MAYC, address(this), _recipient, _tokenId);
            } else if (_action == ACTION_TRANSFER_BAKC) {
                (uint16 _bakcTokenId, address _recipient) = abi.decode(
                    _data[i],
                    (uint16, address)
                );
                _transferNFT(BAKC, address(this), _recipient, _bakcTokenId);
            } else revert UnknownAction(_action);
        }
    }

    //doActions functions

    /// @notice Allows users to deposit `_apeAmount` of apecoin for the offer with nonce `_nonce`.
    /// Can be called with action `ACTION_DEPOSIT_APE`.
    /// @param _nonce The offer nonce
    /// @param _apeAmount The amount of apecoin to deposit
    function _depositApe(uint24 _nonce, uint80 _apeAmount) internal {
        Offer memory _offer = offers[_nonce];
        if (
            _offer.offerType != OfferType.MAIN &&
            _offer.offerType != OfferType.BAKC
        ) revert InvalidOffer(_nonce);

        _validateApeDeposit(
            _apeAmount,
            _offer.apeAmount,
            _offer.offerType,
            _offer.mainNft.collection
        );

        (Position memory _position, uint256 _rewards) = _claimRewards(
            msg.sender,
            _nonce,
            positions[_nonce][msg.sender],
            _offer
        );

        if (_rewards > _apeAmount) {
            unchecked {
                _transferApe(address(this), msg.sender, _rewards - _apeAmount);
            }
        } else {
            unchecked {
                _transferApe(msg.sender, address(this), _apeAmount - _rewards);
            }
        }

        if (_offer.offerType == OfferType.MAIN)
            _stakeApeMain(
                _apeAmount,
                _offer.mainNft.collection,
                _offer.mainNft.tokenId
            );
        else if (_offer.isPaired)
            _stakeApeBAKC(
                _apeAmount,
                _offer.mainNft.collection,
                _offer.mainNft.tokenId,
                _offer.bakcTokenId
            );

        _position.apeAmount += _apeAmount;
        _offer.apeAmount += _apeAmount;

        positions[_nonce][msg.sender] = _position;
        offers[_nonce] = _offer;

        emit ApeDeposited(msg.sender, _nonce, _apeAmount);
    }

    /// @notice Allows users to withdraw `_apeAmount` of apecoin from the offer with nonce `_nonce`.
    /// Can be called with action `ACTION_WITHDRAW_APE`.
    /// @param _nonce The offer nonce
    /// @param _apeAmount The amount of apecoin to withdraw
    function _withdrawApe(uint24 _nonce, uint80 _apeAmount) internal {
        Offer memory _offer = offers[_nonce];

        (Position memory _position, uint256 _rewards) = _claimRewards(
            msg.sender,
            _nonce,
            positions[_nonce][msg.sender],
            _offer
        );

        if (_apeAmount < MIN_APE || _apeAmount > _position.apeAmount)
            revert InvalidAmount();

        unchecked {
            _position.apeAmount -= _apeAmount;
        }

        if (_position.apeAmount != 0 && _position.apeAmount < MIN_APE)
            revert InvalidAmount();

        if (_offer.offerType == OfferType.MAIN)
            _unstakeApeMain(
                _apeAmount,
                _offer.mainNft.collection,
                _offer.mainNft.tokenId
            );
        else if (_offer.offerType == OfferType.BAKC) {
            if (_offer.isPaired)
                _unstakeApeBAKC(
                    _apeAmount,
                    _offer.apeAmount == _apeAmount,
                    _offer.mainNft.collection,
                    _offer.mainNft.tokenId,
                    _offer.bakcTokenId
                );
        } else if (_offer.offerType == OfferType.SINGLE_SIDE) {
            singleStakingPool.apeAmount -= _apeAmount;
            APE_STAKING.withdrawApeCoin(_apeAmount, address(this));
        }

        _offer.apeAmount -= _apeAmount;

        positions[_nonce][msg.sender] = _position;
        offers[_nonce] = _offer;

        _transferApe(address(this), msg.sender, _apeAmount + _rewards);

        emit ApeWithdrawn(msg.sender, _nonce, _apeAmount);
    }

    /// @notice Allows users to claim pending rewards from the offer with nonce `_nonce`.
    /// Can be called with action `ACTION_CLAIM_APE`.
    /// @param _nonce The offer nonce
    function _claimApe(uint24 _nonce) internal {
        (Position memory _position, uint256 _rewards) = _claimRewards(
            msg.sender,
            _nonce,
            positions[_nonce][msg.sender],
            offers[_nonce]
        );

        positions[_nonce][msg.sender] = _position;

        if (_rewards == 0) revert NoRewards();

        _transferApe(address(this), msg.sender, _rewards);
    }

    //doStrategyActions functions

    /// @notice Allows strategies to deposit a BAYC/MAYC and create offers with the specified params.
    /// Can be called with action `ACTION_DEPOSIT_MAIN`
    /// @param _caller The account the strategy is calling for
    /// @param _nft The NFT to deposit
    /// @param _apeAmountMain The amount of ape to deposit to the newly created main offer. If not 0, has to be greater than `MIN_APE`
    /// and less than `MAX_APE_BAYC` for BAYCs and `MAX_APE_MAYC` for MAYCs
    /// @param _apeAmountBAKC The amount of ape to deposit to the newly created bakc offer. If not 0, has to be greater than `MIN_APE`
    /// and less than `MAX_APE_BAKC`
    /// @param _mainPoolApeShareBps The apecoin share of rewards in bps for the main offer. Has to be greater than 0 and less than 10000.
    /// @param _bakcPoolApeShareBps The apecoin share of rewards in bps for the bakc offer. Has to be greater than 0 and less than 10000.
    /// @param _bakcPoolBAKCShareBps The BAKC share of rewards in bps for the bakc offer. Has to be greater than 0 and less than 10000.
    function _depositMain(
        address _caller,
        MainNFT memory _nft,
        uint80 _apeAmountMain,
        uint80 _apeAmountBAKC,
        uint16 _mainPoolApeShareBps,
        uint16 _bakcPoolApeShareBps,
        uint16 _bakcPoolBAKCShareBps
    ) internal {
        uint24 _mainNonce = nextNonce;
        uint24 _bakcNonce = _mainNonce + 1;

        uint256 _poolId = _nft.collection == ApeStakingLib.Collections.BAYC
            ? BAYC_POOL_ID
            : MAYC_POOL_ID;

        (uint256 _stakedAmount, ) = APE_STAKING.nftPosition(
            _poolId,
            _nft.tokenId
        );

        (, bool _isPaired) = APE_STAKING.mainToBakc(_poolId, _nft.tokenId);
        if (_stakedAmount != 0 || _isPaired) revert InvalidNFT();

        _createOffer(
            OfferType.MAIN,
            _caller,
            _nft,
            _mainNonce,
            _apeAmountMain,
            _mainPoolApeShareBps,
            0
        );

        _createOffer(
            OfferType.BAKC,
            _caller,
            _nft,
            _bakcNonce,
            _apeAmountBAKC,
            _bakcPoolApeShareBps,
            _bakcPoolBAKCShareBps
        );

        unchecked {
            nextNonce = _bakcNonce + 1;
        }

        mainDeposits[_nft.collection][_nft.tokenId] = MainNFTDeposit({
            mainOfferNonce: _mainNonce,
            bakcOfferNonce: _bakcNonce,
            isDeposited: true
        });

        uint80 _totalApeAmount = _apeAmountBAKC + _apeAmountMain;
        if (_totalApeAmount != 0) {
            _transferApe(_caller, address(this), _totalApeAmount);

            if (_apeAmountMain != 0) {
                _stakeApeMain(_apeAmountMain, _nft.collection, _nft.tokenId);

                emit ApeDeposited(_caller, _mainNonce, _apeAmountMain);
            }

            if (_apeAmountBAKC != 0)
                emit ApeDeposited(_caller, _bakcNonce, _apeAmountBAKC);
        }
    }

    /// @notice Allows strategies to deposit a BAKC to the offer with nonce `nonce`.
    /// Can be called with action `ACTION_DEPOSIT_BAKC`
    /// @param _caller The account the strategy is calling for
    /// @param _nonce The nonce of the offer to deposit the BAKC to
    /// @param _bakcTokenId The BAKC to deposit
    /// @param _apeAmount The amount of ape to deposit with the BAKC. If not 0, has to be greater than `MIN_APE`. The
    /// total amount of apecoin in the offer cannot be greater than `MAX_APE_BAKC`
    function _depositBAKC(
        address _caller,
        uint24 _nonce,
        uint16 _bakcTokenId,
        uint80 _apeAmount
    ) internal {
        Offer memory _offer = offers[_nonce];

        if (_offer.offerType != OfferType.BAKC || _offer.isPaired)
            revert InvalidOffer(_nonce);

        {
            //make sure the bakc hasn't been paired before being deposited in the vault
            (uint256 _stakedAmount, ) = APE_STAKING.nftPosition(
                BAKC_POOL_ID,
                _bakcTokenId
            );

            if (_stakedAmount != 0) revert InvalidNFT();
        }

        Position memory _position = positions[_nonce][_caller];
        if (_apeAmount != 0) {
            _validateApeDeposit(
                _apeAmount,
                _offer.apeAmount,
                _offer.offerType,
                _offer.mainNft.collection
            );

            _transferApe(_caller, address(this), _apeAmount);

            _offer.apeAmount += _apeAmount;
            _position.apeAmount += _apeAmount;

            emit ApeDeposited(_caller, _nonce, _apeAmount);
        }

        if (_offer.apeAmount != 0)
            _stakeApeBAKC(
                _offer.apeAmount,
                _offer.mainNft.collection,
                _offer.mainNft.tokenId,
                _bakcTokenId
            );

        _position.isBAKCOwner = true;
        _offer.bakcTokenId = _bakcTokenId;
        _offer.isPaired = true;

        offers[_nonce] = _offer;
        positions[_nonce][_caller] = _position;
        bakcDeposits[_bakcTokenId] = BAKCDeposit({
            isDeposited: true,
            offerNonce: _nonce
        });

        emit BAKCDeposited(_caller, _nonce, _bakcTokenId);
    }

    /// @notice Allows strategies to withdraw a BAYC/MAYC. The apecoin provided by the owner of the NFT
    /// is refunded, the rest (if any) is staked into the apecoin single staking pool.
    /// Can be called with action `ACTION_WITHDRAW_MAIN`
    /// @param _caller The account the strategy is calling for
    /// @param _collection The collection of the NFT to withdraw
    /// @param _tokenId the NFT to withdraw
    /// @param _recipient The address to send the NFT to (usually the vault). The apecoin is always sent to `_caller`
    function _withdrawMain(
        address _caller,
        ApeStakingLib.Collections _collection,
        uint16 _tokenId,
        address _recipient
    ) internal {
        MainNFTDeposit memory _deposit = mainDeposits[_collection][_tokenId];
        if (!_deposit.isDeposited) revert Unauthorized();

        Position memory _mainPosition = positions[_deposit.mainOfferNonce][
            _caller
        ];
        Position memory _bakcPosition = positions[_deposit.bakcOfferNonce][
            _caller
        ];

        if (!_mainPosition.isOwner || !_bakcPosition.isOwner)
            revert Unauthorized();

        Offer memory _mainOffer = offers[_deposit.mainOfferNonce];
        Offer memory _bakcOffer = offers[_deposit.bakcOfferNonce];

        if (
            _mainOffer.offerType != OfferType.MAIN ||
            _bakcOffer.offerType != OfferType.BAKC
        ) revert Unauthorized();

        uint256 _apeToSend;
        (_mainPosition, _apeToSend) = _claimRewards(
            _caller,
            _deposit.mainOfferNonce,
            _mainPosition,
            _mainOffer
        );

        {
            uint256 _tempApe;

            (_bakcPosition, _tempApe) = _claimRewards(
                _caller,
                _deposit.bakcOfferNonce,
                _bakcPosition,
                _bakcOffer
            );

            _apeToSend += _tempApe;
        }

        _apeToSend += _mainPosition.apeAmount + _bakcPosition.apeAmount;
        uint176 _apeToStake = (_mainOffer.apeAmount - _mainPosition.apeAmount) +
            (_bakcOffer.apeAmount - _bakcPosition.apeAmount);

        if (_mainOffer.apeAmount != 0)
            _unstakeApeMain(_mainOffer.apeAmount, _collection, _tokenId);

        if (_bakcOffer.apeAmount != 0 && _bakcOffer.isPaired)
            _unstakeApeBAKC(
                _bakcOffer.apeAmount,
                true,
                _collection,
                _tokenId,
                _bakcOffer.bakcTokenId
            );

        if (_apeToStake != 0) {
            SingleStakingPool memory _pool = singleStakingPool;
            if (_pool.apeAmount != 0) {
                (
                    uint80 _additionalRewardsPerShare,
                    bool _needsClaim
                ) = _calculateAdditionalSingleSidedRewards(_pool.apeAmount);

                if (_needsClaim) {
                    _pool.rewardsPerShare += _additionalRewardsPerShare;
                    APE_STAKING.claimApeCoin(address(this));
                }
            }

            _mainOffer.lastSingleStakingRewardPerShare = _pool.rewardsPerShare;
            _bakcOffer.lastSingleStakingRewardPerShare = _pool.rewardsPerShare;

            APE_STAKING.depositApeCoin(_apeToStake, address(this));

            _pool.apeAmount += _apeToStake;
            singleStakingPool = _pool;
        }

        _mainOffer.apeAmount -= _mainPosition.apeAmount;
        _mainOffer.offerType = OfferType.SINGLE_SIDE;
        offers[_deposit.mainOfferNonce] = _mainOffer;

        _bakcOffer.apeAmount -= _bakcPosition.apeAmount;
        _bakcOffer.offerType = OfferType.SINGLE_SIDE;
        offers[_deposit.bakcOfferNonce] = _bakcOffer;

        //bakc position is not deleted because `_caller` might be the BAKC's owner
        _bakcPosition.apeAmount = 0;
        _bakcPosition.isOwner = false;
        positions[_deposit.bakcOfferNonce][_caller] = _bakcPosition;

        delete positions[_deposit.mainOfferNonce][_caller];
        delete mainDeposits[_collection][_tokenId];

        if (_apeToSend != 0) {
            _transferApe(address(this), _caller, _apeToSend);

            emit ApeWithdrawn(_caller, _deposit.mainOfferNonce, _apeToSend);
        }

        if (_collection == ApeStakingLib.Collections.BAYC)
            _transferNFT(BAYC, address(this), _recipient, _tokenId);
        else _transferNFT(MAYC, address(this), _recipient, _tokenId);

        emit MainWithdrawn(
            _caller,
            _deposit.mainOfferNonce,
            _tokenId,
            _collection
        );
    }

    /// @notice Allows strategies to withdraw a BAKC.
    /// Can be called with action `ACTION_WITHDRAW_BAKC`
    /// @param _caller The account the strategy is calling for
    /// @param _bakcTokenId The BAKC to withdraw
    /// @param _recipient The address to send the BAKC to (usually the vault)
    function _withdrawBAKC(
        address _caller,
        uint16 _bakcTokenId,
        address _recipient
    ) internal {
        BAKCDeposit memory _deposit = bakcDeposits[_bakcTokenId];
        if (!_deposit.isDeposited) revert Unauthorized();

        Position memory _position = positions[_deposit.offerNonce][_caller];

        if (!_position.isBAKCOwner) revert Unauthorized();

        Offer memory _offer = offers[_deposit.offerNonce];
        if (
            _offer.offerType != OfferType.BAKC &&
            _offer.offerType != OfferType.SINGLE_SIDE
        ) revert InvalidOffer(_deposit.offerNonce);

        uint256 _apeToSend;
        (_position, _apeToSend) = _claimRewards(
            _caller,
            _deposit.offerNonce,
            _position,
            _offer
        );

        if (_offer.offerType == OfferType.BAKC && _offer.apeAmount != 0)
            _unstakeApeBAKC(
                _offer.apeAmount,
                true,
                _offer.mainNft.collection,
                _offer.mainNft.tokenId,
                _bakcTokenId
            );

        _position.isBAKCOwner = false;
        positions[_deposit.offerNonce][_caller] = _position;

        _offer.isPaired = false;
        _offer.bakcTokenId = 0;
        offers[_deposit.offerNonce] = _offer;

        delete bakcDeposits[_bakcTokenId];

        if (_apeToSend > 0) _transferApe(address(this), _caller, _apeToSend);

        _transferNFT(BAKC, address(this), _recipient, _bakcTokenId);

        emit BAKCWithdrawn(_caller, _deposit.offerNonce, _bakcTokenId);
    }

    //internal functions

    /// @dev Claims rewards for the specified position and offer.
    /// Has to be called every time the amount of deposited apecoin is updated
    function _claimRewards(
        address _caller,
        uint24 _nonce,
        Position memory _position,
        Offer memory _offer
    ) internal returns (Position memory, uint256 _userRewards) {
        if (
            _offer.offerType == OfferType.MAIN ||
            _offer.offerType == OfferType.BAKC
        ) {
            OfferRewards memory _offerRewards = rewards[_nonce];

            uint80 _newRewardsPerShare;
            uint80 _newOwnerRewards;
            uint80 _newBAKCRewards;
            bool _needsClaim;
            (
                _newRewardsPerShare,
                _newOwnerRewards,
                _newBAKCRewards,
                _userRewards,
                _needsClaim
            ) = _calculateUpdatedRewardsData(_position, _offerRewards, _offer);

            _position.lastRewardsPerShare = _newRewardsPerShare;

            _offerRewards.rewardsPerShare = _newRewardsPerShare;
            _offerRewards.ownerRewards = _newOwnerRewards;
            _offerRewards.bakcRewards = _newBAKCRewards;

            if (_needsClaim) {
                if (_offer.offerType == OfferType.MAIN)
                    _doApeStakingAction(
                        ApeStakingLib.Actions.CLAIM,
                        false,
                        abi.encode(
                            _offer.mainNft.collection,
                            _offer.mainNft.tokenId
                        )
                    );
                else
                    _doApeStakingAction(
                        ApeStakingLib.Actions.CLAIM,
                        true,
                        abi.encode(
                            _offer.mainNft.collection,
                            _offer.mainNft.tokenId,
                            _offer.bakcTokenId
                        )
                    );
            }

            rewards[_nonce] = _offerRewards;
        } else if (_offer.offerType == OfferType.SINGLE_SIDE) {
            if (!_position.isSingleStaking) {
                OfferRewards memory _offerRewards = rewards[_nonce];

                uint80 _updatedOwnerRewards;
                uint80 _updatedBAKCRewards;
                (
                    _updatedOwnerRewards,
                    _updatedBAKCRewards,
                    _userRewards
                ) = _calculateUpdatedPositionRewards(
                    _position,
                    _offerRewards.rewardsPerShare,
                    _offerRewards.ownerRewards,
                    _offerRewards.bakcRewards
                );

                _position.isSingleStaking = true;
                _position.lastRewardsPerShare = _offer
                    .lastSingleStakingRewardPerShare;

                _offerRewards.ownerRewards = _updatedOwnerRewards;
                _offerRewards.bakcRewards = _updatedBAKCRewards;

                rewards[_nonce] = _offerRewards;
            }

            SingleStakingPool memory _pool = singleStakingPool;
            bool _needsClaim;
            uint256 _tempRewards;
            (
                _position.lastRewardsPerShare,
                _tempRewards,
                _needsClaim
            ) = _calculateUpdatedSingleSidedRewardsData(_position, _pool);

            _userRewards += _tempRewards;
            _position.isSingleStaking = true;

            if (_needsClaim) {
                _pool.rewardsPerShare = _position.lastRewardsPerShare;

                APE_STAKING.claimApeCoin(address(this));
                singleStakingPool = _pool;
            }
        } else revert InvalidOffer(_nonce);

        if (_userRewards != 0)
            emit RewardsClaimed(_caller, _nonce, _userRewards);

        return (_position, _userRewards);
    }

    /// @dev Calculates updated rewards data for the specified position and offer
    function _calculateUpdatedRewardsData(
        Position memory _position,
        OfferRewards memory _offerRewards,
        Offer memory _offer
    )
        internal
        view
        returns (
            uint80 _newRewardsPerShare,
            uint80 _newOwnerRewards,
            uint80 _newBAKCRewards,
            uint256 _userRewards,
            bool _needsClaim
        )
    {
        bool _isStaked;
        uint16 _tokenId;
        uint256 _poolId;

        if (_offer.offerType == OfferType.MAIN) {
            _isStaked = _offer.apeAmount != 0;
            _tokenId = _offer.mainNft.tokenId;
            _poolId = _offer.mainNft.collection ==
                ApeStakingLib.Collections.BAYC
                ? BAYC_POOL_ID
                : MAYC_POOL_ID;
        } else {
            _isStaked = _offer.apeAmount != 0 && _offer.isPaired;
            _tokenId = _offer.bakcTokenId;
            _poolId = BAKC_POOL_ID;
        }

        if (_isStaked) {
            (
                _newRewardsPerShare,
                _newOwnerRewards,
                _newBAKCRewards,
                _needsClaim
            ) = _calculateAdditionalRewards(
                _poolId,
                _offer.apeAmount,
                _tokenId,
                _offer.apeRewardShareBps,
                _offer.bakcRewardShareBps
            );
        }

        _newRewardsPerShare += _offerRewards.rewardsPerShare;

        (
            _newOwnerRewards,
            _newBAKCRewards,
            _userRewards
        ) = _calculateUpdatedPositionRewards(
            _position,
            _newRewardsPerShare,
            _newOwnerRewards + _offerRewards.ownerRewards,
            _newBAKCRewards + _offerRewards.bakcRewards
        );
    }

    /// @dev Calculates updated rewards data for the specified position in the single staking pool
    function _calculateUpdatedSingleSidedRewardsData(
        Position memory _position,
        SingleStakingPool memory _pool
    )
        internal
        view
        returns (
            uint80 _updatedRewardsPerShare,
            uint256 _userRewards,
            bool _needsClaim
        )
    {
        if (_pool.apeAmount != 0) {
            (
                _updatedRewardsPerShare,
                _needsClaim
            ) = _calculateAdditionalSingleSidedRewards(_pool.apeAmount);
        }

        _updatedRewardsPerShare += _pool.rewardsPerShare;

        _userRewards += _calculateRewardsFromShares(
            _position.apeAmount,
            _updatedRewardsPerShare,
            _position.lastRewardsPerShare
        );
    }

    /// @dev Creates an offer with the specified parameters
    function _createOffer(
        OfferType _offerType,
        address _owner,
        MainNFT memory _nft,
        uint24 _nonce,
        uint80 _apeAmount,
        uint16 _apeRewardShareBps,
        uint16 _bakcRewardShareBps
    ) internal {
        if (_offerType != OfferType.MAIN && _offerType != OfferType.BAKC)
            revert Unauthorized();

        if (
            _apeRewardShareBps == 0 ||
            _apeRewardShareBps + _bakcRewardShareBps >= 10_000 ||
            (_offerType == OfferType.BAKC && _bakcRewardShareBps == 0)
        ) revert InvalidRewardShare();

        Offer memory _offer = Offer({
            offerType: _offerType,
            mainNft: _nft,
            bakcTokenId: 0,
            apeAmount: 0,
            apeRewardShareBps: _apeRewardShareBps,
            bakcRewardShareBps: _bakcRewardShareBps,
            isPaired: false,
            lastSingleStakingRewardPerShare: 0
        });

        if (_apeAmount != 0)
            _validateApeDeposit(
                _apeAmount,
                _offer.apeAmount,
                _offer.offerType,
                _offer.mainNft.collection
            );

        _offer.apeAmount = _apeAmount;
        offers[_nonce] = _offer;

        positions[_nonce][_owner] = Position({
            apeAmount: _apeAmount,
            lastRewardsPerShare: 0,
            isOwner: true,
            isBAKCOwner: false,
            isSingleStaking: false
        });

        emit OfferCreated(_owner, _nonce, _nft.tokenId, _nft.collection);
    }

    /// @dev Validates apecoin deposits (min and max amounts)
    function _validateApeDeposit(
        uint80 _apeAmount,
        uint80 _totalApeAmount,
        OfferType _offerType,
        ApeStakingLib.Collections _collection
    ) internal pure {
        if (_apeAmount < MIN_APE) revert InvalidAmount();

        uint80 _maxApe;
        if (_offerType == OfferType.MAIN)
            _maxApe = _collection == ApeStakingLib.Collections.BAYC
                ? MAX_APE_BAYC
                : MAX_APE_MAYC;
        else if (_offerType == OfferType.BAKC) _maxApe = MAX_APE_BAKC;
        else revert();

        _totalApeAmount += _apeAmount;
        if (_totalApeAmount > _maxApe) revert InvalidAmount();
    }

    /// @dev Calculates updated rewards for the specified position (also applies NFT rewards)
    function _calculateUpdatedPositionRewards(
        Position memory _position,
        uint80 _rewardsPerShare,
        uint80 _ownerRewards,
        uint80 _bakcRewards
    )
        internal
        pure
        returns (
            uint80 _updatedOwnerRewards,
            uint80 _updatedBAKCRewards,
            uint256 _rewardsAmount
        )
    {
        if (_position.apeAmount != 0)
            _rewardsAmount = _calculateRewardsFromShares(
                _position.apeAmount,
                _rewardsPerShare,
                _position.lastRewardsPerShare
            );

        if (_position.isOwner) _rewardsAmount += _ownerRewards;
        else _updatedOwnerRewards = _ownerRewards;

        if (_position.isBAKCOwner) _rewardsAmount += _bakcRewards;
        else _updatedBAKCRewards = _bakcRewards;
    }

    /// @dev Core rewards calculation based on shares
    function _calculateRewardsFromShares(
        uint80 _apeAmount,
        uint80 _rewardsPerShare,
        uint80 _lastRewardsPerShare
    ) internal pure returns (uint256) {
        assert(_rewardsPerShare >= _lastRewardsPerShare);
        return
            (uint256(_rewardsPerShare - _lastRewardsPerShare) * _apeAmount) /
            REWARDS_PRECISION;
    }

    /// @dev Calculates the additional rewards per share for the single sided pool
    function _calculateAdditionalSingleSidedRewards(
        uint176 _totalApe
    ) internal view returns (uint80, bool) {
        uint256 _pendingRewards = APE_STAKING.pendingRewards(
            APE_POOL_ID,
            address(this),
            0
        );

        assert(_pendingRewards <= type(uint80).max);

        //see `REWARDS_PRECISION`
        return (
            uint80((_pendingRewards * REWARDS_PRECISION) / _totalApe),
            _pendingRewards != 0
        );
    }

    /// @dev Calculates the additional NFT rewards and rewards per share for a specific offer
    function _calculateAdditionalRewards(
        uint256 _apeStakingPoolId,
        uint80 _totalApe,
        uint16 _tokenId,
        uint16 _apeRewardShareBps,
        uint16 _bakcRewardShareBps
    )
        internal
        view
        returns (
            uint80 _additionalRewardsPerShare,
            uint80 _additionalOwnerRewards,
            uint80 _additionalBAKCRewards,
            bool _needsClaim
        )
    {
        uint256 _pendingRewards = APE_STAKING.pendingRewards(
            _apeStakingPoolId,
            address(this),
            _tokenId
        );

        if (_pendingRewards != 0) {
            assert(_pendingRewards <= type(uint80).max);

            _needsClaim = true;

            uint80 _apeShare = uint80(
                (_pendingRewards * _apeRewardShareBps) / 10000
            );

            if (_bakcRewardShareBps != 0) {
                _additionalBAKCRewards = uint80(
                    (_pendingRewards * _bakcRewardShareBps) / 10000
                );

                _additionalOwnerRewards = uint80(
                    _pendingRewards - _apeShare - _additionalBAKCRewards
                );
            } else
                _additionalOwnerRewards = uint80(_pendingRewards - _apeShare);

            //see `REWARDS_PRECISION`
            _additionalRewardsPerShare = uint80(
                (_apeShare * REWARDS_PRECISION) / _totalApe
            );
        }
    }

    function _stakeApeMain(
        uint80 _apeAmount,
        ApeStakingLib.Collections _collection,
        uint16 _tokenId
    ) internal {
        _doApeStakingAction(
            ApeStakingLib.Actions.DEPOSIT,
            false,
            abi.encode(_apeAmount, _collection, _tokenId)
        );
    }

    function _unstakeApeMain(
        uint80 _apeAmount,
        ApeStakingLib.Collections _collection,
        uint16 _tokenId
    ) internal {
        _doApeStakingAction(
            ApeStakingLib.Actions.WITHDRAW,
            false,
            abi.encode(_apeAmount, _collection, _tokenId)
        );
    }

    function _stakeApeBAKC(
        uint80 _apeAmount,
        ApeStakingLib.Collections _collection,
        uint16 _tokenId,
        uint16 _bakcTokenId
    ) internal {
        _doApeStakingAction(
            ApeStakingLib.Actions.DEPOSIT,
            true,
            abi.encode(_apeAmount, _collection, _tokenId, _bakcTokenId)
        );
    }

    function _unstakeApeBAKC(
        uint80 _apeAmount,
        bool _isUncommit,
        ApeStakingLib.Collections _collection,
        uint16 _tokenId,
        uint16 _bakcTokenId
    ) internal {
        _doApeStakingAction(
            ApeStakingLib.Actions.WITHDRAW,
            true,
            abi.encode(
                _apeAmount,
                _isUncommit,
                _collection,
                _tokenId,
                _bakcTokenId
            )
        );
    }

    function _doApeStakingAction(
        ApeStakingLib.Actions _action,
        bool _isBAKC,
        bytes memory _data
    ) internal {
        ApeStakingLib.doApeStakingAction(APE_STAKING, _action, _isBAKC, _data);
    }

    //saves bytecode size
    function _transferNFT(
        IERC721Upgradeable _nft,
        address _sender,
        address _recipient,
        uint256 _tokenId
    ) internal {
        _nft.transferFrom(_sender, _recipient, _tokenId);
    }

    //saves bytecode size
    function _transferApe(
        address _sender,
        address _recipient,
        uint256 _amount
    ) internal {
        if (_sender == address(this)) APE.transfer(_recipient, _amount);
        else APE.transferFrom(_sender, _recipient, _amount);
    }
}
