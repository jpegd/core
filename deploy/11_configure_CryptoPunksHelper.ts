import fs from "fs";
import path from "path";
import { task } from "hardhat/config";
import { CryptoPunksHelper } from "../types";

task("configure-punksHelper", "Configures the CryptoPunksHelper contract")
	.setAction(async (_, { network, ethers }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

		if (!config.punksHelper)
			throw "No CryptoPunksHelper address in network's config file";

		const nftVault = config["nftVault-" + config.punksHelper.substring(config.punksHelper.length - 5)];
        if (!nftVault)
            throw "No NFTVault address in network's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

		const punksHelper = <CryptoPunksHelper> await ethers.getContractAt(
			"CryptoPunksHelper",
			config.punksHelper
		  );

		await (await punksHelper.transferOwnership(nftVault)).wait();

		console.log("All done.");
	});