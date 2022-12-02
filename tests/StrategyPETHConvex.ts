import { JsonRpcSigner } from "@ethersproject/providers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, network, upgrades } from "hardhat";
import {
  PETHVaultForDAO,
  IBaseRewardPool,
  IBooster,
  ICurve,
  IERC20,
  PETH,
  StrategyPETHConvex,
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
describe("StrategyPETHConvex", () => {
  let owner: JsonRpcSigner, user: SignerWithAddress, weth: JsonRpcSigner;
  let strategy: StrategyPETHConvex, vault: Vault;
  let ethVault: PETHVaultForDAO;
  let booster: IBooster;
  let want: ICurve,
    cvx: IERC20,
    crv: IERC20,
    peth: PETH;
  let cvxSigner: JsonRpcSigner,
    crvSigner: JsonRpcSigner;
  let rewardPool: IBaseRewardPool;

  let snapshot: string;

  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    user = accounts[0];

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0x51C2cEF9efa48e08557A361B52DB34061c025a1B"],
    });

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"],
    });

    owner = ethers.provider.getSigner("0x51C2cEF9efa48e08557A361B52DB34061c025a1B");

    weth = ethers.provider.getSigner("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");

    snapshot = (await network.provider.request({
      method: "evm_snapshot",
      params: [],
    })) as string;

    const PETH = await ethers.getContractFactory("PETH", owner);
    peth = PETH.attach("0x836A808d4828586A69364065A1e064609F5078c7");

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
        "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
        owner
      )
    );

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0x8a8e9730646efd1e57453054f1a6366897d7cb1c"],
    });
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0x7a16ff8270133f063aab6c9977183d9e72835428"],
    });

    cvxSigner = ethers.provider.getSigner(
      "0x8a8e9730646efd1e57453054f1a6366897d7cb1c"
    );
    crvSigner = ethers.provider.getSigner(
      "0x7a16ff8270133f063aab6c9977183d9e72835428"
    );

    const Vault = await ethers.getContractFactory("Vault", owner);
    vault = <Vault>await upgrades.deployProxy(Vault, [want.address, owner._address, { numerator: 0, denominator: 100 }]);

    const ETHVault = await ethers.getContractFactory(
      "PETHVaultForDAO", owner
    );
    ethVault = ETHVault.attach("0x548cAB89eBF34509Ae562BC8cE8D5Cdb4F08c3AD");

    booster = <IBooster>(
      await ethers.getContractAt(
        "IBooster",
        "0xF403C135812408BFbE8713b5A23a04b3D48AAE31",
        owner
      )
    );

    rewardPool = <IBaseRewardPool>(
      await ethers.getContractAt(
        "IBaseRewardPool",
        "0xb235205E1096E0Ad221Fb7621a2E2cbaB875bE75",
        owner
      )
    );

    const Strategy = await ethers.getContractFactory("StrategyPETHConvex", owner);
    strategy = await Strategy.deploy(
      {
        want: want.address,
        peth: peth.address,
        cvx: cvx.address,
        crv: crv.address
      },
      owner._address,
      {
        lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
        ethIndex: 0
      },
      {
        lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
        ethIndex: 0
      },
      {
        lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
        ethIndex: 0
      },
      {
        booster: booster.address,
        baseRewardPool: rewardPool.address,
        pid: 122,
      },
      {
        vault: vault.address,
        ethVault: ethVault.address,
      },
      {
        numerator: 20,
        denominator: 100,
      }
    );

    await strategy.grantRole(strategist_role, owner._address);
    await ethVault.grantRole(whitelisted_role, strategy.address);

    await vault.migrateStrategy(strategy.address);
    await vault.unpause();
  });

  afterEach(async () => {
    await network.provider.request({
      method: "evm_revert",
      params: [snapshot],
    });
  });

  it("should allow the DAO to change ETH vault", async () => {
    await expect(strategy.setETHVault(ZERO_ADDRESS)).to.be.revertedWith(
      "INVALID_ETH_VAULT"
    );

    await strategy.setETHVault(owner._address);
    const { ethVault } = await strategy.strategyConfig();
    expect(ethVault).to.equal(owner._address);
  });

  it("should deposit want on convex", async () => {
    await want.transfer(strategy.address, units(500));
    await strategy.deposit();

    expect(await strategy.depositedAssets()).to.equal(units(500));
  });

  it("should allow strategists to withdraw non strategy tokens", async () => {
    await expect(
      strategy["withdraw(address,address)"](owner._address, want.address)
    ).to.be.revertedWith("want");
    await expect(
      strategy["withdraw(address,address)"](owner._address, peth.address)
    ).to.be.revertedWith("peth");

    await cvx.connect(cvxSigner).transfer(strategy.address, units(500));
    await strategy["withdraw(address,address)"](owner._address, cvx.address);

    expect(await cvx.balanceOf(owner._address)).to.equal(units(500));
  });

  it("should allow the vault to withdraw want", async () => {
    await want.transfer(user.address, units(100));
    await want.connect(user).approve(vault.address, units(100));

    await vault.connect(user).deposit(user.address, units(100));
    expect(await strategy.depositedAssets()).to.equal(units(100));

    await want.transfer(strategy.address, units(100));

    await vault.connect(user).withdraw(user.address, units(50));
    expect(await want.balanceOf(user.address)).to.equal(units(100));

    await vault.connect(user).withdraw(user.address, units(50));
    expect(await want.balanceOf(user.address)).to.equal(units(200));
  });

  it("should allow the vault to call withdrawAll", async () => {
    await want.approve(vault.address, units(500));

    await vault.deposit(owner._address, units(500));

    await expect(strategy.withdrawAll()).to.be.revertedWith(
      "NOT_VAULT"
    );

    await vault.migrateStrategy(ZERO_ADDRESS);

    expect(await want.balanceOf(vault.address)).to.equal(units(500));
  });

  it("should add liquidity with PETH when harvest is called and curve has less PETH than ETH", async () => {
    const initialVaultETHBalance = await ethers.provider.getBalance(ethVault.address);
    const initialOwnerETHBalance = await ethers.provider.getBalance(owner._address);
    const initialWantPETHBalance = await peth.balanceOf(want.address);

    await expect(strategy.harvest(0)).to.be.revertedWith("NOOP");

    const poolPETHBalance = await want.balances(1);

    await weth.sendTransaction({value: poolPETHBalance, to: owner._address});

    await want.add_liquidity([poolPETHBalance, 0], 0, { value: poolPETHBalance });

    const ownerWantBalance = await want.balanceOf(owner._address);
    await want.approve(vault.address, ownerWantBalance);
    await vault.deposit(owner._address, ownerWantBalance);

    expect(await strategy.depositedAssets()).to.equal(ownerWantBalance);

    await crv.connect(crvSigner).approve(rewardPool.address, units(1_000_000));
    await rewardPool.connect(crvSigner).donate(units(1_000_000));

    await booster.earmarkRewards(122);

    await timeTravel(86400);

    await strategy.harvest(0);

    //subtract balance deposited by owner to borrow PETH
    const vaultAdditionalETHBalance = (
      await ethers.provider.getBalance(ethVault.address)
    ).sub(initialVaultETHBalance);
    expect(vaultAdditionalETHBalance).to.be.gt(0);

    expect(await peth.balanceOf(want.address)).to.equal(
      vaultAdditionalETHBalance.add(initialWantPETHBalance)
    );

    expect(await strategy.depositedAssets()).to.be.gt(ownerWantBalance);
  });

  it("should add liquidity with ETH when harvest is called and curve has less ETH than PETH", async () => {
    await expect(strategy.harvest(0)).to.be.revertedWith("NOOP");

    const poolETHBalance = (await want.balances(0));

    await weth.sendTransaction({value: poolETHBalance, to: owner._address});

    await ethVault.deposit({ value: poolETHBalance });
    await ethVault.borrow(poolETHBalance);

    await peth.approve(want.address, poolETHBalance);

    await want.add_liquidity([0, poolETHBalance], 0);

    const ownerWantBalance = await want.balanceOf(owner._address);
    await want.approve(vault.address, ownerWantBalance);
    await vault.deposit(owner._address, ownerWantBalance);

    expect(await strategy.depositedAssets()).to.equal(ownerWantBalance);

    await crv.connect(crvSigner).approve(rewardPool.address, units(1_000_000));
    await rewardPool.connect(crvSigner).donate(units(1_000_000));

    await booster.earmarkRewards(122);

    await timeTravel(86400);

    const initialOwnerETHBalance = await ethers.provider.getBalance(owner._address);

    await strategy.harvest(0);

    expect((await want.balances(1))).to.be.gt(poolETHBalance);
    expect(await ethers.provider.getBalance(owner._address)).to.be.gt(initialOwnerETHBalance);
    expect(await strategy.depositedAssets()).to.be.gt(ownerWantBalance);
  });

  it("should revert on deploy with bad arguments", async () => {
    const Strategy = await ethers.getContractFactory("StrategyPETHConvex");

    await expect(
      Strategy.deploy(
        {
          want: ZERO_ADDRESS,
          peth: peth.address,
          cvx: cvx.address,
          crv: crv.address
        },
        owner._address,
        {
          lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
          ethIndex: 0
        },
        {
          lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
          ethIndex: 0
        },
        {
          lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
          ethIndex: 0
        },
        {
          booster: booster.address,
          baseRewardPool: rewardPool.address,
          pid: 122,
        },
        {
          vault: vault.address,
          ethVault: ethVault.address,
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
          peth: ZERO_ADDRESS,
          cvx: cvx.address,
          crv: crv.address
        },
        owner._address,
        {
          lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
          ethIndex: 0
        },
        {
          lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
          ethIndex: 0
        },
        {
          lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
          ethIndex: 0
        },
        {
          booster: booster.address,
          baseRewardPool: rewardPool.address,
          pid: 122,
        },
        {
          vault: vault.address,
          ethVault: ethVault.address,
        },
        {
          numerator: 20,
          denominator: 100,
        }
      )
    ).to.be.revertedWith("INVALID_PETH");

    await expect(
      Strategy.deploy(
        {
          want: want.address,
          peth: peth.address,
          cvx: ZERO_ADDRESS,
          crv: crv.address
        },
        owner._address,
        {
          lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
          ethIndex: 0
        },
        {
          lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
          ethIndex: 0
        },
        {
          lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
          ethIndex: 0
        },
        {
          booster: booster.address,
          baseRewardPool: rewardPool.address,
          pid: 122,
        },
        {
          vault: vault.address,
          ethVault: ethVault.address,
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
          peth: peth.address,
          cvx: cvx.address,
          crv: ZERO_ADDRESS
        },
        owner._address,
        {
          lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
          ethIndex: 0
        },
        {
          lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
          ethIndex: 0
        },
        {
          lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
          ethIndex: 0
        },
        {
          booster: booster.address,
          baseRewardPool: rewardPool.address,
          pid: 122,
        },
        {
          vault: vault.address,
          ethVault: ethVault.address,
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
          peth: peth.address,
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
          lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
          ethIndex: 0
        },
        {
          booster: booster.address,
          baseRewardPool: rewardPool.address,
          pid: 122,
        },
        {
          vault: vault.address,
          ethVault: ethVault.address,
        },
        {
          numerator: 20,
          denominator: 100,
        }
      )
    ).to.be.revertedWith("INVALID_FEE_RECIPIENT");

    await expect(
      Strategy.deploy(
        {
          want: want.address,
          peth: peth.address,
          cvx: cvx.address,
          crv: crv.address
        },
        owner._address,
        {
          lp: ZERO_ADDRESS,
          ethIndex: 0
        },
        {
          lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
          ethIndex: 0
        },
        {
          lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
          ethIndex: 0
        },
        {
          booster: booster.address,
          baseRewardPool: rewardPool.address,
          pid: 122,
        },
        {
          vault: vault.address,
          ethVault: ethVault.address,
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
          peth: peth.address,
          cvx: cvx.address,
          crv: crv.address
        },
        owner._address,
        {
          lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
          ethIndex: 2
        },
        {
          lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
          ethIndex: 0
        },
        {
          lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
          ethIndex: 0
        },
        {
          booster: booster.address,
          baseRewardPool: rewardPool.address,
          pid: 122,
        },
        {
          vault: vault.address,
          ethVault: ethVault.address,
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
          peth: peth.address,
          cvx: cvx.address,
          crv: crv.address
        },
        owner._address,
        {
          lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
          ethIndex: 0
        },
        {
          lp: ZERO_ADDRESS,
          ethIndex: 0
        },
        {
          lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
          ethIndex: 0
        },
        {
          booster: booster.address,
          baseRewardPool: rewardPool.address,
          pid: 122,
        },
        {
          vault: vault.address,
          ethVault: ethVault.address,
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
          peth: peth.address,
          cvx: cvx.address,
          crv: crv.address
        },
        owner._address,
        {
          lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
          ethIndex: 0
        },
        {
          lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
          ethIndex: 2
        },
        {
          lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
          ethIndex: 0
        },
        {
          booster: booster.address,
          baseRewardPool: rewardPool.address,
          pid: 122,
        },
        {
          vault: vault.address,
          ethVault: ethVault.address,
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
          peth: peth.address,
          cvx: cvx.address,
          crv: crv.address
        },
        owner._address,
        {
          lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
          ethIndex: 0
        },
        {
          lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
          ethIndex: 0
        },
        {
          lp: ZERO_ADDRESS,
          ethIndex: 0
        },
        {
          booster: booster.address,
          baseRewardPool: rewardPool.address,
          pid: 122,
        },
        {
          vault: vault.address,
          ethVault: ethVault.address,
        },
        {
          numerator: 20,
          denominator: 100,
        }
      )
    ).to.be.revertedWith("INVALID_PETHETH_LP");

    await expect(
      Strategy.deploy(
        {
          want: want.address,
          peth: peth.address,
          cvx: cvx.address,
          crv: crv.address
        },
        owner._address,
        {
          lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
          ethIndex: 0
        },
        {
          lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
          ethIndex: 0
        },
        {
          lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
          ethIndex: 2
        },
        {
          booster: booster.address,
          baseRewardPool: rewardPool.address,
          pid: 122,
        },
        {
          vault: vault.address,
          ethVault: ethVault.address,
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
          peth: peth.address,
          cvx: cvx.address,
          crv: crv.address
        },
        owner._address,
        {
          lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
          ethIndex: 0
        },
        {
          lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
          ethIndex: 0
        },
        {
          lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
          ethIndex: 0
        },
        {
          booster: ZERO_ADDRESS,
          baseRewardPool: rewardPool.address,
          pid: 122,
        },
        {
          vault: vault.address,
          ethVault: ethVault.address,
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
          peth: peth.address,
          cvx: cvx.address,
          crv: crv.address
        },
        owner._address,
        {
          lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
          ethIndex: 0
        },
        {
          lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
          ethIndex: 0
        },
        {
          lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
          ethIndex: 0
        },
        {
          booster: booster.address,
          baseRewardPool: ZERO_ADDRESS,
          pid: 122,
        },
        {
          vault: vault.address,
          ethVault: ethVault.address,
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
          peth: peth.address,
          cvx: cvx.address,
          crv: crv.address
        },
        owner._address,
        {
          lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
          ethIndex: 0
        },
        {
          lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
          ethIndex: 0
        },
        {
          lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
          ethIndex: 0
        },
        {
          booster: booster.address,
          baseRewardPool: rewardPool.address,
          pid: 122,
        },
        {
          vault: ZERO_ADDRESS,
          ethVault: ethVault.address,
        },
        {
          numerator: 20,
          denominator: 100,
        }
      )
    ).to.be.revertedWith("INVALID_VAULT");

    await expect(
      Strategy.deploy(
        {
          want: want.address,
          peth: peth.address,
          cvx: cvx.address,
          crv: crv.address
        },
        owner._address,
        {
          lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
          ethIndex: 0
        },
        {
          lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
          ethIndex: 0
        },
        {
          lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
          ethIndex: 0
        },
        {
          booster: booster.address,
          baseRewardPool: rewardPool.address,
          pid: 122,
        },
        {
          vault: vault.address,
          ethVault: ZERO_ADDRESS,
        },
        {
          numerator: 20,
          denominator: 100,
        }
      )
    ).to.be.revertedWith("INVALID_ETH_VAULT");

    await expect(
      Strategy.deploy(
        {
          want: want.address,
          peth: peth.address,
          cvx: cvx.address,
          crv: crv.address
        },
        owner._address,
        {
          lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
          ethIndex: 0
        },
        {
          lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
          ethIndex: 0
        },
        {
          lp: "0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
          ethIndex: 0
        },
        {
          booster: booster.address,
          baseRewardPool: rewardPool.address,
          pid: 122,
        },
        {
          vault: vault.address,
          ethVault: ethVault.address,
        },
        {
          numerator: 20,
          denominator: 0,
        }
      )
    ).to.be.revertedWith("INVALID_RATE");
  });
});
