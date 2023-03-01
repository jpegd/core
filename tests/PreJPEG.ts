import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, network } from "hardhat";
import { JPEG, PreJPEG } from "../types";
import { units, currentTimestamp, days } from "./utils";

const { expect } = chai;

chai.use(solidity);

const vesting_controller_role =
    "0xc23e4cf9f9c5137c948ad4a95211794895d43271639a97b001bd23951d54c84a";

describe("PreJPEG", () => {
    let owner: SignerWithAddress;
    let jpeg: JPEG, preJpeg: PreJPEG;
    let vestingDelay = days(1);
    let vestingStart: number;
    let cliffDuration = days(1);
    let vestingDuration = days(365) * 2;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];

        const JPEG = await ethers.getContractFactory("JPEG");
        jpeg = await JPEG.deploy(units(1000000000)); // 1B JPEG'd
        await jpeg.deployed();
        const PreJPEG = await ethers.getContractFactory("PreJPEG");
        vestingStart = (await currentTimestamp()) + vestingDelay;

        preJpeg = await PreJPEG.deploy(jpeg.address);
        await preJpeg.deployed();

        await preJpeg.grantRole(vesting_controller_role, owner.address);
    });

    it("should mint PreJPEG tokens on new vesting", async () => {
        await jpeg.approve(preJpeg.address, units(1000000000));

        await preJpeg.vestTokens(
            owner.address,
            units(1000000000),
            vestingStart,
            cliffDuration,
            vestingDuration
        );

        expect(await preJpeg.balanceOf(owner.address)).to.equal(
            units(1000000000)
        );
    });

    it("should burn all tokens on revoke", async () => {
        await jpeg.approve(preJpeg.address, units(1000000000));
        await preJpeg.vestTokens(
            owner.address,
            units(1000000000),
            vestingStart,
            cliffDuration,
            vestingDuration
        );

        await preJpeg.revoke(owner.address);

        expect(await preJpeg.balanceOf(owner.address)).to.equal(0);
    });

    it("should burn tokens on release", async () => {
        await jpeg.approve(preJpeg.address, units(1000000000));
        await preJpeg.vestTokens(
            owner.address,
            units(1000000000),
            vestingStart,
            cliffDuration,
            vestingDuration
        );

        await network.provider.send("evm_setNextBlockTimestamp", [
            vestingStart + vestingDuration / 2
        ]);
        await preJpeg.release();

        expect(await preJpeg.balanceOf(owner.address)).to.be.closeTo(
            units(500000000),
            units(100) as any
        );
    });

    it("should not allow transfers", async () => {
        await jpeg.approve(preJpeg.address, units(1000000000));
        await preJpeg.vestTokens(
            owner.address,
            units(1000000000),
            vestingStart,
            cliffDuration,
            vestingDuration
        );

        await expect(preJpeg.transfer(owner.address, 1)).to.be.revertedWith(
            "Transfers are locked"
        );
    });
});
