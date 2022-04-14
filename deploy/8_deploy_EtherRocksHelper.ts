import { ethers, upgrades, run } from "hardhat";
import fs from "fs";

const addresses = require("./addresses.json");
const { deployData } = require("./utils");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer: ", deployer.address);

  const Helper = await ethers.getContractFactory("EtherRocksHelper");
  const helper = await upgrades.deployProxy(Helper, [deployData.etherRocks]);
  await helper.deployed();
  console.log("EtherRocksHelper deployed at: ", helper.address);

  const helperImplementation = await (
    await upgrades.admin.getInstance()
  ).getProxyImplementation(helper.address);
  console.log(
    "EtherRocksHelper implementation deployed at: ",
    helperImplementation
  );

  addresses.rocksHelper = helper.address;
  addresses.rocksHelperImplementation = helperImplementation;
  fs.writeFileSync(
    "./deploy/addresses.json",
    JSON.stringify(addresses, null, 2)
  );

  if (deployData.verify) {
    await run("verify:verify", {
      address: helperImplementation,
      constructorArguments: [],
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });