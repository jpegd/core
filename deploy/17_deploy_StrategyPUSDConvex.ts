import fs from "fs";
import path from "path";
import { task } from "hardhat/config";
import { DEFAULT_ADMIN_ROLE } from "./constants";

task("deploy-pusd-strategy", "Deploys the StrategyPUSDConvex contract")
    .addParam("feeAddress", "Address to send harvest fees to")
	.setAction(async ({ feeAddress }, { network, ethers, run }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

		if (!config.pusdPool)
			throw "No pusdPool address in network's config file";
        if (!config.pusd)
			throw "No pusd address in network's config file";
        if (!config.weth)
			throw "No weth address in network's config file";
        if (!config.usdc)
			throw "No usdc address in network's config file";
        if (!config.cvx)
			throw "No cvx address in network's config file";
        if (!config.crv)
            throw "No crv address in network's config file";
        if (!config.univ3)
            throw "No univ3 address in network's config file";
        if (!config.cvxPool)
            throw "No cvxPool address in network's config file";
        if (!config.crvPool)
            throw "No crvPool address in network's config file";
        if (!config.crv3Zap)
            throw "No crv3Zap address in network's config file";
        if (!config.cvxBooster)
            throw "No cvxBooster address in network's config file";
        if (!config.pusdRewardPool)
            throw "No pusdRewardPool address in network's config file";
        if (!config.vault)
            throw "No vault address in network's config file";
        if (!config.dao)
            throw "No DAO address in network's config file";

        let usdcVault = config["vaultForDAO-" + config.usdc.substring(config.usdc.length - 5)];

        if (!config["vaultForDAO-" + config.usdc.substring(config.usdc.length - 5)])
            throw "No usdc vault address in network's config file";
        
		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

		const Strategy = await ethers.getContractFactory("StrategyPUSDConvex");
		const pusdStrategy = await Strategy.deploy(
            {
                want: config.pusdPool,
                pusd: config.pusd,
                weth: config.weth,
                usdc: config.usdc,
                cvx: config.cvx,
                crv: config.crv
            },
            config.univ3,
            feeAddress,
            {
                lp: config.cvxPool,
                ethIndex: 0
            },
            {
                lp: config.crvPool,
                ethIndex: 0
            },
            {
                zap: config.crv3Zap,
                crv3Index: 1,
                usdcIndex: 2,
                pusdIndex: 0,
            },
            {
                booster: config.cvxBooster,
                baseRewardPool: config.pusdRewardPool,
                pid: 91
            },
            {
                vault: config.vault,
                usdcVault: usdcVault
            },
            {
                numerator: 20,
                denominator: 100
            }
        );

		console.log("StrategyPUSDConvex deployed at: ", pusdStrategy.address);

		config.pusd = pusdStrategy.address;
		fs.writeFileSync(configFilePath, JSON.stringify(config));
		
		console.log("Configuring StrategyPUSDConvex");

		await pusdStrategy.grantRole(DEFAULT_ADMIN_ROLE, config.dao);
		await pusdStrategy.revokeRole(DEFAULT_ADMIN_ROLE, deployer.address);
        
        const Vault = await ethers.getContractFactory("Vault");
        const vault = Vault.attach(config.vault);

        await vault.migrateStrategy(pusdStrategy.address);

        await vault.transferOwnership(config.dao);

		if (network.name != "hardhat") {
			console.log("Verifying StrategyPUSDConvex");

			await run("verify:verify", {
				address: pusdStrategy.address,
				constructorArguments: [{
                    want: config.pusdPool,
                    pusd: config.pusd,
                    weth: config.weth,
                    usdc: config.usdc,
                    cvx: config.cvx,
                    crv: config.crv
                },
                config.univ3,
                feeAddress,
                {
                    lp: config.cvxPool,
                    ethIndex: 0
                },
                {
                    lp: config.crvPool,
                    ethIndex: 0
                },
                {
                    zap: config.crv3Zap,
                    crv3Index: 1,
                    usdcIndex: 2,
                    pusdIndex: 0,
                },
                {
                    booster: config.cvxBooster,
                    baseRewardPool: config.pusdRewardPool,
                    pid: 91
                },
                {
                    vault: config.vault,
                    usdcVault: usdcVault
                },
                {
                    numerator: 20,
                    denominator: 100
                }],
			});
		}

		console.log("All done.");
	});