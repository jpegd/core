import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, upgrades } from "hardhat";
import {
    JPEG,
    JPEGCardsCigStaking,
    NFTValueProvider,
    TestERC721,
    UniswapV2MockOracle
} from "../types";
import { units, bn, timeTravel } from "./utils";

const { expect } = chai;

chai.use(solidity);

const apeHash =
    "0x26bca2ecad19e981c90a8c6efd8ee9856bbc5a2042259e6ee31e310fdc08d970";
const minterRole =
    "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";
const zeroHash =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("NFTValueProvider", () => {
    let owner: SignerWithAddress, user: SignerWithAddress;
    let nftValueProvider: NFTValueProvider,
        jpegOracle: UniswapV2MockOracle,
        cigStaking: JPEGCardsCigStaking,
        erc721: TestERC721,
        jpeg: JPEG;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user = accounts[1];

        const MockOracle = await ethers.getContractFactory(
            "UniswapV2MockOracle"
        );
        jpegOracle = await MockOracle.deploy(1000000000000000);
        await jpegOracle.deployed();

        const MockAggregator = await ethers.getContractFactory(
            "MockV3Aggregator"
        );
        const floorOracle = await MockAggregator.deploy(18, units(50));
        await floorOracle.deployed();

        const JPEG = await ethers.getContractFactory("JPEG");

        jpeg = await JPEG.deploy(units(1000000000));
        await jpeg.deployed();

        await jpeg.grantRole(minterRole, owner.address);

        const JPEGOraclesAggregator = await ethers.getContractFactory(
            "JPEGOraclesAggregator"
        );
        let jpegOraclesAggregator = await JPEGOraclesAggregator.deploy(
            jpegOracle.address
        );

        const ERC721 = await ethers.getContractFactory("TestERC721");
        erc721 = await ERC721.deploy();
        await erc721.deployed();

        const CigStaking = await ethers.getContractFactory(
            "JPEGCardsCigStaking"
        );
        cigStaking = await CigStaking.deploy(erc721.address, [200]);
        await cigStaking.deployed();

        const NFTValueProvider = await ethers.getContractFactory(
            "NFTValueProvider"
        );
        nftValueProvider = <NFTValueProvider>(
            await upgrades.deployProxy(NFTValueProvider, [
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
            ])
        );
        await nftValueProvider.deployed();

        await jpegOraclesAggregator.addFloorOracle(
            floorOracle.address,
            nftValueProvider.address
        );
    });

    it("should return the collection's floor price when calling getFloorETH", async () => {
        expect(await nftValueProvider.getFloorETH()).to.equal(units(50));
    });

    it("should return the collection's floor price when calling getNFTValueETH with a floor NFT", async () => {
        expect(await nftValueProvider.getNFTValueETH(0)).to.equal(units(50));
    });

    it("should allow the owner to set an nft type and its multiplier", async () => {
        await expect(
            nftValueProvider.connect(user).setNFTType([0], apeHash)
        ).to.be.revertedWith("Ownable: caller is not the owner");
        await expect(
            nftValueProvider.connect(user).setNFTTypeMultiplier(apeHash, {
                numerator: 10,
                denominator: 1
            })
        ).to.be.revertedWith("Ownable: caller is not the owner");

        await nftValueProvider.setNFTTypeMultiplier(apeHash, {
            numerator: 10,
            denominator: 1
        });
        await nftValueProvider.setNFTType([0], apeHash);

        expect(
            await nftValueProvider.nftTypeValueMultiplier(apeHash)
        ).to.deep.equal([bn(10), bn(1)]);
        expect(await nftValueProvider.nftTypes(0)).to.equal(apeHash);
    });

    it("should return the correct credit and liquidation limits", async () => {
        expect(
            await nftValueProvider.getCreditLimitETH(owner.address, 0)
        ).to.equal(units((50 * 32) / 100));
        expect(
            await nftValueProvider.getLiquidationLimitETH(owner.address, 0)
        ).to.equal(units((50 * 33) / 100));
    });

    it("should increase credit and liquidation limits after staking cig", async () => {
        await cigStaking.unpause();

        await erc721.mint(user.address, 200);
        await erc721.connect(user).approve(cigStaking.address, 200);
        await cigStaking.connect(user).deposit(200);

        const creditLimit = await nftValueProvider.getCreditLimitRate(
            user.address,
            0
        );
        expect(creditLimit[0].toNumber() / creditLimit[1].toNumber()).to.equal(
            0.39
        );
        const liquidationLimit = await nftValueProvider.getLiquidationLimitRate(
            user.address,
            0
        );
        expect(
            liquidationLimit[0].toNumber() / liquidationLimit[1].toNumber()
        ).to.equal(0.4);
    });

    it("should decrease credit and liquidation limits after unstaking cig", async () => {
        await cigStaking.unpause();

        await erc721.mint(user.address, 200);
        await erc721.connect(user).approve(cigStaking.address, 200);
        await cigStaking.connect(user).deposit(200);

        await cigStaking.connect(user).withdraw(200);

        expect(
            await nftValueProvider.getCreditLimitRate(user.address, 0)
        ).to.deep.equal([bn(32), bn(100)]);
        expect(
            await nftValueProvider.getLiquidationLimitRate(user.address, 0)
        ).to.deep.equal([bn(33), bn(100)]);
    });

    it("should allow users to lock JPEG to unlock trait boosts", async () => {
        const indexes = [100, 101, 102];

        await nftValueProvider.setNFTTypeMultiplier(apeHash, {
            numerator: 10,
            denominator: 1
        });
        await nftValueProvider.setNFTType(indexes, apeHash);

        await expect(
            nftValueProvider.applyTraitBoost(indexes, [0, 0])
        ).to.be.revertedWith("InvalidLength");
        await expect(
            nftValueProvider.applyTraitBoost(indexes, [0, 0, 0])
        ).to.be.revertedWith("InvalidUnlockTime(0)");

        const timestamp = (await ethers.provider.getBlock("latest")).timestamp;

        await expect(
            nftValueProvider.applyTraitBoost([0], [timestamp + 1000])
        ).to.be.revertedWith('InvalidNFTType("' + zeroHash + '")');

        await jpeg.mint(user.address, units(36000 * 3));
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, units(36000 * 3));

        await nftValueProvider.connect(user).applyTraitBoost(
            indexes,
            [0, 0, 0].map(() => timestamp + 1000)
        );

        expect(await nftValueProvider.getNFTValueETH(indexes[0])).to.equal(
            units(500)
        );

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(36000 * 3)
        );

        await expect(
            nftValueProvider.withdrawTraitBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");
        await expect(
            nftValueProvider.connect(user).withdrawTraitBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");

        await timeTravel(1000);

        expect(await nftValueProvider.getNFTValueETH(indexes[0])).to.equal(
            units(50)
        );
        expect(await nftValueProvider.getNFTValueETH(indexes[1])).to.equal(
            units(50)
        );
        expect(await nftValueProvider.getNFTValueETH(indexes[2])).to.equal(
            units(50)
        );

        await nftValueProvider
            .connect(user)
            .withdrawTraitBoost(indexes.slice(1));

        expect(await jpeg.balanceOf(user.address)).to.equal(units(36000 * 2));
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(36000)
        );
    });

    it("should allow users to lock JPEG to unlock LTV boosts", async () => {
        const indexes = [100, 101, 102];
        const rateIncreases = [1000, 500, 250];
        await expect(
            nftValueProvider.applyLTVBoost(indexes, [0, 0], rateIncreases)
        ).to.be.revertedWith("InvalidLength");
        await expect(
            nftValueProvider.applyLTVBoost(indexes, [0, 0, 0], rateIncreases)
        ).to.be.revertedWith("InvalidUnlockTime(0)");
        await expect(
            nftValueProvider.applyLTVBoost(indexes, [0, 0, 0], [0, 0, 0])
        ).to.be.revertedWith("InvalidAmount(0)");
        await expect(
            nftValueProvider.applyLTVBoost(indexes, [0, 0, 0], [11000, 0, 0])
        ).to.be.revertedWith("InvalidAmount(11000)");
        await expect(
            nftValueProvider.applyLTVBoost(indexes, [0, 0, 0], [3000, 0, 0])
        ).to.be.revertedWith("InvalidRate([3000, 10000])");

        const jpegAmount = units(500 + 250 + 125);
        await jpeg.mint(user.address, jpegAmount);
        await jpeg.connect(user).approve(nftValueProvider.address, jpegAmount);

        const timestamp = (await ethers.provider.getBlock("latest")).timestamp;

        await nftValueProvider.connect(user).applyLTVBoost(
            indexes,
            [0, 0, 0].map(() => timestamp + 1000),
            rateIncreases
        );

        let creditLimitRate = await nftValueProvider.getCreditLimitRate(
            user.address,
            indexes[0]
        );
        expect(
            creditLimitRate[0].toNumber() / creditLimitRate[1].toNumber()
        ).to.equal(0.42);
        let liquidationLimitRate =
            await nftValueProvider.getLiquidationLimitRate(
                user.address,
                indexes[0]
            );
        expect(
            liquidationLimitRate[0].toNumber() /
                liquidationLimitRate[1].toNumber()
        ).to.equal(0.43);

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            jpegAmount
        );

        await expect(
            nftValueProvider.withdrawLTVBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");
        await expect(
            nftValueProvider.connect(user).withdrawLTVBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");

        await timeTravel(1000);

        creditLimitRate = await nftValueProvider.getCreditLimitRate(
            user.address,
            indexes[0]
        );
        expect(
            creditLimitRate[0].toNumber() / creditLimitRate[1].toNumber()
        ).to.equal(0.32);
        liquidationLimitRate = await nftValueProvider.getLiquidationLimitRate(
            user.address,
            indexes[0]
        );
        expect(
            liquidationLimitRate[0].toNumber() /
                liquidationLimitRate[1].toNumber()
        ).to.equal(0.33);

        await nftValueProvider.connect(user).withdrawLTVBoost(indexes.slice(1));

        expect(await jpeg.balanceOf(user.address)).to.equal(units(250 + 125));
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(500)
        );
    });

    it("should apply both LTV and cig boosts to the same NFT", async () => {
        const indexes = [100];

        await jpeg.mint(user.address, units(500));
        await jpeg.connect(user).approve(nftValueProvider.address, units(500));

        const timestamp = (await ethers.provider.getBlock("latest")).timestamp;

        await nftValueProvider
            .connect(user)
            .applyLTVBoost(indexes, [timestamp + 1000], [1000]);

        await cigStaking.unpause();

        await erc721.mint(user.address, 200);
        await erc721.connect(user).approve(cigStaking.address, 200);
        await cigStaking.connect(user).deposit(200);

        let creditLimitRate = await nftValueProvider.getCreditLimitRate(
            user.address,
            indexes[0]
        );
        expect(
            creditLimitRate[0].toNumber() / creditLimitRate[1].toNumber()
        ).to.equal(0.49);
        let liquidationLimitRate =
            await nftValueProvider.getLiquidationLimitRate(
                user.address,
                indexes[0]
            );
        expect(
            liquidationLimitRate[0].toNumber() /
                liquidationLimitRate[1].toNumber()
        ).to.equal(0.5);

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(500)
        );
    });

    it("should allow users to override trait locks", async () => {
        const indexes = [100, 101, 102];

        await nftValueProvider.setNFTTypeMultiplier(apeHash, {
            numerator: 10,
            denominator: 1
        });
        await nftValueProvider.setNFTType(indexes, apeHash);

        await jpeg.mint(user.address, units(90000));
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, units(720000));

        const timestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await nftValueProvider
            .connect(user)
            .applyTraitBoost([indexes[0]], [timestamp + 1000]);

        expect(await jpeg.balanceOf(user.address)).to.equal(units(54000));
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(36000)
        );

        await jpegOracle.setPrice(2000000000000000);

        await expect(
            nftValueProvider
                .connect(user)
                .applyTraitBoost([indexes[0]], [timestamp + 1000])
        ).to.be.revertedWith("InvalidUnlockTime(" + (timestamp + 1000) + ")");

        await nftValueProvider.connect(user).applyTraitBoost(
            indexes,
            [0, 0, 0].map(() => timestamp + 1001)
        );

        expect(await jpeg.balanceOf(user.address)).to.equal(units(18000));
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(72000)
        );

        await jpegOracle.setPrice(1000000000000000);

        await nftValueProvider
            .connect(user)
            .applyTraitBoost([indexes[0]], [timestamp + 1002]);
        expect(await jpeg.balanceOf(user.address)).to.equal(units(18000));
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(72000)
        );

        await nftValueProvider
            .connect(user)
            .applyTraitBoost([indexes[1]], [timestamp + 1002]);

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(90000)
        );

        await jpeg.mint(owner.address, units(36000));
        await jpeg.approve(nftValueProvider.address, units(36000));

        await nftValueProvider.applyTraitBoost(
            [indexes[2]],
            [0].map(() => timestamp + 1003)
        );

        expect(await jpeg.balanceOf(user.address)).to.equal(units(18000));
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(108000)
        );
        expect(await jpeg.balanceOf(owner.address)).to.equal(units(1000000000));

        await jpegOracle.setPrice(2000000000000000);
        await timeTravel(2000);

        await nftValueProvider.connect(user).applyTraitBoost(
            indexes,
            [0, 0, 0].map(() => timestamp + 3003)
        );
        expect(await jpeg.balanceOf(user.address)).to.equal(units(36000));
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(54000)
        );
        expect(await jpeg.balanceOf(owner.address)).to.equal(units(1000036000));
    });

    it("should allow users to override ltv locks", async () => {
        const indexes = [100, 101, 102];
        const rateIncreases = [1000, 500, 250];

        await jpeg.mint(user.address, units(500 + 250 + 125));
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, units(720000));

        const timestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await nftValueProvider
            .connect(user)
            .applyLTVBoost(
                [indexes[0]],
                [timestamp + 1000],
                [rateIncreases[0]]
            );

        expect(await jpeg.balanceOf(user.address)).to.equal(units(250 + 125));
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(500)
        );

        await jpegOracle.setPrice(2000000000000000);

        await expect(
            nftValueProvider
                .connect(user)
                .applyLTVBoost(
                    [indexes[0]],
                    [timestamp + 1000],
                    [rateIncreases[0]]
                )
        ).to.be.revertedWith("InvalidUnlockTime(" + (timestamp + 1000) + ")");
        await expect(
            nftValueProvider
                .connect(user)
                .applyLTVBoost(
                    [indexes[0]],
                    [timestamp + 1001],
                    [rateIncreases[0] / 2]
                )
        ).to.be.revertedWith(
            "InvalidRate([" + rateIncreases[0] / 2 + ", 10000])"
        );

        await nftValueProvider.connect(user).applyLTVBoost(
            indexes,
            [0, 0, 0].map(() => timestamp + 1001),
            rateIncreases
        );

        expect(await jpeg.balanceOf(user.address)).to.equal(units(125 + 62.5));
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(500 + 125 + 62.5)
        );

        await jpegOracle.setPrice(1000000000000000);

        await nftValueProvider
            .connect(user)
            .applyLTVBoost(
                [indexes[0]],
                [timestamp + 1002],
                [rateIncreases[0]]
            );
        expect(await jpeg.balanceOf(user.address)).to.equal(units(125 + 62.5));
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(500 + 125 + 62.5)
        );

        await nftValueProvider
            .connect(user)
            .applyLTVBoost(
                [indexes[1]],
                [timestamp + 1002],
                [rateIncreases[1]]
            );

        expect(await jpeg.balanceOf(user.address)).to.equal(units(62.5));
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(500 + 250 + 62.5)
        );

        await jpeg.mint(owner.address, units(125));
        await jpeg.approve(nftValueProvider.address, units(125));

        await nftValueProvider.applyLTVBoost(
            [indexes[2]],
            [0].map(() => timestamp + 1003),
            [rateIncreases[2]]
        );

        expect(await jpeg.balanceOf(user.address)).to.equal(units(125));
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(500 + 250 + 125)
        );
        expect(await jpeg.balanceOf(owner.address)).to.equal(units(1000000000));

        await jpegOracle.setPrice(2000000000000000);
        await timeTravel(2000);

        await nftValueProvider.connect(user).applyLTVBoost(
            indexes,
            [0, 0, 0].map(() => timestamp + 3003),
            rateIncreases
        );
        expect(await jpeg.balanceOf(user.address)).to.equal(
            units(250 + 125 + 62.5)
        );
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            units(250 + 125 + 62.5)
        );
        expect(await jpeg.balanceOf(owner.address)).to.equal(units(1000000125));
    });

    it("should allow the owner to override floor price", async () => {
        await nftValueProvider.overrideFloor(units(10));
        expect(await nftValueProvider.getFloorETH()).to.equal(units(10));
        expect(await nftValueProvider.getNFTValueETH(0)).to.equal(units(10));
        await nftValueProvider.disableFloorOverride();
        expect(await nftValueProvider.getNFTValueETH(0)).to.equal(units(50));
    });
});
