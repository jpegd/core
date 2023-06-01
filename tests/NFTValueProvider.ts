import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber, BigNumberish } from "ethers";
import { ethers, upgrades } from "hardhat";
import {
    JPEG,
    JPEGCardsCigStaking,
    NFTValueProvider,
    TestERC721,
    UniswapV2MockOracle
} from "../types";
import {
    units,
    bn,
    timeTravel,
    setNextTimestamp,
    currentTimestamp
} from "./utils";

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
const ltvBoostMaxRateIncrease = [2000, 10000];
const traitBoostLockRate = [35, 100];
const ltvBoostLockRate = [2_000, 10_000];
const ltvRateCap = [80, 100];
const liquidationRateCap = [81, 100];
const locksReleaseDelay = 7 * 86400;

const jpegPrice = bn("1000000000000000");
const floor = units(50);

function sumRates(r1: BigNumberish[], ...remaining: BigNumberish[][]) {
    return remaining.reduce<BigNumber[]>(
        (p, c) => [p[0].mul(c[1]).add(p[1].mul(c[0])), p[1].mul(c[1])],
        [bn(r1[0]), bn(r1[1])]
    );
}

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
                locksReleaseDelay
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

        expect(
            await nftValueProvider.getCreditLimitRate(user.address, 0)
        ).to.deep.equal(sumRates(baseCreditLimitRate, cigBoostRateIncrease));

        expect(
            await nftValueProvider.getLiquidationLimitRate(user.address, 0)
        ).to.deep.equal(
            sumRates(baseLiquidationLimitRate, cigBoostRateIncrease)
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

    it("should allow users to lock JPEG for trait boosts", async () => {
        const indexes = [100, 101, 102];

        await nftValueProvider.setNFTTypeMultiplier(apeHash, {
            numerator: 10,
            denominator: 1
        });
        await nftValueProvider.setNFTType(indexes, apeHash);

        await expect(nftValueProvider.applyTraitBoost([])).to.be.revertedWith(
            "InvalidLength()"
        );

        await expect(nftValueProvider.applyTraitBoost([0])).to.be.revertedWith(
            'InvalidNFTType("' + zeroHash + '")'
        );

        const jpegToLock = floor
            .mul(10)
            .sub(floor)
            .mul(traitBoostLockRate[0])
            .div(traitBoostLockRate[1])
            .mul(units(1))
            .div(jpegPrice);

        expect(
            await nftValueProvider.calculateTraitBoostLock(apeHash, jpegPrice)
        ).to.equal(jpegToLock);

        await jpeg.mint(user.address, jpegToLock.mul(indexes.length));
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, jpegToLock.mul(indexes.length));

        await nftValueProvider.connect(user).applyTraitBoost(indexes);

        await expect(
            nftValueProvider.connect(user).applyTraitBoost(indexes)
        ).to.be.revertedWith(`LockExists(${indexes[0]})`);

        await expect(
            nftValueProvider.applyTraitBoost(indexes)
        ).to.be.revertedWith(`LockExists(${indexes[0]})`);

        expect(
            await Promise.all(
                indexes.map(i => nftValueProvider.traitBoostPositions(i))
            )
        ).to.deep.equal(
            new Array(indexes.length).fill([user.address, bn(0), jpegToLock])
        );

        expect(
            await Promise.all(
                indexes.map(i => nftValueProvider.getNFTValueETH(i))
            )
        ).to.deep.equal(new Array(indexes.length).fill(floor.mul(10)));

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            jpegToLock.mul(indexes.length)
        );

        await expect(
            nftValueProvider.withdrawTraitBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");
        await expect(
            nftValueProvider.connect(user).withdrawTraitBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");
    });

    it("should allow users to lock JPEG for LTV boosts", async () => {
        const indexes = [100, 101, 102];
        const rateIncreases = [1000, 500, 250];

        const boostedCreditLimitRates = rateIncreases.map(r =>
            sumRates([r, 10_000], baseCreditLimitRate)
        );
        const boostedLiquidationLimitRates = rateIncreases.map(r =>
            sumRates([r, 10_000], baseLiquidationLimitRate)
        );

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

        expect(
            await Promise.all(
                rateIncreases.map(r =>
                    nftValueProvider.calculateLTVBoostLock(jpegPrice, r)
                )
            )
        ).to.deep.equal(jpegAmounts);

        await expect(
            nftValueProvider.applyLTVBoost(indexes, [0])
        ).to.be.revertedWith("InvalidLength()");
        await expect(
            nftValueProvider.applyLTVBoost(indexes, [0, 0, 0])
        ).to.be.revertedWith("InvalidAmount(0)");
        await expect(
            nftValueProvider.applyLTVBoost(indexes, [11000, 0, 0])
        ).to.be.revertedWith("InvalidAmount(11000)");
        await expect(
            nftValueProvider.applyLTVBoost(indexes, [3000, 0, 0])
        ).to.be.revertedWith("InvalidRate()");

        await jpeg.mint(user.address, totalJpegAmount);
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, totalJpegAmount);

        await nftValueProvider
            .connect(user)
            .applyLTVBoost(indexes, rateIncreases);

        await expect(
            nftValueProvider.connect(user).applyLTVBoost(indexes, rateIncreases)
        ).to.be.revertedWith(`LockExists(${indexes[0]})`);

        await expect(
            nftValueProvider.applyLTVBoost(indexes, rateIncreases)
        ).to.be.revertedWith(`LockExists(${indexes[0]})`);

        expect(
            await Promise.all(
                indexes.map(i => nftValueProvider.ltvBoostPositions(i))
            )
        ).to.deep.equal(jpegAmounts.map(a => [user.address, bn(0), a]));

        expect(
            await Promise.all(
                indexes.map(i =>
                    nftValueProvider.getCreditLimitRate(user.address, i)
                )
            )
        ).to.deep.equal(boostedCreditLimitRates);

        expect(
            await Promise.all(
                indexes.map(i =>
                    nftValueProvider.getLiquidationLimitRate(user.address, i)
                )
            )
        ).to.deep.equal(boostedLiquidationLimitRates);

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            totalJpegAmount
        );

        await expect(
            nftValueProvider.connect(user).withdrawLTVBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");

        await expect(
            nftValueProvider.withdrawLTVBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");
    });

    it("should allow increasing LTV locks", async () => {
        const indexes = [100, 101, 102];

        const rateIncreases = [
            ltvBoostMaxRateIncrease[0],
            ltvBoostMaxRateIncrease[0] / 2,
            ltvBoostMaxRateIncrease[0] / 4
        ];

        const jpegAmounts = await Promise.all(
            rateIncreases.map(r =>
                nftValueProvider.calculateLTVBoostLock(jpegPrice, r)
            )
        );

        let totalJpegAmount = jpegAmounts.reduce((p, c) => p.add(c));

        await jpeg.mint(user.address, totalJpegAmount);
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, totalJpegAmount);

        await nftValueProvider
            .connect(user)
            .applyLTVBoost(indexes, rateIncreases);

        await expect(
            nftValueProvider.connect(user).applyLTVBoost(indexes, rateIncreases)
        ).to.be.revertedWith(`LockExists(${indexes[0]})`);

        let newIncreases = rateIncreases.map(r => r * 2);

        await expect(
            nftValueProvider.connect(user).applyLTVBoost(indexes, newIncreases)
        ).to.be.revertedWith("InvalidRate()");

        newIncreases = newIncreases.slice(1);

        const newJpegAmount = jpegAmounts.slice(1).reduce((p, c) => p.add(c));

        await jpeg.mint(user.address, newJpegAmount);
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, newJpegAmount);

        await nftValueProvider
            .connect(user)
            .applyLTVBoost(indexes.slice(1), newIncreases);

        expect(
            await Promise.all(
                indexes
                    .slice(1)
                    .map(i =>
                        nftValueProvider.getCreditLimitRate(user.address, i)
                    )
            )
        ).to.deep.equal(
            newIncreases.map(r => sumRates([r, 10_000], baseCreditLimitRate))
        );

        expect(await jpeg.balanceOf(user.address)).to.equal(0);

        await jpegOracle.setPrice(jpegPrice.mul(4));

        await expect(
            nftValueProvider
                .connect(user)
                .applyLTVBoost([indexes[1]], [newIncreases[0] * 2])
        ).to.be.revertedWith("InvalidRate()");

        await expect(
            nftValueProvider.applyLTVBoost([indexes[2]], [newIncreases[1] * 2])
        ).to.be.revertedWith(`LockExists(${indexes[2]})`);

        await nftValueProvider
            .connect(user)
            .applyLTVBoost([indexes[2]], [newIncreases[1] * 2]);

        expect(
            await nftValueProvider.getCreditLimitRate(user.address, indexes[1])
        ).to.deep.equal(
            sumRates([newIncreases[1] * 2, 10_000], baseCreditLimitRate)
        );
    });

    it("should allow queueing releases for trait boost locks", async () => {
        const indexes = [100, 101, 102];

        await nftValueProvider.setNFTTypeMultiplier(apeHash, {
            numerator: 10,
            denominator: 1
        });
        await nftValueProvider.setNFTType(indexes, apeHash);

        const jpegAmounts = await Promise.all(
            indexes.map(() =>
                nftValueProvider.calculateTraitBoostLock(apeHash, jpegPrice)
            )
        );

        const totalJpegAmount = jpegAmounts.reduce((p, c) => p.add(c));

        await jpeg.mint(user.address, totalJpegAmount);
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, totalJpegAmount);

        await nftValueProvider.connect(user).applyTraitBoost(indexes);

        await expect(
            nftValueProvider.queueTraitBoostRelease(indexes)
        ).to.be.revertedWith("Unauthorized()");

        const startTimestamp = (await currentTimestamp()) + 1;
        await setNextTimestamp(startTimestamp);

        await nftValueProvider.connect(user).queueTraitBoostRelease(indexes);

        await expect(
            nftValueProvider.connect(user).queueTraitBoostRelease(indexes)
        ).to.be.revertedWith("Unauthorized()");

        expect(
            await Promise.all(
                indexes.map(i => nftValueProvider.traitBoostPositions(i))
            )
        ).to.deep.equal(
            jpegAmounts.map(a => [
                user.address,
                bn(startTimestamp + locksReleaseDelay),
                a
            ])
        );

        await expect(
            nftValueProvider.connect(user).withdrawTraitBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");

        expect(
            await Promise.all(
                indexes.map(i => nftValueProvider.getNFTValueETH(i))
            )
        ).to.deep.equal(new Array(indexes.length).fill(floor.mul(10)));

        await timeTravel(locksReleaseDelay);

        expect(
            await Promise.all(
                indexes.map(i => nftValueProvider.getNFTValueETH(i))
            )
        ).to.deep.equal(new Array(indexes.length).fill(floor));

        await nftValueProvider
            .connect(user)
            .withdrawTraitBoost(indexes.slice(1));

        expect(await jpeg.balanceOf(user.address)).to.equal(
            totalJpegAmount.sub(jpegAmounts[0])
        );
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            jpegAmounts[0]
        );
    });

    it("should allow queueing releases for LTV boost locks", async () => {
        const indexes = [100, 101, 102];
        const rateIncreases = [1000, 500, 250];

        const jpegAmounts = await Promise.all(
            rateIncreases.map(r =>
                nftValueProvider.calculateLTVBoostLock(jpegPrice, r)
            )
        );

        const totalJpegAmount = jpegAmounts.reduce((p, c) => p.add(c));

        await jpeg.mint(user.address, totalJpegAmount);
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, totalJpegAmount);

        await nftValueProvider
            .connect(user)
            .applyLTVBoost(indexes, rateIncreases);

        let creditLimitRates = await Promise.all(
            indexes.map(i =>
                nftValueProvider.getCreditLimitRate(user.address, i)
            )
        );
        let liquidationLimitRates = await Promise.all(
            indexes.map(i =>
                nftValueProvider.getLiquidationLimitRate(user.address, i)
            )
        );

        await expect(
            nftValueProvider.queueLTVBoostRelease(indexes)
        ).to.be.revertedWith("Unauthorized()");

        const startTimestamp = (await currentTimestamp()) + 1;
        await setNextTimestamp(startTimestamp);

        await nftValueProvider.connect(user).queueLTVBoostRelease(indexes);

        await expect(
            nftValueProvider.connect(user).queueLTVBoostRelease(indexes)
        ).to.be.revertedWith("Unauthorized()");

        expect(
            await Promise.all(
                indexes.map(i =>
                    nftValueProvider.ltvBoostPositions(i).then(l => l.unlockAt)
                )
            )
        ).to.deep.equal(
            new Array(indexes.length).fill(
                bn(startTimestamp + locksReleaseDelay)
            )
        );

        await expect(
            nftValueProvider.connect(user).withdrawLTVBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");

        expect(
            await Promise.all(
                indexes.map(i =>
                    nftValueProvider.getCreditLimitRate(user.address, i)
                )
            )
        ).to.deep.equal(creditLimitRates);

        expect(
            await Promise.all(
                indexes.map(i =>
                    nftValueProvider.getLiquidationLimitRate(user.address, i)
                )
            )
        ).to.deep.equal(liquidationLimitRates);

        await timeTravel(locksReleaseDelay);

        expect(
            await Promise.all(
                indexes.map(i =>
                    nftValueProvider.getCreditLimitRate(user.address, i)
                )
            )
        ).to.deep.equal(
            new Array(indexes.length).fill(baseCreditLimitRate.map(n => bn(n)))
        );

        expect(
            await Promise.all(
                indexes.map(i =>
                    nftValueProvider.getLiquidationLimitRate(user.address, i)
                )
            )
        ).to.deep.equal(
            new Array(indexes.length).fill(
                baseLiquidationLimitRate.map(n => bn(n))
            )
        );

        await nftValueProvider.connect(user).withdrawLTVBoost(indexes.slice(1));

        expect(await jpeg.balanceOf(user.address)).to.equal(
            totalJpegAmount.sub(jpegAmounts[0])
        );
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            jpegAmounts[0]
        );
    });

    it("should allow cancelling queued releases for trait boost locks", async () => {
        const indexes = [100, 101, 102];

        await nftValueProvider.setNFTTypeMultiplier(apeHash, {
            numerator: 10,
            denominator: 1
        });
        await nftValueProvider.setNFTType(indexes, apeHash);

        const jpegAmounts = await Promise.all(
            indexes.map(() =>
                nftValueProvider.calculateTraitBoostLock(apeHash, jpegPrice)
            )
        );

        const totalJpegAmount = jpegAmounts.reduce((p, c) => p.add(c));

        await jpeg.mint(user.address, totalJpegAmount);
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, totalJpegAmount);

        await nftValueProvider.connect(user).applyTraitBoost(indexes);

        await expect(
            nftValueProvider.connect(user).cancelTraitBoostRelease(indexes)
        ).to.be.revertedWith("Unauthorized()");

        await nftValueProvider.connect(user).queueTraitBoostRelease(indexes);

        await nftValueProvider.connect(user).cancelTraitBoostRelease(indexes);

        await expect(
            nftValueProvider.connect(user).cancelTraitBoostRelease(indexes)
        ).to.be.revertedWith("Unauthorized()");

        expect(
            await Promise.all(
                indexes.map(i => nftValueProvider.traitBoostPositions(i))
            )
        ).to.deep.equal(jpegAmounts.map(a => [user.address, bn(0), a]));

        expect(
            await Promise.all(
                indexes.map(i => nftValueProvider.getNFTValueETH(i))
            )
        ).to.deep.equal(new Array(indexes.length).fill(floor.mul(10)));

        await expect(
            nftValueProvider.connect(user).withdrawTraitBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");

        await nftValueProvider.connect(user).queueTraitBoostRelease(indexes);

        await timeTravel(locksReleaseDelay);

        await expect(
            nftValueProvider.connect(user).cancelTraitBoostRelease(indexes)
        ).to.be.revertedWith("Unauthorized()");

        expect(
            await Promise.all(
                indexes.map(i => nftValueProvider.getNFTValueETH(i))
            )
        ).to.deep.equal(new Array(indexes.length).fill(floor));

        await nftValueProvider
            .connect(user)
            .withdrawTraitBoost(indexes.slice(1));

        expect(await jpeg.balanceOf(user.address)).to.equal(
            totalJpegAmount.sub(jpegAmounts[0])
        );
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            jpegAmounts[0]
        );
    });

    it("should allow cancelling queued releases for ltv boost locks", async () => {
        const indexes = [100, 101, 102];
        const rateIncreases = [1000, 500, 250];

        const jpegAmounts = await Promise.all(
            rateIncreases.map(r =>
                nftValueProvider.calculateLTVBoostLock(jpegPrice, r)
            )
        );

        const totalJpegAmount = jpegAmounts.reduce((p, c) => p.add(c));

        await jpeg.mint(user.address, totalJpegAmount);
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, totalJpegAmount);

        await nftValueProvider
            .connect(user)
            .applyLTVBoost(indexes, rateIncreases);

        await expect(
            nftValueProvider.connect(user).cancelLTVBoostRelease(indexes)
        ).to.be.revertedWith("Unauthorized()");

        await nftValueProvider.connect(user).queueLTVBoostRelease(indexes);

        await nftValueProvider.connect(user).cancelLTVBoostRelease(indexes);

        expect(
            await Promise.all(
                indexes.map(i => nftValueProvider.ltvBoostPositions(i))
            )
        ).to.deep.equal(jpegAmounts.map(a => [user.address, bn(0), a]));

        expect(
            await Promise.all(
                indexes.map(i =>
                    nftValueProvider.getCreditLimitRate(user.address, i)
                )
            )
        ).to.deep.equal(
            rateIncreases.map(r => sumRates([r, 10_000], baseCreditLimitRate))
        );

        expect(
            await Promise.all(
                indexes.map(i =>
                    nftValueProvider.getLiquidationLimitRate(user.address, i)
                )
            )
        ).to.deep.equal(
            rateIncreases.map(r =>
                sumRates([r, 10_000], baseLiquidationLimitRate)
            )
        );

        await expect(
            nftValueProvider.connect(user).withdrawLTVBoost(indexes)
        ).to.be.revertedWith("Unauthorized()");

        await nftValueProvider.connect(user).queueLTVBoostRelease(indexes);

        await timeTravel(locksReleaseDelay);

        expect(
            await Promise.all(
                indexes.map(i =>
                    nftValueProvider.getCreditLimitRate(user.address, i)
                )
            )
        ).to.deep.equal(
            new Array(indexes.length).fill(baseCreditLimitRate.map(n => bn(n)))
        );

        expect(
            await Promise.all(
                indexes.map(i =>
                    nftValueProvider.getLiquidationLimitRate(user.address, i)
                )
            )
        ).to.deep.equal(
            new Array(indexes.length).fill(
                baseLiquidationLimitRate.map(n => bn(n))
            )
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
        const indexes = [100, 101, 102];
        const rateIncreases = [2000, 1000, 500];

        const jpegAmounts = await Promise.all(
            rateIncreases.map(r =>
                nftValueProvider.calculateLTVBoostLock(jpegPrice, r)
            )
        );

        const totalJpegAmount = jpegAmounts.reduce((p, c) => p.add(c));
        await jpeg.mint(user.address, totalJpegAmount);
        await jpeg
            .connect(user)
            .approve(nftValueProvider.address, totalJpegAmount);

        await nftValueProvider
            .connect(user)
            .applyLTVBoost(indexes, rateIncreases);

        await cigStaking.unpause();

        await erc721.mint(user.address, 200);
        await erc721.connect(user).approve(cigStaking.address, 200);
        await cigStaking.connect(user).deposit(200);

        const creditLimitRates = await Promise.all(
            indexes.map(i =>
                nftValueProvider.getCreditLimitRate(user.address, i)
            )
        );

        const expectedCreditLimitRates = rateIncreases.map(r => {
            const rate = sumRates(
                [r, 10_000],
                baseCreditLimitRate,
                cigBoostRateIncrease
            );

            if (
                rate[0]
                    .mul(floor)
                    .div(rate[1])
                    .gt(floor.mul(ltvRateCap[0]).div(ltvRateCap[1]))
            )
                return [bn(ltvRateCap[0]), bn(ltvRateCap[1])];

            return rate;
        });

        expect(creditLimitRates).to.deep.equal(expectedCreditLimitRates);

        const liquidationLimitRates = await Promise.all(
            indexes.map(i =>
                nftValueProvider.getLiquidationLimitRate(user.address, i)
            )
        );

        const expectedLiquidationLimitRates = rateIncreases.map(r => {
            const rate = sumRates(
                [r, 10_000],
                baseLiquidationLimitRate,
                cigBoostRateIncrease
            );

            if (
                rate[0]
                    .mul(floor)
                    .div(rate[1])
                    .gt(
                        floor
                            .mul(liquidationRateCap[0])
                            .div(liquidationRateCap[1])
                    )
            )
                return [bn(liquidationRateCap[0]), bn(liquidationRateCap[1])];

            return rate;
        });

        expect(liquidationLimitRates).to.deep.equal(
            expectedLiquidationLimitRates
        );

        expect(await jpeg.balanceOf(user.address)).to.equal(0);
        expect(await jpeg.balanceOf(nftValueProvider.address)).to.equal(
            totalJpegAmount
        );
    });

    it("should allow the owner to override floor price", async () => {
        await nftValueProvider.overrideFloor(units(10));
        expect(await nftValueProvider.getFloorETH()).to.equal(units(10));
        expect(await nftValueProvider.getNFTValueETH(0)).to.equal(units(10));
        await nftValueProvider.disableFloorOverride();
        expect(await nftValueProvider.getNFTValueETH(0)).to.equal(floor);
    });
});
