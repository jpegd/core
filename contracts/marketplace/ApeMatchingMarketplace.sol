// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "../interfaces/IApeStaking.sol";

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
    error BAKCAlreadyPaired(uint256 id);
    error UnknownAction(uint8 action);

    event OfferCreated(address indexed owner, uint256 indexed nonce);

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

    event BAKCDeposited(
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

    enum Collections {
        BAYC,
        MAYC
    }

    struct MainNFT {
        Collections collection;
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
        uint24 mainOrderNonce;
        uint24 bakcOrderNonce;
        bool isDeposited;
    }

    struct BAKCDeposit {
        uint24 orderNonce;
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

    struct OrderRewards {
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

    uint8 internal constant ACTION_DEPOSIT_APE = 0;
    uint8 internal constant ACTION_WITHDRAW_APE = 1;
    uint8 internal constant ACTION_CLAIM_APE = 2;

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

    uint24 internal nextNonce;

    SingleStakingPool public singleStakingPool;

    mapping(uint24 => Offer) public offers;
    mapping(uint24 => mapping(address => Position)) public positions;

    mapping(Collections => mapping(uint16 => MainNFTDeposit))
        public mainDeposits;
    mapping(uint16 => BAKCDeposit) public bakcDeposits;

    mapping(uint24 => OrderRewards) internal rewards;

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

    function pendingRewards(
        uint24 _nonce,
        address _user
    ) external view returns (uint256 _userRewards) {
        Offer memory _offer = offers[_nonce];
        Position memory _position = positions[_nonce][_user];
        OrderRewards memory _orderRewards = rewards[_nonce];

        if (
            _offer.offerType == OfferType.MAIN ||
            _offer.offerType == OfferType.BAKC
        )
            (, , , _userRewards, ) = _calculateUpdatedRewardsData(
                _position,
                _orderRewards,
                _offer
            );
        else if (_offer.offerType == OfferType.SINGLE_SIDE) {
            if (!_position.isSingleStaking) {
                (, , _userRewards) = _calculateUpdatedPositionRewards(
                    _position,
                    _orderRewards.rewardsPerShare,
                    _orderRewards.ownerRewards,
                    _orderRewards.bakcRewards
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

    function doActions(
        uint8[] calldata _actions,
        bytes[] calldata _data
    ) external nonReentrant {
        if (_actions.length != _data.length) revert InvalidLength();

        for (uint256 i; i < _actions.length; ++i) {
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
                _claimRewards(_nonce);
            } else revert UnknownAction(_action);
        }
    }

    function createOffers(
        address _caller,
        MainNFT calldata _nft,
        uint80 _apeAmountMain,
        uint80 _apeAmountBAKC,
        uint16 _mainPoolApeShareBps,
        uint16 _bakcPoolApeShareBps,
        uint16 _bakcPoolBAKCShareBps
    ) external nonReentrant {
        _checkRole(STRATEGY_ROLE, msg.sender);

        uint24 _mainNonce = nextNonce;
        uint24 _bakcNonce = _mainNonce + 1;

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

        nextNonce = _bakcNonce + 1;

        mainDeposits[_nft.collection][_nft.tokenId] = MainNFTDeposit({
            mainOrderNonce: _mainNonce,
            bakcOrderNonce: _bakcNonce,
            isDeposited: true
        });

        uint80 _totalApeAmount = _apeAmountBAKC + _apeAmountMain;
        if (_totalApeAmount != 0) {
            APE.transferFrom(_caller, address(this), _totalApeAmount);

            if (_apeAmountMain != 0) {
                _updateStakedApeAmountMain(
                    _apeAmountMain,
                    _nft.collection,
                    _nft.tokenId,
                    false
                );

                emit ApeDeposited(_caller, _mainNonce, _apeAmountMain);
            }

            if (_apeAmountBAKC != 0)
                emit ApeDeposited(_caller, _bakcNonce, _apeAmountBAKC);
        }
    }

    function withdrawMainNFT(
        address _caller,
        Collections _collection,
        uint16 _tokenId,
        address _recipient
    ) external nonReentrant {
        _checkRole(STRATEGY_ROLE, msg.sender);

        MainNFTDeposit memory _deposit = mainDeposits[_collection][_tokenId];
        if (!_deposit.isDeposited) revert Unauthorized();

        Position memory _mainPosition = positions[_deposit.mainOrderNonce][
            _caller
        ];
        Position memory _bakcPosition = positions[_deposit.bakcOrderNonce][
            _caller
        ];

        if (!_mainPosition.isOwner || !_bakcPosition.isOwner)
            revert Unauthorized();

        Offer memory _mainOffer = offers[_deposit.mainOrderNonce];
        Offer memory _bakcOffer = offers[_deposit.bakcOrderNonce];

        if (
            _mainOffer.offerType != OfferType.MAIN ||
            _bakcOffer.offerType != OfferType.BAKC
        ) revert Unauthorized();

        uint256 _apeToSend;
        (_mainPosition, _apeToSend) = _claimRewards(
            _caller,
            _deposit.mainOrderNonce,
            _mainPosition,
            _mainOffer
        );

        {
            uint256 _tempApe;

            (_bakcPosition, _tempApe) = _claimRewards(
                _caller,
                _deposit.bakcOrderNonce,
                _bakcPosition,
                _bakcOffer
            );

            _apeToSend += _tempApe;
        }

        _apeToSend += _mainPosition.apeAmount + _bakcPosition.apeAmount;
        uint176 _apeToStake = (_mainOffer.apeAmount - _mainPosition.apeAmount) +
            (_bakcOffer.apeAmount - _bakcPosition.apeAmount);

        if (_mainOffer.apeAmount != 0)
            _updateStakedApeAmountMain(
                _mainOffer.apeAmount,
                _collection,
                _tokenId,
                true
            );

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

                ) = _calculateAdditionalSingleSidedRewards(_pool.apeAmount);

                _pool.rewardsPerShare += _additionalRewardsPerShare;
            }

            _mainOffer.lastSingleStakingRewardPerShare = _pool.rewardsPerShare;
            _bakcOffer.lastSingleStakingRewardPerShare = _pool.rewardsPerShare;

            APE_STAKING.depositApeCoin(_apeToStake, address(this));

            _pool.apeAmount += _apeToStake;
            singleStakingPool = _pool;
        }

        _mainOffer.apeAmount -= _mainPosition.apeAmount;
        _mainOffer.offerType = OfferType.SINGLE_SIDE;
        offers[_deposit.mainOrderNonce] = _mainOffer;

        _bakcOffer.apeAmount -= _bakcPosition.apeAmount;
        _bakcOffer.offerType = OfferType.SINGLE_SIDE;
        offers[_deposit.bakcOrderNonce] = _bakcOffer;

        //bakc position is not deleted because `_caller` might be the BAKC's owner
        _bakcPosition.apeAmount = 0;
        _bakcPosition.isOwner = false;
        positions[_deposit.bakcOrderNonce][_caller] = _bakcPosition;

        delete positions[_deposit.mainOrderNonce][_caller];
        delete mainDeposits[_collection][_tokenId];

        if (_apeToSend != 0) APE.transfer(_caller, _apeToSend);

        if (_collection == Collections.BAYC)
            BAYC.transferFrom(address(this), _recipient, _tokenId);
        else MAYC.transferFrom(address(this), _recipient, _tokenId);
    }

    //check claim logic for when BAKC is staked but order has been cancelled
    function withdrawBAKC(
        address _caller,
        uint16 _bakcTokenId,
        address _recipient
    ) external nonReentrant {
        _checkRole(STRATEGY_ROLE, msg.sender);

        BAKCDeposit memory _deposit = bakcDeposits[_bakcTokenId];
        if (!_deposit.isDeposited) revert Unauthorized();

        Position memory _position = positions[_deposit.orderNonce][_caller];

        if (!_position.isBAKCOwner) revert Unauthorized();

        Offer memory _offer = offers[_deposit.orderNonce];
        if (
            _offer.offerType != OfferType.BAKC &&
            _offer.offerType != OfferType.SINGLE_SIDE
        ) revert InvalidOffer(_deposit.orderNonce);

        uint256 _apeToSend;
        (_position, _apeToSend) = _claimRewards(
            _caller,
            _deposit.orderNonce,
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
        positions[_deposit.orderNonce][_caller] = _position;

        _offer.isPaired = false;
        _offer.bakcTokenId = 0;
        offers[_deposit.orderNonce] = _offer;

        delete bakcDeposits[_bakcTokenId];

        if (_apeToSend > 0) APE.transfer(_caller, _apeToSend);

        BAKC.transferFrom(address(this), _recipient, _bakcTokenId);
    }

    function depositBAKC(
        address _caller,
        uint24 _nonce,
        uint16 _bakcTokenId,
        uint80 _apeAmount
    ) external nonReentrant {
        _checkRole(STRATEGY_ROLE, msg.sender);

        Offer memory _offer = offers[_nonce];

        if (_offer.offerType != OfferType.BAKC || _offer.isPaired)
            revert InvalidOffer(_nonce);

        {
            //make sure the bakc hasn't been paired before being deposited in the vault
            (uint256 _stakedAmount, ) = APE_STAKING.nftPosition(
                BAKC_POOL_ID,
                _bakcTokenId
            );

            if (_stakedAmount > 0) revert BAKCAlreadyPaired(_bakcTokenId);
        }

        Position memory _position = positions[_nonce][_caller];
        if (_apeAmount != 0) {
            _validateApeDeposit(
                _apeAmount,
                _offer.apeAmount,
                _offer.offerType,
                _offer.mainNft.collection
            );

            APE.transferFrom(_caller, address(this), _apeAmount);

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
            orderNonce: _nonce
        });

        emit BAKCDeposited(_caller, _nonce, _bakcTokenId);
    }

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

        if (_rewards > _apeAmount)
            APE.transfer(msg.sender, _rewards - _apeAmount);
        else APE.transferFrom(msg.sender, address(this), _apeAmount - _rewards);

        if (_offer.offerType == OfferType.MAIN)
            _updateStakedApeAmountMain(
                _apeAmount,
                _offer.mainNft.collection,
                _offer.mainNft.tokenId,
                false
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
            _updateStakedApeAmountMain(
                _apeAmount,
                _offer.mainNft.collection,
                _offer.mainNft.tokenId,
                true
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

        APE.transfer(msg.sender, _apeAmount + _rewards);

        emit ApeWithdrawn(msg.sender, _nonce, _apeAmount);
    }

    function _claimRewards(uint24 _nonce) internal {
        Offer memory _offer = offers[_nonce];

        (Position memory _position, uint256 _rewards) = _claimRewards(
            msg.sender,
            _nonce,
            positions[_nonce][msg.sender],
            _offer
        );

        positions[_nonce][msg.sender] = _position;

        if (_rewards == 0) revert NoRewards();

        APE.transfer(msg.sender, _rewards);
    }

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
            OrderRewards memory _orderRewards = rewards[_nonce];

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
            ) = _calculateUpdatedRewardsData(_position, _orderRewards, _offer);

            _position.lastRewardsPerShare = _newRewardsPerShare;

            _orderRewards.rewardsPerShare = _newRewardsPerShare;
            _orderRewards.ownerRewards = _newOwnerRewards;
            _orderRewards.bakcRewards = _newBAKCRewards;

            if (_needsClaim) {
                if (_offer.offerType == OfferType.MAIN)
                    _claimApeMain(
                        _offer.mainNft.collection,
                        _offer.mainNft.tokenId
                    );
                else
                    _claimApeBAKC(
                        _offer.mainNft.collection,
                        _offer.mainNft.tokenId,
                        _offer.bakcTokenId
                    );
            }

            rewards[_nonce] = _orderRewards;
        } else if (_offer.offerType == OfferType.SINGLE_SIDE) {
            if (!_position.isSingleStaking) {
                OrderRewards memory _orderRewards = rewards[_nonce];

                uint80 _updatedOwnerRewards;
                uint80 _updatedBAKCRewards;
                (
                    _updatedOwnerRewards,
                    _updatedBAKCRewards,
                    _userRewards
                ) = _calculateUpdatedPositionRewards(
                    _position,
                    _orderRewards.rewardsPerShare,
                    _orderRewards.ownerRewards,
                    _orderRewards.bakcRewards
                );

                _position.isSingleStaking = true;
                _position.lastRewardsPerShare = _offer
                    .lastSingleStakingRewardPerShare;

                _orderRewards.ownerRewards = _updatedOwnerRewards;
                _orderRewards.bakcRewards = _updatedBAKCRewards;

                rewards[_nonce] = _orderRewards;
            }

            SingleStakingPool memory _pool = singleStakingPool;
            uint80 _updatedRewardsPerShare;
            bool _needsClaim;
            (
                _updatedRewardsPerShare,
                _userRewards,
                _needsClaim
            ) = _calculateUpdatedSingleSidedRewardsData(_position, _pool);

            _position.lastRewardsPerShare = _updatedRewardsPerShare;
            _position.isSingleStaking = true;

            if (_needsClaim) {
                _pool.rewardsPerShare = _updatedRewardsPerShare;

                APE_STAKING.claimApeCoin(address(this));
                singleStakingPool = _pool;
            }
        } else revert InvalidOffer(_nonce);

        if (_userRewards != 0)
            emit RewardsClaimed(_caller, _nonce, _userRewards);

        return (_position, _userRewards);
    }

    function _calculateUpdatedRewardsData(
        Position memory _position,
        OrderRewards memory _orderRewards,
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
            _poolId = _offer.mainNft.collection == Collections.BAYC
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

        _newRewardsPerShare += _orderRewards.rewardsPerShare;

        (
            _newOwnerRewards,
            _newBAKCRewards,
            _userRewards
        ) = _calculateUpdatedPositionRewards(
            _position,
            _newRewardsPerShare,
            _newOwnerRewards + _orderRewards.ownerRewards,
            _newBAKCRewards + _orderRewards.bakcRewards
        );
    }

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

        emit OfferCreated(_owner, _nonce);
    }

    function _validateApeDeposit(
        uint80 _apeAmount,
        uint80 _totalApeAmount,
        OfferType _offerType,
        Collections _collection
    ) internal pure {
        if (_apeAmount < MIN_APE) revert InvalidAmount();

        uint80 _maxApe;
        if (_offerType == OfferType.MAIN)
            _maxApe = _collection == Collections.BAYC
                ? MAX_APE_BAYC
                : MAX_APE_MAYC;
        else if (_offerType == OfferType.BAKC) _maxApe = MAX_APE_BAKC;
        else revert();

        _totalApeAmount += _apeAmount;
        if (_totalApeAmount > _maxApe) revert InvalidAmount();
    }

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

    function _updateStakedApeAmountMain(
        uint80 _apeAmount,
        Collections _collection,
        uint16 _tokenId,
        bool _isUnstake
    ) internal {
        IApeStaking.SingleNft[] memory _toUpdate = new IApeStaking.SingleNft[](
            1
        );

        _toUpdate[0] = IApeStaking.SingleNft({
            tokenId: _tokenId,
            amount: _apeAmount
        });

        bool _isBAYC = _collection == Collections.BAYC;

        if (_isUnstake) {
            if (_isBAYC) APE_STAKING.withdrawBAYC(_toUpdate, address(this));
            else APE_STAKING.withdrawMAYC(_toUpdate, address(this));
        } else {
            if (_isBAYC) APE_STAKING.depositBAYC(_toUpdate);
            else APE_STAKING.depositMAYC(_toUpdate);
        }
    }

    function _stakeApeBAKC(
        uint80 _apeAmount,
        Collections _collection,
        uint16 _tokenId,
        uint16 _bakcTokenId
    ) internal {
        IApeStaking.PairNftDepositWithAmount[]
            memory _toDeposit = new IApeStaking.PairNftDepositWithAmount[](1);

        _toDeposit[0] = IApeStaking.PairNftDepositWithAmount({
            mainTokenId: _tokenId,
            bakcTokenId: _bakcTokenId,
            amount: _apeAmount
        });

        if (_collection == Collections.BAYC)
            APE_STAKING.depositBAKC(
                _toDeposit,
                new IApeStaking.PairNftDepositWithAmount[](0)
            );
        else
            APE_STAKING.depositBAKC(
                new IApeStaking.PairNftDepositWithAmount[](0),
                _toDeposit
            );
    }

    function _unstakeApeBAKC(
        uint80 _apeAmount,
        bool _isUncommit,
        Collections _collection,
        uint16 _tokenId,
        uint16 _bakcTokenId
    ) internal {
        IApeStaking.PairNftWithdrawWithAmount[]
            memory _toWithdraw = new IApeStaking.PairNftWithdrawWithAmount[](1);

        _toWithdraw[0] = IApeStaking.PairNftWithdrawWithAmount({
            mainTokenId: _tokenId,
            bakcTokenId: _bakcTokenId,
            amount: _apeAmount,
            isUncommit: _isUncommit
        });

        if (_collection == Collections.BAYC)
            APE_STAKING.withdrawBAKC(
                _toWithdraw,
                new IApeStaking.PairNftWithdrawWithAmount[](0)
            );
        else
            APE_STAKING.withdrawBAKC(
                new IApeStaking.PairNftWithdrawWithAmount[](0),
                _toWithdraw
            );
    }

    function _claimApeMain(Collections _collection, uint16 _tokenId) internal {
        uint256[] memory _toClaim = new uint256[](1);
        _toClaim[0] = _tokenId;

        if (_collection == Collections.BAYC)
            APE_STAKING.claimBAYC(_toClaim, address(this));
        else APE_STAKING.claimMAYC(_toClaim, address(this));
    }

    function _claimApeBAKC(
        Collections _collection,
        uint16 _tokenId,
        uint16 _bakcTokenId
    ) internal {
        IApeStaking.PairNft[] memory _toClaim = new IApeStaking.PairNft[](1);
        _toClaim[0] = IApeStaking.PairNft({
            mainTokenId: _tokenId,
            bakcTokenId: _bakcTokenId
        });

        if (_collection == Collections.BAYC)
            APE_STAKING.claimBAKC(
                _toClaim,
                new IApeStaking.PairNft[](0),
                address(this)
            );
        else
            APE_STAKING.claimBAKC(
                new IApeStaking.PairNft[](0),
                _toClaim,
                address(this)
            );
    }
}
