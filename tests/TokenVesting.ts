import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, network } from "hardhat";
import { JPEG, TokenVesting } from "../types";
import { ZERO_ADDRESS, units, currentTimestamp, days } from "./utils";

const { expect } = chai;

chai.use(solidity);

const vesting_controller_role =
    "0xc23e4cf9f9c5137c948ad4a95211794895d43271639a97b001bd23951d54c84a";

describe("TokenVesting", () => {
    let owner: SignerWithAddress,
        user1: SignerWithAddress,
        user2: SignerWithAddress,
        user3: SignerWithAddress;
    let jpeg: JPEG, tokenVesting: TokenVesting;
    let vestingDelay = days(1);
    let vestingStart: number;
    let cliffDuration = days(1);
    let vestingDuration = days(365) * 2;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user1 = accounts[1];
        user2 = accounts[2];
        user3 = accounts[3];

        const JPEG = await ethers.getContractFactory("JPEG");
        jpeg = await JPEG.deploy(units(1000000000)); // 1B JPEG'd
        await jpeg.deployed();
        const TokenVesting = await ethers.getContractFactory("TokenVesting");
        vestingStart = (await currentTimestamp()) + vestingDelay;

        await expect(TokenVesting.deploy(ZERO_ADDRESS)).to.be.revertedWith(
            "Invalid token"
        );

        tokenVesting = await TokenVesting.deploy(jpeg.address);
        await tokenVesting.deployed();

        await tokenVesting.grantRole(vesting_controller_role, owner.address);
    });

    it("should allow members of the vesting_controller role to vest tokens", async () => {
        await jpeg.approve(tokenVesting.address, units(1000000000));

        await expect(
            tokenVesting.vestTokens(
                ZERO_ADDRESS,
                units(1000000000),
                vestingStart,
                cliffDuration,
                vestingDuration
            )
        ).to.be.revertedWith("Invalid beneficiary");

        await expect(
            tokenVesting.vestTokens(
                user1.address,
                0,
                vestingStart,
                cliffDuration,
                vestingDuration
            )
        ).to.be.revertedWith("Invalid allocation");

        await expect(
            tokenVesting.vestTokens(
                user1.address,
                units(1000000000),
                0,
                cliffDuration,
                vestingDuration
            )
        ).to.be.revertedWith("Invalid start");

        await expect(
            tokenVesting.vestTokens(
                user1.address,
                units(1000000000),
                vestingStart,
                vestingDuration,
                vestingDuration
            )
        ).to.be.revertedWith("Invalid cliff");

        await expect(
            tokenVesting.vestTokens(
                user1.address,
                units(1000000000),
                vestingStart,
                cliffDuration,
                0
            )
        ).to.be.revertedWith("Invalid duration");

        await tokenVesting.vestTokens(
            user1.address,
            units(1000000000),
            vestingStart,
            cliffDuration,
            vestingDuration
        );

        const schedule = await tokenVesting.vestingSchedules(user1.address);
        expect(schedule.totalAllocation).to.equal(units(1000000000));
        expect(schedule.start).to.equal(vestingStart);
        expect(schedule.cliffDuration).to.equal(cliffDuration);
        expect(schedule.duration).to.equal(vestingDuration);
        expect(schedule.released).to.equal(0);

        await expect(
            tokenVesting.vestTokens(
                user1.address,
                units(1000000000),
                vestingStart,
                cliffDuration,
                vestingDuration
            )
        ).to.be.revertedWith("Beneficiary already exists");
    });

    it("shouldn't allow to release vested tokens before vesting starts", async () => {
        await jpeg.approve(tokenVesting.address, units(1000000000));
        await tokenVesting.vestTokens(
            user1.address,
            units(1000000000),
            vestingStart,
            0,
            vestingDuration
        );

        expect(await tokenVesting.releasableAmount(user1.address)).to.equal(0);
    });

    it("should allow users to release", async () => {
        await jpeg.approve(tokenVesting.address, units(1000000000));
        await tokenVesting.vestTokens(
            user1.address,
            units(1000000000),
            vestingStart,
            0,
            vestingDuration
        );

        await network.provider.send("evm_setNextBlockTimestamp", [
            vestingStart + vestingDuration / 2
        ]);
        await network.provider.send("evm_mine", []);
        const releasableAmount = await tokenVesting.releasableAmount(
            user1.address
        );
        const lockedAmount = await tokenVesting.lockedAmount(user1.address);
        const vestedAmount = await tokenVesting.vestedAmount(user1.address);

        expect(releasableAmount).to.equal(vestedAmount);
        expect(releasableAmount).to.be.closeTo(lockedAmount, units(100) as any);
        expect(releasableAmount).to.be.closeTo(
            units(1000000000).div(2),
            units(100) as any
        );

        await expect(tokenVesting.release()).to.be.revertedWith(
            "No releasable tokens"
        );
        await tokenVesting.connect(user1).release();

        //a second has passed since we called the releasableAmount function
        expect(await jpeg.balanceOf(user1.address)).to.be.closeTo(
            releasableAmount,
            units(100) as any
        );
        expect(
            await tokenVesting.releasableAmount(user1.address)
        ).to.be.closeTo(units(0), units(100) as any);
        expect(await tokenVesting.lockedAmount(user1.address)).to.be.closeTo(
            lockedAmount,
            units(100) as any
        );
        expect(await tokenVesting.vestedAmount(user1.address)).to.be.closeTo(
            vestedAmount,
            units(100) as any
        );
    });

    it("should not emit tokens during the cliff period", async () => {
        await jpeg.approve(tokenVesting.address, units(1000000000));
        await tokenVesting.vestTokens(
            user1.address,
            units(1000000000),
            vestingStart,
            cliffDuration,
            vestingDuration
        );

        await network.provider.send("evm_setNextBlockTimestamp", [
            vestingStart + cliffDuration / 2
        ]);
        await network.provider.send("evm_mine", []);
        expect(await tokenVesting.releasableAmount(user1.address)).to.equal(0);
        await network.provider.send("evm_setNextBlockTimestamp", [
            vestingStart + cliffDuration
        ]);
        await network.provider.send("evm_mine", []);
        expect(
            await tokenVesting.releasableAmount(user1.address)
        ).to.be.closeTo(units(1369863), units(100) as any);
    });

    it("should allow to claim all the tokens after vesting is over", async () => {
        await jpeg.approve(tokenVesting.address, units(1000000000));
        await tokenVesting.vestTokens(
            user1.address,
            units(1000000000),
            vestingStart,
            cliffDuration,
            vestingDuration
        );

        await network.provider.send("evm_setNextBlockTimestamp", [
            vestingStart + vestingDuration - 1
        ]);
        await network.provider.send("evm_mine", []);

        expect(
            await tokenVesting.releasableAmount(user1.address)
        ).to.be.closeTo(units(1000000000), units(100) as any);
        await network.provider.send("evm_mine", []);
        expect(await tokenVesting.releasableAmount(user1.address)).to.equal(
            units(1000000000)
        );
        await tokenVesting.connect(user1).release();
        expect(await jpeg.balanceOf(user1.address)).to.equal(units(1000000000));
    });

    it("should allow the owner to revoke tokens", async () => {
        await jpeg.approve(tokenVesting.address, units(1000000000));
        await tokenVesting.vestTokens(
            user1.address,
            units(500000000),
            vestingStart,
            cliffDuration,
            vestingDuration
        );

        await tokenVesting.vestTokens(
            user2.address,
            units(500000000),
            vestingStart,
            cliffDuration,
            vestingDuration
        );

        await expect(tokenVesting.revoke(owner.address)).to.be.revertedWith(
            "Beneficiary doesn't exist"
        );

        await network.provider.send("evm_setNextBlockTimestamp", [
            vestingStart + vestingDuration / 2
        ]);

        await tokenVesting.connect(user1).release();
        await tokenVesting.revoke(user1.address);
        expect(await jpeg.balanceOf(owner.address)).to.be.closeTo(
            units(250000000),
            units(100) as any
        );

        await network.provider.send("evm_setNextBlockTimestamp", [
            vestingStart + vestingDuration
        ]);
        await network.provider.send("evm_mine", []);

        await tokenVesting.connect(user2).release();
        await expect(tokenVesting.revoke(user2.address)).to.be.revertedWith(
            "All tokens unlocked"
        );
    });
});
