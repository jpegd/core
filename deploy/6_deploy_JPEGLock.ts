import fs from "fs";
import path from "path";
import { task } from "hardhat/config";

task("deploy-jpegLock", "Deploys the JPEGLock contract")
	.setAction(async (_, { network, ethers, run }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

		if (!config.jpeg)
			throw "No JPEG address in network's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

		const JPEGLock = await ethers.getContractFactory("JPEGLock");
		const jpegLock = await JPEGLock.deploy(config.jpeg);

		console.log("JPEGLock deployed at: ", jpegLock.address);

		config.jpegLock = jpegLock.address;
		fs.writeFileSync(configFilePath, JSON.stringify(config));

		if (network.name != "hardhat") {
			console.log("Verifying PreJPEG");

			await run("verify:verify", {
				address: jpegLock.address,
				constructorArguments: [config.jpeg],
			});
		}

		console.log("All done.");
	});