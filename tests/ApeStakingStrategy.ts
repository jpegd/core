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
    MockApeStaking
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

describe("ApeStakingStrategy", () => {
    let owner: SignerWithAddress;
    let user: SignerWithAddress;
    let strategy: BAYCApeStakingStrategy;
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
        strategy = <BAYCApeStakingStrategy>(
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

        await strategy.grantRole(VAULT_ROLE, owner.address);
        await strategy.grantRole(BAKC_STRATEGY_ROLE, owner.address);

        await ape.grantRole(MINTER_ROLE, apeStaking.address);
    });

    it("should allow the vault to deposit NFTs", async () => {
        const nftAmounts = [
            { tokenId: 0, amount: units(100) },
            { tokenId: 1, amount: units(200) },
            { tokenId: 2, amount: units(300) },
            { tokenId: 3, amount: units(400) }
        ];

        const firstAmount = nftAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        const depositAddress = await strategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, firstAmount);
        await ape.connect(user).approve(strategy.address, firstAmount);

        await strategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );

        expect(await ape.balanceOf(apeStaking.address)).to.equal(firstAmount);

        const newAmounts = [
            { tokenId: 4, amount: units(500) },
            { tokenId: 5, amount: units(600) }
        ];

        const secondAmount = newAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        for (let i = 0; i < newAmounts.length; i++) {
            await bayc.mint(depositAddress, newAmounts[i].tokenId);
        }

        await ape.mint(user.address, secondAmount);
        await ape.connect(user).approve(strategy.address, secondAmount);

        await strategy.afterDeposit(
            user.address,
            newAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [newAmounts.map(e => e.amount)]
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

        const firstAmount = nftAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        const depositAddress = await strategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, firstAmount);
        await ape.connect(user).approve(strategy.address, firstAmount);

        await strategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );

        const newAmounts = [
            { tokenId: nftAmounts[0].tokenId, amount: units(500) },
            { tokenId: nftAmounts[1].tokenId, amount: units(500) }
        ];

        const secondAmount = newAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        await ape.mint(user.address, secondAmount);
        await ape.connect(user).approve(strategy.address, secondAmount);

        await expect(strategy.depositTokens(newAmounts)).to.be.revertedWith(
            "Unauthorized()"
        );
        await expect(
            strategy.depositTokens([
                ...newAmounts,
                { tokenId: 100, amount: units(500) }
            ])
        ).to.be.reverted;

        await strategy.connect(user).depositTokens(newAmounts);

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

        const totalAmount = nftAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        const depositAddress = await strategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, totalAmount);
        await ape.connect(user).approve(strategy.address, totalAmount);

        await strategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );

        await expect(
            strategy
                .connect(user)
                .withdrawTokens(
                    [{ tokenId: 10, amount: units(200) }],
                    user.address
                )
        ).to.be.reverted;

        const toWithdraw = [
            { tokenId: 0, amount: units(100) },
            { tokenId: 1, amount: units(100) }
        ];

        await expect(
            strategy.withdrawTokens(toWithdraw, user.address)
        ).to.be.revertedWith("Unauthorized()");

        await strategy.connect(user).withdrawTokens(toWithdraw, user.address);

        const totalWithdrawn = toWithdraw.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        expect(await bayc.ownerOf(toWithdraw[0].tokenId)).to.equal(
            depositAddress
        );
        expect(await bayc.ownerOf(toWithdraw[1].tokenId)).to.equal(
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

        const firstAmount = nftAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        const depositAddress = await strategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, firstAmount);
        await ape.connect(user).approve(strategy.address, firstAmount);

        await strategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );

        await expect(strategy.connect(user).claimRewards([100], user.address))
            .to.be.reverted;

        const toClaim = [0, 1];

        await expect(
            strategy.claimRewards(toClaim, user.address)
        ).to.be.revertedWith("Unauthorized()");

        await strategy.connect(user).claimRewards(toClaim, user.address);

        expect(await ape.balanceOf(user.address)).to.equal(
            units(1 * toClaim.length)
        );
    });

    it("should allow the vault to withdraw NFTs", async () => {
        const nftAmounts = [
            { mainTokenId: 0, bakcTokenId: 0, amount: units(100) },
            { mainTokenId: 1, bakcTokenId: 1, amount: units(200) },
            { mainTokenId: 2, bakcTokenId: 2, amount: units(300) },
            { mainTokenId: 3, bakcTokenId: 3, amount: units(400) }
        ];

        const totalAmount = nftAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        const depositAddress = await strategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].mainTokenId);
            await bakc.mint(depositAddress, nftAmounts[i].bakcTokenId);
        }

        await ape.mint(user.address, totalAmount);
        await ape.connect(user).approve(strategy.address, totalAmount);

        await strategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.mainTokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );

        await ape.mint(depositAddress, totalAmount);
        await strategy.depositTokensBAKC(user.address, nftAmounts);

        const toWithdraw = nftAmounts[nftAmounts.length - 1];

        await expect(
            strategy.withdraw(
                owner.address,
                owner.address,
                toWithdraw.mainTokenId
            )
        ).to.be.revertedWith("Unauthorized()");
        await strategy.withdraw(
            user.address,
            owner.address,
            toWithdraw.mainTokenId
        );

        expect(await bayc.ownerOf(toWithdraw.mainTokenId)).to.equal(
            owner.address
        );
        expect(await bakc.ownerOf(toWithdraw.bakcTokenId)).to.equal(
            depositAddress
        );
        expect(await ape.balanceOf(user.address)).to.equal(
            toWithdraw.amount.mul(2)
        );
        expect(await ape.balanceOf(apeStaking.address)).to.equal(
            totalAmount.sub(toWithdraw.amount).mul(2)
        );

        await strategy.connect(user).withdrawTokens(
            [
                {
                    tokenId: nftAmounts[0].mainTokenId,
                    amount: nftAmounts[0].amount
                }
            ],
            user.address
        );
        await strategy.withdraw(
            user.address,
            owner.address,
            nftAmounts[0].mainTokenId
        );

        expect(await bayc.ownerOf(nftAmounts[0].mainTokenId)).to.equal(
            owner.address
        );
        expect(await ape.balanceOf(user.address)).to.equal(
            toWithdraw.amount.add(nftAmounts[0].amount).mul(2)
        );
        expect(await ape.balanceOf(apeStaking.address)).to.equal(
            totalAmount.sub(toWithdraw.amount).sub(nftAmounts[0].amount).mul(2)
        );
    });

    it("should allow the vault to flash loan NFTs", async () => {
        const nftAmounts = [
            { tokenId: 0, amount: units(100) },
            { tokenId: 1, amount: units(200) },
            { tokenId: 2, amount: units(300) },
            { tokenId: 3, amount: units(400) }
        ];

        const totalAmount = nftAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        const depositAddress = await strategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].tokenId);
        }

        await ape.mint(user.address, totalAmount.mul(3));
        await ape.connect(user).approve(strategy.address, totalAmount.mul(3));

        await strategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );

        await strategy.flashLoanStart(
            user.address,
            owner.address,
            [0, 1, 2, 3],
            new AbiCoder().encode(["uint256[]"], [[2, 3]])
        );

        expect(await bayc.ownerOf(0)).to.equal(owner.address);
        expect(await bayc.ownerOf(1)).to.equal(owner.address);
        expect(await bayc.ownerOf(2)).to.equal(owner.address);
        expect(await bayc.ownerOf(3)).to.equal(owner.address);
    });

    it("should allow the BAKC strategy to pair BAKCs with deposited NFTs", async () => {
        const nftAmounts = [
            { mainTokenId: 0, bakcTokenId: 0, amount: units(100) },
            { mainTokenId: 1, bakcTokenId: 1, amount: units(200) },
            { mainTokenId: 2, bakcTokenId: 2, amount: units(300) },
            { mainTokenId: 3, bakcTokenId: 3, amount: units(400) }
        ];

        const totalAmount = nftAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        const depositAddress = await strategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].mainTokenId);
            await bakc.mint(depositAddress, nftAmounts[i].bakcTokenId);
        }

        await ape.mint(user.address, totalAmount);
        await ape.connect(user).approve(strategy.address, totalAmount);

        await strategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.mainTokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );

        await ape.mint(depositAddress, totalAmount);

        await expect(
            strategy.connect(user).depositTokensBAKC(user.address, nftAmounts)
        ).to.be.reverted;

        await strategy.depositTokensBAKC(user.address, nftAmounts);

        expect(await ape.balanceOf(apeStaking.address)).to.equal(
            totalAmount.mul(2)
        );
    });

    it("should allow the BAKC strategy to claim rewards from BAKC pairs", async () => {
        const nftAmounts = [
            { mainTokenId: 0, bakcTokenId: 0, amount: units(100) },
            { mainTokenId: 1, bakcTokenId: 1, amount: units(200) },
            { mainTokenId: 2, bakcTokenId: 2, amount: units(300) },
            { mainTokenId: 3, bakcTokenId: 3, amount: units(400) }
        ];

        const totalAmount = nftAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        const depositAddress = await strategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].mainTokenId);
            await bakc.mint(depositAddress, nftAmounts[i].bakcTokenId);
        }

        await ape.mint(user.address, totalAmount);
        await ape.connect(user).approve(strategy.address, totalAmount);

        await strategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.mainTokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );

        await ape.mint(depositAddress, totalAmount);

        await strategy.depositTokensBAKC(user.address, nftAmounts);

        await expect(
            strategy.connect(user).claimRewardsBAKC(
                user.address,
                [
                    {
                        mainTokenId: nftAmounts[0].mainTokenId,
                        bakcTokenId: nftAmounts[0].bakcTokenId
                    }
                ],
                user.address
            )
        ).to.be.reverted;

        await strategy.claimRewardsBAKC(
            user.address,
            [
                {
                    mainTokenId: nftAmounts[0].mainTokenId,
                    bakcTokenId: nftAmounts[0].bakcTokenId
                }
            ],
            user.address
        );

        expect(await ape.balanceOf(user.address)).to.equal(units(1));
    });

    it("should allow the BAKC strategy to withdraw tokens from BAKC pairs", async () => {
        const nftAmounts = [
            { mainTokenId: 0, bakcTokenId: 0, amount: units(100) },
            { mainTokenId: 1, bakcTokenId: 1, amount: units(200) },
            { mainTokenId: 2, bakcTokenId: 2, amount: units(300) },
            { mainTokenId: 3, bakcTokenId: 3, amount: units(400) }
        ];

        const totalAmount = nftAmounts.reduce((s, e) => {
            return e.amount.add(s);
        }, BigNumber.from(0));

        const depositAddress = await strategy.depositAddress(user.address);
        for (let i = 0; i < nftAmounts.length; i++) {
            await bayc.mint(depositAddress, nftAmounts[i].mainTokenId);
            await bakc.mint(depositAddress, nftAmounts[i].bakcTokenId);
        }

        await ape.mint(user.address, totalAmount);
        await ape.connect(user).approve(strategy.address, totalAmount);

        await strategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.mainTokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );

        await ape.mint(depositAddress, totalAmount);
        await strategy.depositTokensBAKC(user.address, nftAmounts);

        expect(await ape.balanceOf(depositAddress)).to.equal(0);

        await expect(
            strategy
                .connect(user)
                .withdrawTokensBAKC(user.address, [
                    { isUncommit: true, ...nftAmounts[0] }
                ])
        ).to.be.reverted;

        await strategy.withdrawTokensBAKC(user.address, [
            { isUncommit: true, ...nftAmounts[0] }
        ]);

        expect(await ape.balanceOf(apeStaking.address)).to.equal(
            totalAmount.mul(2).sub(nftAmounts[0].amount)
        );
        expect(await ape.balanceOf(depositAddress)).to.equal(
            nftAmounts[0].amount
        );
    });

    it("should allow the BAKC strategy to transfer BAKC from the clone contract", async () => {
        const nftAmounts = [{ tokenId: 0, amount: units(100) }];

        const depositAddress = await strategy.depositAddress(user.address);
        await bayc.mint(depositAddress, nftAmounts[0].tokenId);

        await ape.mint(user.address, nftAmounts[0].amount);
        await ape.connect(user).approve(strategy.address, nftAmounts[0].amount);

        await strategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );

        await bakc.mint(depositAddress, 0);
        await bakc.mint(depositAddress, 1);
        await expect(
            strategy
                .connect(user)
                .transferBAKC(user.address, [0, 1], user.address)
        ).to.be.reverted;

        await strategy.transferBAKC(user.address, [0, 1], user.address);

        expect(await bakc.ownerOf(0)).to.equal(user.address);
        expect(await bakc.ownerOf(1)).to.equal(user.address);
    });

    it("should allow the BAKC strategy to transfer apecoin from the clone contract", async () => {
        const nftAmounts = [{ tokenId: 0, amount: units(100) }];

        const depositAddress = await strategy.depositAddress(user.address);
        await bayc.mint(depositAddress, nftAmounts[0].tokenId);

        await ape.mint(user.address, nftAmounts[0].amount);
        await ape.connect(user).approve(strategy.address, nftAmounts[0].amount);

        await strategy.afterDeposit(
            user.address,
            nftAmounts.map(e => e.tokenId),
            new AbiCoder().encode(
                ["uint256[]"],
                [nftAmounts.map(e => e.amount)]
            )
        );

        await ape.mint(depositAddress, units(1000));
        await expect(
            strategy.connect(user).transferApeCoin(user.address, user.address)
        ).to.be.reverted;

        await strategy.transferApeCoin(user.address, user.address);

        expect(await ape.balanceOf(user.address)).to.equal(units(1000));
    });
});
