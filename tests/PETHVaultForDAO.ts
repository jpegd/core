import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, upgrades } from "hardhat";
import { units } from "./utils";
import { PETHVaultForDAO, PETH } from "../types";

const { expect } = chai;

chai.use(solidity);

const default_admin_role =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
const minter_role =
    "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";
const whitelisted_role =
    "0x8429d542926e6695b59ac6fbdcd9b37e8b1aeb757afab06ab60b1bb5878c3b49";

describe("PETHVaultForDAO", () => {
    let owner: SignerWithAddress,
        dao: SignerWithAddress,
        user: SignerWithAddress;
    let vault: PETHVaultForDAO, peth: PETH;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        dao = accounts[1];
        user = accounts[2];

        const PETH = await ethers.getContractFactory("PETH");
        peth = await PETH.deploy();
        await peth.deployed();

        const PETHVaultForDAO = await ethers.getContractFactory(
            "PETHVaultForDAO"
        );
        vault = <PETHVaultForDAO>(
            await upgrades.deployProxy(PETHVaultForDAO, [peth.address])
        );

        await peth.grantRole(default_admin_role, dao.address);
        await peth.revokeRole(default_admin_role, owner.address);
        await peth.connect(dao).grantRole(minter_role, vault.address);

        await vault.grantRole(default_admin_role, dao.address);
        await vault.grantRole(whitelisted_role, dao.address);
        await vault.revokeRole(default_admin_role, owner.address);
    });

    it("should be able to deposit ETH", async () => {
        let depositAmount = units(10);
        await expect(vault.deposit({ value: depositAmount })).to.revertedWith(
            `AccessControl: account ${owner.address.toLowerCase()} is missing role ${whitelisted_role}`
        );
        await expect(vault.connect(dao).deposit({ value: 0 })).to.revertedWith(
            "invalid_value"
        );
        await vault.connect(dao).deposit({ value: depositAmount });

        expect(await ethers.provider.getBalance(vault.address)).to.equal(
            depositAmount
        );
        expect(await vault.debtAmount()).to.equal(0);
    });

    it("should be able to borrow peth", async () => {
        const borrowAmount = units(10);
        await vault.connect(dao).deposit({ value: borrowAmount });
        await expect(vault.borrow(borrowAmount)).to.revertedWith(
            `AccessControl: account ${owner.address.toLowerCase()} is missing role ${whitelisted_role}`
        );
        await expect(
            vault.connect(dao).borrow(borrowAmount.add(1))
        ).to.revertedWith("insufficient_credit");
        await vault.connect(dao).borrow(borrowAmount);
        expect(await peth.balanceOf(dao.address)).to.equal(borrowAmount);
        expect(await vault.debtAmount()).to.equal(borrowAmount);
    });

    it("should be able to repay peth", async () => {
        const borrowAmount = units(10);
        await vault.connect(dao).deposit({ value: borrowAmount });
        await vault.connect(dao).borrow(borrowAmount);

        await expect(vault.repay(borrowAmount)).to.revertedWith(
            `AccessControl: account ${owner.address.toLowerCase()} is missing role ${whitelisted_role}`
        );
        await expect(vault.connect(dao).repay(borrowAmount)).to.revertedWith(
            "ERC20: insufficient allowance"
        );

        // repay partial
        await peth.connect(dao).approve(vault.address, borrowAmount);
        await vault.connect(dao).repay(borrowAmount.div(2));
        expect(await vault.debtAmount()).to.equal(borrowAmount.div(2));

        await vault.connect(dao).repay(borrowAmount.div(2));
        expect(await vault.debtAmount()).to.equal(0);
    });

    it("should be able to withdraw eth", async () => {
        const depositAmount = units(10);
        await vault.connect(dao).deposit({ value: depositAmount });

        await expect(vault.withdraw(depositAmount)).to.revertedWith(
            `AccessControl: account ${owner.address.toLowerCase()} is missing role ${whitelisted_role}`
        );
        await expect(
            vault.connect(dao).withdraw(depositAmount.add(1))
        ).to.revertedWith("invalid_amount");

        await vault.connect(dao).withdraw(depositAmount.div(2));
        expect(await ethers.provider.getBalance(vault.address)).to.equal(
            depositAmount.div(2)
        );

        // withdraw all
        await vault.connect(dao).withdraw(depositAmount.div(2));
        expect(await ethers.provider.getBalance(vault.address)).to.equal(0);
    });
});
