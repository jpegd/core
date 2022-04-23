import fs from "fs";
import path from "path";
import { task } from "hardhat/config";

task("deploy-rocksHelper", "Deploys the EtherRocksHelper contract")
	.setAction(async (_, { network, ethers, run, upgrades }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

		if (!config.etherRocks)
			throw "No EtherRocks address in network's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

		const Helper = await ethers.getContractFactory("EtherRocksHelper");
		const rocksHelper = await upgrades.deployProxy(Helper, [config.etherRocks]);

		console.log("EtherRocksHelper deployed at: ", rocksHelper.address);

		config.rocksHelper = rocksHelper.address;
		fs.writeFileSync(configFilePath, JSON.stringify(config));

		if (network.name != "hardhat") {
			console.log("Verifying EtherRocksHelper");
			
			const impl = await (await upgrades.admin.getInstance()).getProxyImplementation(rocksHelper.address);

			await run("verify:verify", {
				address: impl.address,
				constructorArguments: [],
			});
		}

		console.log("All done.");
	});