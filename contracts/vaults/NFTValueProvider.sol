// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../interfaces/IAggregatorV3Interface.sol";
import "../interfaces/IUniswapV2Oracle.sol";
import "../interfaces/IJPEGOraclesAggregator.sol";
import "../interfaces/IJPEGCardsCigStaking.sol";

contract NFTValueProvider is ReentrancyGuardUpgradeable, OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    error InvalidNFTType(bytes32 nftType);
    error InvalidRate(Rate rate);
    error InvalidUnlockTime(uint256 unlockTime);
    error ExistingLock(uint256 index);
    error InvalidAmount(uint256 amount);
    error InvalidOracleResults();
    error Unauthorized();
    error ZeroAddress();
    error InvalidLength();

    event DaoFloorChanged(uint256 newFloor);

    event JPEGLocked(
        address indexed owner,
        uint256 indexed index,
        uint256 amount,
        uint256 unlockTime,
        bool isTraitBoost
    );
    event JPEGUnlocked(
        address indexed owner,
        uint256 indexed index,
        uint256 amount,
        bool isTraitBoost
    );

    struct Rate {
        uint128 numerator;
        uint128 denominator;
    }

    struct JPEGLock {
        address owner;
        uint256 unlockAt;
        uint256 lockedValue;
    }

    /// @notice The JPEG floor oracles aggregator
    IJPEGOraclesAggregator public aggregator;
    /// @notice If true, the floor price won't be fetched using the Chainlink oracle but
    /// a value set by the DAO will be used instead
    bool public daoFloorOverride;
    /// @notice Value of floor set by the DAO. Only used if `daoFloorOverride` is true
    uint256 private overriddenFloorValueETH;

    /// @notice The JPEG token
    IERC20Upgradeable public jpeg;
    /// @notice Value of the JPEG to lock for trait boost based on the NFT value increase
    /// @custom:oz-renamed-from valueIncreaseLockRate
    Rate public traitBoostLockRate;
    /// @notice Minimum amount of JPEG to lock for trait boost
    uint256 public minJPEGToLock;

    mapping(uint256 => bytes32) public nftTypes;
    mapping(bytes32 => Rate) public nftTypeValueMultiplier;
    /// @custom:oz-renamed-from lockPositions
    mapping(uint256 => JPEGLock) public traitBoostPositions;
    mapping(uint256 => JPEGLock) public ltvBoostPositions;

    Rate public baseCreditLimitRate;
    Rate public baseLiquidationLimitRate;
    Rate public cigStakedRateIncrease;
    Rate public jpegLockedRateIncrease;

    /// @notice Value of the JPEG to lock for ltv boost based on the NFT ltv increase
    Rate public ltvBoostLockRate;

    /// @notice JPEGCardsCigStaking, cig stakers get an higher credit limit rate and liquidation limit rate.
    /// Immediately reverts to normal rates if the cig is unstaked.
    IJPEGCardsCigStaking public cigStaking;

    /// @notice This function is only called once during deployment of the proxy contract. It's not called after upgrades.
    /// @param _jpeg The JPEG token
    /// @param _aggregator The JPEG floor oracles aggregator
    /// @param _cigStaking The cig staking address
    /// @param _baseCreditLimitRate The base credit limit rate
    /// @param _baseLiquidationLimitRate The base liquidation limit rate
    /// @param _cigStakedRateIncrease The liquidation and credit limit rate increases for users staking a cig in the cigStaking contract
    /// @param _jpegLockedRateIncrease The liquidation and credit limit rate increases for users that locked JPEG for LTV boost
    /// @param _traitBoostLockRate The rate used to calculate the amount of JPEG to lock for trait boost based on the NFT's value increase
    /// @param _ltvBoostLockRate The rate used to calculate the amount of JPEG to lock for LTV boost based on the NFT's credit limit increase
    /// @param _minJPEGToLock Minimum amount of JPEG to lock to apply the trait boost
    function initialize(
        IERC20Upgradeable _jpeg,
        IJPEGOraclesAggregator _aggregator,
        IJPEGCardsCigStaking _cigStaking,
        Rate calldata _baseCreditLimitRate,
        Rate calldata _baseLiquidationLimitRate,
        Rate calldata _cigStakedRateIncrease,
        Rate calldata _jpegLockedRateIncrease,
        Rate calldata _traitBoostLockRate,
        Rate calldata _ltvBoostLockRate,
        uint256 _minJPEGToLock
    ) external initializer {
        __Ownable_init();
        __ReentrancyGuard_init();

        if (address(_jpeg) == address(0)) revert ZeroAddress();
        if (address(_aggregator) == address(0)) revert ZeroAddress();
        if (address(_cigStaking) == address(0)) revert ZeroAddress();

        _validateRateBelowOne(_baseCreditLimitRate);
        _validateRateBelowOne(_baseLiquidationLimitRate);
        _validateRateBelowOne(_cigStakedRateIncrease);
        _validateRateBelowOne(_jpegLockedRateIncrease);
        _validateRateBelowOne(_traitBoostLockRate);
        _validateRateBelowOne(_ltvBoostLockRate);

        if (!_greaterThan(_baseLiquidationLimitRate, _baseCreditLimitRate))
            revert InvalidRate(_baseLiquidationLimitRate);

        _validateRateBelowOne(
            _rateSum(
                _rateSum(_baseLiquidationLimitRate, _cigStakedRateIncrease),
                _jpegLockedRateIncrease
            )
        );

        jpeg = _jpeg;
        aggregator = _aggregator;
        cigStaking = _cigStaking;
        baseCreditLimitRate = _baseCreditLimitRate;
        baseLiquidationLimitRate = _baseLiquidationLimitRate;
        cigStakedRateIncrease = _cigStakedRateIncrease;
        jpegLockedRateIncrease = _jpegLockedRateIncrease;
        traitBoostLockRate = _traitBoostLockRate;
        ltvBoostLockRate = _ltvBoostLockRate;
        minJPEGToLock = _minJPEGToLock;
    }

    /// @notice This function is only called once during the upgrade process by the {ProxyAdmin} contract.
    function finalizeUpgrade(
        IJPEGCardsCigStaking _cigStaking,
        Rate calldata _baseCreditLimitRate,
        Rate calldata _baseLiquidationLimitRate,
        Rate calldata _cigStakedRateIncrease,
        Rate calldata _jpegLockedRateIncrease,
        Rate calldata _ltvBoostLockRate
    ) external {
        if (address(cigStaking) != address(0)) revert Unauthorized();

        if (address(_cigStaking) == address(0)) revert ZeroAddress();

        _validateRateBelowOne(_baseCreditLimitRate);
        _validateRateBelowOne(_baseLiquidationLimitRate);
        _validateRateBelowOne(_cigStakedRateIncrease);
        _validateRateBelowOne(_jpegLockedRateIncrease);
        _validateRateBelowOne(_ltvBoostLockRate);

        if (!_greaterThan(_baseLiquidationLimitRate, _baseCreditLimitRate))
            revert InvalidRate(_baseLiquidationLimitRate);

        _validateRateBelowOne(
            _rateSum(
                _rateSum(_baseLiquidationLimitRate, _cigStakedRateIncrease),
                _jpegLockedRateIncrease
            )
        );

        cigStaking = _cigStaking;
        baseCreditLimitRate = _baseCreditLimitRate;
        baseLiquidationLimitRate = _baseLiquidationLimitRate;
        cigStakedRateIncrease = _cigStakedRateIncrease;
        jpegLockedRateIncrease = _jpegLockedRateIncrease;
        ltvBoostLockRate = _ltvBoostLockRate;
    }

    /// @param _owner The owner of the NFT at index `_nftIndex` (or the owner of the associated position in the vault)
    /// @param _nftIndex The index of the NFT to return the credit limit rate for
    /// @return The credit limit rate for the NFT with index `_nftIndex`
    function getCreditLimitRate(address _owner, uint256 _nftIndex)
        public
        view
        returns (Rate memory)
    {
        return _rateAfterBoosts(baseCreditLimitRate, _owner, _nftIndex);
    }

    /// @param _owner The owner of the NFT at index `_nftIndex` (or the owner of the associated position in the vault)
    /// @param _nftIndex The index of the NFT to return the liquidation limit rate for
    /// @return The liquidation limit rate for the NFT with index `_nftIndex`
    function getLiquidationLimitRate(address _owner, uint256 _nftIndex)
        public
        view
        returns (Rate memory)
    {
        return _rateAfterBoosts(baseLiquidationLimitRate, _owner, _nftIndex);
    }

    /// @param _owner The owner of the NFT at index `_nftIndex` (or the owner of the associated position in the vault)
    /// @param _nftIndex The index of the NFT to return the credit limit for
    /// @return The credit limit for the NFT with index `_nftIndex`, in ETH
    function getCreditLimitETH(address _owner, uint256 _nftIndex)
        external
        view
        returns (uint256)
    {
        Rate memory creditLimitRate = getCreditLimitRate(_owner, _nftIndex);
        return
            (getNFTValueETH(_nftIndex) * creditLimitRate.numerator) /
            creditLimitRate.denominator;
    }

    /// @param _owner The owner of the NFT at index `_nftIndex` (or the owner of the associated position in the vault)
    /// @param _nftIndex The index of the NFT to return the liquidation limit for
    /// @return The liquidation limit for the NFT with index `_nftIndex`, in ETH
    function getLiquidationLimitETH(address _owner, uint256 _nftIndex)
        external
        view
        returns (uint256)
    {
        Rate memory liquidationLimitRate = getLiquidationLimitRate(
            _owner,
            _nftIndex
        );
        return
            (getNFTValueETH(_nftIndex) * liquidationLimitRate.numerator) /
            liquidationLimitRate.denominator;
    }

    /// @param _nftType The NFT type to calculate the JPEG lock amount for
    /// @param _jpegPrice The JPEG price in ETH (18 decimals)
    /// @return The JPEG to lock for the specified `_nftType`
    function calculateTraitBoostLock(bytes32 _nftType, uint256 _jpegPrice)
        public
        view
        returns (uint256)
    {
        return
            _calculateTraitBoostLock(
                traitBoostLockRate,
                _nftType,
                getFloorETH(),
                _jpegPrice
            );
    }

    /// @param _nftIndex The index of the NFT to calculate the JPEG lock amount for
    /// @param _jpegPrice The JPEG price in ETH (18 decimals)
    /// @return The JPEG to lock for the specified `_nftIndex`
    function calculateLTVBoostLock(uint256 _nftIndex, uint256 _jpegPrice)
        external
        view
        returns (uint256)
    {
        uint256 nftValue = getNFTValueETH(_nftIndex);

        Rate memory creditLimitRate = baseCreditLimitRate;
        return
            _calculateLTVBoostLock(
                creditLimitRate,
                _rateSum(creditLimitRate, jpegLockedRateIncrease),
                ltvBoostLockRate,
                nftValue,
                _jpegPrice
            );
    }

    /// @return The floor value for the collection, in ETH.
    function getFloorETH() public view returns (uint256) {
        if (daoFloorOverride) return overriddenFloorValueETH;
        else return aggregator.getFloorETH();
    }

    /// @param _nftIndex The NFT to return the value of
    /// @return The value in ETH of the NFT at index `_nftIndex`, with 18 decimals.
    function getNFTValueETH(uint256 _nftIndex) public view returns (uint256) {
        uint256 floor = getFloorETH();

        bytes32 nftType = nftTypes[_nftIndex];
        if (
            nftType != bytes32(0) &&
            traitBoostPositions[_nftIndex].unlockAt > block.timestamp
        ) {
            Rate memory multiplier = nftTypeValueMultiplier[nftType];
            return (floor * multiplier.numerator) / multiplier.denominator;
        } else return floor;
    }

    /// @notice Allows users to lock JPEG tokens to unlock the trait boost for a single non floor NFT.
    /// The trait boost is a multiplicative value increase relative to the collection's floor.
    /// The value increase depends on the NFT's traits and it's set by the DAO.
    /// The ETH value of the JPEG to lock is calculated by applying the `traitBoostLockRate` rate to the NFT's new credit limit.
    /// The unlock time is set by the user and has to be greater than `block.timestamp` and the previous unlock time.
    /// After the lock expires, the boost is revoked and the NFT's value goes back to floor.
    /// If a boosted position is closed or liquidated, the JPEG remains locked and the boost will still be applied in case the NFT
    /// is deposited again, even in case of a different owner. The locked JPEG will only be claimable by the original lock creator
    /// once the lock expires. If the lock is renewed by the new owner, the JPEG from the previous lock will be sent back to the original
    /// lock creator.
    /// @dev emits multiple {JPEGLocked} events
    /// @param _nftIndexes The indexes of the non floor NFTs to boost
    /// @param _unlocks The locks expiration times
    function applyTraitBoost(
        uint256[] calldata _nftIndexes,
        uint256[] calldata _unlocks
    ) external nonReentrant {
        _lockJPEG(_nftIndexes, _unlocks, true);
    }

    /// @notice Allows users to lock JPEG tokens to unlock the LTV boost for a single NFT.
    /// The LTV boost is an increase of an NFT's credit and liquidation limit rates.
    /// The ETH value of the JPEG to lock is calculated by applying the `ltvBoostLockRate` rate to the difference between the new and the old credit limits.
    /// See {applyTraitBoost} for details on the locking and unlocking mechanism.
    /// @dev emits multiple {JPEGLocked} events
    /// @param _nftIndexes The indexes of the NFTs to boost
    /// @param _unlocks The locks expiration times
    function applyLTVBoost(
        uint256[] calldata _nftIndexes,
        uint256[] calldata _unlocks
    ) external nonReentrant {
        _lockJPEG(_nftIndexes, _unlocks, false);
    }

    /// @notice Allows trait boost lock creators to unlock the JPEG associated to the NFT at index `_nftIndex`, provided the lock expired.
    /// @dev emits a {JPEGUnlocked} event
    /// @param _nftIndexes The indexes of the NFTs holding the locks.
    function withdrawTraitBoost(uint256[] calldata _nftIndexes)
        external
        nonReentrant
    {
        _unlockJPEG(traitBoostPositions, _nftIndexes, true);
    }

    /// @notice Allows ltv boost lock creators to unlock the JPEG associated to the NFT at index `_nftIndex`, provided the lock expired.
    /// @dev emits a {JPEGUnlocked} event
    /// @param _nftIndexes The indexes of the NFTs holding the locks.
    function withdrawLTVBoost(uint256[] calldata _nftIndexes)
        external
        nonReentrant
    {
        _unlockJPEG(ltvBoostPositions, _nftIndexes, false);
    }

    function addLocks(
        uint256[] calldata _nftIndexes,
        JPEGLock[] calldata _locks
    ) external onlyOwner {
        if (_nftIndexes.length != _locks.length || _nftIndexes.length == 0)
            revert InvalidLength();

        for (uint256 i; i < _nftIndexes.length; ++i) {
            if (traitBoostPositions[_nftIndexes[i]].owner != address(0))
                revert ExistingLock(_nftIndexes[i]);
            traitBoostPositions[_nftIndexes[i]] = _locks[i];
        }
    }

    /// @notice Allows the DAO to bypass the floor oracle and override the NFT floor value
    /// @param _newFloor The new floor
    function overrideFloor(uint256 _newFloor) external onlyOwner {
        if (_newFloor == 0) revert InvalidAmount(_newFloor);
        overriddenFloorValueETH = _newFloor;
        daoFloorOverride = true;

        emit DaoFloorChanged(_newFloor);
    }

    /// @notice Allows the DAO to stop overriding floor
    function disableFloorOverride() external onlyOwner {
        daoFloorOverride = false;
    }

    /// @notice Allows the DAO to change the multiplier of an NFT category
    /// @param _type The category hash
    /// @param _multiplier The new multiplier
    function setNFTTypeMultiplier(bytes32 _type, Rate calldata _multiplier)
        external
        onlyOwner
    {
        if (_type == bytes32(0)) revert InvalidNFTType(_type);
        _validateRateAboveOne(_multiplier);
        nftTypeValueMultiplier[_type] = _multiplier;
    }

    /// @notice Allows the DAO to add an NFT to a specific price category
    /// @param _nftIndexes The indexes to add to the category
    /// @param _type The category hash
    function setNFTType(uint256[] calldata _nftIndexes, bytes32 _type)
        external
        onlyOwner
    {
        if (_type != bytes32(0) && nftTypeValueMultiplier[_type].numerator == 0)
            revert InvalidNFTType(_type);

        for (uint256 i; i < _nftIndexes.length; ++i) {
            nftTypes[_nftIndexes[i]] = _type;
        }
    }

    function setBaseCreditLimitRate(Rate memory _baseCreditLimitRate)
        external
        onlyOwner
    {
        _validateRateBelowOne(_baseCreditLimitRate);
        if (!_greaterThan(baseLiquidationLimitRate, _baseCreditLimitRate))
            revert InvalidRate(_baseCreditLimitRate);

        baseCreditLimitRate = _baseCreditLimitRate;
    }

    function setBaseLiquidationLimitRate(Rate memory _liquidationLimitRate)
        external
        onlyOwner
    {
        _validateRateBelowOne(_liquidationLimitRate);

        if (!_greaterThan(_liquidationLimitRate, baseCreditLimitRate))
            revert InvalidRate(_liquidationLimitRate);

        _validateRateBelowOne(
            _rateSum(
                _rateSum(_liquidationLimitRate, cigStakedRateIncrease),
                jpegLockedRateIncrease
            )
        );

        baseLiquidationLimitRate = _liquidationLimitRate;
    }

    function setCigStakedRateIncrease(Rate memory _cigStakedRateIncrease)
        external
        onlyOwner
    {
        _validateRateBelowOne(_cigStakedRateIncrease);
        _validateRateBelowOne(
            _rateSum(
                _rateSum(baseLiquidationLimitRate, _cigStakedRateIncrease),
                jpegLockedRateIncrease
            )
        );

        cigStakedRateIncrease = _cigStakedRateIncrease;
    }

    function setJPEGLockedRateIncrease(Rate memory _jpegLockedRateIncrease)
        external
        onlyOwner
    {
        _validateRateBelowOne(_jpegLockedRateIncrease);
        _validateRateBelowOne(
            _rateSum(
                _rateSum(baseLiquidationLimitRate, cigStakedRateIncrease),
                _jpegLockedRateIncrease
            )
        );

        jpegLockedRateIncrease = _jpegLockedRateIncrease;
    }

    function setTraitBoostLockRate(Rate memory _traitBoostLockRate)
        external
        onlyOwner
    {
        _validateRateBelowOne(_traitBoostLockRate);
        traitBoostLockRate = _traitBoostLockRate;
    }

    function setLTVBoostLockRate(Rate memory _ltvBoostLockRate)
        external
        onlyOwner
    {
        _validateRateBelowOne(_ltvBoostLockRate);
        ltvBoostLockRate = _ltvBoostLockRate;
    }

    /// @dev see {applyTraitBoost} and {applyLTVBoost}
    function _lockJPEG(
        uint256[] memory _nftIndexes,
        uint256[] memory _unlocks,
        bool _isTraitBoost
    ) internal {
        if (_nftIndexes.length != _unlocks.length) revert InvalidLength();

        Rate memory creditLimitRate;
        Rate memory boostedCreditLimitRate;
        Rate memory lockRate;

        if (_isTraitBoost) {
            lockRate = traitBoostLockRate;
        } else {
            creditLimitRate = baseCreditLimitRate;
            boostedCreditLimitRate = _rateSum(
                creditLimitRate,
                jpegLockedRateIncrease
            );
            lockRate = ltvBoostLockRate;
        }

        IERC20Upgradeable _jpeg = jpeg;
        uint256 floor = getFloorETH();
        uint256 minJPEG = minJPEGToLock;
        uint256 jpegPrice = _jpegPriceETH();
        uint256 requiredJpeg;
        uint256 jpegToRefund;
        for (uint256 i; i < _nftIndexes.length; ++i) {
            uint256 index = _nftIndexes[i];
            uint256 unlockAt = _unlocks[i];

            uint256 jpegToLock;

            JPEGLock storage jpegLock;
            if (_isTraitBoost) {
                jpegLock = traitBoostPositions[index];
                bytes32 nftType = nftTypes[index];
                if (nftType == bytes32(0)) revert InvalidNFTType(nftType);
                jpegToLock = _calculateTraitBoostLock(
                    lockRate,
                    nftType,
                    floor,
                    jpegPrice
                );

                if (minJPEG > jpegToLock) revert InvalidNFTType(nftType);

                //dirty workaround to prevent stack too deep errors
                _emitJPEGLockedTraitBoost(index, jpegToLock, unlockAt);
            } else {
                jpegLock = ltvBoostPositions[index];
                jpegToLock = _calculateLTVBoostLock(
                    creditLimitRate,
                    boostedCreditLimitRate,
                    lockRate,
                    floor,
                    jpegPrice
                );
                if (minJPEG > jpegToLock) jpegToLock = minJPEG;

                //dirty workaround to prevent stack too deep errors
                _emitJPEGLockedLTVBoost(index, jpegToLock, unlockAt);
            }

            if (block.timestamp >= unlockAt || jpegLock.unlockAt >= unlockAt)
                revert InvalidUnlockTime(unlockAt);

            uint256 previousLockValue = jpegLock.lockedValue;
            address previousOwner = jpegLock.owner;

            jpegLock.lockedValue = jpegToLock;
            jpegLock.unlockAt = unlockAt;
            jpegLock.owner = msg.sender;

            requiredJpeg += jpegToLock;

            if (previousOwner == msg.sender) jpegToRefund += previousLockValue;
            else if (previousLockValue > 0)
                _jpeg.safeTransfer(previousOwner, previousLockValue);
        }

        if (requiredJpeg > jpegToRefund)
            _jpeg.safeTransferFrom(
                msg.sender,
                address(this),
                requiredJpeg - jpegToRefund
            );
        else if (requiredJpeg < jpegToRefund)
            _jpeg.safeTransfer(msg.sender, jpegToRefund - requiredJpeg);
    }

    /// @dev This function is used in {_lockJPEG} to prevent stack too deep errors
    function _emitJPEGLockedTraitBoost(
        uint256 _nftIndex,
        uint256 _jpegToLock,
        uint256 _unlockAt
    ) internal {
        emit JPEGLocked(msg.sender, _nftIndex, _jpegToLock, _unlockAt, true);
    }

    /// @dev This function is used in {_lockJPEG} to prevent stack too deep errors
    function _emitJPEGLockedLTVBoost(
        uint256 _nftIndex,
        uint256 _jpegToLock,
        uint256 _unlockAt
    ) internal {
        emit JPEGLocked(msg.sender, _nftIndex, _jpegToLock, _unlockAt, false);
    }

    /// @dev See {withdrawTraitBoost} and {withdrawLTVBoost}
    function _unlockJPEG(
        mapping(uint256 => JPEGLock) storage _locks,
        uint256[] calldata _nftIndexes,
        bool _isTraitBoost
    ) internal {
        uint256 length = _nftIndexes.length;
        if (length == 0) revert InvalidLength();

        uint256 jpegToSend;
        for (uint256 i; i < length; ++i) {
            uint256 index = _nftIndexes[i];
            JPEGLock memory jpegLock = _locks[index];
            if (jpegLock.owner != msg.sender) revert Unauthorized();

            if (block.timestamp < jpegLock.unlockAt) revert Unauthorized();

            jpegToSend += jpegLock.lockedValue;

            delete _locks[index];

            emit JPEGUnlocked(
                msg.sender,
                index,
                jpegLock.lockedValue,
                _isTraitBoost
            );
        }

        jpeg.safeTransfer(msg.sender, jpegToSend);
    }

    function _calculateTraitBoostLock(
        Rate memory _lockRate,
        bytes32 _nftType,
        uint256 _floor,
        uint256 _jpegPrice
    ) internal view returns (uint256) {
        Rate memory multiplier = nftTypeValueMultiplier[_nftType];

        if (multiplier.numerator == 0 || multiplier.denominator == 0) return 0;

        return
            (((_floor * multiplier.numerator) /
                multiplier.denominator -
                _floor) *
                1 ether *
                _lockRate.numerator) /
            _lockRate.denominator /
            _jpegPrice;
    }

    function _calculateLTVBoostLock(
        Rate memory _creditLimitRate,
        Rate memory _boostedCreditLimitRate,
        Rate memory _lockRate,
        uint256 _floor,
        uint256 _jpegPrice
    ) internal pure returns (uint256) {
        uint256 baseCreditLimit = (_floor * _creditLimitRate.numerator) /
            _creditLimitRate.denominator;
        uint256 boostedCreditLimit = (_floor *
            _boostedCreditLimitRate.numerator) /
            _boostedCreditLimitRate.denominator;

        return
            ((((boostedCreditLimit - baseCreditLimit) * _lockRate.numerator) /
                _lockRate.denominator) * 1 ether) / _jpegPrice;
    }

    function _rateAfterBoosts(
        Rate memory _baseRate,
        address _owner,
        uint256 _nftIndex
    ) internal view returns (Rate memory) {
        if (cigStaking.isUserStaking(_owner)) {
            _baseRate = _rateSum(_baseRate, cigStakedRateIncrease);
        }
        if (ltvBoostPositions[_nftIndex].unlockAt > block.timestamp) {
            _baseRate = _rateSum(_baseRate, jpegLockedRateIncrease);
        }

        return _baseRate;
    }

    /// @dev Returns the current JPEG price in ETH
    /// @return result The current JPEG price, 18 decimals
    function _jpegPriceETH() internal returns (uint256) {
        return aggregator.consultJPEGPriceETH(address(jpeg));
    }

    /// @dev Validates a rate. The denominator must be greater than zero and less than or equal to the numerator.
    /// @param _rate The rate to validate
    function _validateRateAboveOne(Rate memory _rate) internal pure {
        if (_rate.denominator == 0 || _rate.numerator < _rate.denominator)
            revert InvalidRate(_rate);
    }

    /// @dev Validates a rate. The denominator must be greater than zero and greater than or equal to the numerator.
    /// @param _rate The rate to validate
    function _validateRateBelowOne(Rate memory _rate) internal pure {
        if (_rate.denominator == 0 || _rate.denominator < _rate.numerator)
            revert InvalidRate(_rate);
    }

    /// @dev Checks if `r1` is greater than `r2`.
    function _greaterThan(Rate memory _r1, Rate memory _r2)
        internal
        pure
        returns (bool)
    {
        return
            _r1.numerator * _r2.denominator > _r2.numerator * _r1.denominator;
    }

    function _rateSum(Rate memory _r1, Rate memory _r2)
        internal
        pure
        returns (Rate memory)
    {
        return
            Rate({
                numerator: _r1.numerator *
                    _r2.denominator +
                    _r1.denominator *
                    _r2.numerator,
                denominator: _r1.denominator * _r2.denominator
            });
    }
}
