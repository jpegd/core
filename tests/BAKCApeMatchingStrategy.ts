import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumberish } from "ethers";
import { AbiCoder } from "ethers/lib/utils";
import { ethers, upgrades } from "hardhat";
import {
    ApeMatchingMarketplace,
    BAKCApeMatchingStrategy,
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

describe("BAKCApeMatchingStrategy", () => {
    let owner: SignerWithAddress, user: SignerWithAddress;
    let ape: TestERC20;
    let bakc: TestERC721, bayc: TestERC721;
    let apeStaking: MockApeStaking;
    let marketplace: ApeMatchingMarketplace;
    let strategy: BAKCApeMatchingStrategy;

    function depositMain(
        account: SignerWithAddress,
        caller: string,
        collection: number,
        tokenId: number,
        apeAmountMain: BigNumberish,
        apeAmountBAKC: BigNumberish,
        apeShareMain: number,
        apeShareBAKC: number,
        bakcShareBAKC: number
    ) {
        return marketplace
            .connect(account)
            .doStrategyActions(
                caller,
                [100],
                [
                    abiCoder.encode(
                        [
                            "uint8",
                            "uint16",
                            "uint80",
                            "uint80",
                            "uint16",
                            "uint16",
                            "uint16"
                        ],
                        [
                            collection,
                            tokenId,
                            apeAmountMain,
                            apeAmountBAKC,
                            apeShareMain,
                            apeShareBAKC,
                            bakcShareBAKC
                        ]
                    )
                ]
            );
    }

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user = accounts[1];

        const ERC20 = await ethers.getContractFactory("TestERC20");
        ape = await ERC20.deploy("", "");

        const ERC721 = await ethers.getContractFactory("TestERC721");
        bayc = await ERC721.deploy();
        const mayc = await ERC721.deploy();
        bakc = await ERC721.deploy();

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
            "BAKCApeMatchingStrategy"
        );
        strategy = <BAKCApeMatchingStrategy>await upgrades.deployProxy(
            Strategy,
            [],
            {
                constructorArgs: [marketplace.address]
            }
        );

        await strategy.grantRole(VAULT_ROLE, owner.address);
        await marketplace.grantRole(STRATEGY_ROLE, strategy.address);
        await marketplace.grantRole(STRATEGY_ROLE, owner.address);
        await ape.grantRole(MINTER_ROLE, apeStaking.address);
    });

    it("should allow the vault to deposit NFTs", async () => {
        await bayc.mint(marketplace.address, 100);
        await bakc.mint(marketplace.address, 200);

        await ape.mint(user.address, units(500));
        await ape.connect(user).approve(marketplace.address, units(500));

        await depositMain(
            owner,
            user.address,
            0,
            100,
            0,
            0,
            7_000,
            7_000,
            1_500
        );

        await strategy.afterDeposit(
            user.address,
            [200],
            abiCoder.encode(
                ["tuple(uint24 nonce,uint16 bakcTokenId,uint80 apeAmount)[]"],
                [[[1, 200, units(500)]]]
            )
        );

        const deposit = await marketplace.bakcDeposits(200);
        expect(deposit.isDeposited).to.be.true;
        expect(deposit.offerNonce).to.equal(1);

        const offer = await marketplace.offers(1);
        expect(offer.offerType).to.equal(2);
        expect(offer.bakcTokenId).to.equal(200);
        expect(offer.apeAmount).to.equal(units(500));
        expect(offer.isPaired).to.be.true;
    });

    it("should allow the vault to withdraw NFTs", async () => {
        await bayc.mint(marketplace.address, 100);
        await bakc.mint(marketplace.address, 200);

        await depositMain(
            owner,
            user.address,
            0,
            100,
            0,
            0,
            7_000,
            7_000,
            1_500
        );

        await strategy.afterDeposit(
            user.address,
            [200],
            abiCoder.encode(
                ["tuple(uint24 nonce,uint16 bakcTokenId,uint80 apeAmount)[]"],
                [[[1, 200, 0]]]
            )
        );

        await strategy.withdraw(user.address, owner.address, [200]);

        expect(await bakc.ownerOf(200)).to.equal(owner.address);

        const deposit = await marketplace.bakcDeposits(200);
        expect(deposit.isDeposited).to.be.false;
    });

    it("should allow the vault to flash loan NFTs", async () => {
        await bayc.mint(marketplace.address, 100);
        await bakc.mint(marketplace.address, 200);

        await depositMain(
            owner,
            user.address,
            0,
            100,
            0,
            0,
            7_000,
            7_000,
            1_500
        );

        await strategy.afterDeposit(
            user.address,
            [200],
            abiCoder.encode(
                ["tuple(uint24 nonce,uint16 bakcTokenId,uint80 apeAmount)[]"],
                [[[1, 200, 0]]]
            )
        );

        await strategy.flashLoanStart(user.address, owner.address, [200], "0x");

        expect(await bakc.ownerOf(200)).to.equal(owner.address);

        await bakc.transferFrom(owner.address, marketplace.address, 200);

        await strategy.flashLoanEnd(user.address, [200], "0x");
    });
});
