import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { OracleFeed } from "../types";
import { units, currentTimestamp, bn } from "./utils";

const description = "JPEGd Price Oracle";

describe("OracleFeed", () => {
    let owner: SignerWithAddress,
        user: SignerWithAddress,
        oracleFeed: OracleFeed;

    beforeEach(async () => {
        [owner, user] = await ethers.getSigners();

        const OracleFeed = await ethers.getContractFactory("OracleFeed");
        oracleFeed = await OracleFeed.deploy(18, units(50), description);
    });

    it("owner should be able to update price", async () => {
        const newPrice = units(100);

        await expect(await oracleFeed.latestAnswer()).to.equal(units(50));

        await expect(oracleFeed.connect(user).updateAnswer(newPrice)).to.be
            .reverted;

        const ts = (await currentTimestamp()) + 1;
        await expect(oracleFeed.updateAnswer(newPrice))
            .to.emit(oracleFeed, "AnswerUpdated")
            .withArgs(newPrice, "0", ts);

        const { roundId, answer, startedAt, updatedAt, answeredInRound } =
            await oracleFeed.latestRoundData();
        expect(roundId).to.equal(0);
        expect(answer).to.equal(newPrice);
        expect(startedAt).to.equal(ts);
        expect(updatedAt).to.equal(ts);
        expect(answeredInRound).to.equal(0);
    });

    it("should be configured correctly", async () => {
        await expect(await oracleFeed.decimals()).to.equal(18);
        await expect(await oracleFeed.description()).to.equal(description);
    });
});
