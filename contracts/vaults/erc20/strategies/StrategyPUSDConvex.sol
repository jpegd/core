// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../../interfaces/ISwapRouter.sol";
import "../../../interfaces/ICurve.sol";
import "../../../interfaces/I3CRVZap.sol";
import "../../../interfaces/IBooster.sol";
import "../../../interfaces/IBaseRewardPool.sol";

import "../../../interfaces/IFungibleAssetVaultForDAO.sol";

import "../../../interfaces/IStrategy.sol";

/// @title JPEG'd PUSD Convex autocompounding strategy
/// @notice This strategy autocompounds Convex rewards from the PUSD/USDC/USDT/DAI Curve pool.
/// @dev The strategy deposits either USDC or PUSD in the Curve pool depending on which one has lower liquidity.
/// The strategy sells reward tokens for USDC. If the pool has less PUSD than USDC, this contract uses the
/// USDC {FungibleAssetVaultForDAO} to mint PUSD using USDC as collateral
contract StrategyPUSDConvex is AccessControl, IStrategy {
    using SafeERC20 for IERC20;
    using SafeERC20 for ICurve;

    event Harvested(uint256 wantEarned);

    struct Rate {
        uint128 numerator;
        uint128 denominator;
    }

    /// @param booster Convex Booster's address
    /// @param baseRewardPool Convex BaseRewardPool's address
    /// @param pid The Convex pool id for PUSD/3CRV LP tokens
    struct ConvexConfig {
        IBooster booster;
        IBaseRewardPool baseRewardPool;
        uint256 pid;
    }

    /// @param zap The 3CRV zap address
    /// @param crv3Index The USDC token index in curve's pool
    /// @param usdcIndex The USDC token index in curve's pool
    /// @param pusdIndex The PUSD token index in curve's pool
    struct ZapConfig {
        I3CRVZap zap;
        uint256 crv3Index;
        uint256 usdcIndex;
        uint256 pusdIndex;
    }

    /// @param lp The curve LP token
    /// @param ethIndex The eth index in the curve LP pool
    struct CurveSwapConfig {
        ICurve lp;
        uint256 ethIndex;
    }

    /// @param vault The strategy's vault
    /// @param usdcVault The JPEG'd USDC {FungibleAssetVaultForDAO} address
    struct StrategyConfig {
        address vault;
        IFungibleAssetVaultForDAO usdcVault;
    }

    struct StrategyTokens {
        ICurve want;
        IERC20 pusd;
        IERC20 weth;
        IERC20 usdc;
        IERC20 cvx;
        IERC20 crv;
    }

    bytes32 public constant STRATEGIST_ROLE = keccak256("STRATEGIST_ROLE");

    /// @notice The PUSD/USDC/USDT/DAI Curve LP token
    StrategyTokens public strategyTokens;

    ISwapRouter public immutable v3Router;

    address public feeRecipient;

    CurveSwapConfig public cvxEth;
    CurveSwapConfig public crvEth;

    ZapConfig public zapConfig;
    ConvexConfig public convexConfig;
    StrategyConfig public strategyConfig;

    /// @notice The performance fee to be sent to the DAO/strategists
    Rate public performanceFee;

    /// @notice lifetime strategy earnings denominated in `want` token
    uint256 public earned;

    /// @param _strategyTokens tokens relevant to this strategy
    /// @param _v3Router The Uniswap V3 router
    /// @param _feeAddress The fee recipient address
    /// @param _cvxEth See {CurveSwapConfig}
    /// @param _crvEth See {CurveSwapConfig}
    /// @param _zapConfig See {ZapConfig} struct
    /// @param _convexConfig See {ConvexConfig} struct
    /// @param _strategyConfig See {StrategyConfig} struct
    /// @param _performanceFee The rate of USDC to be sent to the DAO/strategists
    constructor(
        StrategyTokens memory _strategyTokens,
        address _v3Router,
        address _feeAddress,
        CurveSwapConfig memory _cvxEth,
        CurveSwapConfig memory _crvEth,
        ZapConfig memory _zapConfig,
        ConvexConfig memory _convexConfig,
        StrategyConfig memory _strategyConfig,
        Rate memory _performanceFee
    ) {
        require(address(_strategyTokens.want) != address(0), "INVALID_WANT");
        require(address(_strategyTokens.pusd) != address(0), "INVALID_PUSD");
        require(address(_strategyTokens.weth) != address(0), "INVALID_WETH");
        require(address(_strategyTokens.usdc) != address(0), "INVALID_USDC");

        require(address(_strategyTokens.cvx) != address(0), "INVALID_CVX");
        require(address(_strategyTokens.crv) != address(0), "INVALID_CRV");

        require(_v3Router != address(0), "INVALID_UNISWAP_V3");

        require(address(_cvxEth.lp) != address(0), "INVALID_CVXETH_LP");
        require(address(_crvEth.lp) != address(0), "INVALID_CRVETH_LP");
        require(_cvxEth.ethIndex < 2, "INVALID_ETH_INDEX");
        require(_crvEth.ethIndex < 2, "INVALID_ETH_INDEX");

        require(address(_zapConfig.zap) != address(0), "INVALID_3CRV_ZAP");
        require(
            _zapConfig.pusdIndex != _zapConfig.crv3Index,
            "INVALID_CURVE_INDEXES"
        );
        require(_zapConfig.pusdIndex < 2, "INVALID_PUSD_CURVE_INDEX");
        require(_zapConfig.crv3Index < 2, "INVALID_3CRV_CURVE_INDEX");
        require(_zapConfig.usdcIndex < 4, "INVALID_USDC_CURVE_INDEX");

        require(
            address(_convexConfig.booster) != address(0),
            "INVALID_CONVEX_BOOSTER"
        );
        require(
            address(_convexConfig.baseRewardPool) != address(0),
            "INVALID_CONVEX_BASE_REWARD_POOL"
        );
        require(address(_strategyConfig.vault) != address(0), "INVALID_VAULT");
        require(
            address(_strategyConfig.usdcVault) != address(0),
            "INVALID_USDC_VAULT"
        );

        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        setFeeRecipient(_feeAddress);
        setPerformanceFee(_performanceFee);

        strategyTokens = _strategyTokens;

        feeRecipient = _feeAddress;

        cvxEth = _cvxEth;
        crvEth = _crvEth;

        v3Router = ISwapRouter(_v3Router);

        zapConfig = _zapConfig;
        convexConfig = _convexConfig;
        strategyConfig = _strategyConfig;

        _strategyTokens.want.safeApprove(
            address(_convexConfig.booster),
            type(uint256).max
        );
        _strategyTokens.cvx.safeApprove(address(_cvxEth.lp), type(uint256).max);
        _strategyTokens.crv.safeApprove(address(_crvEth.lp), type(uint256).max);
        _strategyTokens.weth.safeApprove(address(_v3Router), type(uint256).max);
        _strategyTokens.usdc.safeApprove(
            address(_strategyConfig.usdcVault),
            type(uint256).max
        );
        _strategyTokens.usdc.safeApprove(
            address(_zapConfig.zap),
            type(uint256).max
        );
        _strategyTokens.pusd.safeApprove(
            address(_zapConfig.zap),
            type(uint256).max
        );
    }

    modifier onlyVault() {
        require(msg.sender == address(strategyConfig.vault), "NOT_VAULT");
        _;
    }

    /// @notice Allows the DAO to set the performance fee
    /// @param _performanceFee The new performance fee
    function setPerformanceFee(
        Rate memory _performanceFee
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            _performanceFee.denominator != 0 &&
                _performanceFee.denominator >= _performanceFee.numerator,
            "INVALID_RATE"
        );
        performanceFee = _performanceFee;
    }

    /// @notice Allows the DAO to set the USDC vault
    /// @param _vault The new USDC vault
    function setUSDCVault(
        address _vault
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_vault != address(0), "INVALID_USDC_VAULT");
        strategyConfig.usdcVault = IFungibleAssetVaultForDAO(_vault);
    }

    function setFeeRecipient(
        address _newRecipient
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_newRecipient != address(0), "INVALID_FEE_RECIPIENT");

        feeRecipient = _newRecipient;
    }

    /// @return The amount of `want` tokens held by this contract
    function heldAssets() public view returns (uint256) {
        return strategyTokens.want.balanceOf(address(this));
    }

    /// @return The amount of `want` tokens deposited in the Convex pool by this contract
    function depositedAssets() public view returns (uint256) {
        return convexConfig.baseRewardPool.balanceOf(address(this));
    }

    /// @return The total amount of `want` tokens this contract manages (held + deposited)
    function totalAssets() external view override returns (uint256) {
        return heldAssets() + depositedAssets();
    }

    /// @notice Allows anyone to deposit the total amount of `want` tokens in this contract into Convex
    function deposit() public override {
        ConvexConfig memory convex = convexConfig;
        convex.booster.depositAll(convex.pid, true);
    }

    /// @notice Controller only function that allows to withdraw non-strategy tokens (e.g tokens sent accidentally).
    /// CVX and CRV can be withdrawn with this function.
    function withdraw(
        address _to,
        address _asset
    ) external override onlyRole(STRATEGIST_ROLE) {
        require(_to != address(0), "INVALID_ADDRESS");
        require(address(strategyTokens.want) != _asset, "want");
        require(address(strategyTokens.pusd) != _asset, "pusd");
        require(address(strategyTokens.usdc) != _asset, "usdc");
        require(address(strategyTokens.weth) != _asset, "weth");

        uint256 balance = IERC20(_asset).balanceOf(address(this));
        IERC20(_asset).safeTransfer(_to, balance);
    }

    /// @notice Allows the controller to withdraw `want` tokens. Normally used with a vault withdrawal
    /// @param _to The address to send the tokens to
    /// @param _amount The amount of `want` tokens to withdraw
    function withdraw(
        address _to,
        uint256 _amount
    ) external override onlyVault {
        ICurve _want = strategyTokens.want;

        uint256 balance = _want.balanceOf(address(this));
        //if the contract doesn't have enough want, withdraw from Convex
        if (balance < _amount) {
            unchecked {
                convexConfig.baseRewardPool.withdrawAndUnwrap(
                    _amount - balance,
                    false
                );
            }
        }

        _want.safeTransfer(_to, _amount);
    }

    /// @notice Allows the controller to withdraw all `want` tokens. Normally used when migrating strategies
    function withdrawAll() external override onlyVault {
        ICurve _want = strategyTokens.want;

        convexConfig.baseRewardPool.withdrawAllAndUnwrap(true);

        uint256 balance = _want.balanceOf(address(this));
        _want.safeTransfer(msg.sender, balance);
    }

    /// @notice Allows members of the `STRATEGIST_ROLE` to compound Convex rewards into Curve
    /// @param minOutCurve The minimum amount of `want` tokens to receive
    function harvest(uint256 minOutCurve) external onlyRole(STRATEGIST_ROLE) {
        convexConfig.baseRewardPool.getReward(address(this), true);

        IERC20 _usdc = strategyTokens.usdc;
        //Prevent `Stack too deep` errors
        {
            uint256 cvxBalance = strategyTokens.cvx.balanceOf(address(this));
            if (cvxBalance > 0) {
                CurveSwapConfig memory _cvxEth = cvxEth;
                //minOut is not needed here, we already have it on the Curve deposit
                _cvxEth.lp.exchange(
                    1 - _cvxEth.ethIndex,
                    _cvxEth.ethIndex,
                    cvxBalance,
                    0
                );
            }

            uint256 crvBalance = strategyTokens.crv.balanceOf(address(this));
            if (crvBalance > 0) {
                CurveSwapConfig memory _crvEth = crvEth;
                //minOut is not needed here, we already have it on the Curve deposit
                _crvEth.lp.exchange(
                    1 - _crvEth.ethIndex,
                    _crvEth.ethIndex,
                    crvBalance,
                    0
                );
            }

            IERC20 _weth = strategyTokens.weth;
            uint256 wethBalance = _weth.balanceOf(address(this));
            require(wethBalance != 0, "NOOP");

            //minOut is not needed here, we already have it on the Curve deposit
            ISwapRouter.ExactInputParams memory params = ISwapRouter
                .ExactInputParams(
                    abi.encodePacked(_weth, uint24(500), _usdc),
                    address(this),
                    block.timestamp,
                    wethBalance,
                    0
                );

            v3Router.exactInput(params);
        }

        StrategyConfig memory strategy = strategyConfig;
        ZapConfig memory zap = zapConfig;

        uint256 usdcBalance = _usdc.balanceOf(address(this));

        //take the performance fee
        uint256 fee = (usdcBalance * performanceFee.numerator) /
            performanceFee.denominator;
        _usdc.safeTransfer(feeRecipient, fee);
        unchecked {
            usdcBalance -= fee;
        }

        ICurve _want = strategyTokens.want;

        uint256 pusdCurveBalance = _want.balances(zap.pusdIndex);
        uint256 crv3Balance = _want.balances(zap.crv3Index);

        //The curve pool has 4 tokens, we are doing a single asset deposit with either USDC or PUSD
        uint256[4] memory liquidityAmounts = [uint256(0), 0, 0, 0];
        if (crv3Balance > pusdCurveBalance) {
            //if there's more USDC than PUSD in the pool, use USDC as collateral to mint PUSD
            //and deposit it into the Curve pool
            strategy.usdcVault.deposit(usdcBalance);

            //check the vault's credit limit, it should be 1:1 for USDC
            uint256 toBorrow = strategy.usdcVault.getCreditLimit(usdcBalance);

            strategy.usdcVault.borrow(toBorrow);
            liquidityAmounts[zap.pusdIndex] = toBorrow;
        } else {
            //if there's more PUSD than USDC in the pool, deposit USDC
            liquidityAmounts[zap.usdcIndex] = usdcBalance;
        }

        zap.zap.add_liquidity(address(_want), liquidityAmounts, minOutCurve);

        uint256 wantBalance = heldAssets();

        deposit();

        earned += wantBalance;
        emit Harvested(wantBalance);
    }
}
