import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { JPEGVaultRouter, NFTVault } from "../types";
import { ZERO_ADDRESS } from "./utils";

describe("JPEGVaultRouter", () => {
    let owner: SignerWithAddress;
    let router: JPEGVaultRouter;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];

        const Router = await ethers.getContractFactory("JPEGVaultRouter");
        router = <JPEGVaultRouter>await upgrades.deployProxy(Router);
        await router.deployed();
    });

    it("should call doActions in the specified vaults", async () => {
        await expect(router.batchExecute([])).to.be.revertedWithCustomError(
            router,
            "InvalidLength"
        );

        const MockVault = await ethers.getContractFactory("MockNFTVault");
        const vault1 = await MockVault.deploy(ZERO_ADDRESS, ZERO_ADDRESS);
        const vault2 = await MockVault.deploy(ZERO_ADDRESS, ZERO_ADDRESS);

        const payload = [
            {
                target: vault1.address,
                actions: [0, 1],
                data: ["0x00", "0x01"]
            },
            {
                target: vault2.address,
                actions: [2, 3],
                data: ["0x02", "0x03"]
            }
        ];

        await expect(
            router.batchExecute(payload)
        ).to.be.revertedWithCustomError(router, "UnknownVault");
        await router.whitelistVault(vault1.address, false);

        await expect(
            router.batchExecute(payload)
        ).to.be.revertedWithCustomError(router, "UnknownVault");
        await router.whitelistVault(vault2.address, false);

        await expect(router.batchExecute(payload))
            .to.emit(vault1, "DoActionsCalled")
            .withArgs(owner.address, payload[0].actions, payload[0].data);
        await expect(router.batchExecute(payload))
            .to.emit(vault2, "DoActionsCalled")
            .withArgs(owner.address, payload[1].actions, payload[1].data);
    });

    it("should migrate positions when requested", async () => {
        const MockVault = await ethers.getContractFactory("MockNFTVault");
        const vault1 = await MockVault.deploy(ZERO_ADDRESS, ZERO_ADDRESS);
        const vault2 = await MockVault.deploy(owner.address, owner.address);

        const payload = [
            {
                target: router.address,
                actions: [200],
                data: [
                    ethers.utils.defaultAbiCoder.encode(
                        ["address", "address", "uint256"],
                        [vault1.address, vault1.address, 0]
                    )
                ]
            }
        ];

        await expect(router.batchExecute(payload)).to.be.reverted;

        payload[0].data = [
            ethers.utils.defaultAbiCoder.encode(
                ["address", "address", "uint256"],
                [vault1.address, vault2.address, 0]
            )
        ];

        await expect(
            router.batchExecute(payload)
        ).to.be.revertedWithCustomError(router, "UnknownVault");
        await router.whitelistVault(vault1.address, false);

        await expect(
            router.batchExecute(payload)
        ).to.be.revertedWithCustomError(router, "UnknownVault");
        await router.whitelistVault(vault2.address, true);

        await expect(
            router.batchExecute(payload)
        ).to.be.revertedWithCustomError(router, "IncompatibleVaults");
        await vault2.setStablecoin(ZERO_ADDRESS);

        await expect(
            router.batchExecute(payload)
        ).to.be.revertedWithCustomError(router, "IncompatibleVaults");
        await router.removeVault(vault2.address);
        await router.whitelistVault(vault2.address, false);

        await expect(
            router.batchExecute(payload)
        ).to.be.revertedWithCustomError(router, "IncompatibleVaults");
        await vault2.setNFT(ZERO_ADDRESS);

        await vault1.setPosition(
            {
                borrowType: 2,
                debtPrincipal: 0,
                debtPortion: 0,
                debtAmountForRepurchase: 0,
                liquidatedAt: 0,
                liquidator: ZERO_ADDRESS,
                strategy: ZERO_ADDRESS
            },
            0
        );
        await vault1.setForceCloseReturn(10000);

        await expect(router.batchExecute(payload))
            .to.emit(vault1, "ForceCloseCalled")
            .withArgs(owner.address, 0, vault2.address)
            .to.emit(vault2, "ImportPositionCalled")
            .withArgs(owner.address, 0, 10000, true, ZERO_ADDRESS)
            .to.emit(router, "PositionMigrated")
            .withArgs(0, vault1.address, vault2.address);

        await vault1.setPosition(
            {
                borrowType: 1,
                debtPrincipal: 0,
                debtPortion: 0,
                debtAmountForRepurchase: 0,
                liquidatedAt: 0,
                liquidator: ZERO_ADDRESS,
                strategy: owner.address
            },
            0
        );
        await expect(router.batchExecute(payload))
            .to.emit(vault1, "ForceCloseCalled")
            .withArgs(owner.address, 0, vault2.address)
            .to.emit(vault2, "ImportPositionCalled")
            .withArgs(owner.address, 0, 10000, false, ZERO_ADDRESS)
            .to.emit(router, "PositionMigrated")
            .withArgs(0, vault1.address, vault2.address);

        await vault2.setHasStrategy(true);
        await expect(router.batchExecute(payload))
            .to.emit(vault1, "ForceCloseCalled")
            .withArgs(owner.address, 0, owner.address)
            .to.emit(vault2, "ImportPositionCalled")
            .withArgs(owner.address, 0, 10000, false, owner.address)
            .to.emit(router, "PositionMigrated")
            .withArgs(0, vault1.address, vault2.address);

        const Escrow = await ethers.getContractFactory("MockEscrow");
        const escrow1 = await Escrow.deploy(ZERO_ADDRESS);
        const escrow2 = await Escrow.deploy(owner.address);

        await vault1.setNFT(escrow1.address);
        await vault2.setNFT(escrow2.address);

        await expect(
            router.batchExecute(payload)
        ).to.be.revertedWithCustomError(router, "IncompatibleVaults");
        await router.removeVault(vault1.address);
        await router.removeVault(vault2.address);
        await router.whitelistVault(vault1.address, true);
        await router.whitelistVault(vault2.address, true);

        await expect(
            router.batchExecute(payload)
        ).to.be.revertedWithCustomError(router, "IncompatibleVaults");
        await escrow2.setNFTAddress(ZERO_ADDRESS);

        await expect(router.batchExecute(payload))
            .to.emit(vault1, "ForceCloseCalled")
            .withArgs(owner.address, 0, owner.address)
            .to.emit(vault2, "ImportPositionCalled")
            .withArgs(owner.address, 0, 10000, false, owner.address)
            .to.emit(router, "PositionMigrated")
            .withArgs(0, vault1.address, vault2.address);

        await vault2.setHasStrategy(false);
        await expect(router.batchExecute(payload))
            .to.emit(vault1, "ForceCloseCalled")
            .withArgs(owner.address, 0, escrow2.address)
            .to.emit(vault2, "ImportPositionCalled")
            .withArgs(owner.address, 0, 10000, false, ZERO_ADDRESS)
            .to.emit(router, "PositionMigrated")
            .withArgs(0, vault1.address, vault2.address);
    });
});
