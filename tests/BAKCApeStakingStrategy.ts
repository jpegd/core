import { BigNumber } from "@ethersproject/bignumber";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { AbiCoder } from "ethers/lib/utils";
import { ethers, upgrades } from "hardhat";
import {
    TestERC20,
    TestERC721,
    BAYCApeStakingStrategy,
    MockApeStaking,
    BAKCApeStakingStrategy
} from "../types";
import { units } from "./utils";

const { expect } = chai;

const VAULT_ROLE =
    "0x31e0210044b4f6757ce6aa31f9c6e8d4896d24a755014887391a926c5224d959";
const BAKC_STRATEGY_ROLE =
    "0x6a1f594db90e5efe37169e9519b7ed208b645cacac4f1018dd1ce6b5cd10bcb1";
const MINTER_ROLE =
    "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";

chai.use(solidity);

describe("BAKCApeStakingStrategy", () => {
    let owner: SignerWithAddress;
    let user: SignerWithAddress;
    let baycStrategy: BAYCApeStakingStrategy;
    let bakcStrategy: BAKCApeStakingStrategy;
    let apeStaking: MockApeStaking;
    let bayc: TestERC721;
    let bakc: TestERC721;
    let ape: TestERC20;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];
        user = accounts[1];

        const TestERC20 = await ethers.getContractFactory("TestERC20");
        ape = await TestERC20.deploy("APE", "APE");

        const TestERC721 = await ethers.getContractFactory("TestERC721");
        bayc = await TestERC721.deploy();

        bakc = await TestERC721.deploy();

        const MockApeStaking = await ethers.getContractFactory(
            "MockApeStaking"
        );
        apeStaking = await MockApeStaking.deploy(
            ape.address,
            bayc.address,
            bayc.address,
            bakc.address
        );

        const SimpleUserProxy = await ethers.getContractFactory(
            "SimpleUserProxy"
        );
        const proxy = await SimpleUserProxy.deploy();

        const BAYCApeStakingStrategy = await ethers.getContractFactory(
            "BAYCApeStakingStrategy"
        );
        baycStrategy = <BAYCApeStakingStrategy>(
            await upgrades.deployProxy(BAYCApeStakingStrategy, [
                apeStaking.address,
                ape.address,
                bayc.address,
                bakc.address,
                1,
                3,
                proxy.address
            ])
        );

        const BAKCApeStakingStrategy = await ethers.getContractFactory(
            "BAKCApeStakingStrategy"
        );
        bakcStrategy = <BAKCApeStakingStrategy>await upgrades.deployProxy(
            BAKCApeStakingStrategy,
            [],
            {
                constructorArgs: [
                    baycStrategy.address,
                    ape.address,
                    apeStaking.address
                ]
            }
        );

        await bakcStrategy.grantRole(VAULT_ROLE, owner.address);
        await baycStrategy.grantRole(VAULT_ROLE, owner.address);
        await baycStrategy.grantRole(BAKC_STRATEGY_ROLE, bakcStrategy.address);

        await ape.grantRole(MINTER_ROLE, apeStaking.address);
    });

    it("should allow the vault to deposit NFTs", async () => {
        const nftAmounts = [
            { tokenId: 0, amount: units(100) },
            { tokenId: 1, amount: units(200) },
            { tokenId: 2, amount: units(300) },
            { tokenId: 3, amount: units(400) }
        ];

        const firstAmount = nftAmounts
            .reduce((s, e) => {
                return e.amount.add(s);
            }, BigNumber.from(0))
            .mul(2);

        const depositAddress = await bakcStrategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
            await bakc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, firstAmount);
        await ape.connect(user).approve(baycStrategy.address, firstAmount);
        await ape.connect(user).approve(bakcStrategy.address, firstAmount);

        await baycStrategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );

        await bakcStrategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["tuple(uint32 tokenId,uint224 amount)[]"],
                [nftAmounts]
            )
        );

        expect(await ape.balanceOf(apeStaking.address)).to.equal(firstAmount);

        const newAmounts = [
            { tokenId: 4, amount: units(500) },
            { tokenId: 5, amount: units(600) }
        ];

        const secondAmount = newAmounts
            .reduce((s, e) => {
                return e.amount.add(s);
            }, BigNumber.from(0))
            .mul(2);

        for (let i = 0; i < newAmounts.length; i++) {
            await bakc.mint(depositAddress, newAmounts[i].tokenId);
            await bayc.mint(depositAddress, newAmounts[i].tokenId);
        }

        await ape.mint(user.address, secondAmount);
        await ape.connect(user).approve(bakcStrategy.address, secondAmount);
        await ape.connect(user).approve(baycStrategy.address, secondAmount);

        await baycStrategy.afterDeposit(
            user.address,
            newAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [newAmounts.map(e => e.amount)]
            )
        );

        await bakcStrategy.afterDeposit(
            user.address,
            newAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["tuple(uint32 tokenId,uint224 amount)[]"],
                [newAmounts]
            )
        );

        expect(await ape.balanceOf(apeStaking.address)).to.equal(
            firstAmount.add(secondAmount)
        );
    });

    it("should allow users to increase the amount of staked tokens after deposit", async () => {
        const nftAmounts = [
            { tokenId: 0, amount: units(100) },
            { tokenId: 1, amount: units(200) },
            { tokenId: 2, amount: units(300) },
            { tokenId: 3, amount: units(400) }
        ];

        const firstAmount = nftAmounts
            .reduce((s, e) => {
                return e.amount.add(s);
            }, BigNumber.from(0))
            .mul(2);

        const depositAddress = await bakcStrategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
            await bakc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, firstAmount);
        await ape.connect(user).approve(bakcStrategy.address, firstAmount);
        await ape.connect(user).approve(baycStrategy.address, firstAmount);

        await baycStrategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );

        await bakcStrategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["tuple(uint32 tokenId,uint224 amount)[]"],
                [nftAmounts]
            )
        );

        const newAmounts = [
            {
                mainTokenId: nftAmounts[0].tokenId,
                bakcTokenId: nftAmounts[0].tokenId,
                amount: units(500)
            },
            {
                mainTokenId: nftAmounts[1].tokenId,
                bakcTokenId: nftAmounts[0].tokenId,
                amount: units(500)
            }
        ];

        const secondAmount = newAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        await ape.mint(user.address, secondAmount);
        await ape.connect(user).approve(bakcStrategy.address, secondAmount);

        await ape.mint(owner.address, secondAmount);
        await ape.approve(bakcStrategy.address, secondAmount);

        await expect(bakcStrategy.depositTokens(newAmounts)).to.be.revertedWith(
            "Unauthorized()"
        );
        await expect(
            bakcStrategy
                .connect(user)
                .depositTokens([
                    ...newAmounts,
                    { bakcTokenId: 100, mainTokenId: 100, amount: units(500) }
                ])
        ).to.be.reverted;

        await bakcStrategy.connect(user).depositTokens(newAmounts);

        expect(await ape.balanceOf(apeStaking.address)).to.equal(
            firstAmount.add(secondAmount)
        );
    });

    it("should allow users to withdraw tokens", async () => {
        const nftAmounts = [
            { tokenId: 0, amount: units(100) },
            { tokenId: 1, amount: units(200) },
            { tokenId: 2, amount: units(300) },
            { tokenId: 3, amount: units(400) }
        ];

        const totalAmount = nftAmounts
            .reduce((s, e) => {
                return e.amount.add(s);
            }, BigNumber.from(0))
            .mul(2);

        const depositAddress = await bakcStrategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bakc.mint(depositAddress, nftAmounts[i].tokenId);
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, totalAmount);
        await ape.connect(user).approve(bakcStrategy.address, totalAmount);
        await ape.connect(user).approve(baycStrategy.address, totalAmount);

        await baycStrategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );
        await bakcStrategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["tuple(uint32 tokenId,uint224 amount)[]"],
                [nftAmounts]
            )
        );

        await expect(
            bakcStrategy.connect(user).withdrawTokens(
                [
                    {
                        mainTokenId: 10,
                        bakcTokenId: 10,
                        amount: units(200),
                        isUncommit: false
                    }
                ],
                user.address
            )
        ).to.be.reverted;

        const toWithdraw = [
            {
                mainTokenId: 0,
                bakcTokenId: 0,
                amount: units(100),
                isUncommit: false
            },
            {
                mainTokenId: 1,
                bakcTokenId: 1,
                amount: units(100),
                isUncommit: false
            }
        ];

        await expect(
            bakcStrategy.withdrawTokens(toWithdraw, user.address)
        ).to.be.revertedWith("Unauthorized()");

        await bakcStrategy
            .connect(user)
            .withdrawTokens(toWithdraw, user.address);

        const totalWithdrawn = toWithdraw.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        expect(await bakc.ownerOf(toWithdraw[0].bakcTokenId)).to.equal(
            depositAddress
        );
        expect(await bakc.ownerOf(toWithdraw[1].bakcTokenId)).to.equal(
            depositAddress
        );
        expect(await ape.balanceOf(user.address)).to.equal(totalWithdrawn);
        expect(await ape.balanceOf(apeStaking.address)).to.equal(
            totalAmount.sub(totalWithdrawn)
        );
    });

    it("should allow users to claim rewards", async () => {
        const nftAmounts = [
            { tokenId: 0, amount: units(100) },
            { tokenId: 1, amount: units(200) },
            { tokenId: 2, amount: units(300) },
            { tokenId: 3, amount: units(400) }
        ];

        const firstAmount = nftAmounts
            .reduce((s, e) => {
                return e.amount.add(s);
            }, BigNumber.from(0))
            .mul(2);

        const depositAddress = await bakcStrategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
            await bakc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, firstAmount);
        await ape.connect(user).approve(bakcStrategy.address, firstAmount);
        await ape.connect(user).approve(baycStrategy.address, firstAmount);

        await baycStrategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );
        await bakcStrategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["tuple(uint32 tokenId,uint224 amount)[]"],
                [nftAmounts]
            )
        );

        await expect(
            bakcStrategy
                .connect(user)
                .claimRewards(
                    [{ mainTokenId: 100, bakcTokenId: 100 }],
                    user.address
                )
        ).to.be.reverted;

        const toClaim = [
            { mainTokenId: 0, bakcTokenId: 0 },
            { mainTokenId: 1, bakcTokenId: 1 }
        ];

        await expect(
            bakcStrategy.claimRewards(toClaim, user.address)
        ).to.be.revertedWith("Unauthorized()");

        await bakcStrategy.connect(user).claimRewards(toClaim, user.address);

        expect(await ape.balanceOf(user.address)).to.equal(
            units(1 * toClaim.length)
        );
    });

    it("should allow the vault to withdraw NFTs", async () => {
        const nftAmounts = [
            { tokenId: 0, amount: units(100) },
            { tokenId: 1, amount: units(200) },
            { tokenId: 2, amount: units(300) },
            { tokenId: 3, amount: units(400) }
        ];

        const totalAmount = nftAmounts
            .reduce((s, e) => {
                return e.amount.add(s);
            }, BigNumber.from(0))
            .mul(2);

        const depositAddress = await bakcStrategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
            await bakc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, totalAmount);
        await ape.connect(user).approve(bakcStrategy.address, totalAmount);
        await ape.connect(user).approve(baycStrategy.address, totalAmount);

        await baycStrategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );

        await bakcStrategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["tuple(uint32 tokenId,uint224 amount)[]"],
                [nftAmounts]
            )
        );

        const toWithdraw = nftAmounts[nftAmounts.length - 1];

        await expect(
            bakcStrategy.withdraw(
                owner.address,
                owner.address,
                toWithdraw.tokenId
            )
        ).to.be.revertedWith("Unauthorized()");
        await bakcStrategy.withdraw(
            user.address,
            owner.address,
            toWithdraw.tokenId
        );

        expect(await bayc.ownerOf(toWithdraw.tokenId)).to.equal(depositAddress);
        expect(await bakc.ownerOf(toWithdraw.tokenId)).to.equal(owner.address);
        expect(await ape.balanceOf(user.address)).to.equal(toWithdraw.amount);
        expect(await ape.balanceOf(apeStaking.address)).to.equal(
            totalAmount.sub(toWithdraw.amount)
        );

        await bakcStrategy.connect(user).withdrawTokens(
            [
                {
                    mainTokenId: nftAmounts[0].tokenId,
                    bakcTokenId: nftAmounts[0].tokenId,
                    amount: nftAmounts[0].amount,
                    isUncommit: false
                }
            ],
            user.address
        );
        await bakcStrategy.withdraw(
            user.address,
            owner.address,
            nftAmounts[0].tokenId
        );

        expect(await bakc.ownerOf(nftAmounts[0].tokenId)).to.equal(
            owner.address
        );
        expect(await ape.balanceOf(user.address)).to.equal(
            toWithdraw.amount.add(nftAmounts[0].amount)
        );
        expect(await ape.balanceOf(apeStaking.address)).to.equal(
            totalAmount.sub(toWithdraw.amount).sub(nftAmounts[0].amount)
        );
    });

    it("should allow the vault to flash loan NFTs", async () => {
        const nftAmounts = [
            { tokenId: 0, amount: units(100) },
            { tokenId: 1, amount: units(200) },
            { tokenId: 2, amount: units(300) },
            { tokenId: 3, amount: units(400) }
        ];

        const totalAmount = nftAmounts
            .reduce((s, e) => {
                return e.amount.add(s);
            }, BigNumber.from(0))
            .mul(2);

        const depositAddress = await bakcStrategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
            await bakc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, totalAmount);
        await ape.connect(user).approve(bakcStrategy.address, totalAmount);
        await ape.connect(user).approve(baycStrategy.address, totalAmount);

        await baycStrategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );
        await bakcStrategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["tuple(uint32 tokenId,uint224 amount)[]"],
                [nftAmounts]
            )
        );

        await bakcStrategy.flashLoanStart(
            user.address,
            owner.address,
            [0, 1, 2, 3],
            "0x"
        );

        expect(await bakc.ownerOf(0)).to.equal(owner.address);
        expect(await bakc.ownerOf(1)).to.equal(owner.address);
        expect(await bakc.ownerOf(2)).to.equal(owner.address);
        expect(await bakc.ownerOf(3)).to.equal(owner.address);
    });

    it("should allow legacy deposits to withdraw directly from the strategy", async () => {
        const nftAmounts = [
            { tokenId: 0, amount: units(100) },
            { tokenId: 1, amount: units(200) },
            { tokenId: 2, amount: units(300) },
            { tokenId: 3, amount: units(400) }
        ];

        const totalAmount = nftAmounts
            .reduce((s, e) => {
                return e.amount.add(s);
            }, BigNumber.from(0))
            .mul(2);

        const depositAddress = await bakcStrategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
            await bakc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, totalAmount);
        await ape.connect(user).approve(bakcStrategy.address, totalAmount);
        await ape.connect(user).approve(baycStrategy.address, totalAmount);

        await baycStrategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );

        const legacy = nftAmounts.splice(0, 2);

        await bakcStrategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["tuple(uint32 tokenId,uint224 amount)[]"],
                [nftAmounts]
            )
        );

        //this is equivalent to a legacy deposit
        await bakcStrategy.connect(user).depositTokens([
            {
                mainTokenId: legacy[0].tokenId,
                bakcTokenId: legacy[0].tokenId,
                amount: legacy[0].amount
            },
            {
                mainTokenId: legacy[1].tokenId,
                bakcTokenId: legacy[1].tokenId,
                amount: legacy[1].amount
            }
        ]);

        await expect(
            bakcStrategy.withdrawNFTs(
                [legacy[0].tokenId, legacy[1].tokenId],
                user.address
            )
        ).to.be.revertedWith("Unauthorized()");
        await expect(
            bakcStrategy
                .connect(user)
                .withdrawNFTs(
                    [nftAmounts[0].tokenId, nftAmounts[1].tokenId],
                    user.address
                )
        ).to.be.revertedWith("NotDirectDeposit(" + nftAmounts[0].tokenId + ")");
        await bakcStrategy
            .connect(user)
            .withdrawNFTs([legacy[0].tokenId, legacy[1].tokenId], user.address);

        expect(await bakc.ownerOf(0)).to.equal(user.address);
        expect(await bakc.ownerOf(1)).to.equal(user.address);
        expect(await ape.balanceOf(user.address)).to.equal(units(300));
        expect(await ape.balanceOf(apeStaking.address)).to.equal(
            totalAmount.sub(units(300))
        );
    });
});
