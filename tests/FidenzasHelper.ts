import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { FidenzasHelper, TestERC721 } from "../types";

describe("FidenzasHelper", () => {
    let owner: SignerWithAddress, user: SignerWithAddress;
    let artblocks: TestERC721, helper: FidenzasHelper;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user = accounts[1];

        const ERC721 = await ethers.getContractFactory("TestERC721");
        artblocks = await ERC721.deploy();

        const FidenzasHelper = await ethers.getContractFactory(
            "FidenzasHelper"
        );
        helper = <FidenzasHelper>(
            await upgrades.deployProxy(FidenzasHelper, [artblocks.address])
        );
    });

    it("should revert when the NFT is out of range", async () => {
        await artblocks.mint(user.address, 0);
        await expect(helper.ownerOf(0)).to.be.revertedWithCustomError(
            helper,
            "InvalidNFT"
        );

        await artblocks.mint(user.address, 78000990);
        expect(await helper.ownerOf(78000990)).to.equal(user.address);
    });

    it("should return the owner of this contract when the nft is owned by the helper", async () => {
        await artblocks.mint(helper.address, 78000990);
        expect(await helper.ownerOf(78000990)).to.equal(owner.address);
    });

    it("should keep the nft if the recipient is the owner", async () => {
        await artblocks.mint(user.address, 78000990);
        await artblocks.connect(user).setApprovalForAll(helper.address, true);
        await helper.transferFrom(user.address, owner.address, 78000990);
        expect(await artblocks.ownerOf(78000990)).to.equal(helper.address);
        expect(await helper.ownerOf(78000990)).to.equal(owner.address);
    });

    it("should send the nft if the recipient is anyone besides the owner", async () => {
        await artblocks.mint(user.address, 78000990);
        await artblocks.connect(user).setApprovalForAll(helper.address, true);
        await helper.transferFrom(user.address, user.address, 78000990);
        expect(await artblocks.ownerOf(78000990)).to.equal(user.address);
        expect(await helper.ownerOf(78000990)).to.equal(user.address);
    });

    it("should allow the owner to send nfts", async () => {
        await artblocks.mint(helper.address, 78000990);
        await helper.safeTransferFrom(owner.address, user.address, 78000990);
        expect(await artblocks.ownerOf(78000990)).to.equal(user.address);
        expect(await helper.ownerOf(78000990)).to.equal(user.address);
    });
});
