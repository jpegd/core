import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { JPEGAirdropClaim, JPEG, JPEGAirdrop } from "../types";

import { MerkleTree } from "merkletreejs";
import { keccak256 } from "@ethersproject/keccak256";
import { currentTimestamp, days, units, ZERO_ADDRESS } from "./utils";

const vesting_controller_role =
    "0xc23e4cf9f9c5137c948ad4a95211794895d43271639a97b001bd23951d54c84a";

describe("JPEGAirdropClaim", function () {
    let owner: SignerWithAddress,
        whitelistedUser1: SignerWithAddress,
        whitelistedUser2: SignerWithAddress,
        user: SignerWithAddress;

    let merkleTree: MerkleTree;

    let airdropClaim: JPEGAirdropClaim;
    let jpeg: JPEG;
    let aJpeg: JPEGAirdrop;

    let vestingStart: number;
    let cliffDuration = days(1);
    let vestingDuration = days(365) * 2;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        whitelistedUser1 = accounts[1];
        whitelistedUser2 = accounts[2];
        user = accounts[3];

        const JPEG = await ethers.getContractFactory("JPEG");
        jpeg = await JPEG.deploy(units(1000000000)); // 1B JPEG'd
        await jpeg.deployed();
        const JPEGAirdrop = await ethers.getContractFactory("JPEGAirdrop");

        aJpeg = await JPEGAirdrop.deploy(jpeg.address);
        await aJpeg.deployed();

        const leafs = [whitelistedUser1, whitelistedUser2].map(wl =>
            keccak256(wl.address)
        );
        merkleTree = new MerkleTree(leafs, keccak256, { sortPairs: true });

        const JPEGAirdropClaim = await ethers.getContractFactory(
            "JPEGAirdropClaim"
        );
        airdropClaim = await JPEGAirdropClaim.deploy(
            aJpeg.address,
            merkleTree.getHexRoot()
        );

        await aJpeg.grantRole(vesting_controller_role, airdropClaim.address);

        jpeg.transfer(airdropClaim.address, units(1000000000));

        vestingStart = (await currentTimestamp()) - vestingDuration / 2;
    });

    it("should allow the owner to set the airdrop's schedule", async () => {
        await expect(
            airdropClaim.setAidropSchedule(
                0,
                cliffDuration,
                vestingDuration,
                units(1000000000)
            )
        ).to.be.revertedWith("INVALID_START_TIMESTAMP");

        await expect(
            airdropClaim.setAidropSchedule(
                vestingStart,
                0,
                0,
                units(1000000000)
            )
        ).to.be.revertedWith("INVALID_END_TIMESTAMP");

        await expect(
            airdropClaim.setAidropSchedule(
                vestingStart,
                cliffDuration,
                vestingDuration,
                0
            )
        ).to.be.revertedWith("INVALID_AIRDROP_AMOUNT");

        await airdropClaim.setAidropSchedule(
            vestingStart,
            cliffDuration,
            vestingDuration,
            units(1000000000)
        );

        await expect(
            airdropClaim.setAidropSchedule(
                vestingStart,
                cliffDuration,
                vestingDuration,
                units(1000000000)
            )
        ).to.be.revertedWith("SCHEDULE_ALREADY_SET");
    });

    it("shouldn't allow whitelisted users to claim the airdrop before the schedule is set", async () => {
        const proof = merkleTree.getHexProof(
            keccak256(whitelistedUser1.address)
        );

        await expect(
            airdropClaim.connect(whitelistedUser1).claimAirdrop(proof)
        ).to.be.revertedWith("SCHEDULE_NOT_SET");
    });

    it("should allow whitelisted users to claim after the schedule has been set", async () => {
        await airdropClaim.setAidropSchedule(
            vestingStart,
            cliffDuration,
            vestingDuration,
            units(1000000000)
        );

        const proof = merkleTree.getHexProof(
            keccak256(whitelistedUser1.address)
        );
        await airdropClaim.connect(whitelistedUser1).claimAirdrop(proof);

        expect(await aJpeg.balanceOf(whitelistedUser1.address)).to.equal(
            units(1000000000)
        );

        await expect(
            airdropClaim.connect(whitelistedUser1).claimAirdrop(proof)
        ).to.be.revertedWith("ALREADY_CLAIMED");
    });

    it("shouldn't allow non whitelisted users to claim", async () => {
        await airdropClaim.setAidropSchedule(
            vestingStart,
            cliffDuration,
            vestingDuration,
            units(1000000000)
        );

        const proof = merkleTree.getHexProof(
            keccak256(whitelistedUser1.address)
        );
        await expect(
            airdropClaim.connect(user).claimAirdrop(proof)
        ).to.be.revertedWith("INVALID_PROOF");
    });

    it("should allow the owner to withdraw tokens", async () => {
        await airdropClaim.rescueToken(jpeg.address, units(1000000000));

        expect(await jpeg.balanceOf(owner.address)).to.equal(units(1000000000));
    });
});
