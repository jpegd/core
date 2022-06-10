import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, upgrades } from "hardhat";
import {
  NFTVault,
  NFTVaultSetter,
} from "../types";
import {
  units,
  bn,
} from "./utils";

const { expect } = chai;

chai.use(solidity);

const setter_role = "0x61c92169ef077349011ff0b1383c894d86c5f0b41d986366b58a6cf31e93beda";

describe("NFTVaultSetter", () => {
  let owner: SignerWithAddress;
  let nftVault: NFTVault,
    nftVaultSetter: NFTVaultSetter;
  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    owner = accounts[0];

    const ERC721 = await ethers.getContractFactory("TestERC721");
    const erc721 = await ERC721.deploy();

    const CigStaking = await ethers.getContractFactory("JPEGCardsCigStaking");
    const cigStaking = await CigStaking.deploy(erc721.address, [200]);

    const StableCoin = await ethers.getContractFactory("StableCoin");
    const stablecoin = await StableCoin.deploy();

    const MockAggregator = await ethers.getContractFactory("MockV3Aggregator");

    const ethOracle = await MockAggregator.deploy(8, 3000e8);

    const floorOracle = await MockAggregator.deploy(18, units(50));

    const JPEG = await ethers.getContractFactory("JPEG");
    const jpeg = await JPEG.deploy(units(1000000000));

    const NFTVault = await ethers.getContractFactory("NFTVault");
    nftVault = <NFTVault>await upgrades.deployProxy(NFTVault, [
      stablecoin.address,
      jpeg.address,
      erc721.address,
      ethOracle.address,
      floorOracle.address,
      [],
      cigStaking.address,
      [
        [2, 100], //debtInterestApr
        [32, 100], //creditLimitRate
        [33, 100], //liquidationLimitRate
        [39, 100], //cigStakedCreditLimitRate
        [40, 100], //cigStakedLiquidationLimitRate
        [25, 100], //valueIncreaseLockRate
        [5, 1000], //organizationFeeRate
        [1, 100], //insuranchePurchaseRate
        [25, 100], //insuranceLiquidationPenaltyRate
        86400 * 3, //insuranceRepurchaseLimit
        units(3000).mul(1000), //borrowAmountCap
      ],
    ]);

    const NFTVaultSetter = await ethers.getContractFactory("NFTVaultSetter");
    nftVaultSetter = await NFTVaultSetter.deploy();
    
    await nftVault.grantRole(setter_role, nftVaultSetter.address);
  });

  it("should be able to update borrowAmountCap", async () => {
    await nftVaultSetter.setBorrowAmountCap(nftVault.address, units(3000).mul(2000));
    expect((await nftVault.settings()).borrowAmountCap).to.equal(
      units(3000).mul(2000)
    );
  });

  it("should be able to update insuranceRepurchaseTimeLimit", async () => {
    await expect(nftVaultSetter.setInsuranceRepurchaseTimeLimit(nftVault.address, 0)).to.be.revertedWith("invalid_limit");
    await nftVaultSetter.setInsuranceRepurchaseTimeLimit(nftVault.address, 1);

    expect((await nftVault.settings()).insuranceRepurchaseTimeLimit).to.equal(1);
  });

  it("should be able to update debtInterestApr", async () => {
    expect((await nftVault.settings()).debtInterestApr).to.deep.equal([
      bn(2),
      bn(100),
    ]);
    await nftVaultSetter.setDebtInterestApr(nftVault.address, { numerator: 3, denominator: 100 });
    expect((await nftVault.settings()).debtInterestApr).to.deep.equal([
      bn(3),
      bn(100),
    ]);
  });

  it("should be able to update creditLimitRate", async () => {
    expect((await nftVault.settings()).creditLimitRate).to.deep.equal([
      bn(32),
      bn(100),
    ]);
    expect((await nftVault.settings()).liquidationLimitRate).to.deep.equal([
      bn(33),
      bn(100),
    ]);
    await expect(
      nftVaultSetter.setCreditLimitRate(nftVault.address, { numerator: 101, denominator: 100 })
    ).to.revertedWith("invalid_rate");
    await expect(
      nftVaultSetter.setCreditLimitRate(nftVault.address, { numerator: 34, denominator: 100 })
    ).to.revertedWith("invalid_credit_limit");
    await nftVaultSetter.setStakedCigLiquidationLimitRate(nftVault.address, { numerator: 41, denominator: 100 });
    await nftVaultSetter.setLiquidationLimitRate(nftVault.address, { numerator: 40, denominator: 100 });
    await expect(
      nftVaultSetter.setCreditLimitRate(nftVault.address, { numerator: 39, denominator: 100 })
    ).to.revertedWith("invalid_credit_limit");
    await nftVaultSetter.setCreditLimitRate(nftVault.address, { numerator: 31, denominator: 100 });
    expect((await nftVault.settings()).creditLimitRate).to.deep.equal([
      bn(31),
      bn(100),
    ]);
    expect((await nftVault.settings()).liquidationLimitRate).to.deep.equal([
      bn(40),
      bn(100),
    ]);
  });

  it("should be able to update liquidationLimitRate", async () => {
    expect((await nftVault.settings()).creditLimitRate).to.deep.equal([
      bn(32),
      bn(100),
    ]);
    expect((await nftVault.settings()).liquidationLimitRate).to.deep.equal([
      bn(33),
      bn(100),
    ]);
    await expect(
      nftVaultSetter.setLiquidationLimitRate(nftVault.address, { numerator: 101, denominator: 100 })
    ).to.revertedWith("invalid_rate");
    await expect(
      nftVaultSetter.setLiquidationLimitRate(nftVault.address, { numerator: 30, denominator: 100 })
    ).revertedWith("invalid_liquidation_limit");
    await expect(
      nftVaultSetter.setLiquidationLimitRate(nftVault.address, { numerator: 40, denominator: 100 })
    ).revertedWith("invalid_liquidation_limit");
    await nftVaultSetter.setLiquidationLimitRate(nftVault.address, { numerator: 34, denominator: 100 });
    expect((await nftVault.settings()).creditLimitRate).to.deep.equal([
      bn(32),
      bn(100),
    ]);
    expect((await nftVault.settings()).liquidationLimitRate).to.deep.equal([
      bn(34),
      bn(100),
    ]);
  });

  it("should be able to update cigStakedLiquidationLimitRate", async () => {
    expect((await nftVault.settings()).cigStakedCreditLimitRate).to.deep.equal([
      bn(39),
      bn(100),
    ]);
    expect((await nftVault.settings()).cigStakedLiquidationLimitRate).to.deep.equal([
      bn(40),
      bn(100),
    ]);

    await expect(
      nftVaultSetter.setStakedCigLiquidationLimitRate(nftVault.address, { numerator: 101, denominator: 100 })
    ).to.revertedWith("invalid_rate");
    await expect(
      nftVaultSetter.setStakedCigLiquidationLimitRate(nftVault.address, { numerator: 39, denominator: 100 })
    ).revertedWith("invalid_cig_liquidation_limit");
    await nftVaultSetter.setStakedCigLiquidationLimitRate(nftVault.address, { numerator: 41, denominator: 100 });
    expect((await nftVault.settings()).cigStakedCreditLimitRate).to.deep.equal([
      bn(39),
      bn(100),
    ]);
    expect((await nftVault.settings()).cigStakedLiquidationLimitRate).to.deep.equal([
      bn(41),
      bn(100),
    ]);
  });

  it("should be able to update cigStakedcreditLimitRate", async () => {
    expect((await nftVault.settings()).cigStakedCreditLimitRate).to.deep.equal([
      bn(39),
      bn(100),
    ]);
    expect((await nftVault.settings()).cigStakedLiquidationLimitRate).to.deep.equal([
      bn(40),
      bn(100),
    ]);
    await expect(
      nftVaultSetter.setStakedCigCreditLimitRate(nftVault.address, { numerator: 101, denominator: 100 })
    ).to.revertedWith("invalid_rate");
    await expect(
      nftVaultSetter.setStakedCigCreditLimitRate(nftVault.address, { numerator: 40, denominator: 100 })
    ).to.revertedWith("invalid_cig_credit_limit");
    await expect(
      nftVaultSetter.setStakedCigCreditLimitRate(nftVault.address, { numerator: 32, denominator: 100 })
    ).to.revertedWith("invalid_cig_credit_limit");
    await nftVaultSetter.setStakedCigCreditLimitRate(nftVault.address, { numerator: 38, denominator: 100 });
    expect((await nftVault.settings()).cigStakedCreditLimitRate).to.deep.equal([
      bn(38),
      bn(100),
    ]);
    expect((await nftVault.settings()).cigStakedLiquidationLimitRate).to.deep.equal([
      bn(40),
      bn(100),
    ]);
  });

  it("should be able to update organizationFeeRate", async () => {
    expect((await nftVault.settings()).organizationFeeRate).to.deep.equal([
      bn(5),
      bn(1000),
    ]);
    await nftVaultSetter.setOrganizationFeeRate(nftVault.address, { numerator: 6, denominator: 1000 });
    expect((await nftVault.settings()).organizationFeeRate).to.deep.equal([
      bn(6),
      bn(1000),
    ]);
  });

  it("should be able to update insurancePurchaseRate", async () => {
    expect((await nftVault.settings()).insurancePurchaseRate).to.deep.equal([
      bn(1),
      bn(100),
    ]);
    await nftVaultSetter.setInsurancePurchaseRate(nftVault.address, { numerator: 2, denominator: 100 });
    expect((await nftVault.settings()).insurancePurchaseRate).to.deep.equal([
      bn(2),
      bn(100),
    ]);
  });

  it("should be able to update insuranceLiquidationPenaltyRate", async () => {
    expect(
      (await nftVault.settings()).insuranceLiquidationPenaltyRate
    ).to.deep.equal([bn(25), bn(100)]);
    await nftVaultSetter.setInsuranceLiquidationPenaltyRate(nftVault.address, { numerator: 26, denominator: 100 });
    expect(
      (await nftVault.settings()).insuranceLiquidationPenaltyRate
    ).to.deep.equal([bn(26), bn(100)]);
  });

  it("should be able to update valueIncreaseLockRate", async () => {
    expect(
      (await nftVault.settings()).valueIncreaseLockRate
    ).to.deep.equal([bn(25), bn(100)]);
    await nftVaultSetter.setValueIncreaseLockRate(nftVault.address, { numerator: 26, denominator: 100 });
    expect(
      (await nftVault.settings()).valueIncreaseLockRate
    ).to.deep.equal([bn(26), bn(100)]);
  });
});
