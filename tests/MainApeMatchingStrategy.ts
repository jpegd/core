import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { AbiCoder } from "ethers/lib/utils";
import { ethers, upgrades } from "hardhat";
import {
    ApeMatchingMarketplace,
    MainApeMatchingStrategy,
    MockApeStaking,
    TestERC20,
    TestERC721
} from "../types";
import { units } from "./utils";

const STRATEGY_ROLE = ethers.utils.solidityKeccak256(
    ["string"],
    ["STRATEGY_ROLE"]
);
const MINTER_ROLE = ethers.utils.solidityKeccak256(["string"], ["MINTER_ROLE"]);
const VAULT_ROLE = ethers.utils.solidityKeccak256(["string"], ["VAULT_ROLE"]);

const abiCoder = new AbiCoder();

describe("MainApeMatchingStrategy", () => {
    let owner: SignerWithAddress, user: SignerWithAddress;
    let ape: TestERC20;
    let bayc: TestERC721;
    let apeStaking: MockApeStaking;
    let marketplace: ApeMatchingMarketplace;
    let strategy: MainApeMatchingStrategy;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user = accounts[1];

        const ERC20 = await ethers.getContractFactory("TestERC20");
        ape = await ERC20.deploy("", "");

        const ERC721 = await ethers.getContractFactory("TestERC721");
        bayc = await ERC721.deploy();
        const mayc = await ERC721.deploy();
        const bakc = await ERC721.deploy();

        const ApeStaking = await ethers.getContractFactory("MockApeStaking");
        apeStaking = await ApeStaking.deploy(
            ape.address,
            bayc.address,
            mayc.address,
            bakc.address
        );

        const ApeStakingLib = await ethers.getContractFactory("ApeStakingLib");
        const lib = await ApeStakingLib.deploy();

        const Marketplace = await ethers.getContractFactory(
            "ApeMatchingMarketplace",
            { libraries: { ApeStakingLib: lib.address } }
        );

        marketplace = <ApeMatchingMarketplace>await upgrades.deployProxy(
            Marketplace,
            [],
            {
                constructorArgs: [
                    apeStaking.address,
                    ape.address,
                    bayc.address,
                    mayc.address,
                    bakc.address
                ]
            }
        );

        const Strategy = await ethers.getContractFactory(
            "MainApeMatchingStrategy"
        );
        strategy = <MainApeMatchingStrategy>await upgrades.deployProxy(
            Strategy,
            [],
            {
                constructorArgs: [marketplace.address, 0]
            }
        );

        await strategy.grantRole(VAULT_ROLE, owner.address);
        await marketplace.grantRole(STRATEGY_ROLE, strategy.address);
        await ape.grantRole(MINTER_ROLE, apeStaking.address);
    });

    it("should allow the vault to deposit NFTs", async () => {
        await bayc.mint(marketplace.address, 100);
        await bayc.mint(marketplace.address, 101);

        await ape.mint(user.address, units(500));
        await ape.connect(user).approve(marketplace.address, units(500));

        await strategy.afterDeposit(
            user.address,
            [100, 101],
            abiCoder.encode(
                [
                    "tuple(uint80 apeAmountMain,uint80 apeAmountBAKC,uint16 mainPoolApeShareBps,uint16 bakcPoolApeShareBps,uint16 bakcPoolBAKCShareBps)[]"
                ],
                [
                    [
                        [units(300), units(200), 7_000, 7_000, 1_500],
                        [0, 0, 5_000, 5_000, 3_000]
                    ]
                ]
            )
        );

        let deposit = await marketplace.mainDeposits(0, 100);
        expect(deposit.isDeposited).to.be.true;
        expect(deposit.mainOfferNonce).to.equal(0);
        expect(deposit.bakcOfferNonce).to.equal(1);

        deposit = await marketplace.mainDeposits(0, 101);
        expect(deposit.isDeposited).to.be.true;
        expect(deposit.mainOfferNonce).to.equal(2);
        expect(deposit.bakcOfferNonce).to.equal(3);

        let offer = await marketplace.offers(0);
        expect(offer.offerType).to.equal(1);
        expect(offer.mainNft.collection).to.equal(0);
        expect(offer.mainNft.tokenId).to.equal(100);
        expect(offer.bakcTokenId).to.equal(0);
        expect(offer.apeAmount).to.equal(units(300));
        expect(offer.apeRewardShareBps).to.equal(7_000);
        expect(offer.bakcRewardShareBps).to.equal(0);
        expect(offer.isPaired).to.be.false;
        expect(offer.lastSingleStakingRewardPerShare).to.equal(0);

        offer = await marketplace.offers(1);
        expect(offer.offerType).to.equal(2);
        expect(offer.mainNft.collection).to.equal(0);
        expect(offer.mainNft.tokenId).to.equal(100);
        expect(offer.bakcTokenId).to.equal(0);
        expect(offer.apeAmount).to.equal(units(200));
        expect(offer.apeRewardShareBps).to.equal(7_000);
        expect(offer.bakcRewardShareBps).to.equal(1_500);
        expect(offer.isPaired).to.be.false;
        expect(offer.lastSingleStakingRewardPerShare).to.equal(0);

        offer = await marketplace.offers(2);
        expect(offer.offerType).to.equal(1);
        expect(offer.mainNft.collection).to.equal(0);
        expect(offer.mainNft.tokenId).to.equal(101);
        expect(offer.bakcTokenId).to.equal(0);
        expect(offer.apeAmount).to.equal(0);
        expect(offer.apeRewardShareBps).to.equal(5_000);
        expect(offer.bakcRewardShareBps).to.equal(0);
        expect(offer.isPaired).to.be.false;
        expect(offer.lastSingleStakingRewardPerShare).to.equal(0);

        offer = await marketplace.offers(3);
        expect(offer.offerType).to.equal(2);
        expect(offer.mainNft.collection).to.equal(0);
        expect(offer.mainNft.tokenId).to.equal(101);
        expect(offer.bakcTokenId).to.equal(0);
        expect(offer.apeAmount).to.equal(0);
        expect(offer.apeRewardShareBps).to.equal(5_000);
        expect(offer.bakcRewardShareBps).to.equal(3_000);
        expect(offer.isPaired).to.be.false;
        expect(offer.lastSingleStakingRewardPerShare).to.equal(0);
    });

    it("should allow the vault to withdraw NFTs", async () => {
        await bayc.mint(marketplace.address, 100);

        await strategy.afterDeposit(
            user.address,
            [100],
            abiCoder.encode(
                [
                    "tuple(uint80 apeAmountMain,uint80 apeAmountBAKC,uint16 mainPoolApeShareBps,uint16 bakcPoolApeShareBps,uint16 bakcPoolBAKCShareBps)[]"
                ],
                [[[0, 0, 5_000, 5_000, 3_000]]]
            )
        );

        await strategy.withdraw(user.address, owner.address, [100]);

        expect(await bayc.ownerOf(100)).to.equal(owner.address);

        const deposit = await marketplace.mainDeposits(0, 100);
        expect(deposit.isDeposited).to.be.false;
    });

    it("should allow the vault to flash loan NFTs", async () => {
        await bayc.mint(marketplace.address, 100);

        await strategy.afterDeposit(
            user.address,
            [100],
            abiCoder.encode(
                [
                    "tuple(uint80 apeAmountMain,uint80 apeAmountBAKC,uint16 mainPoolApeShareBps,uint16 bakcPoolApeShareBps,uint16 bakcPoolBAKCShareBps)[]"
                ],
                [[[0, 0, 5_000, 5_000, 3_000]]]
            )
        );

        await strategy.flashLoanStart(user.address, owner.address, [100], "0x");

        expect(await bayc.ownerOf(100)).to.equal(owner.address);

        await bayc.transferFrom(owner.address, marketplace.address, 100);

        await strategy.flashLoanEnd(user.address, [100], "0x");
    });
});
