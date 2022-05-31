import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import { Controller, MockStrategy, TestERC20, Vault } from "../types";
import { units, ZERO_ADDRESS } from "./utils";

const { expect } = chai;

chai.use(solidity);

const strategist_role =
  "0x17a8e30262c1f919c33056d877a3c22b95c2f5e4dac44683c1c2323cd79fbdb0";

describe("Vault", () => {
  let owner: SignerWithAddress,
    user1: SignerWithAddress;
  //we are mocking the strategy because setting up the test environment for
  //{StrategyPUSDConvex} is complicated, check StrategyPUSDConvex.ts
  let strategy: MockStrategy;
  let vault: Vault, controller: Controller;
  let want: TestERC20, reward: TestERC20;

  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    owner = accounts[0];
    user1 = accounts[1];

    const Controller = await ethers.getContractFactory("Controller");
    controller = await Controller.deploy(owner.address);
    await controller.deployed();

    await controller.grantRole(strategist_role, owner.address);

    const ERC20 = await ethers.getContractFactory("TestERC20");
    want = await ERC20.deploy("TEST", "TEST");
    reward = await ERC20.deploy("TEST", "TEST");

    const RewardPool = await ethers.getContractFactory("MockRewardPool");
    
    const rewardPool = await RewardPool.deploy(
      want.address,
      reward.address,
      []
    );
    await rewardPool.deployed();

    const Strategy = await ethers.getContractFactory("MockStrategy");
    strategy = await Strategy.deploy(
      want.address,
      rewardPool.address
    );
    await strategy.deployed();

    await controller.approveStrategy(want.address, strategy.address);
    await controller.setStrategy(want.address, strategy.address);

    const Vault = await ethers.getContractFactory("Vault");

    await expect(
      Vault.deploy(want.address, ZERO_ADDRESS, {
        numerator: 95,
        denominator: 100,
      })
    ).to.be.revertedWith("INVALID_CONTROLLER");

    await expect(
      Vault.deploy(want.address, controller.address, {
        numerator: 0,
        denominator: 100,
      })
    ).to.be.revertedWith("INVALID_RATE");

    vault = await Vault.deploy(want.address, controller.address, {
      numerator: 95,
      denominator: 100,
    });
    await vault.deployed();

    await controller.setVault(want.address, vault.address);
  });

  it("should have the same decimals as the deposit want", async () => {
    await want.setDecimals(10);
    expect(await vault.decimals()).to.equal(10);

    await want.setDecimals(18);
    expect(await vault.decimals()).to.equal(18);
  });


  it("should allow users to deposit", async () => {
    await want.mint(user1.address, units(1000));
    await want.connect(user1).approve(vault.address, units(1000));

    await expect(vault.connect(user1).deposit(0)).to.be.revertedWith(
      "INVALID_AMOUNT"
    );

    await vault.connect(user1).deposit(units(500));
    expect(await vault.balanceOf(user1.address)).to.equal(units(500));
    await vault.connect(user1).depositAll();
    expect(await vault.balanceOf(user1.address)).to.equal(units(1000));
  });

  it("should mint the correct amount of tokens", async () => {
    expect(await vault.getPricePerFullShare()).to.equal(0);
    await want.mint(user1.address, units(1000));
    await want.connect(user1).approve(vault.address, units(1000));

    await vault.connect(user1).deposit(units(500));
    expect(await vault.balanceOf(user1.address)).to.equal(units(500));

    await want.mint(strategy.address, units(500));

    expect(await vault.getPricePerFullShare()).to.equal(units(2));

    await vault.connect(user1).deposit(units(500));
    expect(await vault.balanceOf(user1.address)).to.equal(units(750));
  });

  it("should deposits tokens into the strategy when calling earn", async () => {
    await want.mint(user1.address, units(1000));
    await want.connect(user1).approve(vault.address, units(1000));

    await vault.connect(user1).depositAll();
    const available = await vault.available();

    expect(available).to.equal(units(950));

    await vault.earn();

    expect(await want.balanceOf(strategy.address)).to.equal(units(950));
    expect(await want.balanceOf(vault.address)).to.equal(units(50));
  });

  it("should withdraw the correct amount of tokens", async () => {
    await want.mint(user1.address, units(1000));
    await want.connect(user1).approve(vault.address, units(1000));

    await expect(vault.connect(user1).withdraw(0)).to.be.revertedWith(
      "INVALID_AMOUNT"
    );
    await expect(vault.connect(user1).withdraw(units(500))).to.be.revertedWith(
      "NO_TOKENS_DEPOSITED"
    );

    await vault.connect(user1).depositAll();

    await vault.connect(user1).withdraw(units(500));
    expect(await want.balanceOf(user1.address)).to.equal(units(500));

    await want.mint(strategy.address, units(500));

    await vault.connect(user1).withdraw(units(250));
    expect(await want.balanceOf(user1.address)).to.equal(units(1000));
    expect(await want.balanceOf(vault.address)).to.equal(0);
    expect(await want.balanceOf(strategy.address)).to.equal(units(500));

    await vault.connect(user1).withdrawAll();
    expect(await want.balanceOf(user1.address)).to.equal(units(1500));
  });
});
