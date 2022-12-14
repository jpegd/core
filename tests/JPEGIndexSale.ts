import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { JPEGIndex, JPEGIndexSale } from "../types";
import { ZERO_ADDRESS, units, currentTimestamp, timeTravel } from "./utils";

const { expect } = chai;

chai.use(solidity);

const minter_role = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";

describe("JPEGIndexSale", () => {
	let user: SignerWithAddress;
	let owner: SignerWithAddress;
	let jpegIndex: JPEGIndex;
	let sale: JPEGIndexSale;

	beforeEach(async () => {
		const accounts = await ethers.getSigners();
		owner = accounts[0];
		user = accounts[1];

		const JPEGIndex = await ethers.getContractFactory("JPEGIndex");
		jpegIndex = await JPEGIndex.deploy();

		const JPEGIndexSale = await ethers.getContractFactory("JPEGIndexSale");
		sale = await JPEGIndexSale.deploy(jpegIndex.address);
		
		await jpegIndex.grantRole(minter_role, owner.address);
	});

	it("should allow the owner to create a new sale", async () => {
		await expect(sale.newSale(0, 0, 0, { numerator: 0, denominator: 0 })).to.be.revertedWith("InvalidAmount()")
		await expect(sale.newSale(1, 0, 0, { numerator: 0, denominator: 0 })).to.be.revertedWith("InvalidStart()")
		await expect(sale.newSale(1, (await currentTimestamp()) + 1000, 0, { numerator: 0, denominator: 0 })).to.be.revertedWith("InvalidDuration()")
		await expect(sale.newSale(1, (await currentTimestamp()) + 1000, 1, { numerator: 0, denominator: 0 })).to.be.revertedWith("InvalidRate()")

		const saleAmount = BigNumber.from(100e18.toString());
		const startTimestamp = (await currentTimestamp()) + 1000;
		const duration = 1000;
		const saleRate = {numerator: BigNumber.from(2), denominator: BigNumber.from(1)};
		await jpegIndex.mint(owner.address, saleAmount);
		await jpegIndex.approve(sale.address, saleAmount);
		await sale.newSale(saleAmount, startTimestamp, duration, saleRate);
		
		expect(await jpegIndex.balanceOf(sale.address)).to.equal(saleAmount);

		const currentSale = await sale.tokenSales(0);
		expect(currentSale.tokenAmount).to.equal(saleAmount);
		expect(currentSale.tokensSold).to.equal(0);
		expect(currentSale.start).to.equal(startTimestamp);
		expect(currentSale.end).to.equal(startTimestamp + duration);
		expect(currentSale.rate).to.deep.equal([saleRate.numerator, saleRate.denominator]);
	});

	it("should allow users to participate in sales", async () => {
		const saleAmount = BigNumber.from(100e18.toString());
		const startTimestamp = (await currentTimestamp()) + 1000;
		const duration = 1000;
		const saleRate = {numerator: BigNumber.from(2), denominator: BigNumber.from(1)};
		await jpegIndex.mint(owner.address, saleAmount);
		await jpegIndex.approve(sale.address, saleAmount);
		await sale.newSale(saleAmount, startTimestamp, duration, saleRate);

		const purchaseAmount = BigNumber.from(10e18.toString());
		await expect(sale.buyTokens({value: purchaseAmount})).to.be.revertedWith("InactiveSale()");

		await timeTravel(1000);

		await sale.connect(user).buyTokens({value: purchaseAmount});

		expect(await jpegIndex.balanceOf(user.address)).to.equal(purchaseAmount.mul(2));
		expect(await ethers.provider.getBalance(sale.address)).to.equal(purchaseAmount);

		const currentSale = await sale.tokenSales(0);
		expect(currentSale.tokensSold).to.equal(purchaseAmount.mul(2));
	});

	it("should allow the owner to end the sale after it sells out", async () => {
		await expect(sale.endSale()).to.be.revertedWith("InactiveSale()");
		const saleAmount = BigNumber.from(100e18.toString());
		const startTimestamp = (await currentTimestamp()) + 1000;
		const duration = 1000;
		const saleRate = {numerator: BigNumber.from(2), denominator: BigNumber.from(1)};
		await jpegIndex.mint(owner.address, saleAmount);
		await jpegIndex.approve(sale.address, saleAmount);
		await sale.newSale(saleAmount, startTimestamp, duration, saleRate);

		const purchaseAmount = saleAmount.div(2);

		await timeTravel(1000);

		await sale.connect(user).buyTokens({value: purchaseAmount});

		const balanceBefore = await ethers.provider.getBalance(owner.address);

		await sale.endSale();

		expect((await ethers.provider.getBalance(owner.address)).sub(balanceBefore)).to.be.closeTo(purchaseAmount, 1e15);
		expect(await sale.saleIndex()).to.equal(1);
	});

	it("should allow the owner do end the sale after end timestamp", async () => {
		const saleAmount = BigNumber.from(100e18.toString());
		const startTimestamp = (await currentTimestamp()) + 1000;
		const duration = 1000;
		const saleRate = {numerator: BigNumber.from(2), denominator: BigNumber.from(1)};
		await jpegIndex.mint(owner.address, saleAmount);
		await jpegIndex.approve(sale.address, saleAmount);
		await sale.newSale(saleAmount, startTimestamp, duration, saleRate);

		const purchaseAmount = saleAmount.div(4);

		await timeTravel(1000);

		await sale.connect(user).buyTokens({value: purchaseAmount});

		const balanceBefore = await ethers.provider.getBalance(owner.address);

		await expect(sale.endSale()).to.be.revertedWith("OngoingSale()");
		
		await timeTravel(duration);

		await sale.endSale();

		expect((await ethers.provider.getBalance(owner.address)).sub(balanceBefore)).to.be.closeTo(purchaseAmount, 1e15);
		expect(await jpegIndex.balanceOf(owner.address)).to.equal(purchaseAmount.mul(2));
		expect(await sale.saleIndex()).to.equal(1);
	});

});
