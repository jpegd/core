import fs from "fs";
import path from "path";
import { task, types } from "hardhat/config";
import { DEFAULT_ADMIN_ROLE, WHITELISTED_ROLE } from "./constants";

task("deploy-vaultForDAO", "Deploys the FungibleAssetVaultForDAO contract")
  .addParam("asset", "The asset to deploy the vault for", undefined, types.string)
  .addParam("oracle", "The oracle for the asset", undefined, types.string)
  .addVariadicPositionalParam("creditlimitrate", "The credit limit rate for the asset", undefined, types.int)
  .setAction(async ({ asset, oracle, creditlimitrate }, { network, ethers, run, upgrades }) => {
    const configFilePath = path.join(__dirname, "config", network.name + ".json");
    const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

    if (!config.pusd)
      throw "No Stablecoin address in network's config file";
    if (!config.dao)
      throw "No DAO address in network's config file";

    const [deployer] = await ethers.getSigners();
    console.log("Deployer: ", deployer.address);

    const FungibleAssetVaultForDAO = await ethers.getContractFactory("FungibleAssetVaultForDAO");
    const vaultForDAO = await upgrades.deployProxy(FungibleAssetVaultForDAO, [
      asset,
      config.pusd,
      oracle,
      creditlimitrate,
    ]);

    console.log("FungibleAssetVaultForDAO for asset", asset, "deployed at:", vaultForDAO.address);

    config["vaultForDAO-" + asset.substring(asset.length - 5)] = vaultForDAO.address;
    fs.writeFileSync(configFilePath, JSON.stringify(config));

    console.log("Configuring FungibleAssetVaultForDAO");

    await (await vaultForDAO.grantRole(DEFAULT_ADMIN_ROLE, config.dao)).wait();
    await (await vaultForDAO.grantRole(WHITELISTED_ROLE, config.dao)).wait();
    await (await vaultForDAO.revokeRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait();


    if (network.name != "hardhat") {
      console.log("Verifying FungibleAssetVaultForDAO");

      const implementation = await (await upgrades.admin.getInstance()).getProxyImplementation(vaultForDAO.address);

      await run("verify:verify", {
        address: implementation.address,
        constructorArguments: [],
      });
    }

    console.log("All done.");
  });