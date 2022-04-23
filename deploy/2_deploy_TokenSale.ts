import fs from "fs";
import path from "path";
import { task } from "hardhat/config";

task("deploy-tokenSale", "Deploys the TokenSale contract")
	.setAction(async (_, { network, ethers, run }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

		if (!config.weth)
			throw "No WETH address in network's config file";
		if (!config.usdc)
			throw "No USDC address in network's config file";
		if (!config.ethOracle)
			throw "No ETHOracle address in network's config file";
		if (!config.usdcOracle)
			throw "No USDCOracle address in network's config file";
		if (!config.dao)
			throw "No DAO address in network's config file";
		if (!config.jpeg)
			throw "No JPEG address in network's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

		const TokenSale = await ethers.getContractFactory("TokenSale");
		const tokenSale = await TokenSale.deploy(config.weth, config.usdc, config.ethOracle, config.usdcOracle, config.jpeg, config.dao);

		console.log("TokenSale deployed at: ", tokenSale.address);

		config.tokenSale = tokenSale.address;
		fs.writeFileSync(configFilePath, JSON.stringify(config));

		if (network.name != "hardhat") {
			console.log("Verifying TokenSale");

			await run("verify:verify", {
				address: tokenSale.address,
				constructorArguments: [
					config.weth,
					config.usdc,
					config.ethOracle,
					config.usdcOracle,
					config.jpeg,
					config.dao
				]
			});
		}

		console.log("All done.");
	});