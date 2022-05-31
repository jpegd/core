import { JsonRpcSigner } from "@ethersproject/providers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, network } from "hardhat";
import {
  Controller,
  FungibleAssetVaultForDAO,
  I3CRVZap,
  IBaseRewardPool,
  IBooster,
  ICurve,
  IERC20,
  ISwapRouter,
  IUniswapV2Router,
  StableCoin,
  StrategyPUSDConvex,
  WETH,
  Vault,
} from "../types";
import { timeTravel, units, ZERO_ADDRESS } from "./utils";

const { expect } = chai;

chai.use(solidity);

const strategist_role =
  "0x17a8e30262c1f919c33056d877a3c22b95c2f5e4dac44683c1c2323cd79fbdb0";
const whitelisted_role =
  "0x8429d542926e6695b59ac6fbdcd9b37e8b1aeb757afab06ab60b1bb5878c3b49";

//this is the only contract that requires mainnet forking to test,
//unfortunately we can't use hardhat_reset as that breaks solidity-coverage
describe("StrategyPUSDConvex", () => {
  let owner: JsonRpcSigner, user: SignerWithAddress;
  let strategy: StrategyPUSDConvex, vault: Vault, controller: Controller;
  let sushiRouter: IUniswapV2Router, uniswapV3Router: ISwapRouter;
  let usdcVault: FungibleAssetVaultForDAO;
  let zap: I3CRVZap, booster: IBooster;
  let want: ICurve,
    cvx: IERC20,
    crv: IERC20,
    pusd: StableCoin,
    weth: WETH,
    usdc: IERC20;
  let cvxSigner: JsonRpcSigner,
    crvSigner: JsonRpcSigner,
    usdcSigner: JsonRpcSigner;
  let rewardPool: IBaseRewardPool;

  let snapshot: string;

  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    user = accounts[0];

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0x51C2cEF9efa48e08557A361B52DB34061c025a1B"],
    });

    owner = ethers.provider.getSigner(
      "0x51C2cEF9efa48e08557A361B52DB34061c025a1B"
    );

    snapshot = (await network.provider.request({
      method: "evm_snapshot",
      params: [],
    })) as string;

    const Controller = await ethers.getContractFactory("Controller", owner);
    controller = await Controller.deploy(owner._address);

    await controller.grantRole(strategist_role, owner._address);

    const Stablecoin = await ethers.getContractFactory("StableCoin", owner);
    pusd = Stablecoin.attach("0x466a756E9A7401B5e2444a3fCB3c2C12FBEa0a54");

    weth = <WETH>(
      await ethers.getContractAt(
        "WETH",
        "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
        owner
      )
    );
    cvx = <IERC20>(
      await ethers.getContractAt(
        "IERC20",
        "0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b",
        owner
      )
    );
    crv = <IERC20>(
      await ethers.getContractAt(
        "IERC20",
        "0xD533a949740bb3306d119CC777fa900bA034cd52",
        owner
      )
    );

    want = <ICurve>(
      await ethers.getContractAt(
        "ICurve",
        "0x8EE017541375F6Bcd802ba119bdDC94dad6911A1",
        owner
      )
    );

    usdc = <IERC20>(
      await ethers.getContractAt(
        "IERC20",
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        owner
      )
    );

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0x0aca67fa70b142a3b9bf2ed89a81b40ff85dacdc"],
    });
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0x7a16ff8270133f063aab6c9977183d9e72835428"],
    });
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xE78388b4CE79068e89Bf8aA7f218eF6b9AB0e9d0"],
    });

    cvxSigner = ethers.provider.getSigner(
      "0x0aca67fa70b142a3b9bf2ed89a81b40ff85dacdc"
    );
    usdcSigner = ethers.provider.getSigner(
      "0xE78388b4CE79068e89Bf8aA7f218eF6b9AB0e9d0"
    );
    crvSigner = ethers.provider.getSigner(
      "0x7a16ff8270133f063aab6c9977183d9e72835428"
    );

    const Vault = await ethers.getContractFactory("Vault", owner);
    vault = await Vault.deploy(want.address, controller.address, {
      numerator: 100,
      denominator: 100,
    });

    const AssetVault = await ethers.getContractFactory(
      "FungibleAssetVaultForDAO", owner
    );
    usdcVault = AssetVault.attach("0xFD110cf7985f6B7cAb4dc97dF1932495cADa9d08");

    booster = <IBooster>(
      await ethers.getContractAt(
        "IBooster",
        "0xF403C135812408BFbE8713b5A23a04b3D48AAE31",
        owner
      )
    );

    sushiRouter = <IUniswapV2Router>(
      await ethers.getContractAt(
        "IUniswapV2Router",
        "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F",
        owner
      )
    );
    uniswapV3Router = <ISwapRouter>(
      await ethers.getContractAt(
        "ISwapRouter",
        "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        owner
      )
    );

    zap = <I3CRVZap>(
      await ethers.getContractAt(
        "I3CRVZap",
        "0xA79828DF1850E8a3A3064576f380D90aECDD3359",
        owner
      )
    );

    rewardPool = <IBaseRewardPool>(
      await ethers.getContractAt(
        "IBaseRewardPool",
        "0x83a3CE160915675F5bC7cC3CfDA5f4CeBC7B7a5a",
        owner
      )
    );

    const Strategy = await ethers.getContractFactory("StrategyPUSDConvex", owner);
    strategy = await Strategy.deploy(
      {
        want: want.address,
        pusd: pusd.address,
        weth: weth.address,
        usdc: usdc.address,
        cvx: cvx.address,
        crv: crv.address
      },
      uniswapV3Router.address,
      {
        lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
        ethIndex: 0
      },
      {
        lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
        ethIndex: 0
      },
      {
        zap: zap.address,
        crv3Index: 1,
        usdcIndex: 2,
        pusdIndex: 0,
      },
      {
        booster: booster.address,
        baseRewardPool: rewardPool.address,
        pid: 91,
      },
      {
        controller: controller.address,
        usdcVault: usdcVault.address,
      },
      {
        numerator: 20,
        denominator: 100,
      }
    );

    await strategy.deployed();
    await strategy.grantRole(strategist_role, owner._address);
    await usdcVault.grantRole(whitelisted_role, strategy.address);

    await controller.approveStrategy(want.address, strategy.address);
    await controller.setStrategy(want.address, strategy.address);
  });

  afterEach(async () => {
    await network.provider.request({
      method: "evm_revert",
      params: [snapshot],
    });
  });

  it("should return the correct name", async () => {
    expect(await strategy.getName()).to.equal("StrategyPUSDConvex");
  });

  it("should allow the DAO to change controller", async () => {
    await expect(strategy.setController(ZERO_ADDRESS)).to.be.revertedWith(
      "INVALID_CONTROLLER"
    );

    await strategy.setController(owner._address);
    const { controller } = await strategy.strategyConfig();
    expect(controller).to.equal(owner._address);
  });

  it("should allow the DAO to change usdc vault", async () => {
    await expect(strategy.setUSDCVault(ZERO_ADDRESS)).to.be.revertedWith(
      "INVALID_USDC_VAULT"
    );

    await strategy.setUSDCVault(owner._address);
    const { usdcVault } = await strategy.strategyConfig();
    expect(usdcVault).to.equal(owner._address);
  });

  it("should deposit want on convex", async () => {
    await want.transfer(strategy.address, units(500));
    await strategy.deposit();

    expect(await strategy.balanceOfPool()).to.equal(units(500));
  });

  it("should allow the controller to withdraw non strategy tokens", async () => {
    await expect(strategy["withdraw(address)"](cvx.address)).to.be.revertedWith(
      "NOT_CONTROLLER"
    );

    await expect(
      controller.inCaseStrategyTokensGetStuck(strategy.address, want.address)
    ).to.be.revertedWith("want");
    await expect(
      controller.inCaseStrategyTokensGetStuck(strategy.address, usdc.address)
    ).to.be.revertedWith("usdc");
    await expect(
      controller.inCaseStrategyTokensGetStuck(strategy.address, pusd.address)
    ).to.be.revertedWith("pusd");
    await expect(
      controller.inCaseStrategyTokensGetStuck(strategy.address, weth.address)
    ).to.be.revertedWith("weth");

    await cvx.connect(cvxSigner).transfer(strategy.address, units(500));
    await controller.inCaseStrategyTokensGetStuck(
      strategy.address,
      cvx.address
    );

    expect(await cvx.balanceOf(controller.address)).to.equal(units(500));
  });

  it("should allow the controller to withdraw want", async () => {
    await want.transfer(user.address, units(500));
    await controller.setVault(want.address, vault.address);
    await want.connect(user).approve(vault.address, units(500));

    await vault.connect(user).deposit(units(500));
    //earn calls the controller's earn which calls the strategy's deposit function
    await vault.earn();
    expect(await strategy.balanceOfPool()).to.equal(units(500));

    await want.transfer(strategy.address, units(500));

    await vault.connect(user).withdraw(units(250));
    expect(await want.balanceOf(user.address)).to.equal(units(500));

    await vault.connect(user).withdrawAll();
    expect(await want.balanceOf(user.address)).to.equal(units(1000));
  });

  it("should allow the controller to call withdrawAll", async () => {
    await want.approve(vault.address, units(500));

    await vault.deposit(units(500));
    //earn calls the controller's earn which calls the strategy's deposit function
    await vault.earn();

    await expect(controller.withdrawAll(want.address)).to.be.revertedWith(
      "ZERO_VAULT"
    );

    await controller.setVault(want.address, vault.address);
    await controller.withdrawAll(want.address);

    expect(await want.balanceOf(vault.address)).to.equal(units(500));
  });

  it("should add liquidity with pusd when harvest is called and curve has less pusd than usdc", async () => {
    const initialVaultUSDCBalance = await usdc.balanceOf(usdcVault.address);
    const initialOwnerUSDCBalance = await usdc.balanceOf(owner._address);
    const initialWantPUSDBalance = await pusd.balanceOf(want.address);

    await expect(strategy.harvest(0)).to.be.revertedWith("NOOP");

    const poolPUSDBalance = await want.balances(0);

    const usdcToAdd = poolPUSDBalance.div(1e12);
    await usdc.connect(usdcSigner).transfer(owner._address, usdcToAdd);
    await usdc.approve(zap.address, usdcToAdd);

    await zap.add_liquidity(want.address, [0, 0, usdcToAdd, 0], 0);

    const ownerWantBalance = await want.balanceOf(owner._address);
    await want.approve(vault.address, ownerWantBalance);
    await vault.deposit(ownerWantBalance);

    await vault.earn();

    expect(await strategy.balanceOfPool()).to.equal(ownerWantBalance);

    await crv.connect(crvSigner).approve(rewardPool.address, units(1_000_000));
    await rewardPool.connect(crvSigner).donate(units(1_000_000));

    await booster.earmarkRewards(91);

    await timeTravel(86400);

    await strategy.harvest(0);

    //subtract balance deposited by owner to borrow pusd
    const vaultAdditionalUSDCBalance = (
      await usdc.balanceOf(usdcVault.address)
    ).sub(initialVaultUSDCBalance);
    expect(vaultAdditionalUSDCBalance).to.be.gt(0);

    const swappedUSDCTotal = vaultAdditionalUSDCBalance.mul(100).div(80);

    expect(await usdc.balanceOf(owner._address)).to.equal(
      swappedUSDCTotal.sub(vaultAdditionalUSDCBalance).add(initialOwnerUSDCBalance)
    );

    const additionalPUSD = await usdcVault.getCreditLimit(vaultAdditionalUSDCBalance);

    expect(await pusd.balanceOf(want.address)).to.equal(
      additionalPUSD.add(initialWantPUSDBalance)
    );

    expect(await strategy.balanceOfPool()).to.be.gt(ownerWantBalance);
  });

  it("should add liquidity with usdc when harvest is called and curve has less usdc than pusd", async () => {
    await expect(strategy.harvest(0)).to.be.revertedWith("NOOP");

    // it's not usdc but 3crv
    const poolUSDCBalance = (await want.balances(1)).div(1e12);

    const pusdToAdd = poolUSDCBalance.mul(1e12);
    await usdc.connect(usdcSigner).transfer(owner._address, poolUSDCBalance);
    await usdc.approve(usdcVault.address, poolUSDCBalance);
    await usdcVault.deposit(poolUSDCBalance);
    await usdcVault.borrow(pusdToAdd);

    await pusd.approve(zap.address, pusdToAdd);

    await zap.add_liquidity(want.address, [pusdToAdd, 0, 0, 0], 0);

    const ownerWantBalance = await want.balanceOf(owner._address);
    await want.approve(vault.address, ownerWantBalance);
    await vault.deposit(ownerWantBalance);

    await vault.earn();

    expect(await strategy.balanceOfPool()).to.equal(ownerWantBalance);

    await crv.connect(crvSigner).approve(rewardPool.address, units(1_000_000));
    await rewardPool.connect(crvSigner).donate(units(1_000_000));

    await booster.earmarkRewards(91);

    await timeTravel(86400);

    const initialOwnerUSDCBalance = await usdc.balanceOf(owner._address);

    await strategy.harvest(0);

    expect((await want.balances(1)).div(1e12)).to.be.gt(poolUSDCBalance);
    expect(await usdc.balanceOf(owner._address)).to.be.gt(initialOwnerUSDCBalance);
    expect(await strategy.balanceOfPool()).to.be.gt(ownerWantBalance);
  });
  
    it("should revert on deploy with bad arguments", async () => {
      const Strategy = await ethers.getContractFactory("StrategyPUSDConvex");
  
      await expect(
        Strategy.deploy(
          {
            want: ZERO_ADDRESS,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_WANT");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: ZERO_ADDRESS,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_PUSD");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: ZERO_ADDRESS,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_WETH");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: ZERO_ADDRESS,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_USDC");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: ZERO_ADDRESS,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_CVX");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: ZERO_ADDRESS
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_CRV");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          ZERO_ADDRESS,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_UNISWAP_V3");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: ZERO_ADDRESS,
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_CVXETH_LP");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 2
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_ETH_INDEX");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: ZERO_ADDRESS,
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_CRVETH_LP");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 2
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_ETH_INDEX");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: ZERO_ADDRESS,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_3CRV_ZAP");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 0,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_CURVE_INDEXES");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 2,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_3CRV_CURVE_INDEX");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 4,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_USDC_CURVE_INDEX");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 2,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_PUSD_CURVE_INDEX");
  
      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: ZERO_ADDRESS,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_CONVEX_BOOSTER");

      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: ZERO_ADDRESS,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_CONVEX_BASE_REWARD_POOL");

      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: ZERO_ADDRESS,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_CONTROLLER");

      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: ZERO_ADDRESS,
          },
          {
            numerator: 20,
            denominator: 100,
          }
        )
      ).to.be.revertedWith("INVALID_USDC_VAULT");

      await expect(
        Strategy.deploy(
          {
            want: want.address,
            pusd: pusd.address,
            weth: weth.address,
            usdc: usdc.address,
            cvx: cvx.address,
            crv: crv.address
          },
          uniswapV3Router.address,
          {
            lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
            ethIndex: 0
          },
          {
            lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
            ethIndex: 0
          },
          {
            zap: zap.address,
            crv3Index: 1,
            usdcIndex: 2,
            pusdIndex: 0,
          },
          {
            booster: booster.address,
            baseRewardPool: rewardPool.address,
            pid: 91,
          },
          {
            controller: controller.address,
            usdcVault: usdcVault.address,
          },
          {
            numerator: 20,
            denominator: 0,
          }
        )
      ).to.be.revertedWith("INVALID_RATE");
    });
});
