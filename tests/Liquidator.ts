import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { ethers, upgrades } from "hardhat";
import { FakeContract, smock } from "@defi-wonderland/smock";
import {
    Liquidator,
    JPEGAuction,
    NFTVault,
    IAggregatorV3Interface,
    TestERC20,
    TestERC721,
    CryptoPunks,
    CryptoPunksHelper
} from "../types";
import { ZERO_ADDRESS, units } from "./utils";

chai.use(smock.matchers);

const { expect } = chai;

const nftIndex = 100;
describe("Liquidator", () => {
    let owner: SignerWithAddress, user: SignerWithAddress;
    let liquidator: Liquidator,
        auction: JPEGAuction,
        stablecoin: TestERC20,
        nft: TestERC721,
        punks: CryptoPunks,
        punksHelper: CryptoPunksHelper;
    let nftVault: FakeContract<NFTVault>,
        oracle: FakeContract<IAggregatorV3Interface>;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user = accounts[1];

        const ERC20 = await ethers.getContractFactory("TestERC20");
        stablecoin = await ERC20.deploy("", "");

        const ERC721 = await ethers.getContractFactory("TestERC721");
        nft = await ERC721.deploy();

        const Punks = await ethers.getContractFactory("CryptoPunks");
        punks = await Punks.deploy();

        const Helper = await ethers.getContractFactory("CryptoPunksHelper");
        punksHelper = <CryptoPunksHelper>(
            await upgrades.deployProxy(Helper, [punks.address])
        );

        const Auction = await ethers.getContractFactory("JPEGAuction");
        auction = <JPEGAuction>(
            await upgrades.deployProxy(Auction, [
                100,
                100,
                { numerator: 1, denominator: 100 }
            ])
        );

        const Liquidator = await ethers.getContractFactory("Liquidator");
        liquidator = <Liquidator>await upgrades.deployProxy(Liquidator, [], {
            constructorArgs: [auction.address]
        });

        nftVault = await smock.fake("NFTVault");
        oracle = await smock.fake("IAggregatorV3Interface");

        await auction.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["WHITELISTED_ROLE"]),
            liquidator.address
        );

        await punksHelper.transferOwnership(auction.address);
    });

    it("should allow the owner to add a NFTVault", async () => {
        nftVault.stablecoin.returns(stablecoin.address);

        await expect(
            liquidator.addNFTVault(ZERO_ADDRESS, ZERO_ADDRESS, false)
        ).to.be.revertedWithCustomError(liquidator, "ZeroAddress");

        await expect(
            liquidator.addNFTVault(nftVault.address, ZERO_ADDRESS, false)
        ).to.be.revertedWithCustomError(liquidator, "ZeroAddress");

        await liquidator.addNFTVault(nftVault.address, nft.address, false);

        let info = await liquidator.vaultInfo(nftVault.address);

        expect(info.stablecoin).to.equal(stablecoin.address);
        expect(info.nftOrWrapper).to.equal(nft.address);
        expect(info.isWrapped).to.be.false;

        await liquidator.removeNFTVault(nftVault.address);

        info = await liquidator.vaultInfo(nftVault.address);

        expect(info.stablecoin).to.equal(ZERO_ADDRESS);
        expect(info.nftOrWrapper).to.equal(ZERO_ADDRESS);
        expect(info.isWrapped).to.be.false;
    });

    it("should allow the owner to set a stablecoin oracle", async () => {
        await expect(
            liquidator.setOracle(ZERO_ADDRESS, ZERO_ADDRESS)
        ).to.be.revertedWithCustomError(liquidator, "ZeroAddress");

        await expect(
            liquidator.setOracle(stablecoin.address, ZERO_ADDRESS)
        ).to.be.revertedWithCustomError(liquidator, "ZeroAddress");

        oracle.decimals.returns(18);

        await liquidator.setOracle(stablecoin.address, oracle.address);

        const info = await liquidator.stablecoinOracle(stablecoin.address);

        expect(info.oracle).to.equal(oracle.address);
        expect(info.decimals).to.equal(18);
    });

    it("should revert on unknown NFTVaults", async () => {
        await expect(
            liquidator.liquidate([], nftVault.address)
        ).to.be.revertedWithCustomError(liquidator, "UnknownVault");

        await expect(
            liquidator.claimExpiredInsuranceNFT([], nftVault.address)
        ).to.be.revertedWithCustomError(liquidator, "UnknownVault");
    });

    it("should revert on invalid calls", async () => {
        nftVault.stablecoin.returns(stablecoin.address);
        await liquidator.addNFTVault(nftVault.address, nft.address, false);

        await expect(
            liquidator.liquidate([], nftVault.address)
        ).to.be.revertedWithCustomError(liquidator, "InvalidLength");

        await expect(
            liquidator.claimExpiredInsuranceNFT([], nftVault.address)
        ).to.be.revertedWithCustomError(liquidator, "InvalidLength");
    });

    describe("Unwrapped NFTs", () => {
        beforeEach(async () => {
            await nft.mint(liquidator.address, nftIndex);

            nftVault.stablecoin.returns(stablecoin.address);
            await liquidator.addNFTVault(nftVault.address, nft.address, false);
        });

        describe("Uninsured", () => {
            beforeEach(async () => {
                nftVault.positions.whenCalledWith(nftIndex).returns({
                    borrowType: 1,
                    debtPrincipal: units(100),
                    debtPortion: 0,
                    debtAmountForRepurchase: 0,
                    liquidatedAt: 0,
                    liquidator: ZERO_ADDRESS,
                    strategy: ZERO_ADDRESS
                });
                nftVault.getDebtInterest.returns(units(1));
            });

            describe("Without stablecoin oracle", () => {
                it("should start auction on liquidation", async () => {
                    await liquidator.liquidate([nftIndex], nftVault.address);

                    expect(nftVault.liquidate).to.have.been.calledOnceWith(
                        nftIndex,
                        liquidator.address
                    );

                    const auctionData = await auction.auctions(0);
                    expect(auctionData.nftAddress).to.equal(nft.address);
                    expect(auctionData.nftIndex).to.equal(nftIndex);
                    expect(auctionData.minBid).to.equal(units(101));

                    expect(await nft.ownerOf(nftIndex)).to.equal(
                        auction.address
                    );
                });
            });

            describe("With stablecoin oracle", () => {
                beforeEach(async () => {
                    oracle.decimals.returns(8);
                    oracle.latestRoundData.returns({
                        roundId: 0,
                        answer: 100e8,
                        startedAt: 0,
                        updatedAt: 0,
                        answeredInRound: 0
                    });

                    await liquidator.setOracle(
                        stablecoin.address,
                        oracle.address
                    );
                });

                it("should start auction on liquidation", async () => {
                    await liquidator.liquidate([nftIndex], nftVault.address);

                    expect(nftVault.liquidate).to.have.been.calledOnceWith(
                        nftIndex,
                        liquidator.address
                    );

                    const auctionData = await auction.auctions(0);
                    expect(auctionData.nftAddress).to.equal(nft.address);
                    expect(auctionData.nftIndex).to.equal(nftIndex);
                    expect(auctionData.minBid).to.equal(units(1.01));

                    expect(await nft.ownerOf(nftIndex)).to.equal(
                        auction.address
                    );
                });
            });
        });

        describe("Insured", () => {
            beforeEach(async () => {
                nftVault.positions.whenCalledWith(nftIndex).returns({
                    borrowType: 2,
                    debtPrincipal: units(100),
                    debtPortion: 0,
                    debtAmountForRepurchase: units(101),
                    liquidatedAt: 0,
                    liquidator: ZERO_ADDRESS,
                    strategy: ZERO_ADDRESS
                });
                nftVault.getDebtInterest.returns(units(1));
            });

            describe("Without stablecoin oracle", () => {
                it("should not start auction on liquidation", async () => {
                    await liquidator.liquidate([nftIndex], nftVault.address);

                    expect(nftVault.liquidate).to.have.been.calledOnceWith(
                        nftIndex,
                        liquidator.address
                    );

                    expect(await auction.auctionsLength()).to.equal(0);
                });

                it("should start auction on expired insurance claim", async () => {
                    await liquidator.claimExpiredInsuranceNFT(
                        [nftIndex],
                        nftVault.address
                    );

                    expect(
                        nftVault.claimExpiredInsuranceNFT
                    ).to.have.been.calledOnceWith(nftIndex, liquidator.address);

                    const auctionData = await auction.auctions(0);
                    expect(auctionData.nftAddress).to.equal(nft.address);
                    expect(auctionData.nftIndex).to.equal(nftIndex);
                    expect(auctionData.minBid).to.equal(units(101));

                    expect(await nft.ownerOf(nftIndex)).to.equal(
                        auction.address
                    );
                });
            });

            describe("With stablecoin oracle", () => {
                beforeEach(async () => {
                    oracle.decimals.returns(8);
                    oracle.latestRoundData.returns({
                        roundId: 0,
                        answer: 100e8,
                        startedAt: 0,
                        updatedAt: 0,
                        answeredInRound: 0
                    });

                    await liquidator.setOracle(
                        stablecoin.address,
                        oracle.address
                    );
                });

                it("should not start auction on liquidation", async () => {
                    await liquidator.liquidate([nftIndex], nftVault.address);

                    expect(nftVault.liquidate).to.have.been.calledOnceWith(
                        nftIndex,
                        liquidator.address
                    );

                    expect(await auction.auctionsLength()).to.equal(0);
                });

                it("should start auction on expired insurance claim", async () => {
                    await liquidator.claimExpiredInsuranceNFT(
                        [nftIndex],
                        nftVault.address
                    );

                    expect(
                        nftVault.claimExpiredInsuranceNFT
                    ).to.have.been.calledOnceWith(nftIndex, liquidator.address);

                    const auctionData = await auction.auctions(0);
                    expect(auctionData.nftAddress).to.equal(nft.address);
                    expect(auctionData.nftIndex).to.equal(nftIndex);
                    expect(auctionData.minBid).to.equal(units(1.01));

                    expect(await nft.ownerOf(nftIndex)).to.equal(
                        auction.address
                    );
                });
            });
        });
    });

    describe("Wrapped NFTs", () => {
        beforeEach(async () => {
            await punks.getPunk(nftIndex);
            await punks.transferPunk(punksHelper.address, nftIndex);

            nftVault.stablecoin.returns(stablecoin.address);
            await liquidator.addNFTVault(
                nftVault.address,
                punksHelper.address,
                true
            );
        });

        describe("Uninsured", () => {
            beforeEach(async () => {
                nftVault.positions.whenCalledWith(nftIndex).returns({
                    borrowType: 1,
                    debtPrincipal: units(100),
                    debtPortion: 0,
                    debtAmountForRepurchase: 0,
                    liquidatedAt: 0,
                    liquidator: ZERO_ADDRESS,
                    strategy: ZERO_ADDRESS
                });
                nftVault.getDebtInterest.returns(units(1));
            });

            describe("Without stablecoin oracle", () => {
                it("should start auction on liquidation", async () => {
                    await liquidator.liquidate([nftIndex], nftVault.address);

                    expect(nftVault.liquidate).to.have.been.calledOnceWith(
                        nftIndex,
                        punksHelper.address
                    );

                    const auctionData = await auction.auctions(0);
                    expect(auctionData.nftAddress).to.equal(
                        punksHelper.address
                    );
                    expect(auctionData.nftIndex).to.equal(nftIndex);
                    expect(auctionData.minBid).to.equal(units(101));

                    expect(await punksHelper.ownerOf(nftIndex)).to.equal(
                        auction.address
                    );
                    expect(await punks.punkIndexToAddress(nftIndex)).to.equal(
                        punksHelper.address
                    );
                });
            });

            describe("With stablecoin oracle", () => {
                beforeEach(async () => {
                    oracle.decimals.returns(8);
                    oracle.latestRoundData.returns({
                        roundId: 0,
                        answer: 100e8,
                        startedAt: 0,
                        updatedAt: 0,
                        answeredInRound: 0
                    });

                    await liquidator.setOracle(
                        stablecoin.address,
                        oracle.address
                    );
                });

                it("should start auction on liquidation", async () => {
                    await liquidator.liquidate([nftIndex], nftVault.address);

                    expect(nftVault.liquidate).to.have.been.calledOnceWith(
                        nftIndex,
                        punksHelper.address
                    );

                    const auctionData = await auction.auctions(0);
                    expect(auctionData.nftAddress).to.equal(
                        punksHelper.address
                    );
                    expect(auctionData.nftIndex).to.equal(nftIndex);
                    expect(auctionData.minBid).to.equal(units(1.01));

                    expect(await punksHelper.ownerOf(nftIndex)).to.equal(
                        auction.address
                    );
                    expect(await punks.punkIndexToAddress(nftIndex)).to.equal(
                        punksHelper.address
                    );
                });
            });
        });

        describe("Insured", () => {
            beforeEach(async () => {
                nftVault.positions.whenCalledWith(nftIndex).returns({
                    borrowType: 2,
                    debtPrincipal: units(100),
                    debtPortion: 0,
                    debtAmountForRepurchase: units(101),
                    liquidatedAt: 0,
                    liquidator: ZERO_ADDRESS,
                    strategy: ZERO_ADDRESS
                });
                nftVault.getDebtInterest.returns(units(1));
            });

            describe("Without stablecoin oracle", () => {
                it("should not start auction on liquidation", async () => {
                    await liquidator.liquidate([nftIndex], nftVault.address);

                    expect(nftVault.liquidate).to.have.been.calledOnceWith(
                        nftIndex,
                        punksHelper.address
                    );

                    expect(await auction.auctionsLength()).to.equal(0);
                });

                it("should start auction on expired insurance claim", async () => {
                    await liquidator.claimExpiredInsuranceNFT(
                        [nftIndex],
                        nftVault.address
                    );

                    expect(
                        nftVault.claimExpiredInsuranceNFT
                    ).to.have.been.calledOnceWith(
                        nftIndex,
                        punksHelper.address
                    );

                    const auctionData = await auction.auctions(0);
                    expect(auctionData.nftAddress).to.equal(
                        punksHelper.address
                    );
                    expect(auctionData.nftIndex).to.equal(nftIndex);
                    expect(auctionData.minBid).to.equal(units(101));

                    expect(await punksHelper.ownerOf(nftIndex)).to.equal(
                        auction.address
                    );
                    expect(await punks.punkIndexToAddress(nftIndex)).to.equal(
                        punksHelper.address
                    );
                });
            });

            describe("With stablecoin oracle", () => {
                beforeEach(async () => {
                    oracle.decimals.returns(8);
                    oracle.latestRoundData.returns({
                        roundId: 0,
                        answer: 100e8,
                        startedAt: 0,
                        updatedAt: 0,
                        answeredInRound: 0
                    });

                    await liquidator.setOracle(
                        stablecoin.address,
                        oracle.address
                    );
                });

                it("should not start auction on liquidation", async () => {
                    await liquidator.liquidate([nftIndex], nftVault.address);

                    expect(nftVault.liquidate).to.have.been.calledOnceWith(
                        nftIndex,
                        punksHelper.address
                    );

                    expect(await auction.auctionsLength()).to.equal(0);
                });

                it("should start auction on expired insurance claim", async () => {
                    await liquidator.claimExpiredInsuranceNFT(
                        [nftIndex],
                        nftVault.address
                    );

                    expect(
                        nftVault.claimExpiredInsuranceNFT
                    ).to.have.been.calledOnceWith(
                        nftIndex,
                        punksHelper.address
                    );

                    const auctionData = await auction.auctions(0);
                    expect(auctionData.nftAddress).to.equal(
                        punksHelper.address
                    );
                    expect(auctionData.nftIndex).to.equal(nftIndex);
                    expect(auctionData.minBid).to.equal(units(1.01));

                    expect(await punksHelper.ownerOf(nftIndex)).to.equal(
                        auction.address
                    );
                    expect(await punks.punkIndexToAddress(nftIndex)).to.equal(
                        punksHelper.address
                    );
                });
            });
        });
    });
});
