import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { MockRewardPool, MockStrategy, TestERC20, Vault } from "../types";
import { units, ZERO_ADDRESS } from "./utils";

describe("Vault", () => {
    let owner: SignerWithAddress, user1: SignerWithAddress;
    let strategy: MockStrategy;
    let vault: Vault;
    let want: TestERC20, reward: TestERC20;
    let rewardPool: MockRewardPool;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user1 = accounts[1];

        const ERC20 = await ethers.getContractFactory("TestERC20");
        want = await ERC20.deploy("TEST", "TEST");
        reward = await ERC20.deploy("TEST", "TEST");

        const RewardPool = await ethers.getContractFactory("MockRewardPool");

        rewardPool = await RewardPool.deploy(want.address, reward.address, []);
        await rewardPool.deployed();

        const Strategy = await ethers.getContractFactory("MockStrategy");
        strategy = await Strategy.deploy(want.address, rewardPool.address);

        const Vault = await ethers.getContractFactory("Vault");

        vault = <Vault>(
            await upgrades.deployProxy(Vault, [
                want.address,
                owner.address,
                { numerator: 5, denominator: 1000 }
            ])
        );

        await expect(
            upgrades.deployProxy(Vault, [
                want.address,
                ZERO_ADDRESS,
                { numerator: 5, denominator: 1000 }
            ])
        ).to.be.revertedWith("INVALID_ADDRESS");

        await expect(
            upgrades.deployProxy(Vault, [
                want.address,
                owner.address,
                { numerator: 1, denominator: 1 }
            ])
        ).to.be.revertedWith("INVALID_RATE");
    });

    it("should have the same decimals as the deposit want", async () => {
        await want.setDecimals(10);
        expect(await vault.decimals()).to.equal(10);

        await want.setDecimals(18);
        expect(await vault.decimals()).to.equal(18);
    });

    it("should allow users to deposit", async () => {
        await vault.unpause();

        await want.mint(user1.address, units(1000));
        await want.connect(user1).approve(vault.address, units(1000));

        await expect(
            vault.connect(user1).deposit(user1.address, 0)
        ).to.be.revertedWith("INVALID_AMOUNT");

        await expect(
            vault.connect(user1).deposit(user1.address, units(500))
        ).to.be.revertedWith("NO_STRATEGY");

        await vault.migrateStrategy(strategy.address);

        await vault.connect(user1).deposit(user1.address, units(500));

        expect(await vault.balanceOf(user1.address)).to.equal(units(497.5));
        await vault.connect(user1).deposit(user1.address, units(500));
        expect(await vault.balanceOf(user1.address)).to.equal(units(995));

        expect(await want.balanceOf(owner.address)).to.equal(units(5));
        expect(await want.balanceOf(strategy.address)).to.equal(units(995));
    });

    it("should mint the correct amount of tokens", async () => {
        await vault.unpause();

        await vault.migrateStrategy(strategy.address);

        expect(await vault.exchangeRate()).to.equal(0);
        await want.mint(user1.address, units(1000));
        await want.connect(user1).approve(vault.address, units(1000));

        await vault.connect(user1).deposit(user1.address, units(500));
        expect(await vault.balanceOf(user1.address)).to.equal(units(497.5));

        await want.mint(vault.address, units(497.5));

        expect(await vault.exchangeRate()).to.equal(units(2));

        await vault.connect(user1).deposit(user1.address, units(500));
        expect(await vault.balanceOf(user1.address)).to.equal(units(746.25));

        expect(await want.balanceOf(owner.address)).to.equal(units(5));
        expect(await want.balanceOf(strategy.address)).to.equal(units(995));
        expect(await want.balanceOf(vault.address)).to.equal(units(497.5));

        await vault.connect(user1).withdraw(user1.address, units(746.25));
        expect(await want.balanceOf(strategy.address)).to.equal(units(0));
        expect(await want.balanceOf(vault.address)).to.equal(units(0));
        expect(await want.balanceOf(user1.address)).to.equal(units(1492.5));
    });

    it("should withdraw the correct amount of tokens", async () => {
        await vault.unpause();

        await vault.migrateStrategy(strategy.address);

        await want.mint(user1.address, units(1000));
        await want.connect(user1).approve(vault.address, units(1000));

        await expect(
            vault.connect(user1).withdraw(user1.address, 0)
        ).to.be.revertedWith("INVALID_AMOUNT");
        await expect(
            vault.connect(user1).withdraw(user1.address, units(500))
        ).to.be.revertedWith("NO_TOKENS_DEPOSITED");

        await vault.connect(user1).deposit(user1.address, units(1000));

        await vault.connect(user1).withdraw(user1.address, units(500));
        expect(await want.balanceOf(user1.address)).to.equal(units(500));

        await want.mint(vault.address, units(495));
        await vault.depositBalance();

        await vault.connect(user1).withdraw(user1.address, units(250));
        expect(await want.balanceOf(user1.address)).to.equal(units(1000));
        expect(await want.balanceOf(strategy.address)).to.equal(units(490));

        await vault.connect(user1).withdraw(user1.address, units(245));
        expect(await want.balanceOf(user1.address)).to.equal(units(1490));
        expect(await want.balanceOf(strategy.address)).to.equal(0);
        expect(await want.balanceOf(owner.address)).to.equal(units(5));
    });

    it("should allow the owner to migrate strategy", async () => {
        await vault.unpause();

        await vault.migrateStrategy(strategy.address);

        await want.mint(user1.address, units(1000));
        await want.connect(user1).approve(vault.address, units(1000));
        await vault.connect(user1).deposit(user1.address, units(1000));

        await expect(
            vault.migrateStrategy(strategy.address)
        ).to.be.revertedWith("SAME_STRATEGY");

        const Strategy = await ethers.getContractFactory("MockStrategy");
        let newStrategy = await Strategy.deploy(
            want.address,
            rewardPool.address
        );

        await vault.migrateStrategy(newStrategy.address);

        expect(await vault.totalAssets()).to.equal(units(995));
        expect(await want.balanceOf(vault.address)).to.equal(0);
        expect(await want.balanceOf(strategy.address)).to.equal(0);
        expect(await want.balanceOf(newStrategy.address)).to.equal(units(995));

        await vault.connect(user1).withdraw(user1.address, units(495));
        expect(await want.balanceOf(user1.address)).to.equal(units(495));

        await vault.migrateStrategy(ZERO_ADDRESS);

        expect(await vault.totalAssets()).to.equal(units(500));
        expect(await want.balanceOf(vault.address)).to.equal(units(500));
        expect(await want.balanceOf(strategy.address)).to.equal(0);
        expect(await want.balanceOf(newStrategy.address)).to.equal(0);

        await expect(
            vault.connect(user1).deposit(user1.address, units(500))
        ).to.be.revertedWith("NO_STRATEGY");

        await vault.connect(user1).withdraw(user1.address, units(500));
        expect(await vault.totalAssets()).to.equal(0);
        expect(await vault.totalSupply()).to.equal(0);
        expect(await want.balanceOf(user1.address)).to.equal(units(995));
    });
});
