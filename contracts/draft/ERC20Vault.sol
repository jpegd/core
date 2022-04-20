// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../interfaces/IAggregatorV3Interface.sol";
import "../interfaces/IStableCoin.sol";
import "../interfaces/IERC20Decimals.sol";

/**
 * ERC20 lending vault
 * Owner: dao address
 */
contract ERC20Vault is OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Position {
        uint256 depositAmount;
        uint256 debtPrincipal;
        uint256 debtInterest;
        uint256 debtUpdatedAt;
    }

    struct Rate {
        uint128 numerator;
        uint128 denominator;
    }

    address public constant ETH = 0x0000000000000000000000000000000000000000;
    uint256 constant SECS_YEAR = 86400 * 365;

    address public collateralAsset; // Collateral Asset
    address public stablecoin; // PUSD
    uint256 private _collateralUnit; // 10 ** collateralAssetDecimals

    address public oracle; // Chainlink pricing oracle

    Rate public debtInterestApr; // Borrow interest rate
    Rate public creditLimitRate; // Credit limit rate
    Rate public liquidationLimitRate; // Liquidation limit rate
    uint256 public compoundingIntervalSecs; // Interest compounding intervals in seconds

    mapping(address => Position) public positions;

    function initialize(
        address _collateralAsset,
        address _stablecoin,
        address _oracle
    ) public initializer {
        __Ownable_init();
        __ReentrancyGuard_init();

        collateralAsset = _collateralAsset;
        stablecoin = _stablecoin;
        if (_collateralAsset == ETH) {
            _collateralUnit = 10**18;
        } else {
            _collateralUnit = 10**IERC20Decimals(_collateralAsset).decimals();
        }

        oracle = _oracle;

        debtInterestApr = Rate(2, 100); // 2%
        creditLimitRate = Rate(32, 100); // 32%
        liquidationLimitRate = Rate(33, 100); // 33%
        compoundingIntervalSecs = 3600; // 1 hour
    }

    function setDebtInterestApr(Rate memory _debtInterestApr)
        external
        onlyOwner
    {
        debtInterestApr = _debtInterestApr;
    }

    function setCreditLimitRate(Rate memory _creditLimitRate)
        external
        onlyOwner
    {
        creditLimitRate = _creditLimitRate;
    }

    function setLiquidationLimitRate(Rate memory _liquidationLimitRate)
        external
        onlyOwner
    {
        liquidationLimitRate = _liquidationLimitRate;
    }

    function setCompoundingIntervalSecs(uint256 _compoundingIntervalSecs)
        external
        onlyOwner
    {
        compoundingIntervalSecs = _compoundingIntervalSecs;
    }

    function collateralPriceUsd() public view returns (uint256) {
        int256 answer = IAggregatorV3Interface(oracle).latestAnswer();

        return uint256(answer) * 10**10;
    }

    function _getCollateralValue(uint256 amount)
        internal
        view
        returns (uint256)
    {
        return (amount * collateralPriceUsd()) / _collateralUnit;
    }

    function _getCreditLimit(uint256 amount) internal view returns (uint256) {
        uint256 collateralValue = _getCollateralValue(amount);
        return
            (collateralValue * creditLimitRate.numerator) /
            creditLimitRate.denominator;
    }

    function _getLiquidationLimit(uint256 amount)
        internal
        view
        returns (uint256)
    {
        return
            (_getCollateralValue(amount) * liquidationLimitRate.numerator) /
            liquidationLimitRate.denominator;
    }

    function _getDebtInterest(address user)
        internal
        view
        returns (uint256 debtInterest)
    {
        Position memory position = positions[user];

        // check if there is debt
        if (position.debtPrincipal > 0) {
            uint256 timeDifferenceSecs = (block.timestamp -
                position.debtUpdatedAt);

            debtInterest = position.debtInterest;
            if (timeDifferenceSecs > compoundingIntervalSecs) {
                uint256 totalDebt = position.debtPrincipal +
                    position.debtInterest;
                uint256 interestPerYear = (totalDebt *
                    debtInterestApr.numerator) / debtInterestApr.denominator;
                uint256 interestPerSec = interestPerYear / SECS_YEAR;
                debtInterest += (timeDifferenceSecs * interestPerSec);
            }
        }
    }

    function _updateDebtInterest(address user) internal {
        uint256 debtInterest = _getDebtInterest(user);
        if (positions[user].debtInterest != debtInterest) {
            positions[user].debtInterest = debtInterest;
            positions[user].debtUpdatedAt = block.timestamp;
        }
    }

    function deposit(uint256 amount) public payable virtual {
        if (collateralAsset == ETH) {
            require(msg.value == amount, "invalid_amount");
        } else {
            IERC20Upgradeable(collateralAsset).safeTransferFrom(
                msg.sender,
                address(this),
                amount
            );
        }

        positions[msg.sender].depositAmount += amount;
    }

    function borrow(uint256 amount) public virtual nonReentrant {
        _updateDebtInterest(msg.sender);

        Position memory position = positions[msg.sender];
        uint256 creditLimit = _getCreditLimit(position.depositAmount);
        uint256 totalDebt = position.debtPrincipal + position.debtInterest;
        require(amount + totalDebt <= creditLimit, "insufficient_credit");

        // mint stablecoin
        IStableCoin(stablecoin).mint(msg.sender, amount);

        // update position
        positions[msg.sender].debtPrincipal += amount;
        if (totalDebt == 0) {
            positions[msg.sender].debtUpdatedAt = block.timestamp;
        }
    }

    function repay(uint256 amount) public virtual nonReentrant {
        _updateDebtInterest(msg.sender);

        Position memory position = positions[msg.sender];
        uint256 debtPrincipal = position.debtPrincipal;
        uint256 debtInterest = position.debtInterest;
        uint256 totalDebt = debtPrincipal + debtInterest;
        amount = amount > totalDebt ? totalDebt : amount;

        IERC20Upgradeable(stablecoin).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );

        uint256 paidInterest = 0;
        // pay interest
        if (amount < debtInterest) {
            paidInterest = amount;
            positions[msg.sender].debtInterest = debtInterest - paidInterest;
        } else {
            paidInterest = debtInterest;
            positions[msg.sender].debtInterest = 0;
        }

        uint256 paidPrincipal = amount - paidInterest;
        // pay principal
        if (paidPrincipal > 0) {
            positions[msg.sender].debtPrincipal = debtPrincipal - paidPrincipal;
        }

        // transfer interest to dao
        if (paidInterest > 0) {
            IERC20Upgradeable(stablecoin).safeTransfer(owner(), paidInterest);
        }
        // burn principal
        if (paidPrincipal > 0) {
            IStableCoin(stablecoin).burn(paidPrincipal);
        }
    }

    function withdraw(uint256 amount) public virtual nonReentrant {
        _updateDebtInterest(msg.sender);

        Position memory position = positions[msg.sender];
        require(amount <= position.depositAmount, "invalid_amount");

        uint256 creditLimit = _getCreditLimit(position.depositAmount - amount);
        require(
            creditLimit >= position.debtPrincipal + position.debtInterest,
            "insufficient_credit"
        );

        positions[msg.sender].depositAmount -= amount;

        if (collateralAsset == ETH) {
            (bool sent, ) = msg.sender.call{value: amount}("");
            require(sent, "Failed to send Ether");
        } else {
            IERC20Upgradeable(collateralAsset).safeTransfer(msg.sender, amount);
        }
    }

    function liquidate(address user) public virtual nonReentrant onlyOwner {
        require(user != owner(), "dao_position");

        _updateDebtInterest(msg.sender);

        Position memory position = positions[user];
        uint256 depositAmount = position.depositAmount;
        uint256 debtPrincipal = position.debtPrincipal;
        uint256 debtInterest = position.debtInterest;
        uint256 totalDebt = debtPrincipal + debtInterest;
        require(totalDebt > 0, "position_not_borrowed");
        require(
            debtPrincipal + debtInterest >= _getLiquidationLimit(depositAmount),
            "position_not_liquidatable"
        );

        // receive stablecoin from liquidator
        IERC20Upgradeable(stablecoin).safeTransferFrom(
            msg.sender,
            address(this),
            totalDebt
        );

        // transfer interest to dao
        if (debtInterest > 0) {
            IERC20Upgradeable(stablecoin).safeTransfer(owner(), debtInterest);
        }

        // burn principal payment
        if (debtPrincipal > 0) {
            IStableCoin(stablecoin).burn(debtPrincipal);
        }

        // transfer collateral to liquidator
        if (collateralAsset == ETH) {
            (bool sent, ) = msg.sender.call{value: depositAmount}("");
            require(sent, "Failed to send Ether");
        } else {
            IERC20Upgradeable(collateralAsset).safeTransfer(
                msg.sender,
                depositAmount
            );
        }

        // update position
        delete positions[user];
    }

    uint256[50] private __gap;
}
