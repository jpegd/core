import { ethers, upgrades, run } from "hardhat";
import fs from "fs";

const addresses = require("./addresses.json");
const { deployData } = require("./utils");
const minter_role =
  "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";
const whitelisted_role =
  "0x8429d542926e6695b59ac6fbdcd9b37e8b1aeb757afab06ab60b1bb5878c3b49";
const default_admin_role =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer: ", deployer.address);

  const FungibleAssetVaultForDAO = await ethers.getContractFactory(
    "FungibleAssetVaultForDAO"
  );
  const usdcVault = await upgrades.deployProxy(FungibleAssetVaultForDAO, [
    deployData.usdc,
    addresses.stablecoin,
    deployData.usdcAggregator,
    [100, 100],
  ]);
  await usdcVault.deployed();
  console.log("USDCVaultForDAO usdc deployed at: ", usdcVault.address);

  const usdcVaultForDaoImplementation = await (
    await upgrades.admin.getInstance()
  ).getProxyImplementation(usdcVault.address);
  console.log(
    "USDCVaultForDAO implementation deployed at: ",
    usdcVaultForDaoImplementation
  );

  const ethVault = await upgrades.deployProxy(FungibleAssetVaultForDAO, [
    deployData.zero,
    addresses.stablecoin,
    deployData.ethAggregator,
    [80, 100],
  ]);
  await ethVault.deployed();
  console.log("ETHVaultForDAO eth deployed at: ", ethVault.address);

  const ethVaultForDaoImplementation = await (
    await upgrades.admin.getInstance()
  ).getProxyImplementation(ethVault.address);
  console.log(
    "ETHVaultForDAO implementation deployed at: ",
    ethVaultForDaoImplementation
  );

  addresses.usdcVaultForDao = usdcVault.address;
  addresses.ethVaultForDao = ethVault.address;
  addresses.usdcVaultForDaoImplementation = usdcVaultForDaoImplementation;
  addresses.ethVaultForDaoImplementation = ethVaultForDaoImplementation;
  fs.writeFileSync(
    "./deploy/addresses.json",
    JSON.stringify(addresses, null, 2)
  );

  await (await usdcVault.grantRole(default_admin_role, deployData.dao)).wait();
  await (await usdcVault.grantRole(whitelisted_role, deployData.dao)).wait();
  await (
    await usdcVault.revokeRole(default_admin_role, deployer.address)
  ).wait();
  await (await ethVault.grantRole(default_admin_role, deployData.dao)).wait();
  await (await ethVault.grantRole(whitelisted_role, deployData.dao)).wait();
  await (
    await ethVault.revokeRole(default_admin_role, deployer.address)
  ).wait();

  const stablecoin = await ethers.getContractAt(
    "StableCoin",
    addresses.stablecoin
  );
  await (await stablecoin.grantRole(minter_role, usdcVault.address)).wait();
  await (await stablecoin.grantRole(minter_role, ethVault.address)).wait();

  if (deployData.verify) {
    await run("verify:verify", {
      address: usdcVaultForDaoImplementation,
      constructorArguments: [],
    });
    if (usdcVaultForDaoImplementation != ethVaultForDaoImplementation) {
      // this should be the same -> this will not happen
      await run("verify:verify", {
        address: ethVaultForDaoImplementation,
        constructorArguments: [],
      });
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
