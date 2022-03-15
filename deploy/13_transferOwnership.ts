import { ethers, upgrades } from "hardhat";

const { deployData } = require("./utils");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer: ", deployer.address);

  await upgrades.admin.transferProxyAdminOwnership(deployData.dao);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
