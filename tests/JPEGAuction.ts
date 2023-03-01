import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { ethers, upgrades } from "hardhat";
import {
    JPEGAuction,
    JPEG,
    TestERC721,
    JPEGCardsCigStaking,
    MockAuction
} from "../types";
import { timeTravel, units, ZERO_ADDRESS } from "./utils";

const { expect } = chai;

chai.use(solidity);

const minter_role =
    "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";

describe("JPEGAuction", () => {
    let owner: SignerWithAddress, user: SignerWithAddress;
    let auction: JPEGAuction;
    let cards: TestERC721;
    let jpeg: JPEG;
    let cigStaking: JPEGCardsCigStaking;
    let legacyAuction: MockAuction;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user = accounts[1];

        const JPEG = await ethers.getContractFactory("JPEG");
        jpeg = await JPEG.deploy(0);
        await jpeg.deployed();
        await jpeg.grantRole(minter_role, owner.address);

        const ERC721 = await ethers.getContractFactory("TestERC721");
        cards = await ERC721.deploy();

        const Staking = await ethers.getContractFactory("JPEGCardsCigStaking");
        cigStaking = await Staking.deploy(cards.address, [2]);
        await cigStaking.unpause();

        const MockAuction = await ethers.getContractFactory("MockAuction");
        legacyAuction = await MockAuction.deploy();

        const Auction = await ethers.getContractFactory("JPEGAuction");
        auction = <JPEGAuction>(
            await upgrades.deployProxy(Auction, [
                jpeg.address,
                cards.address,
                cigStaking.address,
                legacyAuction.address,
                units(5_000_000),
                7 * 24 * 3600,
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

    it("should allow users to deposit JPEG", async () => {
        await jpeg.mint(user.address, units(10_000_000));
        await jpeg.connect(user).approve(auction.address, units(10_000_000));

        const currentTimestamp = (await ethers.provider.getBlock("latest"))
            .timestamp;

        await auction.connect(user).correctDepositedJPEG();
        await expect(
            auction.connect(user).correctDepositedJPEG()
        ).to.be.revertedWith("ALREADY_CORRECT");
        const userInfoFirst = await auction.userInfo(user.address);

        expect(await jpeg.balanceOf(auction.address)).to.equal(
            units(5_000_000)
        );

        expect(userInfoFirst.unlockTime).to.equal(
            currentTimestamp + 7 * 24 * 3600 + 1
        );
        expect(userInfoFirst.stakeArgument).to.equal(units(5_000_000));
        expect(userInfoFirst.stakeMode).to.equal(1);

        expect(await auction.isAuthorized(user.address)).to.be.true;

        await auction.setJPEGLockAmount(units(10_000_000));
        expect(await auction.isAuthorized(user.address)).to.be.false;

        await auction.connect(user).correctDepositedJPEG();
        const userInfoSecond = await auction.userInfo(user.address);

        expect(await jpeg.balanceOf(auction.address)).to.equal(
            units(10_000_000)
        );

        expect(userInfoSecond.unlockTime).to.equal(userInfoFirst.unlockTime);
        expect(userInfoSecond.stakeMode).to.equal(userInfoFirst.stakeMode);
        expect(userInfoSecond.stakeArgument).to.equal(units(10_000_000));

        await auction.setJPEGLockAmount(units(5_000_000));
        expect(await auction.isAuthorized(user.address)).to.be.true;

        await auction.connect(user).correctDepositedJPEG();
        const userInfoThird = await auction.userInfo(user.address);

        expect(await jpeg.balanceOf(auction.address)).to.equal(
            units(5_000_000)
        );

        expect(userInfoThird).to.deep.equal(userInfoFirst);

        await cards.mint(user.address, 1);
        await cards.connect(user).setApprovalForAll(auction.address, true);

        await expect(auction.connect(user).depositCard(1)).to.be.revertedWith(
            "ALREADY_STAKING"
        );
    });

    it("should allow users to deposit a card", async () => {
        await cards.mint(user.address, 1);
        await cards.connect(user).setApprovalForAll(auction.address, true);

        const currentTimestamp = (await ethers.provider.getBlock("latest"))
            .timestamp;

        await auction.connect(user).depositCard(1);
        await expect(auction.connect(user).depositCard(1)).to.be.revertedWith(
            "ALREADY_STAKING"
        );
        const userInfo = await auction.userInfo(user.address);

        expect(userInfo.unlockTime).to.equal(
            currentTimestamp + 7 * 24 * 3600 + 1
        );
        expect(userInfo.stakeArgument).to.equal(1);
        expect(userInfo.stakeMode).to.equal(2);

        await expect(
            auction.connect(user).correctDepositedJPEG()
        ).to.be.revertedWith("STAKING_CARD");
    });

    it("should allow LEGACY StakeMode users to renounce and switch to CIG StakeMode", async () => {
        await auction.addLegacyAccounts([owner.address]);

        await auction.renounceLegacyStakeMode();
        await expect(auction.renounceLegacyStakeMode()).to.be.revertedWith(
            "NOT_LEGACY"
        );

        expect((await auction.userInfo(owner.address)).stakeMode).to.equal(0);
    });

    it("should allow users to withdraw their card/jpeg after the lock elapses if they aren't participating in any auction", async () => {
        await cards.mint(user.address, 1);
        await cards.connect(user).setApprovalForAll(auction.address, true);

        await auction.connect(user).depositCard(1);

        await jpeg.mint(owner.address, units(5_000_000));
        await jpeg.approve(auction.address, units(5_000_000));

        await auction.correctDepositedJPEG();

        await expect(auction.withdrawCard()).to.be.revertedWith(
            "CARD_NOT_DEPOSITED"
        );
        await expect(auction.connect(user).withdrawCard()).to.be.revertedWith(
            "LOCKED"
        );

        await expect(auction.withdrawJPEG()).to.be.revertedWith("LOCKED");
        await expect(auction.connect(user).withdrawJPEG()).to.be.revertedWith(
            "JPEG_NOT_DEPOSITED"
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

        await timeTravel(100);

        await auction.bid(0, { value: units(1) });
        await auction.connect(user).bid(0, { value: units(2) });

        await auction.setJPEGLockAmount(units(10_000_000));

        await timeTravel(7 * 3600 * 24);

        await expect(auction.connect(user).withdrawCard()).to.be.revertedWith(
            "ACTIVE_BIDS"
        );
        await expect(auction.withdrawJPEG()).to.be.revertedWith("ACTIVE_BIDS");

        await auction.withdrawBid(0);
        await auction.withdrawJPEG();

        expect(await jpeg.balanceOf(owner.address)).to.equal(units(5_000_000));

        await auction.connect(user).claimNFT(0);
        await auction.connect(user).withdrawCard();

        expect(await cards.ownerOf(1)).to.equal(user.address);
    });

    it("should allow authorized users to bid", async () => {
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
        await expect(auction.connect(user).bid(0)).to.be.revertedWith(
            "NOT_AUTHORIZED"
        );

        await jpeg.mint(user.address, units(5_000_000));
        await jpeg.connect(user).approve(auction.address, units(5_000_000));

        await expect(
            auction.connect(user).depositJPEGAndBid(0, { value: units(0.5) })
        ).to.be.revertedWith("INVALID_BID");

        await auction.connect(user).depositJPEGAndBid(0, { value: units(1) });

        expect((await auction.auctions(0)).highestBidOwner).to.equal(
            user.address
        );
        expect(await auction.getAuctionBid(0, user.address)).to.equal(units(1));
        expect(await auction.getActiveBids(user.address)).to.deep.equal([
            BigNumber.from(0)
        ]);

        await expect(auction.bid(0)).to.be.revertedWith("NOT_AUTHORIZED");

        await auction.addLegacyAccounts([owner.address]);
        await expect(auction.bid(0)).to.be.revertedWith("NOT_AUTHORIZED");

        await expect(
            auction.addLegacyAccounts([owner.address])
        ).to.be.revertedWith("ACCOUNT_ALREADY_STAKING");

        await legacyAuction.setAuthorized(owner.address, true);

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

        await cards.mint(user.address, 1);
        await cards.connect(user).setApprovalForAll(auction.address, true);

        await auction.connect(user).depositCard(1);

        await cards.mint(owner.address, 2);
        await cards.setApprovalForAll(auction.address, true);

        await auction.depositCard(2);

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

        await cards.mint(user.address, 1);
        await cards.connect(user).setApprovalForAll(auction.address, true);

        await auction
            .connect(user)
            .depositCardAndBid(0, 1, { value: units(1) });
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

        await cards.mint(user.address, 1);
        await cards.connect(user).setApprovalForAll(auction.address, true);

        await auction
            .connect(user)
            .depositCardAndBid(0, 1, { value: units(1) });
        await auction.connect(user).bid(1, { value: units(1) });

        await expect(
            auction.connect(user).withdrawBids([0, 1])
        ).to.be.revertedWith("HIGHEST_BID_OWNER");

        await cards.mint(owner.address, 2);
        await cards.setApprovalForAll(auction.address, true);

        await auction.depositCardAndBid(0, 2, { value: units(2) });

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

        await cards.mint(user.address, 1);
        await cards.connect(user).setApprovalForAll(auction.address, true);

        await auction
            .connect(user)
            .depositCardAndBid(0, 1, { value: units(1) });

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

        await cards.mint(user.address, 1);
        await cards.connect(user).setApprovalForAll(auction.address, true);

        await auction
            .connect(user)
            .depositCardAndBid(0, 1, { value: units(1) });

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
