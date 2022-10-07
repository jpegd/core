import fs from "fs";
import path from "path";
import { task } from "hardhat/config";

task("configure-punksHelper", "Configures the CryptoPunksHelper contract")
	.setAction(async (_, { network, ethers }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

		if (!config.pethPunksHelper)
			throw "No CryptoPunksHelper address in network's config file";

		const nftVault = config["pethNftVault-" + config.pethPunksHelper.substring(config.pethPunksHelper.length - 5)];
        if (!nftVault)
            throw "No NFTVault address in network's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

		const punksHelper = await ethers.getContractAt(
			"CryptoPunksHelper",
			config.pethPunksHelper
		  );

		await (await punksHelper.transferOwnership(nftVault)).wait();

		console.log("All done.");
	});