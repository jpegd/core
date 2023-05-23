import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumberish } from "ethers";
import { ethers, upgrades } from "hardhat";
import {
    JPEG,
    JPEGCardsCigStaking,
    NFTValueProvider,
    TestERC721,
    UniswapV2MockOracle
} from "../types";
import { units, bn, timeTravel, setNextTimestamp, mineBlock } from "./utils";

const { expect } = chai;

chai.use(solidity);

const apeHash =
    "0x26bca2ecad19e981c90a8c6efd8ee9856bbc5a2042259e6ee31e310fdc08d970";
const minterRole =
    "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";
const zeroHash =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

const baseCreditLimitRate = [60, 100];
const baseLiquidationLimitRate = [70, 100];
const cigBoostRateIncrease = [10, 100];
const ltvBoostMaxRateIncrease = [20, 100];
const traitBoostLockRate = [35, 100];
const ltvBoostLockRate = [2_000, 10_000];
const ltvRateCap = [80, 100];
const liquidationRateCap = [81, 100];
const locksDecayPeriod = 86400;

const jpegPrice = bn("1000000000000000");
const floor = units(50);

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
        jpegOracle = await MockOracle.deploy(jpegPrice);
        await jpegOracle.deployed();

        const MockAggregator = await ethers.getContractFactory(
            "MockV3Aggregator"
        );
        const floorOracle = await MockAggregator.deploy(18, floor);
        await floorOracle.deployed();

        const JPEG = await ethers.getContractFactory("JPEG");

        jpeg = await JPEG.deploy(0);
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
                baseCreditLimitRate,
                baseLiquidationLimitRate,
                cigBoostRateIncrease,
                ltvBoostMaxRateIncrease,
                traitBoostLockRate,
                ltvBoostLockRate,
                ltvRateCap,
                liquidationRateCap,
                locksDecayPeriod
            ])
        );
        await nftValueProvider.deployed();

        await jpegOraclesAggregator.addFloorOracle(
            floorOracle.address,
            nftValueProvider.address
        );
    });

    it("should return the collection's floor price when calling getFloorETH", async () => {
        expect(await nftValueProvider.getFloorETH()).to.equal(floor);
    });

    it("should return the collection's floor price when calling getNFTValueETH with a floor NFT", async () => {
        expect(await nftValueProvider.getNFTValueETH(0)).to.equal(floor);
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
        ).to.equal(
            floor.mul(baseCreditLimitRate[0]).div(baseCreditLimitRate[1])
        );
        expect(
            await nftValueProvider.getLiquidationLimitETH(owner.address, 0)
        ).to.equal(
            floor
                .mul(baseLiquidationLimitRate[0])
                .div(baseLiquidationLimitRate[1])
        );
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

        const precision = 10_000;

        expect(
            (creditLimit[0].toNumber() * precision) / creditLimit[1].toNumber()
        ).to.equal(
            (baseCreditLimitRate[0] * precision) / baseCreditLimitRate[1] +
                (cigBoostRateIncrease[0] * precision) / cigBoostRateIncrease[1]
        );
        const liquidationLimit = await nftValueProvider.getLiquidationLimitRate(
            user.address,
            0
        );
        expect(
            (liquidationLimit[0].toNumber() * precision) /
                liquidationLimit[1].toNumber()
        ).to.equal(
            (baseLiquidationLimitRate[0] * precision) /
                baseLiquidationLimitRate[1] +
                (cigBoostRateIncrease[0] * precision) / cigBoostRateIncrease[1]
        );
    });

    it("should decrease credit and liquidation limits after unstaking cig", async () => {
        await cigStaking.unpause();

        await erc721.mint(user.address, 200);
        await erc721.connect(user).approve(cigStaking.address, 200);
        await cigStaking.connect(user).deposit(200);

        await cigStaking.connect(user).withdraw(200);

        expect(
            await nftValueProvider.getCreditLimitRate(user.address, 0)
        ).to.deep.equal([
            bn(baseCreditLimitRate[0]),
            bn(baseCreditLimitRate[1])
        ]);
        expect(
            await nftValueProvider.getLiquidationLimitRate(user.address, 0)
        ).to.deep.equal([
            bn(baseLiquidationLimitRate[0]),
            bn(baseLiquidationLimitRate[1])
        ]);
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

        const jpegToLock = floor
            .mul(10)
            .sub(floor)
            .mul(traitBoostLockRate[0])
            .div(traitBoostLockRate[1])
            .mul(units(1))
            .div(jpegPrice);

        await jpeg.mint(user.address, jpegToLock.mul(3));
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, jpegToLock.mul(3));

        await nftValueProvider.connect(user).applyTraitBoost(
            indexes,
            [0, 0, 0].map(() => timestamp + 1000)
        );

        expect(await nftValueProvider.getNFTValueETH(indexes[0])).to.equal(
            floor.mul(10)
        );

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            jpegToLock.mul(3)
        );

        await expect(
            nftValueProvider.withdrawTraitBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");
        await expect(
            nftValueProvider.connect(user).withdrawTraitBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");

        await timeTravel(1000 + locksDecayPeriod);

        expect(await nftValueProvider.getNFTValueETH(indexes[0])).to.equal(
            floor
        );
        expect(await nftValueProvider.getNFTValueETH(indexes[1])).to.equal(
            floor
        );
        expect(await nftValueProvider.getNFTValueETH(indexes[2])).to.equal(
            floor
        );

        await nftValueProvider
            .connect(user)
            .withdrawTraitBoost(indexes.slice(1));

        expect(await jpeg.balanceOf(user.address)).to.equal(jpegToLock.mul(2));
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            jpegToLock
        );
    });

    it("should allow users to lock JPEG to unlock LTV boosts", async () => {
        const indexes = [100, 101, 102];
        const rateIncreases = [1000, 500, 250];
        const boostedCreditLimitRates = rateIncreases.map(r => [
            baseCreditLimitRate[0] * 10_000 + r * baseCreditLimitRate[1],
            baseCreditLimitRate[1] * 10_000
        ]);
        const boostedLiquidationLimitRates = rateIncreases.map(r => [
            baseLiquidationLimitRate[0] * 10_000 +
                r * baseLiquidationLimitRate[1],
            baseLiquidationLimitRate[1] * 10_000
        ]);
        const jpegAmounts = boostedCreditLimitRates.map(b => {
            const baseCreditLimit = floor
                .mul(baseCreditLimitRate[0])
                .div(baseCreditLimitRate[1]);

            const boostedCreditLimit = floor.mul(b[0]).div(b[1]);

            return boostedCreditLimit
                .sub(baseCreditLimit)
                .mul(ltvBoostLockRate[0])
                .div(ltvBoostLockRate[1])
                .mul(units(1))
                .div(jpegPrice);
        });

        const totalJpegAmount = jpegAmounts.reduce((p, c) => p.add(c));

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
        ).to.be.revertedWith("InvalidRate()");

        await jpeg.mint(user.address, totalJpegAmount);
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, totalJpegAmount);

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

        const precision = 10_000;
        expect(
            creditLimitRate[0].mul(precision).div(creditLimitRate[1])
        ).to.equal(
            bn(boostedCreditLimitRates[0][0])
                .mul(precision)
                .div(boostedCreditLimitRates[0][1])
        );

        let liquidationLimitRate =
            await nftValueProvider.getLiquidationLimitRate(
                user.address,
                indexes[0]
            );
        expect(
            liquidationLimitRate[0].mul(precision).div(liquidationLimitRate[1])
        ).to.equal(
            bn(boostedLiquidationLimitRates[0][0])
                .mul(precision)
                .div(boostedLiquidationLimitRates[0][1])
        );

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            totalJpegAmount
        );

        await expect(
            nftValueProvider.withdrawLTVBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");
        await expect(
            nftValueProvider.connect(user).withdrawLTVBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");

        await timeTravel(1000 + locksDecayPeriod);

        creditLimitRate = await nftValueProvider.getCreditLimitRate(
            user.address,
            indexes[0]
        );
        expect(
            creditLimitRate[0].mul(precision).div(creditLimitRate[1])
        ).to.equal(
            bn(baseCreditLimitRate[0])
                .mul(precision)
                .div(baseCreditLimitRate[1])
        );

        liquidationLimitRate = await nftValueProvider.getLiquidationLimitRate(
            user.address,
            indexes[0]
        );
        expect(
            liquidationLimitRate[0].mul(precision).div(liquidationLimitRate[1])
        ).to.equal(
            bn(baseLiquidationLimitRate[0])
                .mul(precision)
                .div(baseLiquidationLimitRate[1])
        );

        await nftValueProvider.connect(user).withdrawLTVBoost(indexes.slice(1));

        expect(await jpeg.balanceOf(user.address)).to.equal(
            totalJpegAmount.sub(jpegAmounts[0])
        );
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            jpegAmounts[0]
        );
    });

    it("should apply both LTV and cig boosts to the same NFT", async () => {
        const indexes = [100];
        const ltvBoostNumerator = 2000;

        const ltvBoostRate = [
            baseCreditLimitRate[0] * 10_000 +
                ltvBoostNumerator * baseCreditLimitRate[1],
            10_000 * baseCreditLimitRate[1]
        ];
        const ltvJpegAmount = floor
            .mul(ltvBoostRate[0])
            .div(ltvBoostRate[1])
            .sub(floor.mul(baseCreditLimitRate[0]).div(baseCreditLimitRate[1]))
            .mul(ltvBoostLockRate[0])
            .div(ltvBoostLockRate[1])
            .mul(units(1))
            .div(jpegPrice);

        await jpeg.mint(user.address, ltvJpegAmount);
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, ltvJpegAmount);

        const timestamp = (await ethers.provider.getBlock("latest")).timestamp;

        await nftValueProvider
            .connect(user)
            .applyLTVBoost(indexes, [timestamp + 1000], [ltvBoostNumerator]);

        await cigStaking.unpause();

        await erc721.mint(user.address, 200);
        await erc721.connect(user).approve(cigStaking.address, 200);
        await cigStaking.connect(user).deposit(200);

        const precision = 10_000;

        let creditLimitRate = await nftValueProvider.getCreditLimitRate(
            user.address,
            indexes[0]
        );

        const ltvRateSum = [
            ltvBoostRate[0] * cigBoostRateIncrease[1] +
                cigBoostRateIncrease[0] * ltvBoostRate[1],
            ltvBoostRate[1] * cigBoostRateIncrease[1]
        ];

        const maxLTV = (ltvRateCap[0] * precision) / ltvRateCap[1];
        const ltvSum = (ltvRateSum[0] * precision) / ltvRateSum[1];

        let currentLTV;
        if (ltvSum > maxLTV) currentLTV = maxLTV;
        else currentLTV = ltvSum;

        expect(
            creditLimitRate[0].mul(precision).div(creditLimitRate[1])
        ).to.equal(currentLTV);

        let liquidationLimitRate =
            await nftValueProvider.getLiquidationLimitRate(
                user.address,
                indexes[0]
            );

        const liquidationRateSum = [
            baseLiquidationLimitRate[0] * 10_000 * cigBoostRateIncrease[1] +
                ltvBoostNumerator *
                    baseCreditLimitRate[1] *
                    cigBoostRateIncrease[1] +
                cigBoostRateIncrease[0] * baseCreditLimitRate[1] * 10_000,
            baseLiquidationLimitRate[1] * 10_000 * cigBoostRateIncrease[1]
        ];

        const maxLiquidation =
            (liquidationRateCap[0] * precision) / liquidationRateCap[1];
        const liquidationSum =
            (liquidationRateSum[0] * precision) / liquidationRateSum[1];

        let currentLiquidation;
        if (liquidationSum > maxLiquidation)
            currentLiquidation = maxLiquidation;
        else currentLiquidation = liquidationSum;

        expect(
            liquidationLimitRate[0].mul(precision).div(liquidationLimitRate[1])
        ).to.equal(currentLiquidation);

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            ltvJpegAmount
        );
    });

    it("should decay LTV boosts linearly", async () => {
        const index = 100;
        const ltvBoostNumerator = 2000;

        const ltvBoostRate = [
            baseCreditLimitRate[0] * 10_000 +
                ltvBoostNumerator * baseCreditLimitRate[1],
            10_000 * baseCreditLimitRate[1]
        ];
        const baseCreditLimit = floor
            .mul(baseCreditLimitRate[0])
            .div(baseCreditLimitRate[1]);

        const boostedCreditLimit = floor
            .mul(ltvBoostRate[0])
            .div(ltvBoostRate[1]);

        const creditLimitIncrease = boostedCreditLimit.sub(baseCreditLimit);

        const jpegAmount = creditLimitIncrease
            .mul(ltvBoostLockRate[0])
            .div(ltvBoostLockRate[1])
            .mul(units(1))
            .div(jpegPrice);

        await jpeg.mint(user.address, jpegAmount);
        await jpeg.connect(user).approve(nftValueProvider.address, jpegAmount);

        const endTimestamp =
            (await ethers.provider.getBlock("latest")).timestamp + 1000;

        await nftValueProvider
            .connect(user)
            .applyLTVBoost([index], [endTimestamp], [ltvBoostNumerator]);

        await setNextTimestamp(endTimestamp);
        await mineBlock();

        expect(
            await nftValueProvider.getCreditLimitRate(user.address, index)
        ).to.deep.equal([bn(ltvBoostRate[0]), bn(ltvBoostRate[1])]);

        expect(
            await nftValueProvider.getCreditLimitETH(user.address, index)
        ).to.equal(boostedCreditLimit);

        await setNextTimestamp(endTimestamp + locksDecayPeriod / 10);
        await mineBlock();

        expect(
            await nftValueProvider.getCreditLimitETH(user.address, index)
        ).to.equal(boostedCreditLimit.sub(creditLimitIncrease.div(10)));

        await setNextTimestamp(endTimestamp + locksDecayPeriod / 2);
        await mineBlock();

        expect(
            await nftValueProvider.getCreditLimitETH(user.address, index)
        ).to.equal(boostedCreditLimit.sub(creditLimitIncrease.div(2)));

        await setNextTimestamp(endTimestamp + (locksDecayPeriod * 9) / 10);
        await mineBlock();

        expect(
            await nftValueProvider.getCreditLimitETH(user.address, index)
        ).to.equal(boostedCreditLimit.sub(creditLimitIncrease.mul(9).div(10)));

        await setNextTimestamp(endTimestamp + locksDecayPeriod);
        await mineBlock();

        expect(
            await nftValueProvider.getCreditLimitETH(user.address, index)
        ).to.equal(baseCreditLimit);
    });

    it("should decay trait boosts linearly", async () => {
        const index = 100;

        await nftValueProvider.setNFTTypeMultiplier(apeHash, {
            numerator: 10,
            denominator: 1
        });
        await nftValueProvider.setNFTType([index], apeHash);

        const boostedValue = floor.mul(10);
        const valueIncrease = boostedValue.sub(floor);
        const jpegToLock = valueIncrease
            .mul(traitBoostLockRate[0])
            .div(traitBoostLockRate[1])
            .mul(units(1))
            .div(jpegPrice);

        await jpeg.mint(user.address, jpegToLock);
        await jpeg.connect(user).approve(nftValueProvider.address, jpegToLock);

        const endTimestamp =
            (await ethers.provider.getBlock("latest")).timestamp + 1000;

        await nftValueProvider
            .connect(user)
            .applyTraitBoost([index], [endTimestamp]);

        await setNextTimestamp(endTimestamp);
        await mineBlock();

        expect(await nftValueProvider.getNFTValueETH(index)).to.equal(
            boostedValue
        );

        await setNextTimestamp(endTimestamp + locksDecayPeriod / 10);
        await mineBlock();

        expect(await nftValueProvider.getNFTValueETH(index)).to.equal(
            boostedValue.sub(valueIncrease.div(10))
        );

        await setNextTimestamp(endTimestamp + locksDecayPeriod / 2);
        await mineBlock();

        expect(await nftValueProvider.getNFTValueETH(index)).to.equal(
            boostedValue.sub(valueIncrease.div(2))
        );

        await setNextTimestamp(endTimestamp + (locksDecayPeriod * 9) / 10);
        await mineBlock();

        expect(await nftValueProvider.getNFTValueETH(index)).to.equal(
            boostedValue.sub(valueIncrease.mul(9).div(10))
        );

        await setNextTimestamp(endTimestamp + locksDecayPeriod);
        await mineBlock();

        expect(await nftValueProvider.getNFTValueETH(index)).to.equal(floor);
    });

    it("should allow users to override trait locks", async () => {
        const indexes = [100, 101, 102];

        await nftValueProvider.setNFTTypeMultiplier(apeHash, {
            numerator: 10,
            denominator: 1
        });
        await nftValueProvider.setNFTType(indexes, apeHash);

        const jpegToLock = floor
            .mul(10)
            .sub(floor)
            .mul(traitBoostLockRate[0])
            .div(traitBoostLockRate[1])
            .mul(units(1))
            .div(jpegPrice);

        await jpeg.mint(user.address, jpegToLock);
        await jpeg.connect(user).approve(nftValueProvider.address, jpegToLock);

        const timestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await nftValueProvider
            .connect(user)
            .applyTraitBoost([indexes[0]], [timestamp + 1000]);

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            jpegToLock
        );

        await jpegOracle.setPrice(jpegPrice.mul(2));

        await jpeg.mint(user.address, jpegToLock);
        await jpeg.connect(user).approve(nftValueProvider.address, jpegToLock);

        await expect(
            nftValueProvider
                .connect(user)
                .applyTraitBoost([indexes[0]], [timestamp + 1000])
        ).to.be.revertedWith("InvalidUnlockTime(" + (timestamp + 1000) + ")");

        await nftValueProvider.connect(user).applyTraitBoost(
            indexes,
            [0, 0, 0].map(() => timestamp + 1001)
        );

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            jpegToLock.mul(2)
        );

        await jpegOracle.setPrice(jpegPrice);

        await nftValueProvider
            .connect(user)
            .applyTraitBoost([indexes[0]], [timestamp + 1002]);
        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            jpegToLock.mul(2)
        );

        await jpeg.mint(user.address, jpegToLock.div(2));
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, jpegToLock.div(2));

        await nftValueProvider
            .connect(user)
            .applyTraitBoost([indexes[1]], [timestamp + 1002]);

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            jpegToLock.mul(5).div(2)
        );

        await jpeg.mint(owner.address, jpegToLock);
        await jpeg.connect(owner).approve(nftValueProvider.address, jpegToLock);

        await nftValueProvider
            .connect(owner)
            .applyTraitBoost([indexes[2]], [timestamp + 1003]);

        expect(await jpeg.balanceOf(user.address)).to.equal(jpegToLock.div(2));
        expect(await jpeg.balanceOf(owner.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            jpegToLock.mul(3)
        );

        await jpegOracle.setPrice(jpegPrice.mul(2));
        await timeTravel(2000);

        await nftValueProvider.connect(user).applyTraitBoost(
            indexes,
            [0, 0, 0].map(() => timestamp + 3003)
        );
        expect(await jpeg.balanceOf(user.address)).to.equal(jpegToLock);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            jpegToLock.mul(3).div(2)
        );
        expect(await jpeg.balanceOf(owner.address)).to.equal(jpegToLock);
    });

    it("should allow users to override ltv locks", async () => {
        const indexes = [100, 101, 102];
        const rateIncreases = [1000, 500, 250];

        const boostedCreditLimitRates = rateIncreases.map(r => [
            baseCreditLimitRate[0] * 10_000 + r * baseCreditLimitRate[1],
            baseCreditLimitRate[1] * 10_000
        ]);
        const boostedLiquidationLimitRates = rateIncreases.map(r => [
            baseLiquidationLimitRate[0] * 10_000 +
                r * baseLiquidationLimitRate[1],
            baseLiquidationLimitRate[1] * 10_000
        ]);
        const jpegAmounts = boostedCreditLimitRates.map(b => {
            const baseCreditLimit = floor
                .mul(baseCreditLimitRate[0])
                .div(baseCreditLimitRate[1]);

            const boostedCreditLimit = floor.mul(b[0]).div(b[1]);

            return boostedCreditLimit
                .sub(baseCreditLimit)
                .mul(ltvBoostLockRate[0])
                .div(ltvBoostLockRate[1])
                .mul(units(1))
                .div(jpegPrice);
        });

        //const totalJpegAmount = jpegAmounts.reduce((p, c) => p.add(c));

        await jpeg.mint(user.address, jpegAmounts[0]);
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, jpegAmounts[0]);

        const timestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await nftValueProvider
            .connect(user)
            .applyLTVBoost(
                [indexes[0]],
                [timestamp + 1000],
                [rateIncreases[0]]
            );

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            jpegAmounts[0]
        );

        await jpegOracle.setPrice(jpegPrice.mul(2));

        await expect(
            nftValueProvider
                .connect(user)
                .applyLTVBoost(
                    [indexes[0]],
                    [timestamp + 1000],
                    [rateIncreases[0]]
                )
        ).to.be.revertedWith("InvalidUnlockTime(" + (timestamp + 1000) + ")");

        let currentJpegAmount = jpegAmounts[1].add(jpegAmounts[2]).div(2);

        await jpeg.mint(user.address, currentJpegAmount);
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, currentJpegAmount);

        await nftValueProvider.connect(user).applyLTVBoost(
            indexes,
            [0, 0, 0].map(() => timestamp + 1001),
            rateIncreases
        );

        currentJpegAmount = currentJpegAmount.add(jpegAmounts[0]);

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            currentJpegAmount
        );

        await jpegOracle.setPrice(jpegPrice);

        await nftValueProvider
            .connect(user)
            .applyLTVBoost(
                [indexes[0]],
                [timestamp + 1002],
                [rateIncreases[0]]
            );
        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            currentJpegAmount
        );

        await jpeg.mint(user.address, jpegAmounts[1].div(2));
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, jpegAmounts[1].div(2));

        await nftValueProvider
            .connect(user)
            .applyLTVBoost(
                [indexes[1]],
                [timestamp + 1002],
                [rateIncreases[1]]
            );

        currentJpegAmount = currentJpegAmount.add(jpegAmounts[1].div(2));

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            currentJpegAmount
        );

        await jpeg.mint(owner.address, jpegAmounts[2]);
        await jpeg.approve(nftValueProvider.address, jpegAmounts[2]);

        await nftValueProvider
            .connect(owner)
            .applyLTVBoost(
                [indexes[2]],
                [timestamp + 1003],
                [rateIncreases[2]]
            );

        currentJpegAmount = currentJpegAmount.add(jpegAmounts[2].div(2));

        expect(await jpeg.balanceOf(user.address)).to.equal(
            jpegAmounts[2].div(2)
        );
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            currentJpegAmount
        );
        expect(await jpeg.balanceOf(owner.address)).to.equal(0);

        await jpegOracle.setPrice(jpegPrice.mul(2));
        await timeTravel(2000);

        await nftValueProvider.connect(user).applyLTVBoost(
            indexes,
            [0, 0, 0].map(() => timestamp + 3003),
            rateIncreases
        );
        expect(await jpeg.balanceOf(user.address)).to.equal(
            currentJpegAmount.div(2).sub(jpegAmounts[2].div(2))
        );
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            currentJpegAmount.div(2)
        );
        expect(await jpeg.balanceOf(owner.address)).to.equal(jpegAmounts[2]);
    });

    it("should allow the owner to override floor price", async () => {
        await nftValueProvider.overrideFloor(units(10));
        expect(await nftValueProvider.getFloorETH()).to.equal(units(10));
        expect(await nftValueProvider.getNFTValueETH(0)).to.equal(units(10));
        await nftValueProvider.disableFloorOverride();
        expect(await nftValueProvider.getNFTValueETH(0)).to.equal(floor);
    });
});
