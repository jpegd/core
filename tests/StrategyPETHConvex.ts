import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, upgrades } from "hardhat";
import {
    PETHVaultForDAO,
    PETH,
    StrategyPETHConvex,
    Vault,
    TestERC20,
    MockBooster,
    MockRewardPool,
    MockCurvePool
} from "../types";
import { units, ZERO_ADDRESS } from "./utils";

const { expect } = chai;

chai.use(solidity);

describe("StrategyPETHConvex", () => {
    let owner: SignerWithAddress, user: SignerWithAddress;
    let strategy: StrategyPETHConvex;
    let vault: Vault;
    let ethVault: PETHVaultForDAO;
    let booster: MockBooster;
    let peth: PETH;
    let rewardPool: MockRewardPool;

    let cvx: TestERC20, crv: TestERC20, weth: TestERC20;

    let cvxETH: MockCurvePool, crvETH: MockCurvePool, want: MockCurvePool;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user = accounts[1];

        const TestERC20 = await ethers.getContractFactory("TestERC20");

        weth = await TestERC20.deploy("", "");
        cvx = await TestERC20.deploy("", "");
        crv = await TestERC20.deploy("", "");

        const PETH = await ethers.getContractFactory("PETH");
        peth = await PETH.deploy();

        const CurvePool = await ethers.getContractFactory("MockCurvePool");
        cvxETH = await CurvePool.deploy("", "");
        crvETH = await CurvePool.deploy("", "");
        want = await CurvePool.deploy("", "");

        await cvxETH.setTokenIndex(0, weth.address);
        await cvxETH.setTokenIndex(1, cvx.address);
        await crvETH.setTokenIndex(0, weth.address);
        await crvETH.setTokenIndex(1, crv.address);
        await want.setTokenIndex(0, weth.address);
        await want.setTokenIndex(1, peth.address);

        const Vault = await ethers.getContractFactory("Vault");
        vault = <Vault>(
            await upgrades.deployProxy(Vault, [
                want.address,
                owner.address,
                { numerator: 0, denominator: 100 }
            ])
        );

        const ETHVault = await ethers.getContractFactory("PETHVaultForDAO");
        ethVault = <PETHVaultForDAO>(
            await upgrades.deployProxy(ETHVault, [peth.address])
        );

        const RewardPool = await ethers.getContractFactory("MockRewardPool");
        rewardPool = await RewardPool.deploy(want.address, crv.address, []);

        const Booster = await ethers.getContractFactory("MockBooster");
        booster = await Booster.deploy(rewardPool.address);

        await booster.setPidToken(0, want.address);

        const Strategy = await ethers.getContractFactory(
            "StrategyPETHConvex",
            owner
        );
        strategy = await Strategy.deploy(
            {
                want: want.address,
                peth: peth.address,
                cvx: cvx.address,
                crv: crv.address
            },
            owner.address,
            {
                lp: cvxETH.address,
                ethIndex: 0
            },
            {
                lp: crvETH.address,
                ethIndex: 0
            },
            {
                lp: want.address,
                ethIndex: 0
            },
            {
                booster: booster.address,
                baseRewardPool: rewardPool.address,
                pid: 0
            },
            {
                vault: vault.address,
                ethVault: ethVault.address
            },
            {
                numerator: 20,
                denominator: 100
            }
        );

        await strategy.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["STRATEGIST_ROLE"]),
            owner.address
        );
        await ethVault.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["WHITELISTED_ROLE"]),
            strategy.address
        );

        const minter = ethers.utils.solidityKeccak256(
            ["string"],
            ["MINTER_ROLE"]
        );
        await peth.grantRole(minter, owner.address);
        await peth.grantRole(minter, ethVault.address);

        await vault.migrateStrategy(strategy.address);
        await vault.unpause();
    });

    it("should allow the DAO to change ETH vault", async () => {
        await expect(strategy.setETHVault(ZERO_ADDRESS)).to.be.revertedWith(
            "INVALID_ETH_VAULT"
        );

        await strategy.setETHVault(owner.address);
        const { ethVault } = await strategy.strategyConfig();
        expect(ethVault).to.equal(owner.address);
    });

    it("should deposit want on convex", async () => {
        await want.mint(strategy.address, units(500));
        await strategy.deposit();

        expect(await strategy.depositedAssets()).to.equal(units(500));
    });

    it("should allow strategists to withdraw non strategy tokens", async () => {
        await expect(
            strategy["withdraw(address,address)"](owner.address, want.address)
        ).to.be.revertedWith("want");
        await expect(
            strategy["withdraw(address,address)"](owner.address, peth.address)
        ).to.be.revertedWith("peth");

        await cvx.mint(strategy.address, units(500));
        await strategy["withdraw(address,address)"](owner.address, cvx.address);

        expect(await cvx.balanceOf(owner.address)).to.equal(units(500));
    });

    it("should allow the vault to withdraw want", async () => {
        await want.mint(user.address, units(100));
        await want.connect(user).approve(vault.address, units(100));

        await vault.connect(user).deposit(user.address, units(100));
        expect(await strategy.depositedAssets()).to.equal(units(100));

        await want.mint(strategy.address, units(100));

        await vault.connect(user).withdraw(user.address, units(50));
        expect(await want.balanceOf(user.address)).to.equal(units(100));

        await vault.connect(user).withdraw(user.address, units(50));
        expect(await want.balanceOf(user.address)).to.equal(units(200));
    });

    it("should allow the vault to call withdrawAll", async () => {
        await want.mint(owner.address, units(500));
        await want.approve(vault.address, units(500));
        await vault.deposit(owner.address, units(500));

        await expect(strategy.withdrawAll()).to.be.revertedWith("NOT_VAULT");

        await vault.migrateStrategy(ZERO_ADDRESS);

        expect(await want.balanceOf(vault.address)).to.equal(units(500));
    });

    it("should add liquidity with PETH when harvest is called and curve has less PETH than ETH", async () => {
        await expect(strategy.harvest(0)).to.be.revertedWith("NOOP");

        await peth.mint(want.address, units(400));
        await weth.mint(want.address, units(600));

        await want.mint(owner.address, units(1000));
        await want.approve(vault.address, units(1000));
        await vault.deposit(owner.address, units(1000));

        expect(await strategy.depositedAssets()).to.equal(units(1000));

        await crv.mint(rewardPool.address, units(1_000_000));

        await crvETH.setNextAmountOut(units(2));
        await want.setNextMintAmount(units(2));

        await owner.sendTransaction({ to: crvETH.address, value: units(2) });

        await strategy.harvest(0);

        expect(await ethers.provider.getBalance(ethVault.address)).to.equal(
            units(1.6)
        );
        expect(await peth.balanceOf(want.address)).to.equal(units(401.6));
        expect(await strategy.depositedAssets()).to.equal(units(1002));
    });

    it("should add liquidity with ETH when harvest is called and curve has less ETH than PETH", async () => {
        await expect(strategy.harvest(0)).to.be.revertedWith("NOOP");

        await peth.mint(want.address, units(600));
        await weth.mint(want.address, units(400));

        await want.mint(owner.address, units(1000));
        await want.approve(vault.address, units(1000));
        await vault.deposit(owner.address, units(1000));

        expect(await strategy.depositedAssets()).to.equal(units(1000));

        await crv.mint(rewardPool.address, units(1_000_000));

        await crvETH.setNextAmountOut(units(2));
        await want.setNextMintAmount(units(2));

        await owner.sendTransaction({ to: crvETH.address, value: units(2) });

        await strategy.harvest(0);

        expect(await ethers.provider.getBalance(ethVault.address)).to.equal(0);
        expect(await ethers.provider.getBalance(want.address)).to.equal(
            units(1.6)
        );
        expect(await strategy.depositedAssets()).to.equal(units(1002));
    });
});
