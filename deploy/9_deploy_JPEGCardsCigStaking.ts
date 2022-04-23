import fs from "fs";
import path from "path";
import { task, types } from "hardhat/config";

task("deploy-cigStaking", "Deploys the JPEGCardsCigStaking contract")
	.addParam("cigconfig", "A JSON file containing the contract's configuration", undefined, types.inputFile)
	.setAction(async ({ cigconfig }, { network, ethers, run }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

		if (!config.dao)
			throw "No DAO address in network's config file";
        if (!config.jpegCards)
            throw "No JPEG Cards address in network's config file";

		const cigConfig = await JSON.parse(fs.readFileSync(cigconfig).toString());

		if (!cigConfig.cigarettes || cigConfig.cigarettes.length == 0)
            throw "No cigarette indexes in config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

		const JPEGCardsCigStaking = await ethers.getContractFactory("JPEGCardsCigStaking");
        const cigStaking = await JPEGCardsCigStaking.deploy(config.jpegCards, cigConfig.cigarettes);

		console.log("JPEGCardsCigStaking deployed at: ", cigStaking.address);

		config.cigStaking = cigStaking.address;
		fs.writeFileSync(configFilePath, JSON.stringify(config));

		console.log("Setting up JPEGCardsCigStaking");

		await (await cigStaking.transferOwnership(config.dao)).wait();

		if (network.name != "hardhat") {
			console.log("Verifying JPEGCardsCigStaking");

			await run("verify:verify", {
				address: cigStaking.address,
				constructorArguments: [config.jpegCards, cigConfig.cigarettes],
			});
		}

		console.log("All done.");
	});