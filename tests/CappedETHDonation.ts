import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { CappedETHDonation, JPEGCardsCigStaking, TestERC721 } from "../types";

import { currentTimestamp, timeTravel, units } from "./utils";

describe("CappedETHDonation", () => {
    let donation: CappedETHDonation;
    let cards: TestERC721;
    let cigStaking: JPEGCardsCigStaking;
    let owner: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user1 = accounts[1];
        user2 = accounts[2];

        const ERC721 = await ethers.getContractFactory("TestERC721");
        cards = await ERC721.deploy();

        const CigStaking = await ethers.getContractFactory(
            "JPEGCardsCigStaking"
        );
        cigStaking = await CigStaking.deploy(cards.address, [200]);

        await cigStaking.unpause();

        const Donation = await ethers.getContractFactory("CappedETHDonation");
        donation = await Donation.deploy(cards.address, cigStaking.address);
    });

    it("should allow the owner to create a new donation event without a whitelist", async () => {
        await expect(
            donation.newDonationEvent(0, 0, 0, 0, 0, 0)
        ).to.be.revertedWithCustomError(donation, "InvalidAmount");
        await expect(
            donation.newDonationEvent(units(10), 0, 0, 0, 0, 0)
        ).to.be.revertedWithCustomError(donation, "InvalidAmount");
        await expect(
            donation.newDonationEvent(units(10), units(5), 0, 0, 0, 0)
        ).to.be.revertedWithCustomError(donation, "InvalidStart");

        const start = (await currentTimestamp()) + 1000;

        await expect(
            donation.newDonationEvent(units(10), units(5), 0, start, 0, 0)
        ).to.be.revertedWithCustomError(donation, "InvalidDuration");

        await donation.newDonationEvent(units(10), units(5), 0, start, 0, 1000);

        const event = await donation.donationEvents(0);

        expect(event.totalCap).to.equal(units(10));
        expect(event.walletCap).to.equal(units(5));
        expect(event.whitelistCap).to.equal(0);
        expect(event.start).to.equal(start);
        expect(event.whitelistEnd).to.equal(start);
        expect(event.end).to.equal(start + 1000);
        expect(event.donatedAmount).to.equal(0);
    });

    it("should allow the owner to create a new donation event with a whitelist", async () => {
        const start = (await currentTimestamp()) + 1000;

        await expect(
            donation.newDonationEvent(units(10), units(5), 0, start, 100, 1000)
        ).to.be.revertedWithCustomError(donation, "InvalidAmount");

        await donation.newDonationEvent(
            units(10),
            units(5),
            units(1),
            start,
            100,
            1000
        );

        const event = await donation.donationEvents(0);

        expect(event.totalCap).to.equal(units(10));
        expect(event.walletCap).to.equal(units(5));
        expect(event.whitelistCap).to.equal(units(1));
        expect(event.start).to.equal(start);
        expect(event.whitelistEnd).to.equal(start + 100);
        expect(event.end).to.equal(start + 100 + 1000);
        expect(event.donatedAmount).to.equal(0);
    });

    it("should allow users to donate", async () => {
        const start = (await currentTimestamp()) + 1000;
        await donation.newDonationEvent(
            units(10),
            units(5),
            units(1),
            start,
            100,
            1000
        );

        await expect(
            donation.connect(user1).donate({ value: units(1) })
        ).to.be.revertedWithCustomError(donation, "InactiveDonation");

        await timeTravel(1000);
        await expect(
            donation.connect(user1).donate({ value: units(1) })
        ).to.be.revertedWithCustomError(donation, "InactiveDonation");

        await timeTravel(100);
        await expect(
            donation.connect(user1).donate({ value: 0 })
        ).to.be.revertedWithCustomError(donation, "InvalidAmount");
        await expect(
            donation.connect(user1).donate({ value: units(10) })
        ).to.be.revertedWithCustomError(donation, "InvalidAmount");

        await donation.connect(user1).donate({ value: units(3) });

        let event = await donation.donationEvents(0);
        expect(event.donatedAmount).to.equal(units(3));

        expect(await donation.donatedAmount(0, user1.address)).to.equal(
            units(3)
        );

        await expect(
            donation.connect(user1).donate({ value: units(3) })
        ).to.be.revertedWithCustomError(donation, "InvalidAmount");

        await donation.connect(user1).donate({ value: units(2) });

        event = await donation.donationEvents(0);
        expect(event.donatedAmount).to.equal(units(5));

        expect(await donation.donatedAmount(0, user1.address)).to.equal(
            units(5)
        );

        await timeTravel(1000);

        await expect(
            donation.connect(user1).donate({ value: units(1) })
        ).to.be.revertedWithCustomError(donation, "InactiveDonation");
    });

    it("should allow whitelisted users to donate", async () => {
        const start = (await currentTimestamp()) + 1000;
        await donation.newDonationEvent(
            units(10),
            units(5),
            units(1),
            start,
            100,
            1000
        );

        await expect(
            donation.connect(user1).donateWhitelist({ value: units(1) })
        ).to.be.revertedWithCustomError(donation, "InactiveDonation");
        await timeTravel(1000);

        await expect(
            donation.donateWhitelist({ value: units(1) })
        ).to.be.revertedWithCustomError(donation, "Unauthorized");

        await cards.mint(user1.address, 200);

        await expect(
            donation.connect(user1).donateWhitelist({ value: 0 })
        ).to.be.revertedWithCustomError(donation, "InvalidAmount");
        await expect(
            donation.connect(user1).donateWhitelist({ value: units(2) })
        ).to.be.revertedWithCustomError(donation, "InvalidAmount");

        await donation.connect(user1).donateWhitelist({ value: units(0.5) });

        let event = await donation.donationEvents(0);
        expect(event.donatedAmount).to.equal(units(0.5));

        expect(await donation.donatedAmount(0, user1.address)).to.equal(
            units(0.5)
        );

        await expect(
            donation.connect(user1).donateWhitelist({ value: units(1) })
        ).to.be.revertedWithCustomError(donation, "InvalidAmount");

        await cards.connect(user1).setApprovalForAll(cigStaking.address, true);
        await cigStaking.connect(user1).deposit(200);

        await donation.connect(user1).donateWhitelist({ value: units(0.5) });
        event = await donation.donationEvents(0);
        expect(event.donatedAmount).to.equal(units(1));

        expect(await donation.donatedAmount(0, user1.address)).to.equal(
            units(1)
        );

        await timeTravel(100);

        await expect(
            donation.connect(user1).donateWhitelist({ value: units(1) })
        ).to.be.revertedWithCustomError(donation, "InactiveDonation");

        await expect(
            donation.connect(user1).donate({ value: units(5) })
        ).to.be.revertedWithCustomError(donation, "InvalidAmount");

        await donation.connect(user1).donate({ value: units(4) });

        event = await donation.donationEvents(0);
        expect(event.donatedAmount).to.equal(units(5));

        expect(await donation.donatedAmount(0, user1.address)).to.equal(
            units(5)
        );
    });

    it("should allow the owner to end the donation event after reaching cap or end timestamp", async () => {
        await expect(donation.endDonation()).to.be.revertedWithCustomError(
            donation,
            "InactiveDonation"
        );

        let start = (await currentTimestamp()) + 1000;
        await donation.newDonationEvent(
            units(5),
            units(5),
            units(1),
            start,
            0,
            1000
        );

        await expect(donation.endDonation()).to.be.revertedWithCustomError(
            donation,
            "OngoingDonation"
        );

        await timeTravel(1000);

        await donation.connect(user1).donate({ value: units(5) });

        await donation.endDonation();

        expect(await ethers.provider.getBalance(donation.address)).to.equal(0);

        start = (await currentTimestamp()) + 1000;
        await donation.newDonationEvent(
            units(5),
            units(5),
            units(1),
            start,
            0,
            1000
        );

        await expect(donation.endDonation()).to.be.revertedWithCustomError(
            donation,
            "OngoingDonation"
        );

        await timeTravel(2000);

        await donation.endDonation();
    });
});
