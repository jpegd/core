import { BigNumber } from "@ethersproject/bignumber";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { AbiCoder } from "ethers/lib/utils";
import { ethers, upgrades } from "hardhat";
import {
	FungibleAssetVaultForDAO,
	JPEG,
	MockV3Aggregator,
	JPEGCardsCigStaking,
	NFTVault,
	PETH,
	TestERC20,
	TestERC721,
	UniswapV2MockOracle
} from "../types";
import {
	units,
	timeTravel,
	days,
	checkAlmostSame,
	currentTimestamp,
	ZERO_ADDRESS,
} from "./utils";

const { expect } = chai;

chai.use(solidity);

const default_admin_role =
	"0x0000000000000000000000000000000000000000000000000000000000000000";
const minter_role =
	"0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";
const dao_role =
	"0x3b5d4cc60d3ec3516ee8ae083bd60934f6eb2a6c54b1229985c41bfb092b2603";
const liquidator_role =
	"0x5e17fc5225d4a099df75359ce1f405503ca79498a8dc46a7d583235a0ee45c16";
const whitelisted_role =
	"0x8429d542926e6695b59ac6fbdcd9b37e8b1aeb757afab06ab60b1bb5878c3b49";
const router_role = 
	"0x7a05a596cb0ce7fdea8a1e1ec73be300bdb35097c944ce1897202f7a13122eb2";
const apes = [
	372, 1021, 2140, 2243, 2386, 2460, 2491, 2711, 2924, 4156, 4178, 4464, 5217,
	5314, 5577, 5795, 6145, 6915, 6965, 7191, 8219, 8498, 9265, 9280,
];

