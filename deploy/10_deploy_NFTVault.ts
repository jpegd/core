import fs from "fs";
import path from "path";
import { task, types } from "hardhat/config";
import { DAO_ROLE } from "./constants";

task("deploy-nftVault", "Deploys the NFTVault contract")
	.addParam("vaultconfig", "A JSON file containing the vault's configuration", undefined, types.inputFile)
	.setAction(async ({ vaultconfig }, { network, ethers, run, upgrades }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

		if (!config.pusd)
			throw "No PUSD address in network's config file";
		if (!config.ethOracle)
			throw "No ETHOracle address in network's config file";
		if (!config.cigStaking)
			throw "No JPEGCardsCigStaking address in network's config file";
		if (!config.dao)
			throw "No DAO address in network's config file";

		const vaultConfig = await JSON.parse(fs.readFileSync(vaultconfig).toString());

		if (!vaultConfig.nft)
			throw "No NFT in vault's config file";
		if (!vaultConfig.floorOracle)
			throw "No floor oracle in vault's config file";
		if (!vaultConfig.debtInterestApr)
			throw "No debt interest apr in vault's config file"
		if (!vaultConfig.creditLimitRate)
			throw "No credit limit rate in vault's config file";
		if (!vaultConfig.liquidationLimitRate)
			throw "No liquidation limit rate in vault's config file";
		if (!vaultConfig.cigStakedCreditLimitRate)
			throw "No cig staked credit limit rate in vault's config file";
		if (!vaultConfig.cigStakedLiquidationLimitRate)
			throw "No cig staked liquidation limit rate in vault's config file";
		if (!vaultConfig.valueIncreaseLockRate)
			throw "No value increase lock rate in vault's config file";
		if (!vaultConfig.organizationFeeRate)
			throw "No organization fee rate in vault's config file";
		if (!vaultConfig.insurancePurchaseRate)
			throw "No insurance purchase rate in vault's config file";
		if (!vaultConfig.insuranceLiquidationPenaltyRate)
			throw "No insurance liquidation penalty rate in vault's config file";
		if (!vaultConfig.insuranceRepurchaseLimit)
			throw "No insurance repurchase limit in vault's config file";
		if (!vaultConfig.borrowAmountCap)
			throw "No borrow amount cap in vault's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

		const NFTVault = await ethers.getContractFactory("NFTVault");
		const nftVault = await upgrades.deployProxy(NFTVault, [
			config.pusd,
			vaultConfig.nft,
			config.ethOracle,
			vaultConfig.floorOracle,
			vaultConfig.specialNFTs ?? [],
			config.cigStaking,
			[
				vaultConfig.debtInterestApr,
				vaultConfig.creditLimitRate,
				vaultConfig.liquidationLimitRate,
				vaultConfig.cigStakedCreditLimitRate,
				vaultConfig.cigStakedLiquidationLimitRate,
				vaultConfig.valueIncreaseLockRate,
				vaultConfig.organizationFeeRate,
				vaultConfig.insurancePurchaseRate,
				vaultConfig.insuranceLiquidationPenaltyRate,
				vaultConfig.insuranceRepurchaseLimit, 
				vaultConfig.borrowAmountCap
			],
		]);

		console.log("NFTVault for ", vaultConfig.nft, " deployed at: ", nftVault.address);

		config["nftVault-" + vaultConfig.nft.substring(vaultConfig.nft.length - 5)] = nftVault.address;
		fs.writeFileSync(configFilePath, JSON.stringify(config));

		console.log("Setting up NFTVault");

		await (await nftVault.grantRole(DAO_ROLE, config.dao)).wait();
		await (await nftVault.revokeRole(DAO_ROLE, deployer.address)).wait();

		if (network.name != "hardhat") {
			console.log("Verifying NFTVault");

			const nftVaultImplementation = await (await upgrades.admin.getInstance()).getProxyImplementation(nftVault.address);

			await run("verify:verify", {
				address: nftVaultImplementation.address,
				constructorArguments: [],
			});
		}

		console.log("All done.");
	});