import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, upgrades } from "hardhat";
import { JPEGAuction } from "../types";
import { timeTravel, units, ZERO_ADDRESS } from "./utils";

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
                600,
                { numerator: 1, denominator: 100 }
            ])
        );
    });

    it("should allow the owner to create a new auction", async () => {
        await expect(
            auction.newAuction(ZERO_ADDRESS, 0, 0, 0, 0)
        ).to.be.revertedWith("INVALID_NFT");

        const ERC721 = await ethers.getContractFactory("TestERC721");
        const nft = await ERC721.deploy();
        await nft.mint(owner.address, 1);

        await nft.setApprovalForAll(auction.address, true);

        await expect(
            auction.newAuction(nft.address, 1, 0, 0, 0)
        ).to.be.revertedWith("INVALID_START_TIME");

        const currentTimestamp = (await ethers.provider.getBlock("latest"))
            .timestamp;
        await expect(
            auction.newAuction(nft.address, 1, currentTimestamp + 100, 0, 0)
        ).to.be.revertedWith("INVALID_END_TIME");
        await expect(
            auction.newAuction(
                nft.address,
                1,
                currentTimestamp + 100,
                currentTimestamp + 1000,
                0
            )
        ).to.be.revertedWith("INVALID_MIN_BID");

        await auction.newAuction(
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
        await expect(auction.connect(user).bid(0)).to.be.revertedWith(
            "ENDED_OR_INVALID"
        );

        const ERC721 = await ethers.getContractFactory("TestERC721");
        const nft = await ERC721.deploy();
        await nft.mint(owner.address, 1);

        await nft.setApprovalForAll(auction.address, true);

        const currentTimestamp = (await ethers.provider.getBlock("latest"))
            .timestamp;
        await auction.newAuction(
            nft.address,
            1,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );

        await expect(auction.connect(user).bid(0)).to.be.revertedWith(
            "NOT_STARTED"
        );

        await timeTravel(100);

        await expect(
            auction.connect(user).bid(0, { value: units(0.5) })
        ).to.be.revertedWith("INVALID_BID");

        await auction.connect(user).bid(0, { value: units(1) });

        expect((await auction.auctions(0)).highestBidOwner).to.equal(
            user.address
        );
        expect(await auction.getAuctionBid(0, user.address)).to.equal(units(1));
        expect(await auction.getActiveBids(user.address)).to.deep.equal([
            BigNumber.from(0)
        ]);

        await expect(
            auction.bid(0, { value: units(1.009) })
        ).to.be.revertedWith("INVALID_BID");

        await auction.bid(0, { value: units(1.01) });
        expect(await auction.getActiveBids(owner.address)).to.deep.equal([
            BigNumber.from(0)
        ]);

        expect((await auction.auctions(0)).highestBidOwner).to.equal(
            owner.address
        );
        expect(await auction.getAuctionBid(0, owner.address)).to.equal(
            units(1.01)
        );

        await expect(
            auction.connect(user).bid(0, { value: units(0.01) })
        ).to.be.revertedWith("INVALID_BID");
        await auction.connect(user).bid(0, { value: units(0.05) });

        expect((await auction.auctions(0)).highestBidOwner).to.equal(
            user.address
        );
        expect(await auction.getAuctionBid(0, user.address)).to.equal(
            units(1.05)
        );

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
        await auction.newAuction(
            nft.address,
            1,
            currentTimestamp + 100,
            currentTimestamp + 1300,
            units(1)
        );

        await timeTravel(100);

        await auction.bid(0, { value: units(1) });

        expect((await auction.auctions(0)).endTime).to.equal(
            currentTimestamp + 1300
        );

        await timeTravel(600);

        await auction.connect(user).bid(0, { value: units(2) });

        expect((await auction.auctions(0)).endTime).to.equal(
            currentTimestamp + 1303
        );

        await timeTravel(500);

        await auction.bid(0, { value: units(2) });

        expect((await auction.auctions(0)).endTime).to.equal(
            currentTimestamp + 1804
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
        await auction.newAuction(
            nft.address,
            1,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );
        await auction.newAuction(
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
        await auction.newAuction(
            nft.address,
            1,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );
        await auction.newAuction(
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
        ).to.be.revertedWith("HIGHEST_BID_OWNER");

        await auction.bid(0, { value: units(2) });

        await expect(
            auction.connect(user).withdrawBids([0, 1])
        ).to.be.revertedWith("HIGHEST_BID_OWNER");

        await auction.bid(1, { value: units(2) });

        await auction.connect(user).withdrawBids([0, 1]);

        expect(await auction.getActiveBids(user.address)).to.deep.equal([]);
        expect(await auction.getActiveBids(owner.address)).to.deep.equal([
            BigNumber.from(0),
            BigNumber.from(1)
        ]);

        await expect(
            auction.connect(user).withdrawBids([0, 1])
        ).to.be.revertedWith("NO_BID");

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
        await auction.newAuction(
            nft.address,
            1,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );

        await timeTravel(100);

        await auction.connect(user).bid(0, { value: units(1) });

        await expect(auction.claimNFT(0)).to.be.revertedWith("NOT_WINNER");
        await expect(auction.connect(user).claimNFT(0)).to.be.revertedWith(
            "NOT_ENDED"
        );

        await timeTravel(1000);

        await auction.connect(user).claimNFT(0);

        expect(await nft.ownerOf(1)).to.equal(user.address);

        await expect(auction.connect(user).claimNFT(0)).to.be.revertedWith(
            "ALREADY_CLAIMED"
        );
    });

    it("should allow the owner to withdraw the eth", async () => {
        const ERC721 = await ethers.getContractFactory("TestERC721");
        const nft = await ERC721.deploy();
        await nft.mint(owner.address, 1);
        await nft.mint(owner.address, 2);

        await nft.setApprovalForAll(auction.address, true);

        const currentTimestamp = (await ethers.provider.getBlock("latest"))
            .timestamp;
        await auction.newAuction(
            nft.address,
            1,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );

        await timeTravel(100);

        await auction.connect(user).bid(0, { value: units(1) });

        await expect(auction.withdrawETH(0)).to.be.revertedWith("NOT_ENDED");

        await timeTravel(1000);

        await expect(auction.withdrawUnsoldNFT(0)).to.be.revertedWith(
            "NFT_SOLD"
        );

        await auction.withdrawETH(0);
        expect(await ethers.provider.getBalance(auction.address)).to.equal(
            units(0)
        );

        await expect(auction.withdrawETH(0)).to.be.revertedWith(
            "ALREADY_CLAIMED"
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
        await auction.newAuction(
            nft.address,
            1,
            currentTimestamp + 100,
            currentTimestamp + 1000,
            units(1)
        );

        await expect(auction.withdrawUnsoldNFT(0)).to.be.revertedWith(
            "NOT_ENDED"
        );

        await timeTravel(1000);

        await expect(auction.withdrawETH(0)).to.be.revertedWith("NFT_UNSOLD");

        await auction.withdrawUnsoldNFT(0);
        expect(await ethers.provider.getBalance(auction.address)).to.equal(
            units(0)
        );

        await expect(auction.withdrawUnsoldNFT(0)).to.be.revertedWith(
            "ALREADY_CLAIMED"
        );
    });
});