describe("PETHNFTVault", () => {
	let owner: SignerWithAddress,
		dao: SignerWithAddress,
		user: SignerWithAddress;
	let nftVault: NFTVault,
		ethVault: FungibleAssetVaultForDAO,
		ethOracle: MockV3Aggregator,
		jpegOracle: UniswapV2MockOracle,
		floorOracle: MockV3Aggregator,
		fallbackOracle: MockV3Aggregator,
		weth: TestERC20,
		stablecoin: PETH,
		erc721: TestERC721,
		jpeg: JPEG;

	beforeEach(async () => {
		const accounts = await ethers.getSigners();
		owner = accounts[0];
		dao = accounts[1];
		user = accounts[2];

		const ERC721 = await ethers.getContractFactory("TestERC721");
		erc721 = await ERC721.deploy();
		await erc721.deployed();

		const CigStaking = await ethers.getContractFactory("JPEGCardsCigStaking");
		const cigStaking = await CigStaking.deploy(erc721.address, [200]);
		await cigStaking.deployed();

		const TestERC20 = await ethers.getContractFactory("TestERC20");
		weth = await TestERC20.deploy("Test WETH", "WETH");
		await weth.deployed();

		const Peth = await ethers.getContractFactory("PETH");
		stablecoin = await Peth.deploy();
		await stablecoin.deployed();

		const MockOracle = await ethers.getContractFactory("UniswapV2MockOracle");
		jpegOracle = await MockOracle.deploy(1000000000000000);
		await jpegOracle.deployed();

		const MockAggregator = await ethers.getContractFactory("MockV3Aggregator");
		ethOracle = await MockAggregator.deploy(8, 3000e8);
		await ethOracle.deployed();

		floorOracle = await MockAggregator.deploy(18, units(50));
		await floorOracle.deployed();

		fallbackOracle = await MockAggregator.deploy(18, units(10));
		await fallbackOracle.deployed();

		const JPEG = await ethers.getContractFactory("JPEG");

		jpeg = await JPEG.deploy(units(1000000000));
		await jpeg.deployed();

		await jpeg.grantRole(minter_role, owner.address);

		const JPEGOraclesAggregator = await ethers.getContractFactory("JPEGOraclesAggregator");
		let jpegOraclesAggregator = await JPEGOraclesAggregator.deploy(jpegOracle.address);

		const NFTValueProvider = await ethers.getContractFactory("NFTValueProvider");
		const nftValueProvider = await upgrades.deployProxy(NFTValueProvider, [
			jpeg.address,
			jpegOraclesAggregator.address,
			cigStaking.address,
			[32, 100],
			[33, 100],
			[7, 100],
			[10, 100],
			[8, 100],
			[10, 100],
			0
		]);

		await jpegOraclesAggregator.addFloorOracle(floorOracle.address, nftValueProvider.address);

		const NFTVault = await ethers.getContractFactory("PETHNFTVault");
		nftVault = <NFTVault>await upgrades.deployProxy(NFTVault, [
			stablecoin.address,
			erc721.address,
			nftValueProvider.address,
			[
				[2, 100], //debtInterestApr
				[0, 0], //creditLimitRate - unused
				[0, 0], //liquidationLimitRate - unused
				[0, 0], //cigStakedCreditLimitRate - unused
				[0, 0], //cigStakedLiquidationLimitRate - unused
				[0, 0], //valueIncreaseLockRate - unused
				[5, 1000], //organizationFeeRate
				[1, 100], //insuranchePurchaseRate
				[25, 100], //insuranceLiquidationPenaltyRate
				86400 * 3, //insuranceRepurchaseLimit
				units(3000).mul(1000), //borrowAmountCap
			],
		]);
		await nftVault.deployed();

		const FungibleAssetVaultForDAO = await ethers.getContractFactory(
			"FungibleAssetVaultForDAO"
		);
		ethVault = <FungibleAssetVaultForDAO>(
			await upgrades.deployProxy(FungibleAssetVaultForDAO, [
				weth.address,
				stablecoin.address,
				ethOracle.address,
				[100, 100],
			])
		);
		await ethVault.deployed();

		await stablecoin.grantRole(default_admin_role, dao.address);
		await stablecoin.revokeRole(default_admin_role, owner.address);
		await stablecoin.connect(dao).grantRole(minter_role, nftVault.address);
		await stablecoin.connect(dao).grantRole(minter_role, ethVault.address);

		await nftVault.grantRole(dao_role, dao.address);
		await nftVault.grantRole(liquidator_role, dao.address);
		await nftVault.grantRole(router_role, owner.address);
		await nftVault.revokeRole(dao_role, owner.address);
		await ethVault.grantRole(default_admin_role, dao.address);
		await ethVault.grantRole(whitelisted_role, dao.address);
		await ethVault.revokeRole(default_admin_role, owner.address);
	});

	it("should be able to borrow", async () => {
		await expect(nftVault.borrow(10001, 100, false)).to.be.revertedWith(
			"InvalidNFT(10001)"
		);

		await erc721.mint(user.address, 1);

		await expect(nftVault.borrow(1, 0, false)).to.be.revertedWith(
			"InvalidAmount(0)"
		);

		await expect(nftVault.borrow(1, 100, false)).to.be.revertedWith(
			"ERC721: transfer caller is not owner nor approved"
		);

		const index = 1000;
		const borrowAmount = units(10);
		await erc721.mint(user.address, index);
		await expect(
			nftVault.connect(user).borrow(index, borrowAmount, false)
		).to.be.revertedWith("ERC721: transfer caller is not owner nor approved");

		await erc721.connect(user).approve(nftVault.address, index);

		await expect(
			nftVault.connect(user).borrow(index, borrowAmount.mul(2), false)
		).to.be.revertedWith("InvalidAmount(" + borrowAmount.mul(2) + ")");

		const stablecoinBalanceBefore = await stablecoin.balanceOf(user.address);
		await nftVault.connect(user).borrow(index, borrowAmount.div(2), false);

		await expect(
			nftVault.borrow(index, borrowAmount, false)
		).to.be.revertedWith("Unauthorized()");

		await nftVault.connect(user).borrow(index, borrowAmount.div(2), false);

		expect(await stablecoin.balanceOf(user.address)).to.be.equal(
			borrowAmount.mul(995).div(1000).add(stablecoinBalanceBefore)
		);

		expect(await nftVault.openPositionsIndexes()).to.deep.equal([
			BigNumber.from(index),
		]);
		expect(await nftVault.totalPositions()).to.equal(1);
	});

	it("should be able to borrow with insurance", async () => {
		const index = 2000;
		await erc721.mint(user.address, index);

		const borrowAmount = units(1).mul(10);

		await erc721.connect(user).approve(nftVault.address, index);

		const stablecoinBalanceBefore = await stablecoin.balanceOf(user.address);
		const daoBalanceBefore = await stablecoin.balanceOf(dao.address);
		await nftVault.connect(user).borrow(index, borrowAmount, true);

		expect(await stablecoin.balanceOf(user.address)).to.be.equal(
			borrowAmount.mul(985).div(1000).add(stablecoinBalanceBefore)
		);
		await nftVault.connect(dao).collect();
		checkAlmostSame(
			await stablecoin.balanceOf(dao.address),
			borrowAmount.mul(15).div(1000).add(daoBalanceBefore)
		);
	});

	it("should be able to repay", async () => {
		await expect(nftVault.repay(10001, 100)).to.be.revertedWith("InvalidNFT(10001)");
		await erc721.mint(user.address, 1);
		await expect(nftVault.repay(1, 100)).to.be.revertedWith("Unauthorized()");

		const index = 3000;
		await erc721.mint(user.address, index);
		await expect(nftVault.connect(user).repay(index, 100)).to.be.revertedWith(
			"Unauthorized()"
		);

		await erc721.connect(user).approve(nftVault.address, index);
		await expect(nftVault.connect(user).repay(index, 100)).to.be.revertedWith(
			"Unauthorized()"
		);

		const borrowAmount = units(1).mul(10);
		await nftVault.connect(user).borrow(index, borrowAmount, false);

		await expect(nftVault.connect(user).repay(index, 0)).to.be.revertedWith(
			"InvalidAmount(0)"
		);

		// pay half
		expect((await nftVault.positions(index)).debtPrincipal).to.be.equal(borrowAmount);

		let stablecoinBalanceBefore = await stablecoin.balanceOf(user.address);

		await stablecoin
			.connect(user)
			.approve(nftVault.address, borrowAmount.div(2));
		await nftVault.connect(user).repay(index, borrowAmount.div(2));

		checkAlmostSame((await nftVault.positions(index)).debtPrincipal, borrowAmount.div(2));

		expect(stablecoinBalanceBefore).to.be.equal(
			borrowAmount.div(2).add(await stablecoin.balanceOf(user.address))
		);

		// user prepares 10 peth to repay full (consider interest)
		const prepareAmount = units(10);
		await weth.mint(dao.address, prepareAmount);
		await weth.connect(dao).approve(ethVault.address, prepareAmount);
		await ethVault.connect(dao).deposit(prepareAmount);
		await ethVault.connect(dao).borrow(prepareAmount);
		await stablecoin.connect(dao).transfer(user.address, prepareAmount);

		// pay half again
		stablecoinBalanceBefore = await stablecoin.balanceOf(user.address);
		await stablecoin
			.connect(user)
			.approve(nftVault.address, ethers.constants.MaxUint256);
		await nftVault.connect(user).repay(index, ethers.constants.MaxUint256);

		expect((await nftVault.positions(index)).debtPrincipal).to.be.equal(0);

		checkAlmostSame(
			stablecoinBalanceBefore,
			borrowAmount.div(2).add(await stablecoin.balanceOf(user.address))
		);
	});

	it("should be able to close position", async () => {
		await expect(nftVault.closePosition(10001)).to.be.revertedWith(
			"InvalidNFT(10001)"
		);
		await erc721.mint(user.address, 1);
		await expect(nftVault.closePosition(1)).to.be.revertedWith("Unauthorized()");

		const index = 4000;
		await erc721.mint(user.address, index);

		await erc721.connect(user).approve(nftVault.address, index);

		const borrowAmount = units(1).mul(10);
		await nftVault.connect(user).borrow(index, borrowAmount, false);

		await expect(nftVault.connect(user).closePosition(index)).to.be.reverted;
		try {
			await nftVault.connect(user).closePosition(index)
		} catch (err: any) {
			//doing it this way so we can get the exact debt interest
			expect(err.toString()).to.contain("NonZeroDebt(" + borrowAmount.add(await nftVault.getDebtInterest(index)) + ")")
		}

		// user prepares 10 peth to repay full (consider interest)
		const prepareAmount = units(10);
		await weth.mint(dao.address, prepareAmount);
		await weth.connect(dao).approve(ethVault.address, prepareAmount);
		await ethVault.connect(dao).deposit(prepareAmount);
		await ethVault.connect(dao).borrow(prepareAmount);
		await stablecoin.connect(dao).transfer(user.address, prepareAmount);

		// full repay to close position
		await stablecoin
			.connect(user)
			.approve(nftVault.address, ethers.constants.MaxUint256);
		await nftVault.connect(user).repay(index, ethers.constants.MaxUint256);
		await nftVault.connect(user).closePosition(index);

		expect(await erc721.ownerOf(index)).to.be.equal(user.address);

		expect(await nftVault.positionOwner(index)).to.equal(ZERO_ADDRESS);

		expect(await nftVault.openPositionsIndexes()).to.deep.equal([]);
		expect(await nftVault.totalPositions()).to.equal(0);
	});

	it("should be able to liquidate borrow position without insurance", async () => {
		const index = 4000;
		await erc721.mint(user.address, index);

		await expect(nftVault.connect(user).liquidate(index, owner.address)).to.be.revertedWith(
			"AccessControl: account " +
			user.address.toLowerCase() +
			" is missing role " +
			liquidator_role
		);

		await expect(nftVault.connect(dao).liquidate(10001, owner.address)).to.be.revertedWith(
			"InvalidNFT(10001)"
		);

		expect(await nftVault.positionOwner(index)).to.equal(ZERO_ADDRESS);

		await erc721.connect(user).approve(nftVault.address, index);

		expect(await nftVault.positionOwner(index)).to.equal(ZERO_ADDRESS);

		const borrowAmount = units(9);
		await nftVault.connect(user).borrow(index, borrowAmount, false);

		await expect(nftVault.connect(dao).liquidate(index, owner.address)).to.be.revertedWith(
			"InvalidPosition(" + index + ")"
		);

		// dao prepares 10 peth
		const prepareAmount = units(10);
		await weth.mint(dao.address, prepareAmount);
		await weth.connect(dao).approve(ethVault.address, prepareAmount);
		await ethVault.connect(dao).deposit(prepareAmount);
		await ethVault.connect(dao).borrow(prepareAmount);

		expect(await nftVault.isLiquidatable(index)).to.be.false;

		await floorOracle.updateAnswer(units(10));

		expect(await nftVault.isLiquidatable(index)).to.be.true;

		await expect(nftVault.connect(dao).liquidate(index, owner.address)).to.be.revertedWith(
			"ERC20: insufficient allowance"
		);

		await stablecoin.connect(dao).approve(nftVault.address, units(10));
		await nftVault.connect(dao).liquidate(index, owner.address);

		expect(await stablecoin.balanceOf(dao.address)).to.be.gt(0);

		expect(await erc721.ownerOf(index)).to.be.equal(owner.address);

		expect(await nftVault.positionOwner(index)).to.equal(ZERO_ADDRESS);

		// treat to change back eth price
		await floorOracle.updateAnswer(units(50));

		expect(await nftVault.openPositionsIndexes()).to.deep.equal([]);
		expect(await nftVault.totalPositions()).to.equal(0);
	});

	it("should be able to liquidate borrow position with insurance", async () => {
		const index = 6000;
		await erc721.mint(user.address, index);

		await erc721.connect(user).approve(nftVault.address, index);
		const borrowAmount = units(6);
		await nftVault.connect(user).borrow(index, borrowAmount, true);

		// dao prepares 10 peth
		const prepareAmount = units(10);
		await weth.mint(dao.address, prepareAmount);
		await weth.connect(dao).approve(ethVault.address, prepareAmount);
		await ethVault.connect(dao).deposit(prepareAmount);
		await ethVault.connect(dao).borrow(prepareAmount);

		await floorOracle.updateAnswer(units(10));

		await expect(nftVault.connect(dao).liquidate(index, owner.address)).to.be.revertedWith(
			"ERC20: insufficient allowance"
		);

		await stablecoin.connect(dao).approve(nftVault.address, units(10));
		await nftVault.connect(dao).liquidate(index, owner.address);

		await expect(nftVault.connect(dao).liquidate(index, owner.address)).to.be.revertedWith(
			"PositionLiquidated(" + index + ")"
		);

		expect(await erc721.ownerOf(index)).to.be.equal(nftVault.address);

		expect((await nftVault.positions(index)).liquidatedAt).to.be.gt(0);
		await expect(
			nftVault.connect(user).borrow(index, borrowAmount, false)
		).to.be.revertedWith("PositionLiquidated(" + index + ")");
		await expect(
			nftVault.connect(user).repay(index, borrowAmount)
		).to.be.revertedWith("PositionLiquidated(" + index + ")");

		await floorOracle.updateAnswer(units(50));

		expect(await nftVault.openPositionsIndexes()).to.deep.equal([
			BigNumber.from(index),
		]);
		expect(await nftVault.totalPositions()).to.equal(1);
	});

	it("shouldn't allow closing liquidated positions with insurance without repaying", async () => {
		const index = 6000;
		await erc721.mint(user.address, index);

		await erc721.connect(user).approve(nftVault.address, index);
		const borrowAmount = units(6);
		await nftVault.connect(user).borrow(index, borrowAmount, true);

		// dao prepares 10 peth
		const prepareAmount = units(10);
		await weth.mint(dao.address, prepareAmount);
		await weth.connect(dao).approve(ethVault.address, prepareAmount);
		await ethVault.connect(dao).deposit(prepareAmount);
		await ethVault.connect(dao).borrow(prepareAmount);

		await floorOracle.updateAnswer(units(10));

		await stablecoin.connect(dao).approve(nftVault.address, units(10));
		await nftVault.connect(dao).liquidate(index, owner.address);

		await expect(nftVault.connect(user).closePosition(index)).to.be.revertedWith("PositionLiquidated(" + index + ")");
	});

	it("should be able to repurchase", async () => {
		await expect(nftVault.repurchase(10001)).to.be.revertedWith("InvalidNFT(10001)");
		await erc721.mint(owner.address, 1);
		await expect(nftVault.repurchase(1)).to.be.revertedWith("Unauthorized()");

		const index = 5000;
		await erc721.mint(user.address, index);
		await erc721.connect(user).approve(nftVault.address, index);
		const borrowAmount = units(1).mul(10);
		await nftVault.connect(user).borrow(index, borrowAmount, true);

		const initialTimestamp = await currentTimestamp();

		await expect(nftVault.connect(user).repurchase(index)).to.be.revertedWith(
			"InvalidPosition(" + index + ")"
		);

		// dao prepares 25 peth
		const prepareAmount = units(25);
		await weth.mint(dao.address, prepareAmount);
		await weth.connect(dao).approve(ethVault.address, prepareAmount);
		await ethVault.connect(dao).deposit(prepareAmount);
		await ethVault.connect(dao).borrow(prepareAmount);

		await floorOracle.updateAnswer(units(10));

		await stablecoin.connect(dao).approve(nftVault.address, units(25));
		await nftVault.connect(dao).liquidate(index, owner.address);

		const elapsed = (await currentTimestamp()) - initialTimestamp;
		const totalDebt = borrowAmount.add(
			borrowAmount
				.mul(2)
				.mul(elapsed)
				.div(100)
				.div(86400 * 365)
		);
		const toRepurchase = totalDebt.add(totalDebt.mul(25).div(100));

		await stablecoin.connect(dao).transfer(user.address, toRepurchase);
		await stablecoin.connect(user).approve(nftVault.address, toRepurchase);

		await nftVault.connect(user).repurchase(index);

		expect(
			await stablecoin.allowance(user.address, nftVault.address)
		).to.be.closeTo(units(0), units(1) as any);

		expect(await nftVault.openPositionsIndexes()).to.deep.equal([]);
		expect(await nftVault.totalPositions()).to.equal(0);
	});

	it("should allow users to deposit NFTs in whitelisted strategies", async () => {
		const Flash = await ethers.getContractFactory("MockFlashStrategy");
		const flash = await Flash.deploy(erc721.address);
		const Standard = await ethers.getContractFactory("MockStandardStrategy")
		const standard = await Standard.deploy(erc721.address);

		await nftVault.connect(dao).addStrategy(flash.address);
		await nftVault.connect(dao).addStrategy(standard.address);

		const indexes = [100, 200];
		await erc721.mint(user.address, indexes[0]);
		await erc721.mint(user.address, indexes[1]);

		await erc721.connect(user).setApprovalForAll(nftVault.address, true);
		const borrowAmount = units(10);
		await nftVault.connect(user).borrow(indexes[0], borrowAmount, true);
		await nftVault.connect(user).borrow(indexes[1], borrowAmount, true);

		await flash.shouldSendBack(false);
		await expect(nftVault.connect(user).depositInStrategy(indexes, 0, "0x")).to.be.revertedWith("InvalidStrategy()");
		
		await flash.shouldSendBack(true);
		await nftVault.connect(user).depositInStrategy(indexes, 0, "0x");

		expect(await erc721.ownerOf(indexes[0])).to.equal(nftVault.address);
		expect(await erc721.ownerOf(indexes[1])).to.equal(nftVault.address);
		expect((await nftVault.positions(indexes[0])).strategy).to.equal(ZERO_ADDRESS);
		expect((await nftVault.positions(indexes[1])).strategy).to.equal(ZERO_ADDRESS);

		await standard.shouldSendBack(false);
		await nftVault.connect(user).depositInStrategy(indexes, 1, "0x");

		expect(await erc721.ownerOf(indexes[0])).to.equal(standard.address);
		expect(await erc721.ownerOf(indexes[1])).to.equal(standard.address);
		expect((await nftVault.positions(indexes[0])).strategy).to.equal(standard.address);
		expect((await nftVault.positions(indexes[1])).strategy).to.equal(standard.address);

		await expect(nftVault.connect(user).withdrawFromStrategy(indexes)).to.be.revertedWith("InvalidStrategy()");
		
		await standard.shouldSendBack(true);
		await nftVault.connect(user).withdrawFromStrategy(indexes);

		expect(await erc721.ownerOf(indexes[0])).to.equal(nftVault.address);
		expect(await erc721.ownerOf(indexes[1])).to.equal(nftVault.address);
		expect((await nftVault.positions(indexes[0])).strategy).to.equal(ZERO_ADDRESS);
		expect((await nftVault.positions(indexes[1])).strategy).to.equal(ZERO_ADDRESS);

		await nftVault.connect(user).depositInStrategy(indexes, 1, "0x");
		await stablecoin.connect(user).approve(nftVault.address, borrowAmount.mul(2));

		await nftVault.connect(user).repay(indexes[0], borrowAmount.mul(2));
		await nftVault.connect(user).closePosition(indexes[0]);

		expect(await erc721.ownerOf(indexes[0])).to.equal(user.address);
	});

	it("should allow users with NFTs deposited in standard strategies to use flash strategies", async () => {
		const Flash = await ethers.getContractFactory("MockFlashStrategy");
		const flash = await Flash.deploy(erc721.address);
		const Standard = await ethers.getContractFactory("MockStandardStrategy")
		const standard = await Standard.deploy(erc721.address);

		await nftVault.connect(dao).addStrategy(flash.address);
		await nftVault.connect(dao).addStrategy(standard.address);

		const index = 100;
		await erc721.mint(user.address, index);

		await erc721.connect(user).setApprovalForAll(nftVault.address, true);
		const borrowAmount = units(10);
		await nftVault.connect(user).borrow(index, borrowAmount, true);

		await nftVault.connect(user).depositInStrategy([index], 1, "0x");

		await expect(nftVault.connect(user).flashStrategyFromStandardStrategy([], 1, 0, "0x", "0x")).to.be.revertedWith("InvalidLength()");

		await expect(nftVault.connect(user).flashStrategyFromStandardStrategy([100], 0, 1, "0x", "0x")).to.be.revertedWith("InvalidStrategy()");

		await flash.shouldSendBack(false);
		await expect(nftVault.connect(user).flashStrategyFromStandardStrategy([100], 1, 0, "0x", "0x")).to.be.revertedWith("InvalidStrategy()");

		await flash.shouldSendBack(true);
		await nftVault.connect(user).flashStrategyFromStandardStrategy([100], 1, 0, "0x", "0x");
	});

	it("should be able to liquidate borrow position in strategy without insurance", async () => {
		const Standard = await ethers.getContractFactory("MockStandardStrategy")
		const standard = await Standard.deploy(erc721.address);
		await nftVault.connect(dao).addStrategy(standard.address);

		const index = 4000;
		await erc721.mint(user.address, index);

		await erc721.connect(user).approve(nftVault.address, index);

		const borrowAmount = units(10);
		await nftVault.connect(user).borrow(index, borrowAmount, false);

		await nftVault.connect(user).depositInStrategy([index], 0, "0x");

		const prepareAmount = units(20);
		await weth.mint(dao.address, prepareAmount);
		await weth.connect(dao).approve(ethVault.address, prepareAmount);
		await ethVault.connect(dao).deposit(prepareAmount);
		await ethVault.connect(dao).borrow(prepareAmount);;

		expect(await nftVault.isLiquidatable(index)).to.be.false;
		await floorOracle.updateAnswer(units(10));
		expect(await nftVault.isLiquidatable(index)).to.be.true;

		await stablecoin.connect(dao).approve(nftVault.address, units(30000));
		await nftVault.connect(dao).liquidate(index, owner.address);

		expect(await stablecoin.balanceOf(dao.address)).to.be.gt(0);

		expect(await erc721.ownerOf(index)).to.be.equal(owner.address);

		expect(await nftVault.positionOwner(index)).to.equal(ZERO_ADDRESS);

		expect(await nftVault.openPositionsIndexes()).to.deep.equal([]);
		expect(await nftVault.totalPositions()).to.equal(0);
	});

	it("should allow the liquidator to claim an nft with expired insurance", async () => {
		const index = 5000;
		await erc721.mint(user.address, index);
		await erc721.connect(user).approve(nftVault.address, index);
		const borrowAmount = units(1).mul(10);
		await nftVault.connect(user).borrow(index, borrowAmount, true);

		const initialTimestamp = await currentTimestamp();

		// dao prepares 25 peth
		const prepareAmount = units(25);
		await weth.mint(dao.address, prepareAmount);
		await weth.connect(dao).approve(ethVault.address, prepareAmount);
		await ethVault.connect(dao).deposit(prepareAmount);
		await ethVault.connect(dao).borrow(prepareAmount);

		await floorOracle.updateAnswer(units(10));

		await stablecoin.connect(dao).approve(nftVault.address, units(70000));
		await expect(
			nftVault.connect(dao).claimExpiredInsuranceNFT(index, owner.address)
		).to.be.revertedWith("InvalidPosition(" + index + ")");
		await nftVault.connect(dao).liquidate(index, owner.address);

		const elapsed = (await currentTimestamp()) - initialTimestamp;
		const totalDebt = borrowAmount.add(
			borrowAmount
				.mul(2)
				.mul(elapsed)
				.div(100)
				.div(86400 * 365)
		);
		const toRepurchase = totalDebt.add(totalDebt.mul(25).div(100));

		await stablecoin.connect(dao).transfer(user.address, toRepurchase);
		await stablecoin.connect(user).approve(nftVault.address, toRepurchase);

		await expect(
			nftVault.connect(dao).claimExpiredInsuranceNFT(index, owner.address)
		).to.be.revertedWith("PositionInsuranceNotExpired(" + index + ")");

		await timeTravel(86400 * 3);

		await expect(nftVault.connect(user).repurchase(index)).to.be.revertedWith(
			"PositionInsuranceExpired(" + index + ")"
		);

		await expect(nftVault.claimExpiredInsuranceNFT(index, owner.address)).to.be.revertedWith(
			"Unauthorized()"
		);

		await nftVault.connect(dao).claimExpiredInsuranceNFT(index, owner.address);
		expect(await erc721.ownerOf(index)).to.equal(owner.address);
		await expect(
			nftVault.connect(dao).claimExpiredInsuranceNFT(index, owner.address)
		).to.be.revertedWith("InvalidPosition(" + index + ")");

		expect(await nftVault.openPositionsIndexes()).to.deep.equal([]);
		expect(await nftVault.totalPositions()).to.equal(0);
	});

	it("should allow the router to forcefully close positions", async () => {
		const Standard = await ethers.getContractFactory("MockStandardStrategy")
		const standard = await Standard.deploy(erc721.address);
		await nftVault.connect(dao).addStrategy(standard.address);

		const index1 = 5000;
		const index2 = 5001;
		await erc721.mint(user.address, index1);
		await erc721.mint(user.address, index2);
		await erc721.connect(user).setApprovalForAll(nftVault.address, true);
		
		const borrowAmount = units(1).mul(10);

		await nftVault.connect(user).borrow(index1, borrowAmount, true);
		await nftVault.connect(user).borrow(index2, borrowAmount, true);

		await nftVault.connect(user).depositInStrategy([index2], 0, "0x");

		await expect(nftVault.forceClosePosition(owner.address, index1, owner.address)).to.be.revertedWith("Unauthorized()");

		await nftVault.forceClosePosition(user.address, index1, owner.address);

		expect(await erc721.ownerOf(index1)).to.equal(owner.address);
		expect(await nftVault.positionOwner(index1)).to.equal(ZERO_ADDRESS);
		expect(await nftVault.totalDebtAmount()).to.equal(borrowAmount.add(await nftVault.getDebtInterest(index2)));
		expect((await nftVault.openPositionsIndexes()).length).to.equal(1);

		await nftVault.forceClosePosition(user.address, index2, owner.address);

		expect(await erc721.ownerOf(index2)).to.equal(owner.address);
		expect(await nftVault.positionOwner(index2)).to.equal(ZERO_ADDRESS);
		expect(await nftVault.totalDebtAmount()).to.equal(0);
		expect((await nftVault.openPositionsIndexes()).length).to.equal(0);
	});

	it("should allow the router to import positions", async () => {
		const Standard = await ethers.getContractFactory("MockStandardStrategy")
		const standard = await Standard.deploy(erc721.address);

		const index1 = 5000;
		const index2 = 5001;
		await erc721.mint(user.address, index1);
		await erc721.mint(user.address, index2);
		await erc721.connect(user).setApprovalForAll(nftVault.address, true);
		
		const borrowAmount = units(1).mul(10);
		
		await expect(nftVault.importPosition(user.address, index1, units(4000).mul(1000), true, standard.address)).to.be.revertedWith("DebtCapReached()");
		await expect(nftVault.importPosition(user.address, index1, units(2000).mul(1000), true, standard.address)).to.be.revertedWith("InvalidAmount(" + units(2000).mul(1000).toString() + ")");
		await expect(nftVault.importPosition(user.address, index1, borrowAmount, true, standard.address)).to.be.revertedWith("InvalidStrategy()");

		await nftVault.connect(dao).addStrategy(standard.address);

		await expect(nftVault.importPosition(user.address, index1, borrowAmount, true, standard.address)).to.be.revertedWith("InvalidStrategy()");
		await erc721.connect(user).transferFrom(user.address, standard.address, index1);

		await nftVault.importPosition(user.address, index1, borrowAmount, true, standard.address);

		expect(await nftVault.positionOwner(index1)).to.equal(user.address);
		
		let position = await nftVault.positions(index1);

		expect(position.debtPrincipal).to.equal(borrowAmount);
		expect(position.borrowType).to.equal(2);
		expect(position.strategy).to.equal(standard.address);
		expect((await nftVault.openPositionsIndexes()).length).to.equal(1);
		expect(await nftVault.totalDebtAmount()).to.equal(borrowAmount.add(await nftVault.getDebtInterest(index1)));

		await expect(nftVault.importPosition(user.address, index1, borrowAmount, true, ZERO_ADDRESS)).to.be.revertedWith("Unauthorized()");
		await expect(nftVault.importPosition(user.address, index2, borrowAmount, true, ZERO_ADDRESS)).to.be.revertedWith("Unauthorized()");

		await erc721.connect(user).transferFrom(user.address, nftVault.address, index2);

		await nftVault.importPosition(user.address, index2, borrowAmount, true, ZERO_ADDRESS);

		expect(await nftVault.positionOwner(index2)).to.equal(user.address);
		
		position = await nftVault.positions(index2);

		expect(position.debtPrincipal).to.equal(borrowAmount);
		expect(position.borrowType).to.equal(2);
		expect(position.strategy).to.equal(ZERO_ADDRESS);
		expect((await nftVault.openPositionsIndexes()).length).to.equal(2);

		expect(await nftVault.totalDebtAmount()).to.equal(borrowAmount.mul(2).add(await nftVault.getDebtInterest(index1)).add(await nftVault.getDebtInterest(index2)));
	});

	it("should allow users to execute multiple actions in one call", async () => {
		const index1 = apes[2];
		const index2 = 7000;

		const borrowAmount1 = units(5);
		const borrowAmount2 = units(6);

		await erc721.mint(user.address, index1);
		await erc721.mint(user.address, index2);
		await erc721.connect(user).setApprovalForAll(nftVault.address, true);

		await jpeg.mint(user.address, units(36000));
		await jpeg.connect(user).approve(nftVault.address, units(36000));

		await stablecoin.connect(user).approve(nftVault.address, borrowAmount1);

		const abiCoder = new AbiCoder();

		await nftVault.connect(user).doActions(
			[0, 0, 1, 2],
			[
				abiCoder.encode(["uint256", "uint256", "bool"], [index1, borrowAmount1, true]),
				abiCoder.encode(["uint256", "uint256", "bool"], [index2, borrowAmount2, false]),
				abiCoder.encode(["uint256", "uint256"], [index1, borrowAmount2]),
				abiCoder.encode(["uint256"], [index1])
			]
		);

		expect((await nftVault.positions(index1)).debtPrincipal).to.equal(0);
		expect((await nftVault.positions(index2)).debtPrincipal).to.equal(borrowAmount2);

		expect((await erc721.ownerOf(index1))).to.equal(user.address);
	});

	it("organization is deducted from debt", async () => {
		const index = 8000;

		await erc721.mint(user.address, index);
		await erc721.connect(user).approve(nftVault.address, index);

		const balanceBefore = await stablecoin.balanceOf(user.address);
		await nftVault.connect(user).borrow(index, units(1).mul(10), false);
		expect(await stablecoin.balanceOf(user.address)).to.equal(
			balanceBefore.add(units(1).mul(10).mul(995).div(1000))
		);
	});

	it("insurance fee is deducted from debt", async () => {
		const index = 9000;

		await erc721.mint(user.address, index);
		await erc721.connect(user).approve(nftVault.address, index);

		const balanceBefore = await stablecoin.balanceOf(user.address);
		await nftVault.connect(user).borrow(index, units(1).mul(10), true);
		expect(await stablecoin.balanceOf(user.address)).to.equal(
			balanceBefore.add(units(1).mul(10).mul(985).div(1000))
		);
	});

	it("collect mints interest and send to dao", async () => {
		const index = 200;
		const borrowAmount = units(1).mul(10);
		await erc721.mint(user.address, index);
		await erc721.connect(user).approve(nftVault.address, index);
		await nftVault.connect(user).borrow(index, borrowAmount, true);
		await nftVault.connect(dao).collect();

		await timeTravel(days(1));

		let balanceBefore = await stablecoin.balanceOf(dao.address);
		await nftVault.connect(dao).collect();
		const mintedFee = (await stablecoin.balanceOf(dao.address)).sub(
			balanceBefore
		);
		checkAlmostSame(mintedFee, borrowAmount.mul(2).div(100).div(365));

		await stablecoin.connect(dao).transfer(user.address, mintedFee);

		// user prepares 10 peth to repay full (consider interest)
		const prepareAmount = units(10);
		await weth.mint(dao.address, prepareAmount);
		await weth.connect(dao).approve(ethVault.address, prepareAmount);
		await ethVault.connect(dao).deposit(prepareAmount);
		await ethVault.connect(dao).borrow(prepareAmount);
		await stablecoin.connect(dao).transfer(user.address, prepareAmount);

		// no fee transfer when repay after collect
		balanceBefore = await stablecoin.balanceOf(dao.address);
		await stablecoin
			.connect(user)
			.approve(nftVault.address, borrowAmount.add(mintedFee.mul(2)));
		await nftVault
			.connect(user)
			.repay(index, borrowAmount.add(mintedFee.mul(2)));
		expect(await stablecoin.balanceOf(dao.address)).to.equal(balanceBefore);

		expect((await nftVault.positions(index)).debtPrincipal).to.be.equal(0);
		expect(await nftVault.getDebtInterest(index)).to.be.equal(0);
	});
});
