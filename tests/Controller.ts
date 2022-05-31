import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import { Controller, JPEG, MockStrategy, TestERC20, Vault } from "../types";
import { units, ZERO_ADDRESS } from "./utils";

const { expect } = chai;

chai.use(solidity);

const strategist_role =
  "0x17a8e30262c1f919c33056d877a3c22b95c2f5e4dac44683c1c2323cd79fbdb0";

describe("Controller", () => {
  let owner: SignerWithAddress;
  //we are mocking the strategy because setting up the test environment for
  //{StrategyPUSDConvex} is complicated, check StrategyPUSDConvex.ts
  let strategy: MockStrategy;
  let vault: Vault, controller: Controller;
  let want: TestERC20, reward: TestERC20;

  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    owner = accounts[0];

    const Controller = await ethers.getContractFactory("Controller");
    controller = await Controller.deploy(owner.address);
    await controller.deployed();

    await controller.grantRole(strategist_role, owner.address);

    const ERC20 = await ethers.getContractFactory("TestERC20");
    want = await ERC20.deploy("TEST", "TEST");
    await want.deployed();

    reward = await ERC20.deploy("TEST", "TEST");
    await reward.deployed();


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

    const Vault = await ethers.getContractFactory("Vault");

    vault = await Vault.deploy(want.address, controller.address, {
      numerator: 95,
      denominator: 100,
    });
    await vault.deployed();
  });


  it("should allow admins to set the fee address", async () => {
    await expect(controller.setFeeAddress(ZERO_ADDRESS)).to.be.revertedWith(
      "INVALID_FEE_ADDRESS"
    );

    await controller.setFeeAddress(owner.address);
  });

  it("should allow strategists to set vaults for tokens", async () => {
    await expect(
      controller.setVault(want.address, ZERO_ADDRESS)
    ).to.be.revertedWith("INVALID_VAULT");

    await controller.setVault(want.address, vault.address);

    await expect(
      controller.setVault(want.address, vault.address)
    ).to.be.revertedWith("ALREADY_HAS_VAULT");
  });

  it("should allow admins to approve and revoke strategies", async () => {
    await expect(
      controller.approveStrategy(ZERO_ADDRESS, strategy.address)
    ).to.be.revertedWith("INVALID_TOKEN");
    await expect(
      controller.approveStrategy(want.address, ZERO_ADDRESS)
    ).to.be.revertedWith("INVALID_STRATEGY");
    await controller.approveStrategy(want.address, strategy.address);

    await expect(
      controller.revokeStrategy(ZERO_ADDRESS, strategy.address)
    ).to.be.revertedWith("INVALID_TOKEN");
    await expect(
      controller.revokeStrategy(want.address, ZERO_ADDRESS)
    ).to.be.revertedWith("INVALID_STRATEGY");
    await controller.revokeStrategy(want.address, strategy.address);
  });

  it("should allow strategists to set strategies", async () => {
    await expect(
      controller.setStrategy(want.address, strategy.address)
    ).to.be.revertedWith("STRATEGY_NOT_APPROVED");

    await controller.setVault(want.address, vault.address);

    await controller.approveStrategy(want.address, strategy.address);
    await controller.setStrategy(want.address, strategy.address);

    await want.mint(strategy.address, units(500));
    await controller.setStrategy(want.address, strategy.address);

    expect(await want.balanceOf(vault.address)).to.equal(units(500));
  });

  it("should deposit tokens into the strategy when calling earn", async () => {
    await controller.approveStrategy(want.address, strategy.address);
    await controller.setStrategy(want.address, strategy.address);

    await want.mint(controller.address, units(500));

    await controller.earn(want.address, units(500));
    expect(await want.balanceOf(strategy.address)).to.equal(units(500));
    expect(await controller.balanceOf(want.address)).to.equal(units(500));
  });

  it("should allow strategists to withdraw all tokens from a strategy", async () => {
    await controller.approveStrategy(want.address, strategy.address);
    await controller.setStrategy(want.address, strategy.address);
    await controller.setVault(want.address, vault.address);

    await want.mint(strategy.address, units(500));

    await controller.withdrawAll(want.address);

    expect(await want.balanceOf(vault.address)).to.equal(units(500));
  });

  it("should allow strategists to withdraw tokens", async () => {
    await want.mint(controller.address, units(500));

    await controller.inCaseTokensGetStuck(want.address, units(500));
    expect(await want.balanceOf(owner.address)).to.equal(units(500));
  });

  it("should allow strategists to withdraw tokens from a strategy", async () => {
    await controller.approveStrategy(want.address, strategy.address);
    await controller.setStrategy(want.address, strategy.address);

    await want.mint(strategy.address, units(500));
    //this strategy is a mock strategy and allows withdrawing strategy tokens.
    //{StrategyPUSDConvex} only allows withdrawing non strategy tokens
    await controller.inCaseStrategyTokensGetStuck(
      strategy.address,
      want.address
    );

    expect(await want.balanceOf(controller.address)).to.equal(units(500));
  });

  it("should allow vaults to withdraw tokens from a strategy", async () => {
    await controller.approveStrategy(want.address, strategy.address);
    await controller.setStrategy(want.address, strategy.address);

    await expect(
      controller.withdraw(want.address, units(500))
    ).to.be.revertedWith("NOT_VAULT");

    await controller.setVault(want.address, owner.address);

    await want.mint(strategy.address, units(500));

    await controller.withdraw(want.address, units(500));

    expect(await want.balanceOf(owner.address)).to.equal(units(500));
  });
});
