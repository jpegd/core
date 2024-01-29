import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import { id } from "@ethersproject/hash";
import { JPGD, LPFarming, TestERC20 } from "../types";
import { units, mineBlocks, checkAlmostSame } from "./utils";

export const MINTER_ROLE = id("MINTER_ROLE");

describe("LPFarming", () => {
    let owner: SignerWithAddress,
        alice: SignerWithAddress,
        bob: SignerWithAddress;
    let jpgd: JPGD, farming: LPFarming;
    let lpTokens: TestERC20[] = [];

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        alice = accounts[1];
        bob = accounts[2];

        const JPGD = await ethers.getContractFactory("JPGD");
        jpgd = await JPGD.deploy();
        await jpgd.deployed();

        const LPFarming = await ethers.getContractFactory("LPFarming");
        farming = <LPFarming>await upgrades.deployProxy(LPFarming, [], {
            constructorArgs: [jpgd.address]
        }); // 100 JPGD per block
        await farming.deployed();

        const TestERC20 = await ethers.getContractFactory("TestERC20");

        lpTokens = [];
        for (let i = 0; i < 3; i++) {
            const token = await TestERC20.deploy(
                "Test Token " + i.toString(),
                "tAsset" + i.toString()
            );
            await token.deployed();

            await token.mint(owner.address, units(10000));

            lpTokens.push(token);
        }

        await jpgd.grantRole(MINTER_ROLE, owner.address);
        await jpgd.mint(owner.address, units(1000000));
        await jpgd.approve(farming.address, units(1000000));
    });

    it("should not allow the owner to renounce ownership", async () => {
        await expect(farming.renounceOwnership()).to.be.reverted;
    });

    it("only owner can add pools", async () => {
        await expect(farming.connect(alice).add(10, lpTokens[0].address)).to
            .reverted;

        await farming.add(10, lpTokens[0].address);
        await farming.add(20, lpTokens[1].address);
        await farming.add(30, lpTokens[2].address);

        expect(await farming.poolLength()).to.equal(3);

        let pool = await farming.poolInfo(0);
        expect(pool.lpToken).to.equal(lpTokens[0].address);
        expect(pool.allocPoint).to.equal(10);
        pool = await farming.poolInfo(1);
        expect(pool.lpToken).to.equal(lpTokens[1].address);
        expect(pool.allocPoint).to.equal(20);
        pool = await farming.poolInfo(2);
        expect(pool.lpToken).to.equal(lpTokens[2].address);
        expect(pool.allocPoint).to.equal(30);
    });

    it("only owner can update pool configuration", async () => {
        await farming.add(10, lpTokens[0].address);

        let pool = await farming.poolInfo(0);
        expect(pool.lpToken).to.equal(lpTokens[0].address);
        expect(pool.allocPoint).to.equal(10);

        await expect(farming.connect(alice).set(0, 20)).to.reverted;
        await farming.set(0, 20);

        pool = await farming.poolInfo(0);
        expect(pool.lpToken).to.equal(lpTokens[0].address);
        expect(pool.allocPoint).to.equal(20);

        await farming.set(0, 10);
        await farming.set(0, 10);

        pool = await farming.poolInfo(0);
        expect(pool.lpToken).to.equal(lpTokens[0].address);
        expect(pool.allocPoint).to.equal(10);
    });

    it("should not allow an epoch with invalid parameters", async () => {
        await expect(farming.newEpoch(1, 1, 0)).to.be.revertedWithCustomError(
            farming,
            "InvalidBlock"
        );
        let blockNumber = await ethers.provider.getBlockNumber();
        await expect(
            farming.newEpoch(blockNumber + 2, blockNumber + 2, 0)
        ).to.be.revertedWithCustomError(farming, "InvalidBlock");
        blockNumber = await ethers.provider.getBlockNumber();
        await expect(
            farming.newEpoch(blockNumber + 2, blockNumber + 3, 0)
        ).to.be.revertedWithCustomError(farming, "InvalidAmount");
    });

    it("should update epoch", async () => {
        let blockNumber = await ethers.provider.getBlockNumber();
        await farming.newEpoch(blockNumber + 2, blockNumber + 12, 100);
        expect(await jpgd.balanceOf(farming.address)).to.equal(1000);

        await mineBlocks(5);
        blockNumber = await ethers.provider.getBlockNumber();
        await farming.newEpoch(blockNumber + 2, blockNumber + 12, 100);
        expect(await jpgd.balanceOf(farming.address)).to.equal(1500);

        await mineBlocks(5);
        blockNumber = await ethers.provider.getBlockNumber();
        await farming.newEpoch(blockNumber + 2, blockNumber + 12, 50);
        expect(await jpgd.balanceOf(farming.address)).to.equal(1500);

        await mineBlocks(5);
        blockNumber = await ethers.provider.getBlockNumber();
        await farming.newEpoch(blockNumber + 2, blockNumber + 3, 100);
        expect(await jpgd.balanceOf(farming.address)).to.equal(1350);
    });

    it("should not emit tokens outside of an epoch", async () => {
        await farming.add(10, lpTokens[0].address);
        await lpTokens[0].approve(farming.address, units(1000));
        await farming.deposit(0, units(1000));
        await mineBlocks(1);
        expect(await farming.pendingReward(0, owner.address)).to.equal(0);
        await expect(farming.claim(0)).to.be.revertedWithCustomError(
            farming,
            "NoReward"
        );
        await expect(farming.claimAll()).to.be.revertedWithCustomError(
            farming,
            "NoReward"
        );
        const blockNumber = await ethers.provider.getBlockNumber();
        await farming.newEpoch(blockNumber + 2, blockNumber + 4, 1);
        await mineBlocks(1);
        expect(await farming.pendingReward(0, owner.address)).to.equal(0);
        await mineBlocks(1);
        expect(await farming.pendingReward(0, owner.address)).to.equal(1);
        await mineBlocks(1);
        expect(await farming.pendingReward(0, owner.address)).to.equal(2);
        await mineBlocks(1);
        expect(await farming.pendingReward(0, owner.address)).to.equal(2);
    });

    it("should not assing rewards in between epochs", async () => {
        await farming.add(10, lpTokens[0].address);
        await lpTokens[0].approve(farming.address, units(1000));
        await farming.deposit(0, units(1000));
        const blockNumber = await ethers.provider.getBlockNumber();
        await farming.newEpoch(blockNumber + 2, blockNumber + 4, 1);
        await mineBlocks(3);
        expect(await farming.pendingReward(0, owner.address)).to.equal(2);
        await farming.newEpoch(blockNumber + 8, blockNumber + 10, 1);
        await mineBlocks(4);
        expect(await farming.pendingReward(0, owner.address)).to.equal(3);
        await mineBlocks(1);
        expect(await farming.pendingReward(0, owner.address)).to.equal(4);
        await mineBlocks(1);
        expect(await farming.pendingReward(0, owner.address)).to.equal(4);
    });

    it("should not allow 0 token deposits or withdrawals", async () => {
        await farming.add(10, lpTokens[0].address);
        await expect(farming.deposit(0, 0)).to.be.revertedWithCustomError(
            farming,
            "InvalidAmount"
        );
        await expect(farming.withdraw(0, 0)).to.be.revertedWithCustomError(
            farming,
            "InvalidAmount"
        );
        await expect(farming.withdraw(0, 1)).to.be.revertedWithCustomError(
            farming,
            "InvalidAmount"
        );
    });

    it("should work for zero allocations", async () => {
        await farming.add(0, lpTokens[0].address);
        await lpTokens[0].approve(farming.address, units(1000));
        await farming.deposit(0, units(1000));
        await farming.withdraw(0, units(1000));
        await expect(farming.claim(0)).to.reverted;
    });

    it("users can deposit/withdraw/claim", async () => {
        let blockNumber = await ethers.provider.getBlockNumber();
        await farming.newEpoch(
            blockNumber + 2,
            blockNumber + 100000000000000,
            100
        );
        await jpgd.transfer(jpgd.address, await jpgd.balanceOf(owner.address));

        await farming.add(20, lpTokens[0].address); // 50 JPGD per block
        await farming.add(10, lpTokens[1].address); // 25 JPGD per block
        await farming.add(10, lpTokens[2].address); // 25 JPGD per block

        await lpTokens[0].transfer(alice.address, units(1000));
        await lpTokens[0].transfer(bob.address, units(1000));

        await lpTokens[0].approve(farming.address, units(10000));
        await lpTokens[0].connect(alice).approve(farming.address, units(1000));
        await lpTokens[0].connect(bob).approve(farming.address, units(1000));

        console.log("1: ");
        let owner_reward = 0,
            alice_reward = 0,
            bob_reward = 0;
        expect(await farming.pendingReward(0, owner.address)).to.equal(
            owner_reward
        );
        expect(await farming.pendingReward(0, alice.address)).to.equal(
            alice_reward
        );
        expect(await farming.pendingReward(0, bob.address)).to.equal(
            bob_reward
        );

        await farming.deposit(0, units(100));
        await mineBlocks(1000);

        console.log(
            "owner reward: ",
            (await farming.pendingReward(0, owner.address)).toString()
        );
        console.log(
            "alice reward: ",
            (await farming.pendingReward(0, alice.address)).toString()
        );
        console.log(
            "bob reward: ",
            (await farming.pendingReward(0, bob.address)).toString()
        );
        owner_reward += 50 * 1000;
        expect(await farming.pendingReward(0, owner.address)).to.equal(
            owner_reward
        );
        expect(await farming.pendingReward(0, alice.address)).to.equal(
            alice_reward
        );
        expect(await farming.pendingReward(0, bob.address)).to.equal(
            bob_reward
        );

        await farming.claim(0);
        checkAlmostSame(await jpgd.balanceOf(owner.address), owner_reward);
        owner_reward = 0;

        console.log("2: ");
        await farming.connect(alice).deposit(0, units(200));
        await mineBlocks(1000);

        console.log(
            "owner reward: ",
            (await farming.pendingReward(0, owner.address)).toString()
        );
        console.log(
            "alice reward: ",
            (await farming.pendingReward(0, alice.address)).toString()
        );
        console.log(
            "bob reward: ",
            (await farming.pendingReward(0, bob.address)).toString()
        );

        owner_reward += 16.666 * 1000;
        alice_reward += 33.333 * 1000;
        checkAlmostSame(
            await farming.pendingReward(0, owner.address),
            owner_reward
        );
        checkAlmostSame(
            await farming.pendingReward(0, alice.address),
            alice_reward
        );
        expect(await farming.pendingReward(0, bob.address)).to.equal(
            bob_reward
        );

        console.log("3: ");
        await farming.deposit(0, units(200));
        await farming.connect(bob).deposit(0, units(100));
        await mineBlocks(1000);

        console.log(
            "owner reward: ",
            (await farming.pendingReward(0, owner.address)).toString()
        );
        console.log(
            "alice reward: ",
            (await farming.pendingReward(0, alice.address)).toString()
        );
        console.log(
            "bob reward: ",
            (await farming.pendingReward(0, bob.address)).toString()
        );

        expect(await farming.pendingReward(1, owner.address)).to.equal(0);
        expect(await farming.pendingReward(1, alice.address)).to.equal(0);
        expect(await farming.pendingReward(1, bob.address)).to.equal(0);

        owner_reward += 25 * 1000;
        alice_reward += 16.666 * 1000;
        bob_reward += 8.333 * 1000;
        checkAlmostSame(
            await farming.pendingReward(0, owner.address),
            owner_reward
        );
        checkAlmostSame(
            await farming.pendingReward(0, alice.address),
            alice_reward
        );
        checkAlmostSame(
            await farming.pendingReward(0, bob.address),
            bob_reward
        );

        console.log("4: ");
        await farming.connect(alice).withdraw(0, units(100));
        await mineBlocks(1000);

        console.log(
            "owner reward: ",
            (await farming.pendingReward(0, owner.address)).toString()
        );
        console.log(
            "alice reward: ",
            (await farming.pendingReward(0, alice.address)).toString()
        );
        console.log(
            "bob reward: ",
            (await farming.pendingReward(0, bob.address)).toString()
        );

        owner_reward += 30 * 1000;
        alice_reward += 10 * 1000;
        bob_reward += 10 * 1000;
        checkAlmostSame(
            await farming.pendingReward(0, owner.address),
            owner_reward
        );
        checkAlmostSame(
            await farming.pendingReward(0, alice.address),
            alice_reward
        );
        checkAlmostSame(
            await farming.pendingReward(0, bob.address),
            bob_reward
        );

        await farming.connect(alice).claimAll();
        checkAlmostSame(await jpgd.balanceOf(alice.address), alice_reward);
        alice_reward = 0;

        console.log("5: ");
        await farming.connect(bob).deposit(0, units(100));
        await mineBlocks(1000);

        console.log(
            "owner reward: ",
            (await farming.pendingReward(0, owner.address)).toString()
        );
        console.log(
            "alice reward: ",
            (await farming.pendingReward(0, alice.address)).toString()
        );
        console.log(
            "bob reward: ",
            (await farming.pendingReward(0, bob.address)).toString()
        );

        owner_reward += 25 * 1000;
        alice_reward += 8.333 * 1000;
        bob_reward += 16.666 * 1000;
        checkAlmostSame(
            await farming.pendingReward(0, owner.address),
            owner_reward
        );
        checkAlmostSame(
            await farming.pendingReward(0, alice.address),
            alice_reward
        );
        checkAlmostSame(
            await farming.pendingReward(0, bob.address),
            bob_reward
        );

        console.log("6: ");
        await farming.connect(alice).withdraw(0, units(100));
        await mineBlocks(1000);

        console.log(
            "owner reward: ",
            (await farming.pendingReward(0, owner.address)).toString()
        );
        console.log(
            "alice reward: ",
            (await farming.pendingReward(0, alice.address)).toString()
        );
        console.log(
            "bob reward: ",
            (await farming.pendingReward(0, bob.address)).toString()
        );

        owner_reward += 30 * 1000;
        bob_reward += 20 * 1000;
        checkAlmostSame(
            await farming.pendingReward(0, owner.address),
            owner_reward
        );
        checkAlmostSame(
            await farming.pendingReward(0, alice.address),
            alice_reward
        );
        checkAlmostSame(
            await farming.pendingReward(0, bob.address),
            bob_reward
        );

        await farming.connect(bob).claim(0);
        checkAlmostSame(await jpgd.balanceOf(bob.address), bob_reward);
        bob_reward = 0;

        console.log("7: ");
        await farming.connect(bob).deposit(0, units(700));
        await mineBlocks(1000);

        console.log(
            "owner reward: ",
            (await farming.pendingReward(0, owner.address)).toString()
        );
        console.log(
            "alice reward: ",
            (await farming.pendingReward(0, alice.address)).toString()
        );
        console.log(
            "bob reward: ",
            (await farming.pendingReward(0, bob.address)).toString()
        );

        owner_reward += 12.5 * 1000;
        bob_reward += 37.5 * 1000;
        checkAlmostSame(
            await farming.pendingReward(0, owner.address),
            owner_reward
        );
        checkAlmostSame(
            await farming.pendingReward(0, alice.address),
            alice_reward
        );
        checkAlmostSame(
            await farming.pendingReward(0, bob.address),
            bob_reward
        );

        const balanceBefore = ethers.BigNumber.from(
            await jpgd.balanceOf(owner.address)
        );
        await farming.claimAll();
        checkAlmostSame(
            await jpgd.balanceOf(owner.address),
            balanceBefore.add(owner_reward)
        );
    });

    it("should allow to deposit and withdraw underlying tokens", async () => {
        const TestERC20 = await ethers.getContractFactory("TestERC20");
        const underlyingToken = await TestERC20.deploy("", "");

        const MockDeposit = await ethers.getContractFactory(
            "MockUnderlyingDeposit"
        );
        const depositContract = await MockDeposit.deploy(
            underlyingToken.address,
            { numerator: 1, denominator: 2 }
        );

        await farming.add(1, depositContract.address);

        await farming.setUnderlyingInfo(
            0,
            underlyingToken.address,
            depositContract.address
        );

        await underlyingToken.mint(owner.address, units(1000));
        await underlyingToken.approve(farming.address, units(1000));

        await farming.depositUnderlying(0, units(1000));

        expect(
            await underlyingToken.balanceOf(depositContract.address)
        ).to.equal(units(1000));
        expect(await depositContract.balanceOf(farming.address)).to.equal(
            units(500)
        );

        let info = await farming.userInfo(0, owner.address);
        expect(info.amount).to.equal(units(500));

        await farming.withdrawUnderlying(0, units(500));

        expect(await underlyingToken.balanceOf(owner.address)).to.equal(
            units(1000)
        );
        expect(await depositContract.balanceOf(farming.address)).to.equal(0);

        info = await farming.userInfo(0, owner.address);
        expect(info.amount).to.equal(0);
    });
});
