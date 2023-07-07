import { expect } from "chai";
import { ethers } from "hardhat";
import { MockNoContract } from "../types";

describe("NoContract", () => {
    let mockNoContract: MockNoContract;

    beforeEach(async () => {
        const Mock = await ethers.getContractFactory("MockNoContract");
        mockNoContract = await Mock.deploy();
        await mockNoContract.deployed();
    });

    it("should allow EOAs to call protected functions", async () => {
        await mockNoContract.protectedFunction();
    });

    it("shouldn't allow contracts to call protected functions", async () => {
        await expect(mockNoContract.callProtectedFunction()).to.be.revertedWith(
            "NO_CONTRACTS"
        );
    });

    it("should allow whitelisted contracts to call protected functions", async () => {
        await mockNoContract.setContractWhitelisted(
            mockNoContract.address,
            true
        );
        await mockNoContract.callProtectedFunction();
    });
});
