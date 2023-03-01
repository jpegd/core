import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import { JPEGCardsCigStaking, TestERC721 } from "../types";

const { expect } = chai;

chai.use(solidity);

describe("JPEGCardsCigStaking", () => {
    let cigStaking: JPEGCardsCigStaking, cards: TestERC721;
    let user: SignerWithAddress;
    let owner: SignerWithAddress;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user = accounts[1];

        const ERC721 = await ethers.getContractFactory("TestERC721");
        cards = await ERC721.deploy();

        const Staking = await ethers.getContractFactory("JPEGCardsCigStaking");
        cigStaking = await Staking.deploy(cards.address, [1]);

        await cards.setApprovalForAll(cigStaking.address, true);
        await cards.connect(user).setApprovalForAll(cigStaking.address, true);
    });

    it("should allow the owner to add cigs", async () => {
        await cigStaking.addCig(0);

        expect(await cigStaking.cigs(0)).to.be.true;
    });

    it("should allow the owner to unpause/pause", async () => {
        await cigStaking.unpause();
        expect(await cigStaking.paused()).to.be.false;
        await cigStaking.pause();
        expect(await cigStaking.paused()).to.be.true;
    });

    it("should allow users to deposit 1 cig per address", async () => {
        await cigStaking.unpause();

        await cards.mint(owner.address, 0);
        await cards.mint(user.address, 1);
        await cards.mint(user.address, 2);

        await expect(cigStaking.deposit(0)).to.be.revertedWith("NOT_CIG");

        await cigStaking.addCig(0);
        await cigStaking.addCig(2);

        await expect(cigStaking.deposit(1)).to.be.revertedWith(
            "ERC721: transfer from incorrect owner"
        );
        await cigStaking.deposit(0);
        await cigStaking.connect(user).deposit(1);
        await expect(cigStaking.connect(user).deposit(2)).to.be.revertedWith(
            "CANNOT_STAKE_MULTIPLE"
        );

        expect(await cigStaking.isUserStaking(owner.address)).to.be.true;
        expect(await cigStaking.isUserStaking(user.address)).to.be.true;
    });

    it("should allow users to withdraw their cig", async () => {
        await cigStaking.unpause();

        await expect(cigStaking.withdraw(0)).to.be.revertedWith("NOT_STAKED");

        await cards.mint(owner.address, 0);
        await cards.mint(user.address, 1);

        await cigStaking.addCig(0);

        await cigStaking.deposit(0);
        await cigStaking.connect(user).deposit(1);

        await expect(cigStaking.withdraw(1)).to.be.revertedWith("NOT_STAKED");
        await cigStaking.withdraw(0);
        await cigStaking.connect(user).withdraw(1);

        expect(await cards.ownerOf(0)).to.equal(owner.address);
        expect(await cards.ownerOf(1)).to.equal(user.address);

        expect(await cigStaking.isUserStaking(owner.address)).to.be.false;
        expect(await cigStaking.isUserStaking(user.address)).to.be.false;
    });
});
