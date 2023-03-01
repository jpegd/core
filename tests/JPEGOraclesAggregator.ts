import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import { JPEG, JPEGOraclesAggregator } from "../types";
import { units } from "./utils";

const { expect } = chai;

chai.use(solidity);

const minterRole =
    "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";

describe("JPEGOraclesAggregator", () => {
    let owner: SignerWithAddress,
        user: SignerWithAddress,
        jpegOraclesAggregator: JPEGOraclesAggregator,
        jpeg: JPEG;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user = accounts[1];

        const MockOracle = await ethers.getContractFactory(
            "UniswapV2MockOracle"
        );
        let jpegOracle = await MockOracle.deploy(1000000000000000);

        const JPEG = await ethers.getContractFactory("JPEG");

        jpeg = await JPEG.deploy(units(1000000000));

        await jpeg.grantRole(minterRole, owner.address);

        const JPEGOraclesAggregator = await ethers.getContractFactory(
            "JPEGOraclesAggregator"
        );
        jpegOraclesAggregator = await JPEGOraclesAggregator.deploy(
            jpegOracle.address
        );
    });

    it("should return floor prices from different oracles based on the caller's address", async () => {
        const MockAggregator = await ethers.getContractFactory(
            "MockV3Aggregator"
        );

        await jpegOraclesAggregator.addFloorOracle(
            (
                await MockAggregator.deploy(18, units(50))
            ).address,
            owner.address
        );
        await jpegOraclesAggregator.addFloorOracle(
            (
                await MockAggregator.deploy(18, units(10))
            ).address,
            user.address
        );

        expect(await jpegOraclesAggregator.getFloorETH()).to.equal(units(50));
        expect(
            await jpegOraclesAggregator.connect(user).getFloorETH()
        ).to.equal(units(10));
    });

    it("should return the correct JPEG price", async () => {
        expect(
            await jpegOraclesAggregator.callStatic.consultJPEGPriceETH(
                jpeg.address
            )
        ).to.equal(1000000000000000);
    });
});
