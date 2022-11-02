import fs from "fs";
import path from "path";

import { task, types } from "hardhat/config";

const VAULT_ROLE = "0x31e0210044b4f6757ce6aa31f9c6e8d4896d24a755014887391a926c5224d959";
const MINTER_ROLE = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";

task("deploy-ape-staking", "Deploys the Ape Strategy")
	.setAction(async ({ }, { network, ethers, run, upgrades }) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());
        
        if (!config.ape) throw "No ape address in network's config file";
        if (!config.bayc) throw "No bayc address in network's config file";
        if (!config.mayc) throw "No mayc address in network's config file";
        if (!config.bakc) throw "No bakc address in network's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);

        const MockApeStaking = await ethers.getContractFactory("ApeCoinStaking");
        const apeStaking = await MockApeStaking.deploy(config.ape, config.bayc, config.mayc, config.bakc);
        await apeStaking.deployed()
        config.apeStaking = apeStaking.address;

        fs.writeFileSync(configFilePath, JSON.stringify(config));

        if (network.name != "hardhat") {
			console.log("Verifying ApeStaking");
			await run("verify:verify", {
				address: config.apeStaking,
				constructorArguments: [config.ape, config.bayc, config.mayc, config.bakc],
			});
		}
	});

task("deploy-ape-strategy", "Deploys Ape Strategy")
    .setAction(async ({}, {network, ethers, run, upgrades}) => {
		const configFilePath = path.join(__dirname, "config", network.name + ".json");
		const config = await JSON.parse(fs.readFileSync(configFilePath).toString());
        
        const nftHash = "68Ac4";
        const poolId = 1;
        const nftAddress = config.bayc
        
        if (!config.ape) throw "No ape address in network's config file";
        if (!config.bayc) throw "No bayc address in network's config file";
        if (!config.mayc) throw "No mayc address in network's config file";
        if (!config.bakc) throw "No bakc address in network's config file";
        if (!config.apeStaking) throw "No apeStaking address in network's config file";

		const [deployer] = await ethers.getSigners();
		console.log("Deployer: ", deployer.address);
        
        const SimpleUserProxy = await ethers.getContractFactory("SimpleUserProxy");
        const proxy = await SimpleUserProxy.deploy();

        const BAYCApeStakingStrategy = await ethers.getContractFactory("BAYCApeStakingStrategy");
        const strategy = await upgrades.deployProxy(BAYCApeStakingStrategy,
            [
                config.apeStaking,
                config.ape,
                nftAddress,
                config.bakc,
                poolId,
                3, // bakc pool id
                proxy.address
            ]
        );

        await strategy.grantRole(VAULT_ROLE, config[`nftVault-${nftHash}`]);
        await strategy.grantRole(VAULT_ROLE, config[`pethNftVault-${nftHash}`]);
        
        await strategy.unpause();

        config[`apeStakeStrategy-${nftHash}`] = strategy.address
		fs.writeFileSync(configFilePath, JSON.stringify(config));

		if (network.name != "hardhat") {
			console.log("Verifying Strategy");

			const impl = await (await upgrades.admin.getInstance()).getProxyImplementation(config[`apeStakeStrategy-${nftHash}`]);

			await run("verify:verify", {
				address: impl.address,
                contract: "contracts/vaults/strategies/BAYCApeStakingStrategy.sol:BAYCApeStakingStrategy",
				constructorArguments: [
                ],
			});
		}

		console.log("All done.");
    })
