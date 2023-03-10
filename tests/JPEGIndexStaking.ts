import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, upgrades } from "hardhat";
import { JPEGIndex, JPEGIndexStaking } from "../types";
import { units } from "./utils";

const { expect } = chai;

chai.use(solidity);

const minter_role =
    "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";

describe("JPEGIndexStaking", () => {
    let owner: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;
    let jpegIndex: JPEGIndex, staking: JPEGIndexStaking;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user1 = accounts[1];
        user2 = accounts[2];

        const JPEGIndex = await ethers.getContractFactory("JPEGIndex");
        jpegIndex = await JPEGIndex.deploy();

        await jpegIndex.grantRole(minter_role, owner.address);

        const JPEGIndexStaking = await ethers.getContractFactory(
            "JPEGIndexStaking"
        );
        staking = <JPEGIndexStaking>(
            await upgrades.deployProxy(JPEGIndexStaking, [jpegIndex.address])
        );
    });

    it("should allow users to deposit", async () => {
        await expect(staking.deposit(0)).to.be.revertedWith("InvalidAmount()");

        const user1DepositAmount = units(100);
        const user2DepositAmount = units(200);

        await jpegIndex.mint(user1.address, user1DepositAmount);
        await jpegIndex.mint(user2.address, user2DepositAmount);

        await jpegIndex
            .connect(user1)
            .approve(staking.address, user1DepositAmount);
        await jpegIndex
            .connect(user2)
            .approve(staking.address, user2DepositAmount);

        await staking.connect(user1).deposit(user1DepositAmount);

        expect(await jpegIndex.balanceOf(user1.address)).to.equal(0);
        expect(await jpegIndex.balanceOf(staking.address)).to.equal(
            user1DepositAmount
        );

        await staking.notifyReward({ value: units(10) });

        expect(await staking.pendingReward(user1.address)).to.equal(units(10));
        expect(await staking.pendingReward(user2.address)).to.equal(0);

        await staking.connect(user2).deposit(user2DepositAmount);
        expect(await staking.pendingReward(user2.address)).to.equal(0);

        await staking.notifyReward({ value: units(30) });
        expect(await staking.pendingReward(user1.address)).to.equal(units(20));
        expect(await staking.pendingReward(user2.address)).to.equal(units(20));

        await jpegIndex.mint(user1.address, user1DepositAmount);
        await jpegIndex
            .connect(user1)
            .approve(staking.address, user1DepositAmount);

        const balanceBefore = await ethers.provider.getBalance(user1.address);

        await staking.connect(user1).deposit(user1DepositAmount);
        expect(await ethers.provider.getBalance(staking.address)).to.equal(
            units(20)
        );
        expect(await ethers.provider.getBalance(user1.address)).to.be.closeTo(
            balanceBefore.add(units(20)),
            (10e16).toString() as any
        );
        expect(await staking.pendingReward(user1.address)).to.equal(0);
    });

    it("should allow users to withdraw", async () => {
        await expect(staking.withdraw(0)).to.be.revertedWith("InvalidAmount()");

        const user1DepositAmount = units(100);
        const user2DepositAmount = units(200);

        await jpegIndex.mint(user1.address, user1DepositAmount);
        await jpegIndex.mint(user2.address, user2DepositAmount);

        await jpegIndex
            .connect(user1)
            .approve(staking.address, user1DepositAmount);
        await jpegIndex
            .connect(user2)
            .approve(staking.address, user2DepositAmount);

        await staking.connect(user1).deposit(user1DepositAmount);
        await staking.connect(user2).deposit(user2DepositAmount);

        await staking.notifyReward({ value: units(30) });

        expect(await staking.pendingReward(user1.address)).to.equal(units(10));
        expect(await staking.pendingReward(user2.address)).to.equal(units(20));

        const balanceBefore = await ethers.provider.getBalance(user2.address);

        await staking.connect(user2).withdraw(user2DepositAmount);

        expect(await ethers.provider.getBalance(user2.address)).to.be.closeTo(
            balanceBefore.add(units(20)),
            (10e16).toString() as any
        );
        expect(await staking.pendingReward(user2.address)).to.equal(0);
        expect(await jpegIndex.balanceOf(user2.address)).to.equal(
            user2DepositAmount
        );

        await staking.notifyReward({ value: units(10) });
        expect(await staking.pendingReward(user1.address)).to.equal(units(20));
        expect(await staking.pendingReward(user2.address)).to.equal(0);
    });

    it("should allow users to claim rewards", async () => {
        await expect(staking.claim()).to.be.revertedWith("InvalidAmount()");

        const user1DepositAmount = units(100);

        await jpegIndex.mint(user1.address, user1DepositAmount);
        await jpegIndex
            .connect(user1)
            .approve(staking.address, user1DepositAmount);

        await staking.connect(user1).deposit(user1DepositAmount);

        await expect(staking.connect(user1).claim()).to.be.revertedWith(
            "NoRewards()"
        );

        await staking.notifyReward({ value: units(10) });
        const balanceBefore = await ethers.provider.getBalance(user1.address);
        await staking.connect(user1).claim();
        expect(await ethers.provider.getBalance(user1.address)).to.be.closeTo(
            balanceBefore.add(units(10)),
            (10e16).toString() as any
        );
    });
});
