import { ethers, run } from "hardhat";
import fs from "fs";

const addresses = require("./addresses.json");
const { deployData } = require("./utils");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer: ", deployer.address);

  const LPFarming = await ethers.getContractFactory("LPFarming");
  const lpFarming = await LPFarming.deploy(addresses.jpeg);
  await lpFarming.deployed();
  console.log("LPFarming deployed at: ", lpFarming.address);

  addresses.lpFarming = lpFarming.address;
  fs.writeFileSync(
    "./deploy/addresses.json",
    JSON.stringify(addresses, null, 2)
  );

  await lpFarming.transferOwnership(deployData.dao);

  if (deployData.verify) {
    await run("verify:verify", {
      address: lpFarming.address,
      constructorArguments: [addresses.jpeg],
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
