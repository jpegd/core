import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { CappedETHDonation } from "../types";

import { keccak256 } from "@ethersproject/keccak256";

import { MerkleTree } from "merkletreejs";
import { currentTimestamp, days, timeTravel, units } from "./utils";


const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("CappedETHDonation", () => {

	let donation: CappedETHDonation;
	let owner: SignerWithAddress;
	let user1: SignerWithAddress;
	let user2: SignerWithAddress;

	beforeEach(async () => {
		const accounts = await ethers.getSigners();
        owner = accounts[0];
        user1 = accounts[1];
		user2 = accounts[2];

		const Donation = await ethers.getContractFactory("CappedETHDonation");
		donation = await Donation.deploy();
	});

	it("should allow the owner to create a new donation event without a whitelist", async () => {
		await expect(donation.newDonationEvent(0, 0, 0, ZERO_HASH, 0, 0, 0)).to.be.revertedWith("InvalidAmount()");
		await expect(donation.newDonationEvent(units(10), 0, 0, ZERO_HASH, 0, 0, 0)).to.be.revertedWith("InvalidAmount()");
		await expect(donation.newDonationEvent(units(10), units(5), 0, ZERO_HASH, 0, 0, 0)).to.be.revertedWith("InvalidStart()");

		const start = (await currentTimestamp()) + 1000;

		await expect(donation.newDonationEvent(units(10), units(5), 0, ZERO_HASH, start, 0, 0)).to.be.revertedWith("InvalidDuration()");

		await donation.newDonationEvent(units(10), units(5), 0, ZERO_HASH, start, 0, 1000);

		const event = await donation.donationEvents(0);

		expect(event.totalCap).to.equal(units(10));
		expect(event.walletCap).to.equal(units(5));
		expect(event.whitelistCap).to.equal(0);
		expect(event.whitelistRoot).to.equal(ZERO_HASH);
		expect(event.start).to.equal(start);
		expect(event.whitelistEnd).to.equal(start);
		expect(event.end).to.equal(start + 1000);
		expect(event.donatedAmount).to.equal(0);
	});

	it("should allow the owner to create a new donation event with a whitelist", async () => {
		const start = (await currentTimestamp()) + 1000;

		await expect(donation.newDonationEvent(units(10), units(5), 0, ZERO_HASH, start, 100, 1000)).to.be.revertedWith("InvalidAmount()");
		await expect(donation.newDonationEvent(units(10), units(5), units(1), ZERO_HASH, start, 100, 1000)).to.be.revertedWith("ZeroRoot()");
		
		await donation.newDonationEvent(units(10), units(5), units(1), keccak256("0x01"), start, 100, 1000);

		const event = await donation.donationEvents(0);

		expect(event.totalCap).to.equal(units(10));
		expect(event.walletCap).to.equal(units(5));
		expect(event.whitelistCap).to.equal(units(1));
		expect(event.whitelistRoot).to.equal(keccak256("0x01"));
		expect(event.start).to.equal(start);
		expect(event.whitelistEnd).to.equal(start + 100);
		expect(event.end).to.equal(start + 100 + 1000);
		expect(event.donatedAmount).to.equal(0);
	});

	it("should allow users to donate", async () => {
		const start = (await currentTimestamp()) + 1000;
		await donation.newDonationEvent(units(10), units(5), units(1), keccak256("0x01"), start, 100, 1000);

		await expect(donation.connect(user1).donate({ value: units(1) })).to.be.revertedWith("InactiveDonation()");
		
		await timeTravel(1000);
		await expect(donation.connect(user1).donate({ value: units(1) })).to.be.revertedWith("InactiveDonation()");

		await timeTravel(100);
		await expect(donation.connect(user1).donate({ value: 0 })).to.be.revertedWith("InvalidAmount()");
		await expect(donation.connect(user1).donate({ value: units(10) })).to.be.revertedWith("InvalidAmount()");

		await donation.connect(user1).donate({ value: units(3) });

		let event = await donation.donationEvents(0);
		expect(event.donatedAmount).to.equal(units(3));

		expect(await donation.donatedAmount(0, user1.address)).to.equal(units(3));

		await expect(donation.connect(user1).donate({ value: units(3) })).to.be.revertedWith("InvalidAmount()");
		
		await donation.connect(user1).donate({ value: units(2) });

		event = await donation.donationEvents(0);
		expect(event.donatedAmount).to.equal(units(5));

		expect(await donation.donatedAmount(0, user1.address)).to.equal(units(5));

		await timeTravel(1000);

		await expect(donation.connect(user1).donate({ value: units(1) })).to.be.revertedWith("InactiveDonation()");
	});

	it("should allow whitelisted users to donate", async () => {
		const leafs = [user1, user2].map(wl => keccak256(wl.address));
        const merkleTree = new MerkleTree(leafs, keccak256, { sortPairs: true });

		const start = (await currentTimestamp()) + 1000;
		await donation.newDonationEvent(units(10), units(5), units(1), merkleTree.getHexRoot(), start, 100, 1000);

		const proof1 = merkleTree.getHexProof(keccak256(user1.address));

		await expect(donation.connect(user1).donateWhitelist(proof1, { value: units(1) })).to.be.revertedWith("InactiveDonation()");
		await timeTravel(1000);

		await expect(donation.donateWhitelist(proof1, { value: units(1) })).to.be.revertedWith("InvalidProof()");

		await expect(donation.connect(user1).donateWhitelist(proof1, { value: 0 })).to.be.revertedWith("InvalidAmount()");
		await expect(donation.connect(user1).donateWhitelist(proof1, { value: units(2) })).to.be.revertedWith("InvalidAmount()");

		await donation.connect(user1).donateWhitelist(proof1, { value: units(.5) });

		let event = await donation.donationEvents(0);
		expect(event.donatedAmount).to.equal(units(.5));

		expect(await donation.donatedAmount(0, user1.address)).to.equal(units(.5));

		await expect(donation.connect(user1).donateWhitelist(proof1, { value: units(1) })).to.be.revertedWith("InvalidAmount()");

		await donation.connect(user1).donateWhitelist(proof1, { value: units(.5) });
		event = await donation.donationEvents(0);
		expect(event.donatedAmount).to.equal(units(1));

		expect(await donation.donatedAmount(0, user1.address)).to.equal(units(1));

		await timeTravel(100);

		await expect(donation.connect(user1).donateWhitelist(proof1, { value: units(1) })).to.be.revertedWith("InactiveDonation()");

		await expect(donation.connect(user1).donate({ value: units(5) })).to.be.revertedWith("InvalidAmount()");
		
		await donation.connect(user1).donate({ value: units(4) });

		event = await donation.donationEvents(0);
		expect(event.donatedAmount).to.equal(units(5));

		expect(await donation.donatedAmount(0, user1.address)).to.equal(units(5));
	});

	it("should allow the owner to end the donation event after reaching cap or end timestamp", async () => {
		await expect(donation.endDonation()).to.be.revertedWith("InactiveDonation()");
		
		let start = (await currentTimestamp()) + 1000;
		await donation.newDonationEvent(units(5), units(5), units(1), ZERO_HASH, start, 0, 1000);

		await expect(donation.endDonation()).to.be.revertedWith("OngoingDonation()");

		await timeTravel(1000);

		await donation.connect(user1).donate({ value: units(5) });

		await donation.endDonation();

		expect(await ethers.provider.getBalance(donation.address)).to.equal(0);

		start = (await currentTimestamp()) + 1000;
		await donation.newDonationEvent(units(5), units(5), units(1), ZERO_HASH, start, 0, 1000);

		await expect(donation.endDonation()).to.be.revertedWith("OngoingDonation()");

		await timeTravel(2000);

		await donation.endDonation();
	});
});