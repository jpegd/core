import fs from "fs";
import path from "path";
import { task, types } from "hardhat/config";

task("deploy-vault", "Deploys the vault contract")
    .addParam("feeAddress", "The address to send the deposit fees to")
    .addParam("feeNumerator", "The fee numerator, in bp", undefined, types.int)
	.setAction(async ({ feeAddress, feeNumerator }, { network, ethers, run, upgrades }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());
        
        if (!config.pusdPool)
			throw "No pusdPool address in network's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

		const Vault = await ethers.getContractFactory("Vault");
		const vault = await upgrades.deployProxy(Vault, [config.pusdPool, feeAddress, { numerator: feeNumerator, denominator: 10000 }]);

		console.log("Vault deployed at: ", vault.address);

		config.vault = vault.address;
		fs.writeFileSync(configFilePath, JSON.stringify(config));

		if (network.name != "hardhat") {
			console.log("Verifying Vault");

			const impl = await (await upgrades.admin.getInstance()).getProxyImplementation(vault.address);

			await run("verify:verify", {
				address: impl.address,
				constructorArguments: [],
			});
		}

		console.log("All done.");
	});