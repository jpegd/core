import { BigNumber } from "@ethersproject/bignumber";
import { JsonRpcSigner } from "@ethersproject/providers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { getProxyAdminFactory } from "@openzeppelin/hardhat-upgrades/dist/utils";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, network, upgrades } from "hardhat";

import hre from "hardhat";

import {
    FungibleAssetVaultForDAO,
    JPEG,
    MockV3Aggregator,
    JPEGCardsCigStaking,
    NFTVault,
    StableCoin,
    CryptoPunksHelper,
    ERC20,
    IAggregatorV3Interface,
    IAggregatorV3Interface__factory,
    CryptoPunks,
    ERC721,
} from "../types";
import {
    units,
    checkAlmostSame,
    ZERO_ADDRESS,
    currentTimestamp,
    timeTravel
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
const apeHash =
    "0x26bca2ecad19e981c90a8c6efd8ee9856bbc5a2042259e6ee31e310fdc08d970";
const alienHash =
    "0x3f00f46bb8cf74b3f3e5365e6a583ab26c2d9cffcbff21b7c25fe510854bc81f";

describe("NFTVaultUpgrade", () => {
    let owner: SignerWithAddress,
        dao: JsonRpcSigner,
        user: JsonRpcSigner,
        liquidator: JsonRpcSigner;
    let nftVault: NFTVault,
        punks: CryptoPunks,
        usdcVault: FungibleAssetVaultForDAO,
        jpegOracle: MockV3Aggregator,
        ethOracle: IAggregatorV3Interface,
        usd_oracle: IAggregatorV3Interface,
        floorOracle: IAggregatorV3Interface,
        fallbackOracle: MockV3Aggregator,
        cards: ERC721,
        cigStaking: JPEGCardsCigStaking,
        usdc: ERC20,
        stablecoin: StableCoin,
        punksHelper: CryptoPunksHelper,
        jpeg: JPEG,
        data: any;

    before(async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0x51C2cEF9efa48e08557A361B52DB34061c025a1B"],
        });

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xb7f7f6c52f2e2fdb1963eab30438024864c313f6"],
        });

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0x59Bc9F79b3F91A90bfd286C9f8c4c8dE143b1963"],
        });

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0x641ea39410a28f3d035fbcd3758ab04789f88750"],
        });

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xa80c3BC69a0b69a62E777a8ADA1E8807fF878a59"],
        });

        const legacyDao = dao = ethers.provider.getSigner(
            "0xa80c3BC69a0b69a62E777a8ADA1E8807fF878a59"
        );


        dao = ethers.provider.getSigner(
            "0x51C2cEF9efa48e08557A361B52DB34061c025a1B"
        );

        user = ethers.provider.getSigner(
            "0xb7f7f6c52f2e2fdb1963eab30438024864c313f6"
        );

        const cardsHolder = ethers.provider.getSigner(
            "0x641ea39410a28f3d035fbcd3758ab04789f88750"
        );

        liquidator = ethers.provider.getSigner(
            "0x59Bc9F79b3F91A90bfd286C9f8c4c8dE143b1963"
        );

        await network.provider.send("hardhat_setCode", [user._address, "0x"]);
        await network.provider.send("hardhat_setCode", [liquidator._address, "0x"]);

        const accounts = await ethers.getSigners();
        owner = accounts[0];

        await owner.sendTransaction({
            to: user._address,
            value: ethers.utils.parseEther("50")
        });

        await owner.sendTransaction({
            to: cardsHolder._address,
            value: ethers.utils.parseEther("1")
        });

        await owner.sendTransaction({
            to: liquidator._address,
            value: ethers.utils.parseEther("1")
        });

        await owner.sendTransaction({
            to: legacyDao._address,
            value: ethers.utils.parseEther("1")
        });

        const Helper = await ethers.getContractFactory("CryptoPunksHelper");
        punksHelper = Helper.attach("0x810fdbc7E5Cfe998127a1f2Aa26f34E64e0364f4");

        const Punks = await ethers.getContractFactory("CryptoPunks");
        punks = Punks.attach("0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb");

        const CigStaking = await ethers.getContractFactory("JPEGCardsCigStaking");
        cigStaking = CigStaking.attach("0xff9233825542977cd093e9ffb8f0fc526164d3b7");

        const Cards = await ethers.getContractFactory("ERC721");
        cards = Cards.attach("0x83979584ec8c6d94d93f838a524049173deba6f4")

        await cards.connect(cardsHolder).transferFrom(cardsHolder._address, user._address, 418);

        const USDC = await ethers.getContractFactory("ERC20");
        usdc = USDC.attach("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")

        const StableCoin = await ethers.getContractFactory("StableCoin");
        stablecoin = StableCoin.attach("0x466a756e9a7401b5e2444a3fcb3c2c12fbea0a54");

        const MockAggregator = await ethers.getContractFactory("MockV3Aggregator");
        jpegOracle = await MockAggregator.deploy(8, 100000);

        ethOracle = IAggregatorV3Interface__factory.connect("0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419", ethers.provider);

        floorOracle = IAggregatorV3Interface__factory.connect("0x35f08e1b5a18f1f085aa092aaed10edd47457484", ethers.provider);

        fallbackOracle = await MockAggregator.deploy(18, units(10));

        usd_oracle = IAggregatorV3Interface__factory.connect("0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", ethers.provider);

        const JPEG = await ethers.getContractFactory("JPEG");

        jpeg = JPEG.attach("0xE80C0cd204D654CEbe8dd64A4857cAb6Be8345a3");

        const NFTVault = await ethers.getContractFactory("NFTVault");
        nftVault = NFTVault.attach("0xD636a2fC1C18A54dB4442c3249D5e620cf8fE98F");

        const newImpl = await NFTVault.deploy();

        const ProxyAdmin = await getProxyAdminFactory(hre);
        const proxyAdmin = ProxyAdmin.attach("0x4156d093F5e6D649fCDccdBAB733782b726b13d7");

        data = {
            cigStaking: await nftVault.cigStaking(),
            daoFloorOverride: await nftVault.daoFloorOverride(),
            ethAggregator: await nftVault.ethAggregator(),
            fallbackOracle: await nftVault.fallbackOracle(),
            floorOracle: await nftVault.floorOracle(),
            nftContract: await nftVault.nftContract(),
            openPositionsIndexes: await nftVault.openPositionsIndexes(),
            positionOwner: await nftVault.positionOwner(364),
            settings: await nftVault.settings(),
            stablecoin: await nftVault.stablecoin(),
            totalDebtAmount: await nftVault.totalDebtAmount(),
            totalFeeCollected: await nftVault.totalFeeCollected(),
            totalPositions: await nftVault.totalPositions(),
            useFallbackOracle: await nftVault.useFallbackOracle()
        }

        await proxyAdmin.connect(dao).upgradeAndCall(nftVault.address, newImpl.address, (await newImpl.populateTransaction.finalizeUpgrade(jpeg.address, [default_admin_role, apeHash, alienHash])).data);

        const FungibleAssetVaultForDAO = await ethers.getContractFactory(
            "FungibleAssetVaultForDAO"
        );
        usdcVault = FungibleAssetVaultForDAO.attach("0xFD110cf7985f6B7cAb4dc97dF1932495cADa9d08");

        await jpeg.connect(legacyDao).grantRole(minter_role, dao._address);
    });

    it("should have upgraded correctly", async () => {
        expect(await nftVault.jpeg()).to.equal(jpeg.address);

        const upgradeData = {
            cigStaking: await nftVault.cigStaking(),
            daoFloorOverride: await nftVault.daoFloorOverride(),
            ethAggregator: await nftVault.ethAggregator(),
            fallbackOracle: await nftVault.fallbackOracle(),
            floorOracle: await nftVault.floorOracle(),
            nftContract: await nftVault.nftContract(),
            openPositionsIndexes: await nftVault.openPositionsIndexes(),
            positionOwner: await nftVault.positionOwner(364),
            settings: await nftVault.settings(),
            stablecoin: await nftVault.stablecoin(),
            totalDebtAmount: await nftVault.totalDebtAmount(),
            totalFeeCollected: await nftVault.totalFeeCollected(),
            totalPositions: await nftVault.totalPositions(),
            useFallbackOracle: await nftVault.useFallbackOracle()
        }
        expect(upgradeData).to.deep.equal(data);
    });

    it("should be able to borrow", async () => {
        await expect(nftVault.borrow(10001, 100, false)).to.be.revertedWith(
            "InvalidNFT(10001)"
        );

        await expect(nftVault.borrow(1, 0, false)).to.be.revertedWith(
            "InvalidAmount(0)"
        );

        await expect(nftVault.borrow(1, 100, false)).to.be.revertedWith(
            "FlashEscrow: call_failed"
        );

        const positionsBefore = await nftVault.totalPositions();

        const index = 9976;
        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();

        const borrowAmount = floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(32).div(100);

        const { predictedAddress } = await punksHelper.precompute(user._address, index);

        await punks.connect(user).transferPunk(predictedAddress, index);

        await expect(
            nftVault.connect(user).borrow(index, borrowAmount.mul(2), false)
        ).to.be.revertedWith("InvalidAmount(" + borrowAmount.mul(2) + ")");

        await nftVault.connect(user).borrow(index, borrowAmount.div(4), false);

        await expect(
            nftVault.borrow(index, borrowAmount, false)
        ).to.be.revertedWith("Unauthorized()");

        await nftVault.connect(user).borrow(index, borrowAmount.div(4), false);

        expect(await nftVault.openPositionsIndexes()).to.deep.include.members([BigNumber.from(index.toString())]);
        expect(await nftVault.totalPositions()).to.equal(positionsBefore.add(1));

        expect(await nftVault.getCreditLimit(index)).to.equal(borrowAmount);
        expect((await nftVault.positions(index)).debtPrincipal).to.equal(borrowAmount.div(4).mul(2));
    });

    it("should be able to borrow with cig staked", async () => {
        const index = 7975;
        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();

        const positionsBefore = await nftVault.totalPositions();
        const stablecoinBalanceBefore = await stablecoin.balanceOf(user._address);

        const borrowAmount = floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(39).div(100);

        const { predictedAddress } = await punksHelper.precompute(user._address, index);

        await punks.connect(user).transferPunk(predictedAddress, index);

        await expect(
            nftVault.connect(user).borrow(index, borrowAmount, false)
        ).to.be.revertedWith("InvalidAmount(" + borrowAmount + ")");

        await cards.connect(user).approve(cigStaking.address, 418);
        await cigStaking.connect(user).deposit(418);

        await expect(
            nftVault.connect(user).borrow(index, borrowAmount.mul(2), false)
        ).to.be.revertedWith("InvalidAmount(" + borrowAmount.mul(2) + ")");

        await nftVault.connect(user).borrow(index, borrowAmount, false);

        expect(await stablecoin.balanceOf(user._address)).to.be.closeTo(
            borrowAmount.mul(995).div(1000).add(stablecoinBalanceBefore), 2
        );

        expect(await nftVault.openPositionsIndexes()).to.deep.include.members([
            BigNumber.from(index),
        ]);
        expect(await nftVault.totalPositions()).to.equal(positionsBefore.add(1));

        await cigStaking.connect(user).withdraw(418);
    });

    it("credit limit rate should go back to normal after unstaking cig", async () => {
        await cards.connect(user).approve(cigStaking.address, 418);
        await cigStaking.connect(user).deposit(418);

        const index = 4430;
        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();

        const borrowAmount = floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(39).div(100);
        const { predictedAddress } = await punksHelper.precompute(user._address, index);

        await punks.connect(user).transferPunk(predictedAddress, index);
        await nftVault.connect(user).borrow(index, borrowAmount, false);

        expect(await nftVault.isLiquidatable(index)).to.be.false;
        expect(await nftVault.getCreditLimit(index)).to.equal(borrowAmount);

        await cigStaking.connect(user).withdraw(418);

        expect(await nftVault.isLiquidatable(index)).to.be.true;
        expect(await nftVault.getCreditLimit(index)).to.equal(floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(32).div(100));
    });


    it("should be able to borrow with insurance", async () => {
        const index = 4557;
        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();

        const borrowAmount = floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(32).div(100);
        const { predictedAddress } = await punksHelper.precompute(user._address, index);

        await punks.connect(user).transferPunk(predictedAddress, index);

        await nftVault.connect(dao).collect();

        const stablecoinBalanceBefore = await stablecoin.balanceOf(user._address);
        const daoBalanceBefore = await stablecoin.balanceOf(dao._address);
        await nftVault.connect(user).borrow(index, borrowAmount, true);

        expect(await stablecoin.balanceOf(user._address)).to.be.closeTo(
            borrowAmount.mul(945).div(1000).add(stablecoinBalanceBefore), 2
        );
        await nftVault.connect(dao).collect();
        checkAlmostSame(
            await stablecoin.balanceOf(dao._address),
            borrowAmount.mul(55).div(1000).add(daoBalanceBefore)
        );
    });

    it("should be able to repay", async () => {
        await expect(nftVault.repay(10001, 100)).to.be.revertedWith("InvalidNFT(10001)");
        await expect(nftVault.repay(364, 100)).to.be.revertedWith("Unauthorized()");

        const index = 9992;
        await expect(nftVault.connect(user).repay(index, 100)).to.be.revertedWith(
            "Unauthorized()"
        );

        const { predictedAddress } = await punksHelper.precompute(user._address, index);

        await punks.connect(user).transferPunk(predictedAddress, index);

        await expect(nftVault.connect(user).repay(index, 100)).to.be.revertedWith(
            "Unauthorized()"
        );

        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();

        const borrowAmount = floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(32).div(100);

        const stablecoinBalanceBefore = await stablecoin.balanceOf(user._address);

        await nftVault.connect(user).borrow(index, borrowAmount, false);

        await expect(nftVault.connect(user).repay(index, 0)).to.be.revertedWith(
            "InvalidAmount(0)"
        );

        // pay half
        expect((await nftVault.positions(index)).debtPrincipal).to.be.equal(borrowAmount);

        await stablecoin
            .connect(user)
            .approve(nftVault.address, borrowAmount.div(2));
        await nftVault.connect(user).repay(index, borrowAmount.div(2));

        checkAlmostSame((await nftVault.positions(index)).debtPrincipal, borrowAmount.div(2));

        /*expect(stablecoinBalanceBefore.add(borrowAmount.div(2))).to.be.equal(
            await stablecoin.balanceOf(user._address)
        );*/

        // pay half again
        await stablecoin
            .connect(user)
            .approve(nftVault.address, ethers.constants.MaxUint256);
        await nftVault.connect(user).repay(index, ethers.constants.MaxUint256);

        expect((await nftVault.positions(index)).debtPrincipal).to.be.equal(0);

        checkAlmostSame(
            stablecoinBalanceBefore.sub(borrowAmount.mul(5).div(1000)),
            await stablecoin.balanceOf(user._address)
        );
    });


    it("should allow the DAO to toggle the fallback oracle", async () => {
        await expect(nftVault.connect(dao).toggleFallbackOracle(true)).to.be.revertedWith("");
        await expect(nftVault.connect(dao).setFallbackOracle(ZERO_ADDRESS)).to.be.revertedWith("ZeroAddress()");

        await nftVault.connect(dao).setFallbackOracle(fallbackOracle.address);
        await nftVault.connect(dao).toggleFallbackOracle(true);
        const fallbackValueETH = await nftVault.getNFTValueETH(0);
        expect(fallbackValueETH).to.equal(units(10));
        await nftVault.connect(dao).toggleFallbackOracle(false);
        const nftValueETH = await nftVault.getNFTValueETH(0);
        expect(nftValueETH).to.equal((await floorOracle.latestRoundData()).answer);
    });

    it("should be able to close position", async () => {
        await expect(nftVault.closePosition(10001)).to.be.revertedWith(
            "InvalidNFT(10001)"
        );
        await expect(nftVault.closePosition(364)).to.be.revertedWith("Unauthorized()");

        const index = 9218;
        const { predictedAddress } = await punksHelper.precompute(user._address, index);

        await punks.connect(user).transferPunk(predictedAddress, index);

        const borrowAmount = units(3000).mul(10);
        await nftVault.connect(user).borrow(index, borrowAmount, false);

        await expect(nftVault.connect(user).closePosition(index)).to.be.reverted;
        try {
            await nftVault.connect(user).closePosition(index)
        } catch (err: any) {
            //doing it this way so we can get the exact debt interest
            expect(err.toString()).to.contain("NonZeroDebt(" + borrowAmount.add(await nftVault.getDebtInterest(index)) + ")")
        }

        // full repay to close position
        await stablecoin
            .connect(user)
            .approve(nftVault.address, ethers.constants.MaxUint256);
        await nftVault.connect(user).repay(index, ethers.constants.MaxUint256);
        await nftVault.connect(user).closePosition(index);

        expect(await punks.punkIndexToAddress(index)).to.be.equal(user._address);

        expect(await nftVault.positionOwner(index)).to.equal(ZERO_ADDRESS);
    });


    it("should be able to liquidate borrow position without insurance", async () => {
        await expect(nftVault.connect(user).liquidate(10001, owner.address)).to.be.revertedWith(
            "AccessControl: account " +
            user._address.toLowerCase() +
            " is missing role " +
            liquidator_role
        );

        await expect(nftVault.connect(liquidator).liquidate(10001, owner.address)).to.be.revertedWith(
            "InvalidNFT(10001)"
        );

        const index = 9626;

        expect(await nftVault.positionOwner(index)).to.equal(ZERO_ADDRESS);

        const { predictedAddress } = await punksHelper.precompute(user._address, index);

        await punks.connect(user).transferPunk(predictedAddress, index);

        const borrowAmount = units(29000);
        await nftVault.connect(user).borrow(index, borrowAmount, false);

        await expect(nftVault.connect(liquidator).liquidate(index, owner.address)).to.be.revertedWith(
            "InvalidPosition(" + index + ")"
        );

        expect(await nftVault.isLiquidatable(index)).to.be.equal(false);
        // treat to change eth price
        await nftVault.connect(dao).toggleFallbackOracle(true);
        expect(await nftVault.isLiquidatable(index)).to.be.equal(true);

        await expect(nftVault.connect(liquidator).liquidate(index, owner.address)).to.be.revertedWith(
            "ERC20: insufficient allowance"
        );

        await stablecoin.connect(liquidator).approve(nftVault.address, units(30000));
        await nftVault.connect(liquidator).liquidate(index, owner.address);

        expect(await punks.punkIndexToAddress(index)).to.be.equal(owner.address);

        expect(await nftVault.positionOwner(index)).to.equal(ZERO_ADDRESS);

        await nftVault.connect(dao).toggleFallbackOracle(false);
    });

    it("should be able to liquidate borrow position with insurance", async () => {
        const index = 5152;
        const { predictedAddress } = await punksHelper.precompute(user._address, index);

        await punks.connect(user).transferPunk(predictedAddress, index);
        const borrowAmount = units(2000);
        await nftVault.connect(user).borrow(index, borrowAmount, true);

        await nftVault.connect(dao).toggleFallbackOracle(true);

        await fallbackOracle.updateAnswer(1e18.toString());

        await expect(nftVault.connect(liquidator).liquidate(index, owner.address)).to.be.revertedWith(
            "ERC20: insufficient allowance"
        );

        await stablecoin.connect(liquidator).approve(nftVault.address, units(30000));
        await nftVault.connect(liquidator).liquidate(index, owner.address);

        await expect(nftVault.connect(liquidator).liquidate(index, owner.address)).to.be.revertedWith(
            "PositionLiquidated(" + index + ")"
        );

        expect(await punks.punkIndexToAddress(index)).to.be.equal(punksHelper.address);

        expect((await nftVault.positions(index)).liquidatedAt).to.be.gt(0);
        await expect(
            nftVault.connect(user).borrow(index, borrowAmount, false)
        ).to.be.revertedWith("PositionLiquidated(" + index + ")");
        await expect(
            nftVault.connect(user).repay(index, borrowAmount)
        ).to.be.revertedWith("PositionLiquidated(" + index + ")");

        await nftVault.connect(dao).toggleFallbackOracle(false);
    });

    it("should be able to liquidate borrow position with staked cig", async () => {
        await cards.connect(user).approve(cigStaking.address, 418);
        await cigStaking.connect(user).deposit(418);

        const index = 4566;

        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();
        const borrowAmount = floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(39).div(100);
        const { predictedAddress } = await punksHelper.precompute(user._address, index);
        await punks.connect(user).transferPunk(predictedAddress, index);
        await nftVault.connect(user).borrow(index, borrowAmount, false);

        await expect(nftVault.connect(user).liquidate(10001, owner.address)).to.be.revertedWith(
            "AccessControl: account " +
            user._address.toLowerCase() +
            " is missing role " +
            liquidator_role
        );

        await expect(nftVault.connect(liquidator).liquidate(10001, owner.address)).to.be.revertedWith(
            "InvalidNFT(10001)"
        );

        await expect(nftVault.connect(liquidator).liquidate(index, owner.address)).to.be.revertedWith(
            "InvalidPosition(" + index + ")"
        );

        const liquidationCost = borrowAmount.add(units(1));

        await nftVault.connect(dao).toggleFallbackOracle(true);
        expect(await nftVault.isLiquidatable(index)).to.be.equal(true);

        await stablecoin.connect(liquidator).approve(nftVault.address, liquidationCost);
        await nftVault.connect(liquidator).liquidate(index, owner.address);

        expect(await punks.punkIndexToAddress(index)).to.be.equal(owner.address);

        expect(await nftVault.positionOwner(index)).to.equal(ZERO_ADDRESS);

        await nftVault.connect(dao).toggleFallbackOracle(false);
    });

    it("shouldn't allow closing liquidated positions with insurance without repaying", async () => {
        const index = 4377;
        const { predictedAddress } = await punksHelper.precompute(user._address, index);
        await punks.connect(user).transferPunk(predictedAddress, index);
        const borrowAmount = units(2000);
        await nftVault.connect(user).borrow(index, borrowAmount, true);

        await nftVault.connect(dao).toggleFallbackOracle(true);

        await stablecoin.connect(liquidator).approve(nftVault.address, units(30000));
        await nftVault.connect(liquidator).liquidate(index, owner.address);

        await expect(nftVault.connect(user).closePosition(index)).to.be.revertedWith("PositionLiquidated(" + index + ")");

        await nftVault.connect(dao).toggleFallbackOracle(false);
    });

    it("should be able to repurchase", async () => {
        await expect(nftVault.repurchase(10001)).to.be.revertedWith("InvalidNFT(10001)");
        await expect(nftVault.repurchase(1)).to.be.revertedWith("Unauthorized()");

        const index = 4350;
        const { predictedAddress } = await punksHelper.precompute(user._address, index);
        await punks.connect(user).transferPunk(predictedAddress, index);
        const borrowAmount = units(3000).mul(10);
        await nftVault.connect(user).borrow(index, borrowAmount, true);

        const initialTimestamp = await currentTimestamp();

        await expect(nftVault.connect(user).repurchase(index)).to.be.revertedWith(
            "InvalidPosition(" + index + ")"
        );

        await nftVault.connect(dao).toggleFallbackOracle(true);

        await stablecoin.connect(liquidator).approve(nftVault.address, units(70000));
        await nftVault.connect(liquidator).liquidate(index, owner.address);

        const elapsed = (await currentTimestamp()) - initialTimestamp;
        const totalDebt = borrowAmount.add(
            borrowAmount
                .mul(2)
                .mul(elapsed)
                .div(100)
                .div(86400 * 365)
        );
        const toRepurchase = totalDebt.add(totalDebt.mul(25).div(100));

        await stablecoin.connect(user).approve(nftVault.address, toRepurchase);

        await nftVault.connect(user).repurchase(index);

        expect(
            await stablecoin.allowance(user._address, nftVault.address)
        ).to.be.closeTo(units(0), units(1) as any);

        await nftVault.connect(dao).toggleFallbackOracle(false);
    });

    it("should allow the DAO to set JPEG oracle", async () => {
        await expect(nftVault.connect(dao).setJPEGAggregator(ZERO_ADDRESS)).to.be.revertedWith("ZeroAddress()");
        await nftVault.connect(dao).setJPEGAggregator(jpegOracle.address);
    });


    it("should allow the liquidator to claim an nft with expired insurance", async () => {
        const index = 4756;
        const { predictedAddress } = await punksHelper.precompute(user._address, index);
        await punks.connect(user).transferPunk(predictedAddress, index);
        const borrowAmount = units(3000).mul(10);
        await nftVault.connect(user).borrow(index, borrowAmount, true);

        const initialTimestamp = await currentTimestamp();

        await nftVault.connect(dao).toggleFallbackOracle(true);

        await stablecoin.connect(dao).approve(nftVault.address, units(70000));
        await expect(
            nftVault.connect(liquidator).claimExpiredInsuranceNFT(index, owner.address)
        ).to.be.revertedWith("InvalidPosition(" + index + ")");
        await nftVault.connect(liquidator).liquidate(index, owner.address);

        const elapsed = (await currentTimestamp()) - initialTimestamp;
        const totalDebt = borrowAmount.add(
            borrowAmount
                .mul(2)
                .mul(elapsed)
                .div(100)
                .div(86400 * 365)
        );
        const toRepurchase = totalDebt.add(totalDebt.mul(25).div(100));

        await stablecoin.connect(dao).transfer(user._address, toRepurchase);
        await stablecoin.connect(user).approve(nftVault.address, toRepurchase);

        await expect(
            nftVault.connect(liquidator).claimExpiredInsuranceNFT(index, owner.address)
        ).to.be.revertedWith("PositionInsuranceNotExpired(" + index + ")");

        await timeTravel(86400 * 3);

        await expect(nftVault.connect(user).repurchase(index)).to.be.revertedWith(
            "PositionInsuranceExpired(" + index + ")"
        );

        await expect(nftVault.claimExpiredInsuranceNFT(index, owner.address)).to.be.revertedWith(
            "Unauthorized()"
        );

        await nftVault.connect(liquidator).claimExpiredInsuranceNFT(index, owner.address);
        expect(await punks.punkIndexToAddress(index)).to.equal(owner.address);
        await expect(
            nftVault.connect(liquidator).claimExpiredInsuranceNFT(index, owner.address)
        ).to.be.revertedWith("InvalidPosition(" + index + ")");

        await nftVault.connect(dao).toggleFallbackOracle(false);
    });

    it("should allow users to lock JPEG to unlock trait boosts", async () => {
        await expect(nftVault.applyTraitBoost(0, 0)).to.be.revertedWith("InvalidNFTType(\"" + default_admin_role + "\")");

        const index = 6858;
        await nftVault.connect(dao).setNFTTypeMultiplier(apeHash, { numerator: 10, denominator: 1 });
        await nftVault.connect(dao).setNFTType([index], apeHash);

        const { predictedAddress } = await punksHelper.precompute(user._address, index);
        await punks.connect(user).transferPunk(predictedAddress, index);

        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();
        expect(await nftVault.getNFTValueUSD(index)).to.equal(floorETH.mul(ethPrice).div(10 ** decimals));

        await expect(nftVault.applyTraitBoost(index, 0)).to.be.revertedWith("InvalidUnlockTime(0)");

        const timestamp = (await ethers.provider.getBlock("latest")).timestamp;

        const jpegToLock = floorETH.mul(10 ** 8).mul(10).mul(32).div(100).mul(25).div(100).div(100000);

        await jpeg.connect(dao).mint(user._address, jpegToLock);
        await jpeg.connect(user).approve(nftVault.address, jpegToLock);

        await nftVault.connect(user).applyTraitBoost(index, timestamp + 1000);

        expect(await nftVault.getNFTValueUSD(index)).to.equal(floorETH.mul(10).mul(ethPrice).div(10 ** decimals));

        expect(await jpeg.balanceOf(user._address)).to.equal(0);
        expect(await jpeg.balanceOf(nftVault.address)).to.equal(jpegToLock);

        await expect(nftVault.unlockJPEG(index)).to.be.revertedWith("Unauthorized()");
        await expect(nftVault.connect(user).unlockJPEG(index)).to.be.revertedWith("Unauthorized()");

        await timeTravel(1000);

        expect(await nftVault.getNFTValueUSD(index)).to.equal(floorETH.mul(ethPrice).div(10 ** decimals));

        await nftVault.connect(user).unlockJPEG(index);
        await jpeg.connect(user).transfer(owner.address, await jpeg.balanceOf(user._address));
    });

    it("should allow users to override JPEG locks", async () => {
        const index = 6933;

        await nftVault.connect(dao).setNFTTypeMultiplier(apeHash, { numerator: 10, denominator: 1 });
        await nftVault.connect(dao).setNFTType([index], apeHash);

        const { answer: floorETH } = await floorOracle.latestRoundData();
        const jpegToLock = floorETH.mul(10 ** 8).mul(10).mul(32).div(100).mul(25).div(100).div(100000);

        await jpeg.connect(dao).mint(user._address, jpegToLock.mul(2));
        await jpeg.connect(user).approve(nftVault.address, jpegToLock.mul(100));

        const timestamp = (await ethers.provider.getBlock("latest")).timestamp;
        await nftVault.connect(user).applyTraitBoost(index, timestamp + 1000);

        expect(await jpeg.balanceOf(user._address)).to.equal(jpegToLock);
        expect(await jpeg.balanceOf(nftVault.address)).to.equal(jpegToLock);

        await jpegOracle.updateAnswer(200000);

        await expect(nftVault.connect(user).applyTraitBoost(index, timestamp + 1000)).to.be.revertedWith("InvalidUnlockTime(" + (timestamp + 1000) + ")");

        await nftVault.connect(user).applyTraitBoost(index, timestamp + 1001);

        expect(await jpeg.balanceOf(user._address)).to.equal(jpegToLock.mul(3).div(2));
        expect(await jpeg.balanceOf(nftVault.address)).to.equal(jpegToLock.div(2));

        await jpegOracle.updateAnswer(50000);

        await nftVault.connect(user).applyTraitBoost(index, timestamp + 1002);

        expect(await jpeg.balanceOf(user._address)).to.equal(0);
        expect(await jpeg.balanceOf(nftVault.address)).to.equal(jpegToLock.mul(2));

        const daoBalanceBefore = await jpeg.balanceOf(dao._address);

        await jpeg.connect(dao).mint(dao._address, jpegToLock.mul(2));
        await jpeg.connect(dao).approve(nftVault.address, jpegToLock.mul(2));

        await nftVault.connect(dao).applyTraitBoost(index, timestamp + 1003);

        expect(await jpeg.balanceOf(user._address)).to.equal(jpegToLock.mul(2));
        expect(await jpeg.balanceOf(nftVault.address)).to.equal(jpegToLock.mul(2));
        expect(await jpeg.balanceOf(dao._address)).to.equal(daoBalanceBefore);
    });


    it("organization is deducted from debt", async () => {
        const index = 1616;

        const { predictedAddress } = await punksHelper.precompute(user._address, index);
        await punks.connect(user).transferPunk(predictedAddress, index);

        const balanceBefore = await stablecoin.balanceOf(user._address);
        await nftVault.connect(user).borrow(index, units(3000).mul(10), false);
        expect(await stablecoin.balanceOf(user._address)).to.equal(
            balanceBefore.add(units(3000).mul(10).mul(995).div(1000))
        );
    });

    it("insurance fee is deducted from debt", async () => {
        const index = 1815;

        const { predictedAddress } = await punksHelper.precompute(user._address, index);
        await punks.connect(user).transferPunk(predictedAddress, index);

        const balanceBefore = await stablecoin.balanceOf(user._address);
        await nftVault.connect(user).borrow(index, units(3000).mul(10), true);
        expect(await stablecoin.balanceOf(user._address)).to.equal(
            balanceBefore.add(units(3000).mul(10).mul(945).div(1000))
        );
    });

    it("should allow the dao to override floor price", async () => {
        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();
        await nftVault.connect(dao).overrideFloor(units(10));
        expect(await nftVault.getNFTValueUSD(0)).to.equal(units(10).mul(ethPrice).div(10 ** decimals));
        await nftVault.connect(dao).disableFloorOverride();
        expect(await nftVault.getNFTValueUSD(0)).to.equal(floorETH.mul(ethPrice).div(10 ** decimals));
    });

    it("should allow the dao to set nftType", async () => {
        await expect(nftVault.setNFTType([0], apeHash)).to.be.revertedWith(
            "AccessControl: account " +
            owner.address.toLowerCase() +
            " is missing role " +
            dao_role
        );

        await expect(
            nftVault.connect(dao).setNFTType([0], dao_role)
        ).to.be.revertedWith("InvalidNFTType(\"" + dao_role + "\")");

        await nftVault.connect(dao).setNFTType([0], apeHash);
        const nftType = await nftVault.nftTypes(0);
        expect(nftType).to.equal(apeHash);
    });

    it("should allow the dao to set the value of an nft type", async () => {
        await expect(nftVault.setNFTTypeMultiplier(apeHash, { numerator: 100, denominator: 1 })).to.be.revertedWith(
            "AccessControl: account " +
            owner.address.toLowerCase() +
            " is missing role " +
            dao_role
        );

        await nftVault.connect(dao).setNFTTypeMultiplier(apeHash, { numerator: 100, denominator: 1 });
    });
});
