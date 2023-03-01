import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import { JPEGAirdrop, JPEG } from "../types";
import { units, currentTimestamp, days } from "./utils";

const { expect } = chai;

chai.use(solidity);

const vesting_controller_role =
    "0xc23e4cf9f9c5137c948ad4a95211794895d43271639a97b001bd23951d54c84a";

describe("JPEGAirdrop", () => {
    let owner: SignerWithAddress;
    let jpeg: JPEG, aJpeg: JPEGAirdrop;
    let vestingStart: number;
    let cliffDuration = days(1);
    let vestingDuration = days(365) * 2;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];

        const JPEG = await ethers.getContractFactory("JPEG");
        jpeg = await JPEG.deploy(units(1000000000)); // 1B JPEG'd
        await jpeg.deployed();
        const JPEGAirdrop = await ethers.getContractFactory("JPEGAirdrop");

        aJpeg = await JPEGAirdrop.deploy(jpeg.address);
        await aJpeg.deployed();

        await aJpeg.grantRole(vesting_controller_role, owner.address);

        vestingStart = (await currentTimestamp()) - vestingDuration / 2;
    });

    it("should allow setting a past timestamp as the start", async () => {
        await jpeg.approve(aJpeg.address, units(1000000000));

        await aJpeg.vestTokens(
            owner.address,
            units(1000000000),
            vestingStart,
            cliffDuration,
            vestingDuration
        );

        expect(await aJpeg.balanceOf(owner.address)).to.equal(
            units(1000000000)
        );
        expect(await aJpeg.vestedAmount(owner.address)).to.be.closeTo(
            units(1000000000).div(2),
            units(100) as any
        );

        await aJpeg.release();
        expect(await jpeg.balanceOf(owner.address)).to.be.closeTo(
            units(1000000000).div(2),
            units(100) as any
        );
        expect(await aJpeg.balanceOf(owner.address)).to.be.closeTo(
            units(1000000000).div(2),
            units(100) as any
        );
    });

    it("should return 'airdropJPEG' as the name and 'aJPEG' as the symbol", async () => {
        expect(await aJpeg.name()).to.equal("airdropJPEG");
        expect(await aJpeg.symbol()).to.equal("aJPEG");
    });
});
