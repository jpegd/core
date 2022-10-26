import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, upgrades } from "hardhat";
import {
	JPEG,
	NFTValueProvider,
	UniswapV2MockOracle
} from "../types";
import {
	units,
	bn,
	timeTravel
} from "./utils";

const { expect } = chai;

chai.use(solidity);

const apeHash = "0x26bca2ecad19e981c90a8c6efd8ee9856bbc5a2042259e6ee31e310fdc08d970";
const minterRole = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";
const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("NFTValueProvider", () => {
	let owner: SignerWithAddress,
		user: SignerWithAddress;
	let nftValueProvider: NFTValueProvider,
		jpegOracle: UniswapV2MockOracle,
		jpeg: JPEG;

	beforeEach(async () => {
		const accounts = await ethers.getSigners();
		owner = accounts[0];
		user = accounts[1];

		const MockOracle = await ethers.getContractFactory("UniswapV2MockOracle");
		jpegOracle = await MockOracle.deploy(1000000000000000);
		await jpegOracle.deployed();

		const MockAggregator = await ethers.getContractFactory("MockV3Aggregator");
		const floorOracle = await MockAggregator.deploy(18, units(50));
		await floorOracle.deployed();

		const JPEG = await ethers.getContractFactory("JPEG");

		jpeg = await JPEG.deploy(units(1000000000));
		await jpeg.deployed();

		await jpeg.grantRole(minterRole, owner.address);

		const JPEGOraclesAggregator = await ethers.getContractFactory("JPEGOraclesAggregator");
        let jpegOraclesAggregator = await JPEGOraclesAggregator.deploy(jpegOracle.address);

		const NFTValueProvider = await ethers.getContractFactory("NFTValueProvider");
		nftValueProvider = <NFTValueProvider>await upgrades.deployProxy(NFTValueProvider, [
			jpeg.address,
			jpegOraclesAggregator.address,
			[8, 100],
			0
		]);
		await nftValueProvider.deployed();

		await jpegOraclesAggregator.addFloorOracle(floorOracle.address, nftValueProvider.address);
	});

	it("should return the collection's floor price when calling getFloorETH", async () => {
		expect(await nftValueProvider.getFloorETH()).to.equal(units(50));
	});

	it("should return the collection's floor price when calling getNFTValueETH with a floor NFT", async () => {
		expect(await nftValueProvider.getNFTValueETH(0)).to.equal(units(50));
	});

	it("should allow the owner to set an nft type and its multiplier", async () => {
		await expect(nftValueProvider.connect(user).setNFTType([0], apeHash)).to.be.revertedWith("Ownable: caller is not the owner");
		await expect(nftValueProvider.connect(user).setNFTTypeMultiplier(apeHash, { numerator: 10, denominator: 1})).to.be.revertedWith("Ownable: caller is not the owner");

		await nftValueProvider.setNFTTypeMultiplier(apeHash, { numerator: 10, denominator: 1});
		await nftValueProvider.setNFTType([0], apeHash);

		expect(await nftValueProvider.nftTypeValueMultiplier(apeHash)).to.deep.equal([bn(10), bn(1)]);
		expect(await nftValueProvider.nftTypes(0)).to.equal(apeHash);
	});

	it("should allow users to lock JPEG to unlock trait boosts", async () => {
		await expect(nftValueProvider.applyTraitBoost([0], [0])).to.be.revertedWith("InvalidNFTType(\"" + zeroHash + "\")");

		const indexes = [100, 101, 102];

		await nftValueProvider.setNFTTypeMultiplier(apeHash, { numerator: 10, denominator: 1});
		await nftValueProvider.setNFTType(indexes, apeHash);

		await expect(nftValueProvider.applyTraitBoost(indexes, [0, 0])).to.be.revertedWith("InvalidLength");
		await expect(nftValueProvider.applyTraitBoost(indexes, [0, 0, 0])).to.be.revertedWith("InvalidUnlockTime(0)");

		const timestamp = (await ethers.provider.getBlock("latest")).timestamp;

		await jpeg.mint(user.address, units(36000 * 3));
		await jpeg.connect(user).approve(nftValueProvider.address, units(36000 * 3));

		await nftValueProvider.connect(user).applyTraitBoost(indexes, [0, 0, 0].map(() => timestamp + 1000));

		expect(await nftValueProvider.getNFTValueETH(indexes[0])).to.equal(units(500));

		expect(await jpeg.balanceOf(user.address)).to.equal(0);
		expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(units(36000 * 3));

		await expect(nftValueProvider.unlockJPEG(indexes)).to.be.revertedWith("Unauthorized()");
		await expect(nftValueProvider.connect(user).unlockJPEG(indexes)).to.be.revertedWith("Unauthorized()");

		await timeTravel(1000);

		expect(await nftValueProvider.getNFTValueETH(indexes[0])).to.equal(units(50));
		expect(await nftValueProvider.getNFTValueETH(indexes[1])).to.equal(units(50));
		expect(await nftValueProvider.getNFTValueETH(indexes[2])).to.equal(units(50));

		await nftValueProvider.connect(user).unlockJPEG(indexes.slice(1));

		expect(await jpeg.balanceOf(user.address)).to.equal(units(36000 * 2));
		expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(units(36000));
	});


	it("should allow users to override JPEG locks", async () => {
		const indexes = [100, 101, 102];

		await nftValueProvider.setNFTTypeMultiplier(apeHash, { numerator: 10, denominator: 1});
		await nftValueProvider.setNFTType(indexes, apeHash);

		await jpeg.mint(user.address, units(72000));
		await jpeg.connect(user).approve(nftValueProvider.address, units(720000));

		const timestamp = (await ethers.provider.getBlock("latest")).timestamp;
		await nftValueProvider.connect(user).applyTraitBoost([indexes[0]], [timestamp + 1000]);

		expect(await jpeg.balanceOf(user.address)).to.equal(units(36000));
		expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(units(36000));

		await jpegOracle.setPrice(2000000000000000);

		await expect(nftValueProvider.connect(user).applyTraitBoost([indexes[0]], [timestamp + 1000])).to.be.revertedWith("InvalidUnlockTime(" + (timestamp + 1000) + ")");

		await nftValueProvider.connect(user).applyTraitBoost(indexes, [0, 0, 0].map(() => timestamp + 1001));

		expect(await jpeg.balanceOf(user.address)).to.equal(units(18000));
		expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(units(54000));

		await jpegOracle.setPrice(1000000000000000);

		await nftValueProvider.connect(user).applyTraitBoost([indexes[0]], [timestamp + 1002]);

		expect(await jpeg.balanceOf(user.address)).to.equal(0);
		expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(units(72000));

		await jpeg.mint(owner.address, units(36000));
		await jpeg.approve(nftValueProvider.address, units(36000));

		await nftValueProvider.applyTraitBoost([indexes[0]], [timestamp + 1003]);

		expect(await jpeg.balanceOf(user.address)).to.equal(units(36000));
		expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(units(72000));
		expect(await jpeg.balanceOf(owner.address)).to.equal(units(1000000000));
	});

	it("should allow the owner to override floor price", async () => {
		await nftValueProvider.overrideFloor(units(10));
		expect(await nftValueProvider.getFloorETH()).to.equal(units(10));
		expect(await nftValueProvider.getNFTValueETH(0)).to.equal(units(10));
		await nftValueProvider.disableFloorOverride();
		expect(await nftValueProvider.getNFTValueETH(0)).to.equal(units(50));
	  });
});
