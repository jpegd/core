import fs from "fs";
import path from "path";
import { task } from "hardhat/config";
import { DEFAULT_ADMIN_ROLE, VESTING_CONTROLLER_ROLE } from "./constants";

task("deploy-preJPEG", "Deploys the PreJPEG contract")
	.setAction(async (_, { network, ethers, run }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

		if (!config.dao)
			throw "No dao address in network's config file";
		if (!config.jpeg)
			throw "No JPEG address in network's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

		const PreJPEG = await ethers.getContractFactory("PreJPEG");
		const preJPEG = await PreJPEG.deploy(config.jpeg);

		console.log("JPEGStaking deployed at: ", preJPEG.address);

		config.preJPEG = preJPEG.address;
		fs.writeFileSync(configFilePath, JSON.stringify(config));

		console.log("Configuring PreJPEG");

		await (await preJPEG.grantRole(VESTING_CONTROLLER_ROLE, config.dao)).wait();
		await (await preJPEG.grantRole(DEFAULT_ADMIN_ROLE, config.dao)).wait();
		await (await preJPEG.revokeRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait();

		if (network.name != "hardhat") {
			console.log("Verifying PreJPEG");

			await run("verify:verify", {
				address: preJPEG.address,
				constructorArguments: [config.jpeg],
			});
		}

		console.log("All done.");
	});