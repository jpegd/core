import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
    DAOStrategyConvex,
    JPEGIndexStaking,
    JPEGIndex,
    MockBooster,
    TestERC20,
    MockRewardPool,
    MockCurvePool
} from "../types";
import { units } from "./utils";

const strategist_role =
    "0x17a8e30262c1f919c33056d877a3c22b95c2f5e4dac44683c1c2323cd79fbdb0";
const minter_role =
    "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";

describe("DAOStrategyConvex", () => {
    let owner: SignerWithAddress;
    let strategy: DAOStrategyConvex;
    let staking: JPEGIndexStaking;
    let booster: MockBooster;
    let rewardPool: MockRewardPool;
    let jpegIndex: JPEGIndex;

    let cvx: TestERC20, crv: TestERC20;

    let cvxETH: MockCurvePool, crvETH: MockCurvePool, want: MockCurvePool;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];

        const TestERC20 = await ethers.getContractFactory("TestERC20");

        cvx = await TestERC20.deploy("", "");
        crv = await TestERC20.deploy("", "");
        const weth = await TestERC20.deploy("", "");
        const crvUSD = await TestERC20.deploy("", "");

        const PETH = await ethers.getContractFactory("PETH");
        const peth = await PETH.deploy();

        const CurvePool = await ethers.getContractFactory("MockCurvePool");
        cvxETH = await CurvePool.deploy("", "");
        crvETH = await CurvePool.deploy("", "");
        want = await CurvePool.deploy("", "");

        await cvxETH.setTokenIndex(0, weth.address);
        await cvxETH.setTokenIndex(1, cvx.address);
        await crvETH.setTokenIndex(0, crvUSD.address);
        await crvETH.setTokenIndex(1, weth.address);
        await crvETH.setTokenIndex(2, crv.address);
        await want.setTokenIndex(0, weth.address);
        await want.setTokenIndex(1, peth.address);

        const JPEGIndex = await ethers.getContractFactory("JPEGIndex", owner);
        jpegIndex = await JPEGIndex.deploy();

        await jpegIndex.grantRole(minter_role, owner.address);

        const JPEGIndexStaking = await ethers.getContractFactory(
            "JPEGIndexStaking",
            owner
        );
        staking = <JPEGIndexStaking>(
            await upgrades.deployProxy(JPEGIndexStaking, [jpegIndex.address])
        );

        const RewardPool = await ethers.getContractFactory("MockRewardPool");
        rewardPool = await RewardPool.deploy(want.address, crv.address, []);

        const Booster = await ethers.getContractFactory("MockBooster");
        booster = await Booster.deploy(rewardPool.address);

        await booster.setPidToken(0, want.address);

        const Strategy = await ethers.getContractFactory(
            "DAOStrategyConvex",
            owner
        );

        strategy = await Strategy.deploy(
            want.address,
            cvx.address,
            crv.address,
            cvxETH.address,
            crvETH.address,
            booster.address,
            rewardPool.address,
            0,
            owner.address,
            staking.address,
            { numerator: 25, denominator: 100 }
        );

        await strategy.grantRole(strategist_role, owner.address);
    });

    it("should deposit want on convex", async () => {
        await want.mint(strategy.address, units(500));
        await strategy.deposit();

        expect(await strategy.depositedAssets()).to.equal(units(500));
    });

    it("should allow strategists to withdraw non strategy tokens", async () => {
        await expect(
            strategy["withdraw(address,address)"](owner.address, want.address)
        ).to.be.revertedWithoutReason();

        await cvx.mint(strategy.address, units(500));
        await strategy["withdraw(address,address)"](owner.address, cvx.address);

        expect(await cvx.balanceOf(owner.address)).to.equal(units(500));
    });

    it("should allow the owner to withdraw want", async () => {
        await want.mint(strategy.address, units(100));

        await strategy.deposit();
        expect(await strategy.depositedAssets()).to.equal(units(100));

        const balanceBefore = await want.balanceOf(owner.address);
        await strategy["withdraw(address,uint256)"](owner.address, units(100));
        expect(await want.balanceOf(owner.address)).to.equal(
            balanceBefore.add(units(100))
        );
    });

    it("should allow the owner to call withdrawAll", async () => {
        await want.mint(strategy.address, units(100));

        await strategy.deposit();
        expect(await strategy.depositedAssets()).to.equal(units(100));

        const balanceBefore = await want.balanceOf(owner.address);
        await strategy.withdrawAll();
        expect(await want.balanceOf(owner.address)).to.equal(
            balanceBefore.add(units(100))
        );
    });

    it("should call notifyRewards on JPEGIndexStaking after an harvest", async () => {
        await jpegIndex.mint(owner.address, units(100));
        await jpegIndex.approve(staking.address, units(100));
        await staking.deposit(units(100));

        await expect(strategy.harvest(0)).to.be.revertedWithCustomError(
            strategy,
            "InsufficientBalance"
        );

        await want.mint(strategy.address, units(1000));
        await strategy.deposit();

        expect(await strategy.depositedAssets()).to.equal(units(1000));

        await crv.mint(rewardPool.address, units(1_000_000));

        await crvETH.setNextAmountOut(units(2));
        await want.setNextMintAmount(units(2));

        await owner.sendTransaction({ to: crvETH.address, value: units(2) });

        await strategy.harvest(0);

        expect(await ethers.provider.getBalance(staking.address)).to.equal(
            units(1.5)
        );
        expect(await staking.pendingReward(owner.address)).to.equal(units(1.5));
    });
});
