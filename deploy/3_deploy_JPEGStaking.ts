import fs from "fs";
import path from "path";
import { task } from "hardhat/config";

task("deploy-jpegStaking", "Deploys the JPEGStaking contract")
	.setAction(async (_, { network, ethers, run, upgrades }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

		if (!config.jpeg)
			throw "No JPEG address in network's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

		const JPEGStaking = await ethers.getContractFactory("JPEGStaking");
		const sJPEG = await upgrades.deployProxy(JPEGStaking, [config.jpeg]);

		console.log("JPEGStaking deployed at: ", sJPEG.address);

		config.sJPEG = sJPEG.address;
		fs.writeFileSync(configFilePath, JSON.stringify(config));

		if (network.name != "hardhat") {
			console.log("Verifying JPEGStaking");

			const sJPEGImplementation = await (await upgrades.admin.getInstance()).getProxyImplementation(sJPEG.address);

			await run("verify:verify", {
				address: sJPEGImplementation.address,
				constructorArguments: [],
			});
		}

		console.log("All done.");
	});