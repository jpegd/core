import fs from "fs";
import path from "path";
import { task } from "hardhat/config";

task("configure-rocksHelper", "Configures the CryptoPunksHelper contract")
	.setAction(async (_, { network, ethers }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

		if (!config.rocksHelper)
			throw "No EtherRocksHelper address in network's config file";

		const nftVault = config["nftVault-" + config.rocksHelper.substring(config.rocksHelper.length - 5)];
        if (!nftVault)
            throw "No NFTVault address in network's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

		const rocksHelper = await ethers.getContractAt(
			"EtherRocksHelper",
			config.rocksHelper
		  );

		await (await rocksHelper.transferOwnership(nftVault)).wait();

		console.log("All done.");
	});