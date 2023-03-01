import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import { JPEG, MockV3Aggregator, TestERC20, TokenSale, WETH } from "../types";
import { ZERO_ADDRESS, units, currentTimestamp, timeTravel } from "./utils";

const { expect } = chai;

chai.use(solidity);

describe("TokenSale", () => {
    let user1: SignerWithAddress,
        user2: SignerWithAddress,
        treasury: SignerWithAddress;
    let weth: WETH;
    let usdc: TestERC20;
    let jpeg: JPEG;
    let tokenSale: TokenSale;
    let ethOracle: MockV3Aggregator, usdcOracle: MockV3Aggregator;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        //owner is accounts[0]
        user1 = accounts[1];
        user2 = accounts[2];
        treasury = accounts[3];

        const WETH = await ethers.getContractFactory("WETH");
        weth = await WETH.deploy();
        await weth.deployed();

        const TestERC20 = await ethers.getContractFactory("TestERC20");
        usdc = await TestERC20.deploy("USDC", "USDC");
        await usdc.deployed();
        await usdc.setDecimals(6);

        const MockAggregator = await ethers.getContractFactory(
            "MockV3Aggregator"
        );

        ethOracle = await MockAggregator.deploy(8, 3000e8);
        await ethOracle.deployed();

        usdcOracle = await MockAggregator.deploy(8, 1e8);
        await usdcOracle.deployed();

        const JPEG = await ethers.getContractFactory("JPEG");
        jpeg = await JPEG.deploy(units(1000000000));

        const TokenSale = await ethers.getContractFactory("TokenSale");

        await expect(
            TokenSale.deploy(
                ZERO_ADDRESS,
                usdc.address,
                ethOracle.address,
                usdcOracle.address,
                jpeg.address,
                treasury.address
            )
        ).to.be.revertedWith("INVALID_WETH");

        await expect(
            TokenSale.deploy(
                weth.address,
                ZERO_ADDRESS,
                ethOracle.address,
                usdcOracle.address,
                jpeg.address,
                treasury.address
            )
        ).to.be.revertedWith("INVALID_USDC");

        await expect(
            TokenSale.deploy(
                weth.address,
                usdc.address,
                ZERO_ADDRESS,
                usdcOracle.address,
                jpeg.address,
                treasury.address
            )
        ).to.be.revertedWith("INVALID_WETH_ORACLE");

        await expect(
            TokenSale.deploy(
                weth.address,
                usdc.address,
                ethOracle.address,
                ZERO_ADDRESS,
                jpeg.address,
                treasury.address
            )
        ).to.be.revertedWith("INVALID_USDC_ORACLE");

        await expect(
            TokenSale.deploy(
                weth.address,
                usdc.address,
                ethOracle.address,
                usdcOracle.address,
                ZERO_ADDRESS,
                treasury.address
            )
        ).to.be.revertedWith("INVALID_SALE_TOKEN");

        await expect(
            TokenSale.deploy(
                weth.address,
                usdc.address,
                ethOracle.address,
                usdcOracle.address,
                jpeg.address,
                ZERO_ADDRESS
            )
        ).to.be.revertedWith("INVALID_TREASURY");

        tokenSale = await TokenSale.deploy(
            weth.address,
            usdc.address,
            ethOracle.address,
            usdcOracle.address,
            jpeg.address,
            treasury.address
        );
        await tokenSale.deployed();
    });

    it("should return the correct tokens when calling getSupportedTokens", async () => {
        expect(await tokenSale.getSupportedTokens()).to.deep.equal([
            weth.address,
            usdc.address
        ]);
    });

    it("should return the correct oracles when calling getTokenOracles", async () => {
        expect(await tokenSale.getTokenOracles()).to.deep.equal([
            ethOracle.address,
            usdcOracle.address
        ]);
    });

    it("should return the correct oracle when calling getOracle", async () => {
        expect(await tokenSale.getTokenOracle(weth.address)).to.equal(
            ethOracle.address
        );
        expect(await tokenSale.getTokenOracle(usdc.address)).to.equal(
            usdcOracle.address
        );
    });

    it("should allow the owner to allocate tokens", async () => {
        await jpeg.approve(tokenSale.address, units(100000000));

        await expect(tokenSale.allocateTokensForSale(0)).to.be.revertedWith(
            "INVALID_ALLOCATED_AMOUNT"
        );

        await tokenSale.allocateTokensForSale(units(100000000));
        expect(await tokenSale.availableTokens()).to.equal(units(100000000));

        await expect(
            tokenSale.allocateTokensForSale(units(100000000))
        ).to.be.revertedWith("TOKENS_ALREADY_ALLOCATED");
    });

    it("should allow the owner to set the sale schedule", async () => {
        const timestamp = await currentTimestamp();
        await expect(
            tokenSale.setSaleSchedule(timestamp + 100, timestamp + 1000)
        ).to.be.revertedWith("TOKENS_NOT_ALLOCATED");

        await jpeg.approve(tokenSale.address, units(100000000));
        await tokenSale.allocateTokensForSale(units(100000000));

        await expect(
            tokenSale.setSaleSchedule(timestamp, timestamp + 1000)
        ).to.be.revertedWith("INVALID_START_TIMESTAMP");

        await expect(
            tokenSale.setSaleSchedule(timestamp + 1000, timestamp + 1000)
        ).to.be.revertedWith("INVALID_END_TIMESTAMP");

        await tokenSale.setSaleSchedule(timestamp + 100, timestamp + 1000);

        await expect(
            tokenSale.setSaleSchedule(timestamp + 100, timestamp + 1000)
        ).to.be.revertedWith("SCHEDULE_ALREADY_SET");
    });

    it("should allow users to deposit", async () => {
        await weth.connect(user1).deposit({ value: units(5) });
        await usdc.mint(user2.address, 30000e6);

        await expect(
            tokenSale.connect(user1).deposit(weth.address, units(10))
        ).to.be.revertedWith("DEPOSITS_NOT_ACCEPTED");

        await jpeg.approve(tokenSale.address, units(100000000));
        await tokenSale.allocateTokensForSale(units(100000000));

        const timestamp = await currentTimestamp();
        await tokenSale.setSaleSchedule(timestamp + 2, timestamp + 1000);

        await expect(
            tokenSale.connect(user1).deposit(user1.address, units(10))
        ).to.be.revertedWith("TOKEN_NOT_SUPPORTED");

        await expect(
            tokenSale.connect(user1).deposit(weth.address, 0)
        ).to.be.revertedWith("INVALID_AMOUNT");

        await usdc.connect(user2).transfer(user1.address, 5000e6);

        await weth.connect(user1).approve(tokenSale.address, units(5));
        await usdc.connect(user1).approve(tokenSale.address, 5000e6);
        await usdc.connect(user2).approve(tokenSale.address, 25000e6);

        await tokenSale.connect(user1).deposit(weth.address, units(5));
        await tokenSale.connect(user2).deposit(usdc.address, 25000e6);

        await expect(
            tokenSale.connect(user1).deposit(usdc.address, 5000e6)
        ).to.be.revertedWith("SINGLE_ASSET_DEPOSITS");

        await expect(
            tokenSale.connect(user2).depositETH({ value: units(10) })
        ).to.be.revertedWith("SINGLE_ASSET_DEPOSITS");

        await tokenSale.connect(user1).depositETH({ value: units(3) });

        await user1.sendTransaction({ to: tokenSale.address, value: units(2) });

        const user1Data = await tokenSale.userAccounts(user1.address);
        const user2Data = await tokenSale.userAccounts(user2.address);

        expect(user1Data.token).to.equal(weth.address);
        expect(user1Data.depositedAmount).to.equal(units(10));
        expect(user2Data.token).to.equal(usdc.address);
        expect(user2Data.depositedAmount).to.equal(25000e6);

        expect(await weth.balanceOf(tokenSale.address)).to.equal(units(10));
        expect(await usdc.balanceOf(tokenSale.address)).to.equal(25000e6);
    });

    it("should allow the owner to finalize the raise", async () => {
        await expect(tokenSale.finalizeRaise()).to.be.revertedWith(
            "SALE_NOT_ENDED"
        );
        await weth.connect(user1).deposit({ value: units(5) });
        await usdc.mint(user2.address, 30000e6);

        await jpeg.approve(tokenSale.address, units(100000000));
        await tokenSale.allocateTokensForSale(units(100000000));

        const timestamp = await currentTimestamp();
        await tokenSale.setSaleSchedule(timestamp + 2, timestamp + 1000);

        await weth.connect(user1).approve(tokenSale.address, units(5));
        await usdc.connect(user2).approve(tokenSale.address, 30000e6);

        await tokenSale.connect(user1).deposit(weth.address, units(5));
        await tokenSale.connect(user2).deposit(usdc.address, 30000e6);
        await tokenSale.connect(user1).depositETH({ value: units(5) });

        await expect(tokenSale.finalizeRaise()).to.be.revertedWith(
            "SALE_NOT_ENDED"
        );

        await timeTravel(1000);

        await ethOracle.updateAnswer(0);
        await expect(tokenSale.finalizeRaise()).to.be.revertedWith(
            "INVALID_ORACLE_ANSWER"
        );
        await ethOracle.updateAnswer(3000e8);

        await tokenSale.finalizeRaise();

        expect(await tokenSale.totalRaisedUSD()).to.equal(60000e8);

        await expect(tokenSale.finalizeRaise()).to.be.revertedWith(
            "ALREADY_FINALIZED"
        );
    });

    it("should allow the owner to enable withdrawals", async () => {
        await expect(tokenSale.enableWithdrawals()).to.be.revertedWith(
            "NOT_FINALIZED"
        );
        await jpeg.approve(tokenSale.address, units(100000000));
        await tokenSale.allocateTokensForSale(units(100000000));

        const timestamp = await currentTimestamp();
        await tokenSale.setSaleSchedule(timestamp + 2, timestamp + 3);

        await tokenSale.connect(user1).depositETH({ value: units(5) });

        await tokenSale.finalizeRaise();
        await tokenSale.enableWithdrawals();

        expect(await tokenSale.withdrawalsEnabled()).to.equal(true);
        await expect(tokenSale.enableWithdrawals()).to.be.revertedWith(
            "ALREADY_ENABLED"
        );
    });

    it("should allow users to withdraw", async () => {
        await weth.connect(user1).deposit({ value: units(5) });
        await usdc.mint(user2.address, 40000e6);

        await jpeg.approve(tokenSale.address, units(100000000));
        await tokenSale.allocateTokensForSale(units(100000000));

        const timestamp = await currentTimestamp();
        await tokenSale.setSaleSchedule(timestamp + 2, timestamp + 1000);

        await weth.connect(user1).approve(tokenSale.address, units(5));
        await usdc.connect(user2).approve(tokenSale.address, 40000e6);

        await tokenSale.connect(user1).deposit(weth.address, units(5));
        await tokenSale.connect(user2).deposit(usdc.address, 40000e6);
        await tokenSale.connect(user1).depositETH({ value: units(5) });

        await timeTravel(1000);

        expect(await tokenSale.getUserClaimableTokens(user1.address)).to.equal(
            0
        );
        expect(await tokenSale.getUserClaimableTokens(user2.address)).to.equal(
            0
        );

        await tokenSale.finalizeRaise();

        const claimableUser1 = await tokenSale.getUserClaimableTokens(
            user1.address
        );
        const claimableUser2 = await tokenSale.getUserClaimableTokens(
            user2.address
        );
        expect(claimableUser1).to.equal(units(100000000).mul(3).div(7));
        expect(claimableUser2).to.equal(units(100000000).mul(4).div(7));
        expect(claimableUser1).to.be.closeTo(units(42857142), units(1) as any);
        expect(claimableUser2).to.closeTo(units(57142857), units(1) as any);

        await expect(tokenSale.connect(user1).withdraw()).to.be.revertedWith(
            "WITHDRAWALS_NOT_ENABLED"
        );
        await tokenSale.enableWithdrawals();

        await tokenSale.connect(user1).withdraw();
        await tokenSale.connect(user2).withdraw();

        expect(await jpeg.balanceOf(user1.address)).to.equal(claimableUser1);
        expect(await jpeg.balanceOf(user2.address)).to.equal(claimableUser2);

        await expect(tokenSale.connect(user1).withdraw()).to.be.revertedWith(
            "NO_TOKENS"
        );
    });

    it("should allow the owner to transfer the raise to treasury", async () => {
        await weth.connect(user1).deposit({ value: units(5) });
        await usdc.mint(user2.address, 40000e6);

        await jpeg.approve(tokenSale.address, units(100000000));
        await tokenSale.allocateTokensForSale(units(100000000));

        const timestamp = await currentTimestamp();
        await tokenSale.setSaleSchedule(timestamp + 2, timestamp + 1000);

        await weth.connect(user1).approve(tokenSale.address, units(5));
        await usdc.connect(user2).approve(tokenSale.address, 40000e6);

        await tokenSale.connect(user1).deposit(weth.address, units(5));
        await tokenSale.connect(user2).deposit(usdc.address, 40000e6);
        await tokenSale.connect(user1).depositETH({ value: units(5) });

        await timeTravel(1000);

        await tokenSale.finalizeRaise();
        await expect(tokenSale.transferToTreasury()).to.be.revertedWith(
            "WITHDRAWALS_NOT_ENABLED"
        );
        await tokenSale.enableWithdrawals();

        await tokenSale.connect(user1).withdraw();

        await tokenSale.transferToTreasury();
        expect(await usdc.balanceOf(treasury.address)).to.equal(40000e6);
        expect(await weth.balanceOf(treasury.address)).to.equal(units(10));

        await tokenSale.connect(user2).withdraw();
    });
});
