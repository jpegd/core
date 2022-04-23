import fs from "fs";
import path from "path";
import { types, task } from "hardhat/config";
import { parseUnits } from "@ethersproject/units";
import { DEFAULT_ADMIN_ROLE, MINTER_ROLE } from "./constants";

task("deploy-jpeg", "Deploys the JPEG token")
	.addOptionalParam("totalSupply", "JPEG's total supply", 69420000000, types.int)
	.setAction(async ({ totalSupply }, { network, ethers, run }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

		if (!config.dao)
			throw "No DAO address in network's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

		const JPEG = await ethers.getContractFactory("JPEG");
		const jpeg = await JPEG.deploy(parseUnits(totalSupply.toString()));

		console.log("JPEG deployed at: ", jpeg.address);

		config.jpeg = jpeg.address;
		fs.writeFileSync(configFilePath, JSON.stringify(config));

		console.log("Configuring JPEG");

		await (await jpeg.grantRole(DEFAULT_ADMIN_ROLE, config.dao)).wait();
		await (await jpeg.grantRole(MINTER_ROLE, config.dao)).wait();
		await (await jpeg.revokeRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait();
		await (await jpeg.transfer(config.dao, parseUnits(totalSupply.toString()))).wait();

		if (network.name != "hardhat") {
			console.log("Verifying JPEG");
			
			await run("verify:verify", {
				address: jpeg.address,
				constructorArguments: [parseUnits(totalSupply.toString())]
			});
		}

		console.log("All done.");
	});