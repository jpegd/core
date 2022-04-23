import fs from "fs";
import path from "path";
import { task } from "hardhat/config";

task("proxy-transferOwnership", "Transfers ownership of the proxy admin to the DAO")
	.setAction(async (_, { network, ethers, upgrades }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

		if (!config.dao)
			throw "No DAO address in network's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

    await upgrades.admin.transferProxyAdminOwnership(config.dao);

		console.log("All done.");
	});