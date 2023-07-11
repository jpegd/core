import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, upgrades } from "hardhat";
import { JPEGAuction } from "../types";
import {
    timeTravel,
    units,
    ZERO_ADDRESS,
    currentTimestamp,
    setNextTimestamp
} from "./utils";

const AUCTION_DURATION = 12 * 60 * 60;
const TIME_INCREMENT = 600;
const BID_INCREMENT_RATE = { numerator: 1, denominator: 100 };

describe("JPEGAuction", () => {
    let owner: SignerWithAddress, user: SignerWithAddress;
    let auction: JPEGAuction;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user = accounts[1];

        const Auction = await ethers.getContractFactory("JPEGAuction");
        auction = <JPEGAuction>(
            await upgrades.deployProxy(Auction, [
                AUCTION_DURATION,
                TIME_INCREMENT,
                BID_INCREMENT_RATE
            ])
        );
    });

    it("should allow whitelisted addresses to create a new fixed time auction", async () => {
        await expect(auction.newAuction(ZERO_ADDRESS, 0, 0)).to.be.reverted;
        await auction.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["WHITELISTED_ROLE"]),
            owner.address
        );
        await expect(
            auction.newAuction(ZERO_ADDRESS, 0, 0)
        ).to.be.revertedWithCustomError(auction, "ZeroAddress");

        const ERC721 = await ethers.getContractFactory("TestERC721");
        const nft = await ERC721.deploy();
        await nft.mint(owner.address, 1);

        await nft.setApprovalForAll(auction.address, true);

        await expect(
            auction.newAuction(nft.address, 1, 0)
        ).to.be.revertedWithCustomError(auction, "InvalidAmount");

        const nextTimestamp = (await currentTimestamp()) + 1;
        await setNextTimestamp(nextTimestamp);

        const minBid = units(1);

        await auction.newAuction(nft.address, 1, minBid);

        const auctionConfig = await auction.auctions(0);

        const nextSlot =
            nextTimestamp +
            AUCTION_DURATION -
            (nextTimestamp % AUCTION_DURATION);

        expect(auctionConfig.nftAddress).to.equal(nft.address);
        expect(auctionConfig.nftIndex).to.equal(1);
        expect(auctionConfig.startTime).to.equal(nextSlot);
        expect(auctionConfig.endTime).to.equal(nextSlot + AUCTION_DURATION);
        expect(auctionConfig.minBid).to.equal(minBid);
        expect(auctionConfig.highestBidOwner).to.equal(ZERO_ADDRESS);
        expect(auctionConfig.ownerClaimed).to.be.false;
    });

    it("should allow the admin to create a new custom auction", async () => {
        await expect(
            auction.newCustomAuction(ZERO_ADDRESS, 0, 0, 0, 0)
        ).to.be.revertedWithCustomError(auction, "ZeroAddress");

        const ERC721 = await ethers.getContractFactory("TestERC721");
        const nft = await ERC721.deploy();
        await nft.mint(owner.address, 1);

        await nft.setApprovalForAll(auction.address, true);

        await expect(
            auction.newCustomAuction(nft.address, 1, 0, 0, 0)
        ).to.be.revertedWithCustomError(auction, "InvalidAmount");

        const currentTimestamp = (await ethers.provider.getBlock("latest"))
            .timestamp;
        await expect(
            auction.newCustomAuction(
                nft.address,
                1,
                currentTimestamp + 100,
                0,
                0
            )
        ).to.be.revertedWithCustomError(auction, "InvalidAmount");
        await expect(
            auction.newCustomAuction(
                nft.address,
                1,
                currentTimestamp + 100,
                currentTimestamp + 1000,
                0
            )
        ).to.be.revertedWithCustomError(auction, "InvalidAmount");

        await auction.newCustomAuction(
            nft.address,
            1,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );

        const auctionConfig = await auction.auctions(0);

        expect(auctionConfig.nftAddress).to.equal(nft.address);
        expect(auctionConfig.nftIndex).to.equal(1);
        expect(auctionConfig.startTime).to.equal(currentTimestamp + 100);
        expect(auctionConfig.endTime).to.equal(currentTimestamp + 1000);
        expect(auctionConfig.minBid).to.equal(units(1));
        expect(auctionConfig.highestBidOwner).to.equal(ZERO_ADDRESS);
        expect(auctionConfig.ownerClaimed).to.be.false;
    });

    it("should allow users to bid", async () => {
        const initialBid = units(1);
        let minBid = initialBid;

        await expect(
            auction.connect(user).bid(0)
        ).to.be.revertedWithCustomError(auction, "Unauthorized");

        const ERC721 = await ethers.getContractFactory("TestERC721");
        const nft = await ERC721.deploy();
        await nft.mint(owner.address, 1);

        await nft.setApprovalForAll(auction.address, true);

        const currentTimestamp = (await ethers.provider.getBlock("latest"))
            .timestamp;
        await auction.newCustomAuction(
            nft.address,
            1,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            minBid
        );

        await expect(
            auction.connect(user).bid(0)
        ).to.be.revertedWithCustomError(auction, "Unauthorized");

        await timeTravel(100);

        await expect(
            auction.connect(user).bid(0, { value: minBid.sub(1) })
        ).to.be.revertedWithCustomError(auction, "InvalidBid");

        await auction.connect(user).bid(0, { value: minBid });

        expect((await auction.auctions(0)).highestBidOwner).to.equal(
            user.address
        );
        expect(await auction.getAuctionBid(0, user.address)).to.equal(minBid);
        expect(await auction.getActiveBids(user.address)).to.deep.equal([
            BigNumber.from(0)
        ]);

        minBid = minBid.add(
            minBid
                .mul(BID_INCREMENT_RATE.numerator)
                .div(BID_INCREMENT_RATE.denominator)
        );

        await expect(
            auction.bid(0, {
                value: minBid.sub(1)
            })
        ).to.be.revertedWithCustomError(auction, "InvalidBid");

        await auction.bid(0, { value: minBid });
        expect(await auction.getActiveBids(owner.address)).to.deep.equal([
            BigNumber.from(0)
        ]);

        expect((await auction.auctions(0)).highestBidOwner).to.equal(
            owner.address
        );
        expect(await auction.getAuctionBid(0, owner.address)).to.equal(minBid);

        minBid = minBid.add(
            minBid
                .mul(BID_INCREMENT_RATE.numerator)
                .div(BID_INCREMENT_RATE.denominator)
        );
        await expect(
            auction
                .connect(user)
                .bid(0, { value: minBid.sub(initialBid).sub(1) })
        ).to.be.revertedWithCustomError(auction, "InvalidBid");
        await auction.connect(user).bid(0, { value: minBid.sub(initialBid) });

        expect((await auction.auctions(0)).highestBidOwner).to.equal(
            user.address
        );
        expect(await auction.getAuctionBid(0, user.address)).to.equal(minBid);

        expect(await auction.getActiveBids(user.address)).to.deep.equal([
            BigNumber.from(0)
        ]);
        expect(await auction.getActiveBids(owner.address)).to.deep.equal([
            BigNumber.from(0)
        ]);
    });

    it("should extend the auction's end time if a user bids when the remaning time is less than bidTimeIncrement", async () => {
        const ERC721 = await ethers.getContractFactory("TestERC721");
        const nft = await ERC721.deploy();
        await nft.mint(owner.address, 1);

        await nft.setApprovalForAll(auction.address, true);

        const currentTimestamp = (await ethers.provider.getBlock("latest"))
            .timestamp;

        const startTime = currentTimestamp + 100;
        const endTime = startTime + TIME_INCREMENT + 100;

        await auction.newCustomAuction(
            nft.address,
            1,
            startTime,
            endTime,
            units(1)
        );

        await setNextTimestamp(startTime + 99);

        await auction.bid(0, { value: units(1) });

        expect((await auction.auctions(0)).endTime).to.equal(endTime);

        await setNextTimestamp(startTime + 101);

        await auction.connect(user).bid(0, { value: units(2) });

        expect((await auction.auctions(0)).endTime).to.equal(endTime + 1);

        const nextTimestamp = startTime + (endTime - (startTime + 100)) / 2;
        await setNextTimestamp(nextTimestamp);

        await auction.bid(0, { value: units(2) });

        expect((await auction.auctions(0)).endTime).to.equal(
            nextTimestamp + TIME_INCREMENT
        );
    });

    it("should allow users to bid in multiple auctions", async () => {
        const ERC721 = await ethers.getContractFactory("TestERC721");
        const nft = await ERC721.deploy();
        await nft.mint(owner.address, 1);
        await nft.mint(owner.address, 2);

        await nft.setApprovalForAll(auction.address, true);

        const currentTimestamp = (await ethers.provider.getBlock("latest"))
            .timestamp;
        await auction.newCustomAuction(
            nft.address,
            1,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );
        await auction.newCustomAuction(
            nft.address,
            2,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );

        await timeTravel(100);

        await auction.connect(user).bid(0, { value: units(1) });
        await auction.connect(user).bid(1, { value: units(1) });

        expect(await auction.getActiveBids(user.address)).to.deep.equal([
            BigNumber.from(0),
            BigNumber.from(1)
        ]);

        expect((await auction.auctions(0)).highestBidOwner).to.equal(
            user.address
        );
        expect(await auction.getAuctionBid(0, user.address)).to.equal(units(1));
        expect((await auction.auctions(1)).highestBidOwner).to.equal(
            user.address
        );
        expect(await auction.getAuctionBid(1, user.address)).to.equal(units(1));
    });

    it("should allow users to withdraw their bids", async () => {
        const ERC721 = await ethers.getContractFactory("TestERC721");
        const nft = await ERC721.deploy();
        await nft.mint(owner.address, 1);
        await nft.mint(owner.address, 2);

        await nft.setApprovalForAll(auction.address, true);

        const currentTimestamp = (await ethers.provider.getBlock("latest"))
            .timestamp;
        await auction.newCustomAuction(
            nft.address,
            1,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );
        await auction.newCustomAuction(
            nft.address,
            2,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );

        await timeTravel(100);

        await auction.connect(user).bid(0, { value: units(1) });
        await auction.connect(user).bid(1, { value: units(1) });

        await expect(
            auction.connect(user).withdrawBids([0, 1])
        ).to.be.revertedWithCustomError(auction, "Unauthorized");

        await auction.bid(0, { value: units(2) });

        await expect(
            auction.connect(user).withdrawBids([0, 1])
        ).to.be.revertedWithCustomError(auction, "Unauthorized");

        await auction.bid(1, { value: units(2) });

        await auction.connect(user).withdrawBids([0, 1]);

        expect(await auction.getActiveBids(user.address)).to.deep.equal([]);
        expect(await auction.getActiveBids(owner.address)).to.deep.equal([
            BigNumber.from(0),
            BigNumber.from(1)
        ]);

        await expect(
            auction.connect(user).withdrawBids([0, 1])
        ).to.be.revertedWithCustomError(auction, "Unauthorized");

        expect(await ethers.provider.getBalance(auction.address)).to.equal(
            units(4)
        );
    });

    it("should allow the highest bidder to withdraw the nft", async () => {
        const ERC721 = await ethers.getContractFactory("TestERC721");
        const nft = await ERC721.deploy();
        await nft.mint(owner.address, 1);
        await nft.mint(owner.address, 2);

        await nft.setApprovalForAll(auction.address, true);

        const currentTimestamp = (await ethers.provider.getBlock("latest"))
            .timestamp;
        await auction.newCustomAuction(
            nft.address,
            1,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );

        await timeTravel(100);

        await auction.connect(user).bid(0, { value: units(1) });

        await expect(auction.claimNFT(0)).to.be.revertedWithCustomError(
            auction,
            "Unauthorized"
        );
        await expect(
            auction.connect(user).claimNFT(0)
        ).to.be.revertedWithCustomError(auction, "Unauthorized");

        await timeTravel(1000);

        await auction.connect(user).claimNFT(0);

        expect(await nft.ownerOf(1)).to.equal(user.address);

        await expect(
            auction.connect(user).claimNFT(0)
        ).to.be.revertedWithCustomError(auction, "Unauthorized");
    });

    it("should allow the owner to withdraw the eth", async () => {
        const ERC721 = await ethers.getContractFactory("TestERC721");
        const nft = await ERC721.deploy();
        await nft.mint(owner.address, 1);
        await nft.mint(owner.address, 2);

        await nft.setApprovalForAll(auction.address, true);

        const currentTimestamp = (await ethers.provider.getBlock("latest"))
            .timestamp;
        await auction.newCustomAuction(
            nft.address,
            1,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );

        await timeTravel(100);

        await auction.connect(user).bid(0, { value: units(1) });

        await expect(auction.withdrawETH(0)).to.be.revertedWithCustomError(
            auction,
            "Unauthorized"
        );

        await timeTravel(1000);

        await expect(
            auction.withdrawUnsoldNFT(0)
        ).to.be.revertedWithCustomError(auction, "Unauthorized");

        await auction.withdrawETH(0);
        expect(await ethers.provider.getBalance(auction.address)).to.equal(
            units(0)
        );

        await expect(auction.withdrawETH(0)).to.be.revertedWithCustomError(
            auction,
            "Unauthorized"
        );
    });

    it("should allow the owner to withdraw an unsold NFT", async () => {
        const ERC721 = await ethers.getContractFactory("TestERC721");
        const nft = await ERC721.deploy();
        await nft.mint(owner.address, 1);
        await nft.mint(owner.address, 2);

        await nft.setApprovalForAll(auction.address, true);

        const currentTimestamp = (await ethers.provider.getBlock("latest"))
            .timestamp;
        await auction.newCustomAuction(
            nft.address,
            1,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );

        await expect(
            auction.withdrawUnsoldNFT(0)
        ).to.be.revertedWithCustomError(auction, "Unauthorized");

        await timeTravel(1000);

        await expect(auction.withdrawETH(0)).to.be.revertedWithCustomError(
            auction,
            "Unauthorized"
        );

        await auction.withdrawUnsoldNFT(0);
        expect(await ethers.provider.getBalance(auction.address)).to.equal(
            units(0)
        );

        await expect(
            auction.withdrawUnsoldNFT(0)
        ).to.be.revertedWithCustomError(auction, "Unauthorized");
    });

    it("should allow the admin to cancel an auction with no bids", async () => {
        await expect(auction.connect(user).cancelAuction(0, ZERO_ADDRESS)).to.be
            .reverted;
        await expect(
            auction.cancelAuction(0, ZERO_ADDRESS)
        ).to.be.revertedWithCustomError(auction, "ZeroAddress");
        await expect(
            auction.cancelAuction(0, user.address)
        ).to.be.revertedWithCustomError(auction, "InvalidAuction");

        const ERC721 = await ethers.getContractFactory("TestERC721");
        const nft = await ERC721.deploy();
        await nft.mint(owner.address, 1);
        await nft.mint(owner.address, 2);

        await nft.setApprovalForAll(auction.address, true);

        const currentTimestamp = (await ethers.provider.getBlock("latest"))
            .timestamp;
        await auction.newCustomAuction(
            nft.address,
            1,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );

        await auction.cancelAuction(0, user.address);

        expect(await nft.ownerOf(1)).to.equal(user.address);

        await auction.newCustomAuction(
            nft.address,
            2,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );

        await timeTravel(100);

        await auction.bid(1, { value: units(1) });

        await expect(
            auction.cancelAuction(1, user.address)
        ).to.be.revertedWithCustomError(auction, "Unauthorized");
    });

    it("should allow calling finalizeUpgrade once", async () => {
        await auction.finalizeUpgrade(user.address, 1);
        await expect(
            auction.finalizeUpgrade(user.address, 1)
        ).to.be.revertedWithoutReason();

        expect(await auction.hasRole(ethers.constants.HashZero, user.address))
            .to.be.true;
        expect(await auction.auctionDuration()).to.equal(1);
    });
});
