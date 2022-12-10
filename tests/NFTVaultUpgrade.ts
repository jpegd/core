import { BigNumber } from "@ethersproject/bignumber";
import { JsonRpcSigner } from "@ethersproject/providers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { getProxyAdminFactory } from "@openzeppelin/hardhat-upgrades/dist/utils";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, network, upgrades } from "hardhat";

import hre from "hardhat";

import {
    NFTVault,
    StableCoin,
    IAggregatorV3Interface,
    IAggregatorV3Interface__factory,
    ERC721,
    NFTValueProvider,
    IERC721,
    IERC721__factory
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

const liquidator_role = "0x5e17fc5225d4a099df75359ce1f405503ca79498a8dc46a7d583235a0ee45c16";

describe("NFTVaultUpgrade", () => {
    let owner: SignerWithAddress,
        dao: JsonRpcSigner,
        user: JsonRpcSigner,
        liquidator: JsonRpcSigner;
    let nftVault: NFTVault,
        bayc: IERC721,
        ethOracle: IAggregatorV3Interface,
        floorOracle: IAggregatorV3Interface,
        nftValueProvider: NFTValueProvider,
        cards: ERC721,
        stablecoin: StableCoin,
        data: any;

    before(async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0x51C2cEF9efa48e08557A361B52DB34061c025a1B"],
        });

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0x54be3a794282c030b15e43ae2bb182e14c409c5e"],
        });

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0x59Bc9F79b3F91A90bfd286C9f8c4c8dE143b1963"],
        });

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0x36b3a78e141E0a9bB5Dff96a7963a916629190A0"],
        });

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xa80c3BC69a0b69a62E777a8ADA1E8807fF878a59"],
        });

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0x21f73D42Eb58Ba49dDB685dc29D3bF5c0f0373CA"],
        });

        const legacyDao = dao = ethers.provider.getSigner(
            "0xa80c3BC69a0b69a62E777a8ADA1E8807fF878a59"
        );

        dao = ethers.provider.getSigner(
            "0x51C2cEF9efa48e08557A361B52DB34061c025a1B"
        );

        user = ethers.provider.getSigner(
            "0x54be3a794282c030b15e43ae2bb182e14c409c5e"
        );

        const cardsHolder = ethers.provider.getSigner(
            "0x36b3a78e141E0a9bB5Dff96a7963a916629190A0"
        );

        liquidator = ethers.provider.getSigner(
            "0x59Bc9F79b3F91A90bfd286C9f8c4c8dE143b1963"
        );

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

        bayc = IERC721__factory.connect("0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D", ethers.provider);

        const CigStaking = await ethers.getContractFactory("JPEGCardsCigStaking");
        const cigStaking = CigStaking.attach("0xff9233825542977cd093e9ffb8f0fc526164d3b7");

        const Cards = await ethers.getContractFactory("ERC721");
        cards = Cards.attach("0x83979584ec8c6d94d93f838a524049173deba6f4")

        await cards.connect(cardsHolder).transferFrom(cardsHolder._address, user._address, 172);

        const StableCoin = await ethers.getContractFactory("StableCoin");
        stablecoin = StableCoin.attach("0x466a756e9a7401b5e2444a3fcb3c2c12fbea0a54");
        
        ethOracle = IAggregatorV3Interface__factory.connect("0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419", ethers.provider);
        floorOracle = IAggregatorV3Interface__factory.connect("0x0CA05B24795eb4f5bA5237e1D4470048cc0fE235", ethers.provider);

        nftValueProvider = <NFTValueProvider>await ethers.getContractAt("NFTValueProvider", "0x5b9cAA47A52e4BfbBce2f2A9f858c2A501B48C42")

        const ProxyAdmin = await getProxyAdminFactory(hre);
        const proxyAdmin = ProxyAdmin.attach("0x4156d093F5e6D649fCDccdBAB733782b726b13d7");

        const NFTVault = await ethers.getContractFactory("NFTVault");
        nftVault = NFTVault.attach("0x271c7603AAf2BD8F68e8Ca60f4A4F22c4920259f");

        const newImpl = (await upgrades.prepareUpgrade(nftVault.address, NFTVault)).toString();

        data = {
            nftValueProvider: await nftVault.nftValueProvider(),
            ethAggregator: await nftVault.ethAggregator(),
            nftContract: await nftVault.nftContract(),
            openPositionsIndexes: await nftVault.openPositionsIndexes(),
            positionOwner: await nftVault.positionOwner(364),
            settings: await nftVault.settings(),
            stablecoin: await nftVault.stablecoin(),
            totalDebtAmount: await nftVault.totalDebtAmount(),
            totalFeeCollected: await nftVault.totalFeeCollected(),
            totalPositions: await nftVault.totalPositions(),
        }

        await proxyAdmin.connect(dao).upgrade(nftVault.address, newImpl);

        await bayc.connect(user).setApprovalForAll(nftVault.address, true);
    });

    it("should have upgraded correctly", async () => {

        const upgradeData = {
            nftValueProvider: await nftVault.nftValueProvider(),
            ethAggregator: await nftVault.ethAggregator(),
            nftContract: await nftVault.nftContract(),
            openPositionsIndexes: await nftVault.openPositionsIndexes(),
            positionOwner: await nftVault.positionOwner(364),
            settings: await nftVault.settings(),
            stablecoin: await nftVault.stablecoin(),
            totalDebtAmount: await nftVault.totalDebtAmount(),
            totalFeeCollected: await nftVault.totalFeeCollected(),
            totalPositions: await nftVault.totalPositions(),
        }
        expect(upgradeData).to.deep.equal(data);
    });

    it("should be able to borrow", async () => {
        await expect(nftVault.borrow(10001, 100, false)).to.be.revertedWith(
            "ERC721: owner query for nonexistent token"
        );

        await expect(nftVault.borrow(1, 0, false)).to.be.revertedWith(
            "InvalidAmount(0)"
        );

        await expect(nftVault.borrow(1, 100, false)).to.be.revertedWith(
            "ERC721: transfer caller is not owner nor approved"
        );

        const positionsBefore = await nftVault.totalPositions();

        const index = 851;
        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();
        const borrowAmount = floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(35).div(100);

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

        expect(await nftVault.getCreditLimit(user._address, index)).to.equal(borrowAmount);
        expect((await nftVault.positions(index)).debtPrincipal).to.equal(borrowAmount.div(4).mul(2));
    });

    it("should be able to borrow with insurance", async () => {
        const index = 972;
        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();

        const borrowAmount = floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(35).div(100);
        await nftVault.connect(dao).collect();

        const stablecoinBalanceBefore = await stablecoin.balanceOf(user._address);
        const daoBalanceBefore = await stablecoin.balanceOf(dao._address);
        await nftVault.connect(user).borrow(index, borrowAmount, true);

        expect(await stablecoin.balanceOf(user._address)).to.be.closeTo(
            borrowAmount.mul(95).div(100).add(stablecoinBalanceBefore), 2
        );
        await nftVault.connect(dao).collect();
        checkAlmostSame(
            await stablecoin.balanceOf(dao._address),
            borrowAmount.mul(5).div(100).add(daoBalanceBefore)
        );
    });

    it("should be able to repay", async () => {
        await expect(nftVault.repay(10001, 100)).to.be.revertedWith("ERC721: owner query for nonexistent token");
        await expect(nftVault.repay(364, 100)).to.be.revertedWith("Unauthorized()");

        const index = 973;
        await expect(nftVault.connect(user).repay(index, 100)).to.be.revertedWith(
            "Unauthorized()"
        );

        await expect(nftVault.connect(user).repay(index, 100)).to.be.revertedWith(
            "Unauthorized()"
        );

        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();

        const borrowAmount = floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(35).div(100);

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

    it("should be able to close position", async () => {
        await expect(nftVault.closePosition(10001)).to.be.revertedWith(
            "ERC721: owner query for nonexistent token"
        );
        await expect(nftVault.closePosition(364)).to.be.revertedWith("Unauthorized()");

        const index = 974;
        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();

        const borrowAmount = floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(35).div(100);
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

        expect(await bayc.ownerOf(index)).to.be.equal(user._address);

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
            "ERC721: owner query for nonexistent token"
        );

        const index = 975;

        expect(await nftVault.positionOwner(index)).to.equal(ZERO_ADDRESS);

        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();

        const borrowAmount = floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(35).div(100);
        await nftVault.connect(user).borrow(index, borrowAmount, false);

        await expect(nftVault.connect(liquidator).liquidate(index, owner.address)).to.be.revertedWith(
            "InvalidPosition(" + index + ")"
        );

        expect(await nftVault.isLiquidatable(index)).to.be.equal(false);
        await nftValueProvider.connect(dao).overrideFloor(units(10));
        expect(await nftVault.isLiquidatable(index)).to.be.equal(true);

        await expect(nftVault.connect(liquidator).liquidate(index, owner.address)).to.be.revertedWith(
            "ERC20: insufficient allowance"
        );

        await stablecoin.connect(liquidator).approve(nftVault.address, borrowAmount.mul(2));
        await nftVault.connect(liquidator).liquidate(index, owner.address);

        expect(await bayc.ownerOf(index)).to.be.equal(owner.address);

        expect(await nftVault.positionOwner(index)).to.equal(ZERO_ADDRESS);

        await nftValueProvider.connect(dao).disableFloorOverride();
    });

    it("should be able to liquidate borrow position with insurance", async () => {
        const index = 976;
        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();

        const borrowAmount = floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(35).div(100);
        await nftVault.connect(user).borrow(index, borrowAmount, true);

        await nftValueProvider.connect(dao).overrideFloor(units(1));

        await stablecoin.connect(liquidator).approve(nftVault.address, borrowAmount.mul(2));
        await nftVault.connect(liquidator).liquidate(index, owner.address);

        await expect(nftVault.connect(liquidator).liquidate(index, owner.address)).to.be.revertedWith(
            "PositionLiquidated(" + index + ")"
        );

        expect(await bayc.ownerOf(index)).to.be.equal(nftVault.address);

        expect((await nftVault.positions(index)).liquidatedAt).to.be.gt(0);
        await expect(
            nftVault.connect(user).borrow(index, borrowAmount, false)
        ).to.be.revertedWith("PositionLiquidated(" + index + ")");
        await expect(
            nftVault.connect(user).repay(index, borrowAmount)
        ).to.be.revertedWith("PositionLiquidated(" + index + ")");

        await nftValueProvider.connect(dao).disableFloorOverride();
    });

    it("shouldn't allow closing liquidated positions with insurance without repaying", async () => {
        const index = 978;

        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();
        const borrowAmount = floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(35).div(100);
        await nftVault.connect(user).borrow(index, borrowAmount, true);

        await nftValueProvider.connect(dao).overrideFloor(units(10));

        await stablecoin.connect(liquidator).approve(nftVault.address, borrowAmount.mul(2));
        await nftVault.connect(liquidator).liquidate(index, owner.address);

        await expect(nftVault.connect(user).closePosition(index)).to.be.revertedWith("PositionLiquidated(" + index + ")");

        await nftValueProvider.connect(dao).disableFloorOverride();
    });

    it("should be able to repurchase", async () => {
        await expect(nftVault.repurchase(10001)).to.be.revertedWith("ERC721: owner query for nonexistent token");
        await expect(nftVault.repurchase(1)).to.be.revertedWith("Unauthorized()");
        
        const index = 979;

        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();

        const borrowAmount = floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(35).div(100);
        await nftVault.connect(user).borrow(index, borrowAmount, true);

        const initialTimestamp = await currentTimestamp();

        await expect(nftVault.connect(user).repurchase(index)).to.be.revertedWith(
            "InvalidPosition(" + index + ")"
        );

        await nftValueProvider.connect(dao).overrideFloor(units(10));

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

        await nftValueProvider.connect(dao).disableFloorOverride();
    });

    it("should allow users to deposit NFTs in whitelisted strategies", async () => {
		const Flash = await ethers.getContractFactory("MockFlashStrategy");
		const flash = await Flash.deploy(bayc.address);
		const Standard = await ethers.getContractFactory("MockStandardStrategy")
		const standard = await Standard.deploy(bayc.address);

		await nftVault.connect(dao).addStrategy(flash.address);
		await nftVault.connect(dao).addStrategy(standard.address);

		const indexes = [982, 983];

		const borrowAmount = units(30000);
		await nftVault.connect(user).borrow(indexes[0], borrowAmount, true);
		await nftVault.connect(user).borrow(indexes[1], borrowAmount, true);

		await flash.shouldSendBack(false);
		await expect(nftVault.connect(user).depositInStrategy(indexes, 0, "0x")).to.be.revertedWith("InvalidStrategy()");
		
		await flash.shouldSendBack(true);
		await nftVault.connect(user).depositInStrategy(indexes, 0, "0x");

		expect(await bayc.ownerOf(indexes[0])).to.equal(nftVault.address);
		expect(await bayc.ownerOf(indexes[1])).to.equal(nftVault.address);
		expect((await nftVault.positions(indexes[0])).strategy).to.equal(ZERO_ADDRESS);
		expect((await nftVault.positions(indexes[1])).strategy).to.equal(ZERO_ADDRESS);

		await standard.shouldSendBack(false);
		await nftVault.connect(user).depositInStrategy(indexes, 1, "0x");

		expect(await bayc.ownerOf(indexes[0])).to.equal(standard.address);
		expect(await bayc.ownerOf(indexes[1])).to.equal(standard.address);
		expect((await nftVault.positions(indexes[0])).strategy).to.equal(standard.address);
		expect((await nftVault.positions(indexes[1])).strategy).to.equal(standard.address);

		await expect(nftVault.connect(user).withdrawFromStrategy(indexes)).to.be.revertedWith("InvalidStrategy()");
		
		await standard.shouldSendBack(true);
		await nftVault.connect(user).withdrawFromStrategy(indexes);

		expect(await bayc.ownerOf(indexes[0])).to.equal(nftVault.address);
		expect(await bayc.ownerOf(indexes[1])).to.equal(nftVault.address);
		expect((await nftVault.positions(indexes[0])).strategy).to.equal(ZERO_ADDRESS);
		expect((await nftVault.positions(indexes[1])).strategy).to.equal(ZERO_ADDRESS);

		await nftVault.connect(user).depositInStrategy(indexes, 1, "0x");
		await stablecoin.connect(user).approve(nftVault.address, borrowAmount.mul(2));

		await nftVault.connect(user).repay(indexes[0], borrowAmount.mul(2));
		await nftVault.connect(user).closePosition(indexes[0]);

		expect(await bayc.ownerOf(indexes[0])).to.equal(user._address);
	}); 


    it("should allow the liquidator to claim an nft with expired insurance", async () => {
        const index = 980;

        const { answer: floorETH } = await floorOracle.latestRoundData();
        const { answer: ethPrice } = await ethOracle.latestRoundData();
        const decimals = await ethOracle.decimals();

        const borrowAmount = floorETH.mul(ethPrice).div(BigNumber.from(10).pow(decimals)).mul(35).div(100);
        await nftVault.connect(user).borrow(index, borrowAmount, true);

        const initialTimestamp = await currentTimestamp();

        await nftValueProvider.connect(dao).overrideFloor(units(10));

        await stablecoin.connect(liquidator).approve(nftVault.address, units(70000));
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

        await stablecoin.connect(liquidator).transfer(user._address, toRepurchase);
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
        expect(await bayc.ownerOf(index)).to.equal(owner.address);
        await expect(
            nftVault.connect(liquidator).claimExpiredInsuranceNFT(index, owner.address)
        ).to.be.revertedWith("InvalidPosition(" + index + ")");

        await nftValueProvider.connect(dao).disableFloorOverride();
    });
});
