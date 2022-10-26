import { BigNumber } from "@ethersproject/bignumber";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { AbiCoder } from "ethers/lib/utils";
import { ethers, upgrades } from "hardhat";
import {
    TestERC20,
    TestERC721,
    BAYCApeStakingStrategy,
    MockApeStaking
} from "../types";
import {
    units
} from "./utils";

const { expect } = chai;

const VAULT_ROLE = "0x31e0210044b4f6757ce6aa31f9c6e8d4896d24a755014887391a926c5224d959";
const MINTER_ROLE = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";

chai.use(solidity);

describe("ApeStakingStrategy", () => {
    let owner: SignerWithAddress;
    let user: SignerWithAddress;
    let strategy: BAYCApeStakingStrategy;
    let apeStaking: MockApeStaking;
    let bayc: TestERC721;
    let ape: TestERC20;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user = accounts[1];

        const TestERC20 = await ethers.getContractFactory("TestERC20");
        ape = await TestERC20.deploy("APE", "APE");

        const TestERC721 = await ethers.getContractFactory("TestERC721");
        bayc = await TestERC721.deploy();

        const MockApeStaking = await ethers.getContractFactory("MockApeStaking");
        apeStaking = await MockApeStaking.deploy(ape.address, bayc.address, bayc.address);

        const SimpleUserProxy = await ethers.getContractFactory("SimpleUserProxy");
        const proxy = await SimpleUserProxy.deploy();

        const BAYCApeStakingStrategy = await ethers.getContractFactory("BAYCApeStakingStrategy");
        strategy = <BAYCApeStakingStrategy>await upgrades.deployProxy(BAYCApeStakingStrategy,
            [
                apeStaking.address,
                ape.address,
                bayc.address,
                1,
                proxy.address
            ]
        );

        await strategy.grantRole(VAULT_ROLE, owner.address);
        await strategy.unpause();

        await ape.grantRole(MINTER_ROLE, apeStaking.address)
    });

    it("should allow the vault to deposit NFTs", async () => {
        const nftAmounts = [
            {tokenId: 0, amount: units(100)},
            {tokenId: 1, amount: units(200)},
            {tokenId: 2, amount: units(300)},
            {tokenId: 3, amount: units(400)}
        ];
        
        const firstAmount = nftAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        const depositAddress = await strategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, firstAmount);
        await ape.connect(user).approve(strategy.address, firstAmount);

        await strategy.afterDeposit(
            user.address, 
            nftAmounts.map(e => e.tokenId), 
            new AbiCoder().encode(["uint256[]"], [nftAmounts.map(e => e.amount)])
        );
        
        expect(await ape.balanceOf(apeStaking.address)).to.equal(firstAmount);

        const newAmounts = [
            {tokenId: 4, amount: units(500)},
            {tokenId: 5, amount: units(600)},
        ]

        const secondAmount = newAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        for (let i = 0; i < newAmounts.length; i++) {
            await bayc.mint(depositAddress, newAmounts[i].tokenId);
        }

        await ape.mint(user.address, secondAmount);
        await ape.connect(user).approve(strategy.address, secondAmount);

        await strategy.afterDeposit(
            user.address, 
            newAmounts.map(e => e.tokenId), 
            new AbiCoder().encode(["uint256[]"], [newAmounts.map(e => e.amount)])
        );

        expect(await ape.balanceOf(apeStaking.address)).to.equal(firstAmount.add(secondAmount));
    });

    it("should allow users to increase the amount of staked tokens after deposit", async () => {
        const nftAmounts = [
            {tokenId: 0, amount: units(100)},
            {tokenId: 1, amount: units(200)},
            {tokenId: 2, amount: units(300)},
            {tokenId: 3, amount: units(400)}
        ];
        
        const firstAmount = nftAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        const depositAddress = await strategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, firstAmount);
        await ape.connect(user).approve(strategy.address, firstAmount);

        await strategy.afterDeposit(
            user.address, 
            nftAmounts.map(e => e.tokenId), 
            new AbiCoder().encode(["uint256[]"], [nftAmounts.map(e => e.amount)])
        );
        
        const newAmounts = [
            { tokenId: nftAmounts[0].tokenId, amount: units(500) },
            { tokenId: nftAmounts[1].tokenId, amount: units(500) }
        ];

        const secondAmount = newAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        await ape.mint(user.address, secondAmount);
        await ape.connect(user).approve(strategy.address, secondAmount);

        await expect(strategy.stakeTokens(newAmounts)).to.be.revertedWith("Unauthorized()");
        await expect(strategy.stakeTokens([...newAmounts, { tokenId: 100, amount: units(500) }])).to.be.reverted;

        await strategy.connect(user).stakeTokens(newAmounts);
        
        expect(await ape.balanceOf(apeStaking.address)).to.equal(firstAmount.add(secondAmount));
    });

    it("should allow users to withdraw tokens", async () => {
        const nftAmounts = [
            {tokenId: 0, amount: units(100)},
            {tokenId: 1, amount: units(200)},
            {tokenId: 2, amount: units(300)},
            {tokenId: 3, amount: units(400)}
        ];
        
        const totalAmount = nftAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        const depositAddress = await strategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, totalAmount);
        await ape.connect(user).approve(strategy.address, totalAmount);

        await strategy.afterDeposit(
            user.address, 
            nftAmounts.map(e => e.tokenId), 
            new AbiCoder().encode(["uint256[]"], [nftAmounts.map(e => e.amount)])
        );

        await expect(strategy.connect(user).withdrawStakedTokens([{tokenId: 10, amount: units(200)}], user.address)).to.be.reverted;
        
        const toWithdraw = [
            {tokenId: 0, amount: units(100)},
            {tokenId: 1, amount: units(100)}
        ];

        await expect(strategy.withdrawStakedTokens(toWithdraw, user.address)).to.be.revertedWith("Unauthorized()");

        await strategy.connect(user).withdrawStakedTokens(toWithdraw, user.address);

        const totalWithdrawn = toWithdraw.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        expect(await bayc.ownerOf(toWithdraw[0].tokenId)).to.equal(depositAddress);
        expect(await bayc.ownerOf(toWithdraw[1].tokenId)).to.equal(depositAddress);
        expect(await ape.balanceOf(user.address)).to.equal(totalWithdrawn);
        expect(await ape.balanceOf(apeStaking.address)).to.equal(totalAmount.sub(totalWithdrawn));
    });

    it("should allow users to claim rewards", async () => {
        const nftAmounts = [
            {tokenId: 0, amount: units(100)},
            {tokenId: 1, amount: units(200)},
            {tokenId: 2, amount: units(300)},
            {tokenId: 3, amount: units(400)}
        ];
        
        const firstAmount = nftAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        const depositAddress = await strategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, firstAmount);
        await ape.connect(user).approve(strategy.address, firstAmount);

        await strategy.afterDeposit(
            user.address, 
            nftAmounts.map(e => e.tokenId), 
            new AbiCoder().encode(["uint256[]"], [nftAmounts.map(e => e.amount)])
        );
        
        await expect(strategy.connect(user).claim([100], user.address)).to.be.reverted;
        
        const toClaim = [0, 1];

        await expect(strategy.claim(toClaim, user.address)).to.be.revertedWith("Unauthorized()");

        await strategy.connect(user).claim(toClaim, user.address);

        expect(await ape.balanceOf(user.address)).to.equal(units(1 * toClaim.length));
    });

    it("should allow the vault to withdraw NFTs", async () => {
        const nftAmounts = [
            {tokenId: 0, amount: units(100)},
            {tokenId: 1, amount: units(200)},
            {tokenId: 2, amount: units(300)},
            {tokenId: 3, amount: units(400)}
        ];
        
        const totalAmount = nftAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        const depositAddress = await strategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, totalAmount);
        await ape.connect(user).approve(strategy.address, totalAmount);

        await strategy.afterDeposit(
            user.address, 
            nftAmounts.map(e => e.tokenId), 
            new AbiCoder().encode(["uint256[]"], [nftAmounts.map(e => e.amount)])
        );
        
        const toWithdraw = nftAmounts[nftAmounts.length - 1];
        
        await expect(strategy.withdraw(owner.address, owner.address, toWithdraw.tokenId)).to.be.revertedWith("Unauthorized()");
        await strategy.withdraw(user.address, owner.address, toWithdraw.tokenId);
        
        expect(await bayc.ownerOf(toWithdraw.tokenId)).to.equal(owner.address);
        expect(await ape.balanceOf(user.address)).to.equal(toWithdraw.amount);
        expect(await ape.balanceOf(apeStaking.address)).to.equal(totalAmount.sub(toWithdraw.amount));
        
        await strategy.connect(user).withdrawStakedTokens([nftAmounts[0]], user.address);
        await strategy.withdraw(user.address, owner.address, nftAmounts[0].tokenId);

        expect(await bayc.ownerOf(nftAmounts[0].tokenId)).to.equal(owner.address);
        expect(await ape.balanceOf(user.address)).to.equal(toWithdraw.amount.add(nftAmounts[0].amount));
        expect(await ape.balanceOf(apeStaking.address)).to.equal(totalAmount.sub(toWithdraw.amount).sub(nftAmounts[0].amount));
    });
});
