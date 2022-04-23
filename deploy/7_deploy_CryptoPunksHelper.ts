import fs from "fs";
import path from "path";
import { task } from "hardhat/config";

task("deploy-punksHelper", "Deploys the CryptoPunksHelper contract")
	.setAction(async (_, { network, ethers, run, upgrades }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

		if (!config.cryptoPunks)
			throw "No CryptoPunks address in network's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

		const Helper = await ethers.getContractFactory("CryptoPunksHelper");
		const punksHelper = await upgrades.deployProxy(Helper, [config.cryptoPunks]);

		console.log("CryptoPunksHelper deployed at: ", punksHelper.address);

		config.punksHelper = punksHelper.address;
		fs.writeFileSync(configFilePath, JSON.stringify(config));

		if (network.name != "hardhat") {
			console.log("Verifying CryptoPunksHelper");

			const impl = await (await upgrades.admin.getInstance()).getProxyImplementation(punksHelper.address);

			await run("verify:verify", {
				address: impl.address,
				constructorArguments: [],
			});
		}

		console.log("All done.");
	});