// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../utils/RateLib.sol";

import "../interfaces/IAggregatorV3Interface.sol";
import "../interfaces/IStableCoin.sol";
import "../interfaces/INFTValueProvider.sol";
import "../interfaces/INFTStrategy.sol";

/// @title DAO NFT lending vault
/// @notice This contract allows DAO addresses to borrow assets using NFTs as collateral.
/// The floor price of the NFT collection is fetched using a chainlink oracle, while some other more valuable traits
/// can have an higher price set by the DAO.
contract DAONFTVault is AccessControlUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using SafeERC20Upgradeable for IStableCoin;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.UintSet;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
    using RateLib for RateLib.Rate;

    error InvalidNFT(uint256 nftIndex);
    error InvalidAmount(uint256 amount);
    error InvalidPosition(uint256 nftIndex);
    error Unauthorized();
    error DebtCapReached();
    error NoDebt();
    error NonZeroDebt(uint256 debtAmount);
    error ZeroAddress();
    error UnknownAction(uint8 action);
    error InvalidLength();
    error InvalidStrategy();

    event PositionOpened(address indexed owner, uint256 indexed index);
    event Borrowed(
        address indexed owner,
        uint256 indexed index,
        uint256 amount
    );
    event Repaid(address indexed owner, uint256 indexed index, uint256 amount);
    event PositionClosed(address indexed owner, uint256 indexed index);
    event StrategyDeposit(
        uint256 indexed nftIndex,
        address indexed strategy,
        bool isStandard
    );
    event StrategyWithdrawal(
        uint256 indexed nftIndex,
        address indexed strategy
    );

    struct Position {
        uint256 debtPrincipal;
        uint256 debtPortion;
        INFTStrategy strategy;
    }

    struct VaultSettings {
        RateLib.Rate debtInterestApr;
        RateLib.Rate creditLimitRate;
        RateLib.Rate organizationFeeRate;
        uint256 borrowAmountCap;
    }

    bytes32 private constant DAO_ROLE = keccak256("DAO_ROLE");
    bytes32 private constant WHITELISTED_ROLE = keccak256("WHITELISTED_ROLE");
    bytes32 private constant SETTER_ROLE = keccak256("SETTER_ROLE");

    //accrue required
    uint8 private constant ACTION_BORROW = 0;
    uint8 private constant ACTION_REPAY = 1;
    uint8 private constant ACTION_CLOSE_POSITION = 2;

    IStableCoin public stablecoin;

    /// @notice Chainlink ETH/USD price feed.
    /// Unused in this contract but used in {PUSDDAONFTVault}.
    /// Declared here to prevent storage layout incompatibilities after upgrades.
    IAggregatorV3Interface public ethAggregator;

    INFTValueProvider public nftValueProvider;

    IERC721Upgradeable public nftContract;

    /// @notice Total outstanding debt
    uint256 public totalDebtAmount;
    /// @dev Last time debt was accrued. See {accrue} for more info
    uint256 private totalDebtAccruedAt;
    uint256 public totalFeeCollected;
    uint256 private totalDebtPortion;

    VaultSettings public settings;

    /// @dev Keeps track of all the NFTs used as collateral for positions
    EnumerableSetUpgradeable.UintSet private positionIndexes;

    EnumerableSetUpgradeable.AddressSet private nftStrategies;

    mapping(uint256 => Position) public positions;
    mapping(uint256 => address) public positionOwner;

    /// @dev Checks if the provided NFT index is valid
    /// @param nftIndex The index to check
    modifier validNFTIndex(uint256 nftIndex) {
        //The standard OZ ERC721 implementation of ownerOf reverts on a non existing nft isntead of returning address(0)
        if (nftContract.ownerOf(nftIndex) == address(0))
            revert InvalidNFT(nftIndex);
        _;
    }

    /// @notice This function is only called once during deployment of the proxy contract. It's not called after upgrades.
    /// @param _stablecoin stablecoin address
    /// @param _nftContract The NFT contract address. It could also be the address of an helper contract
    /// if the target NFT isn't an ERC721 (CryptoPunks as an example)
    /// @param _settings Initial settings used by the contract
    function initialize(
        IStableCoin _stablecoin,
        IERC721Upgradeable _nftContract,
        INFTValueProvider _nftValueProvider,
        IAggregatorV3Interface _ethAggregator,
        VaultSettings calldata _settings
    ) external initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();

        _setupRole(DAO_ROLE, msg.sender);
        _setRoleAdmin(SETTER_ROLE, DAO_ROLE);
        _setRoleAdmin(WHITELISTED_ROLE, DAO_ROLE);
        _setRoleAdmin(DAO_ROLE, DAO_ROLE);

        if (
            !_settings.debtInterestApr.isValid() ||
            !_settings.debtInterestApr.isBelowOne()
        ) revert RateLib.InvalidRate();

        if (
            !_settings.organizationFeeRate.isValid() ||
            !_settings.organizationFeeRate.isBelowOne()
        ) revert RateLib.InvalidRate();

        if (
            !_settings.creditLimitRate.isValid() ||
            !_settings.creditLimitRate.isBelowOne()
        ) revert RateLib.InvalidRate();

        stablecoin = _stablecoin;
        nftContract = _nftContract;
        nftValueProvider = _nftValueProvider;
        ethAggregator = _ethAggregator;

        settings = _settings;
    }

    /// @notice Returns the number of open positions
    /// @return The number of open positions
    function totalPositions() external view returns (uint256) {
        return positionIndexes.length();
    }

    /// @notice Returns all open position NFT indexes
    /// @return The open position NFT indexes
    function openPositionsIndexes() external view returns (uint256[] memory) {
        return positionIndexes.values();
    }

    /// @param _nftIndex The NFT to return the credit limit of
    /// @return The stablecoin credit limit of the NFT at index `_nftIndex`.
    function getCreditLimit(uint256 _nftIndex) external view returns (uint256) {
        return _getCreditLimit(_nftIndex);
    }

    /// @param _nftIndex The NFT to check
    /// @return The stablecoin debt interest accumulated by the NFT at index `_nftIndex`.
    function getDebtInterest(uint256 _nftIndex) public view returns (uint256) {
        Position storage position = positions[_nftIndex];
        uint256 principal = position.debtPrincipal;
        uint256 debt = _calculateDebt(
            totalDebtAmount + _calculateAdditionalInterest(),
            position.debtPortion,
            totalDebtPortion
        );

        //_calculateDebt is prone to rounding errors that may cause
        //the calculated debt amount to be 1 or 2 units less than
        //the debt principal if no time has elapsed in between the first borrow
        //and the _calculateDebt call.
        if (principal > debt) debt = principal;

        unchecked {
            return debt - principal;
        }
    }

    /// @return The whitelisted strategies for this vault.
    function getStrategies() external view returns (address[] memory) {
        return nftStrategies.values();
    }

    /// @dev The {accrue} function updates the contract's state by calculating
    /// the additional interest accrued since the last state update
    function accrue() public {
        uint256 additionalInterest = _calculateAdditionalInterest();

        totalDebtAccruedAt = block.timestamp;

        totalDebtAmount += additionalInterest;
        totalFeeCollected += additionalInterest;
    }

    /// @notice Allows to execute multiple actions in a single transaction.
    /// @param _actions The actions to execute.
    /// @param _datas The abi encoded parameters for the actions to execute.
    function doActions(uint8[] calldata _actions, bytes[] calldata _datas)
        external
        nonReentrant
    {
        if (_actions.length != _datas.length) revert();
        bool accrueCalled;
        for (uint256 i; i < _actions.length; ++i) {
            uint8 action = _actions[i];
            if (!accrueCalled && action < 100) {
                accrue();
                accrueCalled = true;
            }

            if (action == ACTION_BORROW) {
                (uint256 nftIndex, uint256 amount) = abi.decode(
                    _datas[i],
                    (uint256, uint256)
                );
                _borrow(nftIndex, amount);
            } else if (action == ACTION_REPAY) {
                (uint256 nftIndex, uint256 amount) = abi.decode(
                    _datas[i],
                    (uint256, uint256)
                );
                _repay(nftIndex, amount);
            } else if (action == ACTION_CLOSE_POSITION) {
                uint256 nftIndex = abi.decode(_datas[i], (uint256));
                _closePosition(nftIndex);
            } else {
                revert UnknownAction(action);
            }
        }
    }

    /// @notice Allows users to open positions and borrow using an NFT
    /// @dev emits a {Borrowed} event
    /// @param _nftIndex The index of the NFT to be used as collateral
    /// @param _amount The amount of stablecoin to be borrowed. Note that the user will receive less than the amount requested,
    /// the borrow fee and insurance automatically get removed from the amount borrowed
    function borrow(uint256 _nftIndex, uint256 _amount) external nonReentrant {
        accrue();
        _borrow(_nftIndex, _amount);
    }

    /// @notice Allows users to repay a portion/all of their debt. Note that since interest increases every second,
    /// a user wanting to repay all of their debt should repay for an amount greater than their current debt to account for the
    /// additional interest while the repay transaction is pending, the contract will only take what's necessary to repay all the debt
    /// @dev Emits a {Repaid} event
    /// @param _nftIndex The NFT used as collateral for the position
    /// @param _amount The amount of debt to repay. If greater than the position's outstanding debt, only the amount necessary to repay all the debt will be taken
    function repay(uint256 _nftIndex, uint256 _amount) external nonReentrant {
        accrue();
        _repay(_nftIndex, _amount);
    }

    /// @notice Allows a user to close a position and get their collateral back, if the position's outstanding debt is 0
    /// @dev Emits a {PositionClosed} event
    /// @param _nftIndex The index of the NFT used as collateral
    function closePosition(uint256 _nftIndex) external nonReentrant {
        accrue();
        _closePosition(_nftIndex);
    }

    /// @notice Allows borrowers to deposit NFTs to a whitelisted strategy. Strategies may be used to claim airdrops, stake NFTs for rewards and more.
    /// @dev Emits multiple {StrategyDeposit} events
    /// @param _nftIndexes The indexes of the NFTs to deposit
    /// @param _strategyIndex The index of the strategy to deposit the NFTs into, see {getStrategies}
    /// @param _additionalData Additional data to send to the strategy.
    function depositInStrategy(
        uint256[] calldata _nftIndexes,
        uint256 _strategyIndex,
        bytes calldata _additionalData
    ) external nonReentrant {
        _depositInStrategy(_nftIndexes, _strategyIndex, _additionalData);
    }

    /// @notice Allows users to withdraw NFTs from strategies
    /// @dev Emits multiple {StrategyWithdrawal} events
    /// @param _nftIndexes The indexes of the NFTs to withdraw
    function withdrawFromStrategy(uint256[] calldata _nftIndexes)
        external
        nonReentrant
    {
        _withdrawFromStrategy(_nftIndexes);
    }

    /// @notice Allows the DAO to collect interest and fees before they are repaid
    function collect() external nonReentrant onlyRole(DAO_ROLE) {
        accrue();
        stablecoin.mint(msg.sender, totalFeeCollected);
        totalFeeCollected = 0;
    }

    /// @notice Allows the DAO to withdraw _amount of an ERC20
    function rescueToken(IERC20Upgradeable _token, uint256 _amount)
        external
        nonReentrant
        onlyRole(DAO_ROLE)
    {
        _token.safeTransfer(msg.sender, _amount);
    }

    /// @notice Allows the DAO to whitelist a strategy
    function addStrategy(address _strategy) external onlyRole(DAO_ROLE) {
        if (_strategy == address(0)) revert ZeroAddress();

        if (!nftStrategies.add(_strategy)) revert InvalidStrategy();
    }

    /// @notice Allows the DAO to remove a strategy from the whitelist
    function removeStrategy(address _strategy) external onlyRole(DAO_ROLE) {
        if (_strategy == address(0)) revert ZeroAddress();

        if (!nftStrategies.remove(_strategy)) revert InvalidStrategy();
    }

    /// @notice Allows the setter contract to change fields in the `VaultSettings` struct.
    /// @dev Validation and single field setting is handled by an external contract with the
    /// `SETTER_ROLE`. This was done to reduce the contract's size.
    function setSettings(VaultSettings calldata _settings)
        external
        onlyRole(SETTER_ROLE)
    {
        settings = _settings;
    }

    /// @dev Opens a position
    /// Emits a {PositionOpened} event
    /// @param _owner The owner of the position to open
    /// @param _nftIndex The NFT used as collateral for the position
    function _openPosition(address _owner, uint256 _nftIndex) internal {
        positionOwner[_nftIndex] = _owner;
        positionIndexes.add(_nftIndex);

        nftContract.transferFrom(_owner, address(this), _nftIndex);

        emit PositionOpened(_owner, _nftIndex);
    }

    /// @dev See {borrow}
    function _borrow(uint256 _nftIndex, uint256 _amount)
        internal
        validNFTIndex(_nftIndex)
        onlyRole(WHITELISTED_ROLE)
    {
        address owner = positionOwner[_nftIndex];
        if (owner != msg.sender && owner != address(0)) revert Unauthorized();

        if (_amount == 0) revert InvalidAmount(_amount);

        if (totalDebtAmount + _amount > settings.borrowAmountCap)
            revert DebtCapReached();

        Position storage position = positions[_nftIndex];

        uint256 creditLimit = _getCreditLimit(_nftIndex);
        uint256 debtAmount = _getDebtAmount(_nftIndex);
        if (debtAmount + _amount > creditLimit) revert InvalidAmount(_amount);

        //calculate the borrow fee
        uint256 organizationFee = (_amount *
            settings.organizationFeeRate.numerator) /
            settings.organizationFeeRate.denominator;

        totalFeeCollected += organizationFee;

        uint256 debtPortion = totalDebtPortion;
        // update debt portion
        if (debtPortion == 0) {
            totalDebtPortion = _amount;
            position.debtPortion = _amount;
        } else {
            uint256 plusPortion = (debtPortion * _amount) / totalDebtAmount;
            totalDebtPortion = debtPortion + plusPortion;
            position.debtPortion += plusPortion;
        }
        position.debtPrincipal += _amount;
        totalDebtAmount += _amount;

        if (positionOwner[_nftIndex] == address(0)) {
            _openPosition(msg.sender, _nftIndex);
        }

        //subtract the fee from the amount borrowed
        stablecoin.mint(msg.sender, _amount - organizationFee);

        emit Borrowed(msg.sender, _nftIndex, _amount);
    }

    /// @dev See {repay}
    function _repay(uint256 _nftIndex, uint256 _amount)
        internal
        validNFTIndex(_nftIndex)
        onlyRole(WHITELISTED_ROLE)
    {
        if (msg.sender != positionOwner[_nftIndex]) revert Unauthorized();

        if (_amount == 0) revert InvalidAmount(_amount);

        Position storage position = positions[_nftIndex];

        uint256 debtAmount = _getDebtAmount(_nftIndex);
        if (debtAmount == 0) revert NoDebt();

        uint256 debtPrincipal = position.debtPrincipal;
        uint256 debtInterest = debtAmount - debtPrincipal;

        _amount = _amount > debtAmount ? debtAmount : _amount;

        // burn all payment, the interest is sent to the DAO using the {collect} function
        stablecoin.burnFrom(msg.sender, _amount);

        uint256 paidPrincipal;

        unchecked {
            paidPrincipal = _amount > debtInterest ? _amount - debtInterest : 0;
        }

        uint256 totalPortion = totalDebtPortion;
        uint256 totalDebt = totalDebtAmount;
        uint256 minusPortion = paidPrincipal == debtPrincipal
            ? position.debtPortion
            : (totalPortion * _amount) / totalDebt;

        totalDebtPortion = totalPortion - minusPortion;
        position.debtPortion -= minusPortion;
        position.debtPrincipal -= paidPrincipal;
        totalDebtAmount = totalDebt - _amount;

        emit Repaid(msg.sender, _nftIndex, _amount);
    }

    /// @dev See {closePosition}
    function _closePosition(uint256 _nftIndex)
        internal
        validNFTIndex(_nftIndex)
        onlyRole(WHITELISTED_ROLE)
    {
        if (msg.sender != positionOwner[_nftIndex]) revert Unauthorized();

        Position storage position = positions[_nftIndex];

        uint256 debt = _getDebtAmount(_nftIndex);
        if (debt > 0) revert NonZeroDebt(debt);

        INFTStrategy strategy = position.strategy;
        positionOwner[_nftIndex] = address(0);
        delete positions[_nftIndex];
        positionIndexes.remove(_nftIndex);

        if (address(strategy) == address(0))
            nftContract.safeTransferFrom(address(this), msg.sender, _nftIndex);
        else strategy.withdraw(msg.sender, msg.sender, _nftIndex);

        emit PositionClosed(msg.sender, _nftIndex);
    }

    /// @dev See {depositInStrategy}
    function _depositInStrategy(
        uint256[] calldata _nftIndexes,
        uint256 _strategyIndex,
        bytes calldata _additionalData
    ) internal onlyRole(WHITELISTED_ROLE) {
        uint256 length = _nftIndexes.length;
        if (length == 0) revert InvalidLength();
        if (_strategyIndex >= nftStrategies.length()) revert InvalidStrategy();

        INFTStrategy strategy = INFTStrategy(nftStrategies.at(_strategyIndex));

        IERC721Upgradeable nft = nftContract;
        bool isStandard = INFTStrategy(strategy).kind() ==
            INFTStrategy.Kind.STANDARD;
        address depositAddress = strategy.depositAddress(msg.sender);
        for (uint256 i; i < length; ++i) {
            uint256 index = _nftIndexes[i];

            if (positionOwner[index] != msg.sender) revert Unauthorized();

            Position storage position = positions[index];

            if (address(position.strategy) != address(0))
                revert InvalidPosition(index);

            if (isStandard) position.strategy = strategy;
            nft.transferFrom(address(this), depositAddress, index);

            emit StrategyDeposit(index, address(strategy), isStandard);
        }

        strategy.afterDeposit(msg.sender, _nftIndexes, _additionalData);

        if (!isStandard) {
            for (uint256 i; i < length; ++i) {
                if (nft.ownerOf(_nftIndexes[i]) != address(this))
                    revert InvalidStrategy();
            }
        }
    }

    /// @dev See {withdrawFromStrategy}
    function _withdrawFromStrategy(uint256[] calldata _nftIndexes)
        internal
        onlyRole(WHITELISTED_ROLE)
    {
        uint256 length = _nftIndexes.length;
        if (length == 0) revert InvalidLength();

        IERC721Upgradeable nft = nftContract;
        for (uint256 i; i < length; ++i) {
            uint256 index = _nftIndexes[i];

            if (positionOwner[index] != msg.sender) revert Unauthorized();

            Position storage position = positions[index];
            INFTStrategy strategy = position.strategy;
            if (address(strategy) != address(0)) {
                strategy.withdraw(msg.sender, address(this), index);

                if (nft.ownerOf(index) != address(this))
                    revert InvalidStrategy();

                delete position.strategy;

                emit StrategyWithdrawal(index, address(strategy));
            }
        }
    }

    /// @dev Returns the credit limit of an NFT
    /// @param _nftIndex The NFT to return credit limit of
    /// @return The NFT credit limit
    function _getCreditLimit(uint256 _nftIndex)
        internal
        view
        virtual
        returns (uint256)
    {
        uint256 value = nftValueProvider.getNFTValueETH(_nftIndex);
        return
            (value * settings.creditLimitRate.numerator) /
            settings.creditLimitRate.denominator;
    }

    /// @dev Calculates current outstanding debt of an NFT
    /// @param _nftIndex The NFT to calculate the outstanding debt of
    /// @return The outstanding debt value
    function _getDebtAmount(uint256 _nftIndex) internal view returns (uint256) {
        uint256 calculatedDebt = _calculateDebt(
            totalDebtAmount,
            positions[_nftIndex].debtPortion,
            totalDebtPortion
        );

        uint256 principal = positions[_nftIndex].debtPrincipal;

        //_calculateDebt is prone to rounding errors that may cause
        //the calculated debt amount to be 1 or 2 units less than
        //the debt principal when the accrue() function isn't called
        //in between the first borrow and the _calculateDebt call.
        return principal > calculatedDebt ? principal : calculatedDebt;
    }

    /// @dev Calculates the total debt of a position given the global debt, the user's portion of the debt and the total user portions
    /// @param total The global outstanding debt
    /// @param userPortion The user's portion of debt
    /// @param totalPortion The total user portions of debt
    /// @return The outstanding debt of the position
    function _calculateDebt(
        uint256 total,
        uint256 userPortion,
        uint256 totalPortion
    ) internal pure returns (uint256) {
        return totalPortion == 0 ? 0 : (total * userPortion) / totalPortion;
    }

    /// @dev Calculates the additional global interest since last time the contract's state was updated by calling {accrue}
    /// @return The additional interest value
    function _calculateAdditionalInterest() internal view returns (uint256) {
        // Number of seconds since {accrue} was called
        uint256 elapsedTime = block.timestamp - totalDebtAccruedAt;
        if (elapsedTime == 0) {
            return 0;
        }

        uint256 totalDebt = totalDebtAmount;
        if (totalDebt == 0) {
            return 0;
        }

        // Accrue interest
        return
            (elapsedTime * totalDebt * settings.debtInterestApr.numerator) /
            settings.debtInterestApr.denominator /
            365 days;
    }
}
