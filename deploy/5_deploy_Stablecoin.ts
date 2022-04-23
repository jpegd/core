import fs from "fs";
import path from "path";
import { task } from "hardhat/config";
import { DEFAULT_ADMIN_ROLE } from "./constants";

task("deploy-stablecoin", "Deploys the Stablecoin contract")
	.setAction(async (_, { network, ethers, run }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

		if (!config.dao)
			throw "No dao address in network's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

		const StableCoin = await ethers.getContractFactory("StableCoin");
		const pusd = await StableCoin.deploy();

		console.log("Stablecoin deployed at: ", pusd.address);

		config.pusd = pusd.address;
		fs.writeFileSync(configFilePath, JSON.stringify(config));
		
		console.log("Configuring Stablecoin");

		await (await pusd.grantRole(DEFAULT_ADMIN_ROLE, config.dao)).wait();
		await (await pusd.revokeRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait();

		if (network.name != "hardhat") {
			console.log("Verifying Stablecoin");

			await run("verify:verify", {
				address: pusd.address,
				constructorArguments: [],
			});
		}

		console.log("All done.");
	});