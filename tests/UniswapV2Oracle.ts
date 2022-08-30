import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import {
    UniswapV2Oracle,
    IUniswapV2Pair,
    IUniswapV2Pair__factory
} from "../types";
import { days, timeTravel, ZERO_ADDRESS } from "./utils";

const { expect } = chai;

chai.use(solidity);

describe("UniswapV2Oracle", () => {
    let weth: string = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    let jpeg: string = "0xE80C0cd204D654CEbe8dd64A4857cAb6Be8345a3";
    let pair: IUniswapV2Pair;
    let oracle: UniswapV2Oracle;

    beforeEach(async () => {
        pair = IUniswapV2Pair__factory.connect("0xdB06a76733528761Eda47d356647297bC35a98BD", (await ethers.getSigners())[0]);
        const Oracle = await ethers.getContractFactory("UniswapV2Oracle");
        oracle = await Oracle.deploy(pair.address);
    });

    it("should update prices", async () => {
        await expect(oracle.update()).to.be.revertedWith("PERIOD_NOT_ELAPSED");
        await timeTravel(days(3));
        await pair.sync();
        await oracle.update();
        const jpegPrice = await oracle.consult(weth, 1e18.toString());
        expect(jpegPrice).to.be.gt(0);
    });

    it("should update prices if necessary when calling consultAndUpdateIfNecessary", async () => {
        const last = await oracle.blockTimestampLast();
        expect(await oracle.callStatic.consultAndUpdateIfNecessary(weth, 1e18.toString())).to.equal(0);
        await oracle.consultAndUpdateIfNecessary(weth, 1e18.toString());
        expect(await oracle.blockTimestampLast()).to.equal(last);
        await timeTravel(days(3));
        await pair.sync();
        const price = await oracle.callStatic.consultAndUpdateIfNecessary(weth, 1e18.toString());
        expect(price).to.be.gt(0);
        await oracle.consultAndUpdateIfNecessary(weth, 1e18.toString());
        expect(await oracle.blockTimestampLast()).to.be.gt(last);
        expect(await oracle.consult(weth, 1e18.toString())).to.equal(price);
    });

    it("should return the correct price without updating when calling consultUpdated", async () => {
        const last = await oracle.blockTimestampLast();
        await timeTravel(days(3));
        await pair.sync();
        const price = await oracle.consultUpdated(jpeg, 1e18.toString());
        expect(price).to.be.gt(0);
        expect(await oracle.blockTimestampLast()).to.eq(last);
        await oracle.update();
        expect(await oracle.consult(jpeg, 1e18.toString())).to.eq(price);
    });

    it("should revert if called with a wrong token address", async() => {
        await expect(oracle.consult(ZERO_ADDRESS, 0)).to.be.revertedWith("INVALID_TOKEN");
        await expect(oracle.consultUpdated(ZERO_ADDRESS, 0)).to.be.revertedWith("INVALID_TOKEN");
        await expect(oracle.consultAndUpdateIfNecessary(ZERO_ADDRESS, 0)).to.be.revertedWith("INVALID_TOKEN");
    });
});
