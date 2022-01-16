import { ethers, run } from "hardhat";
import fs from "fs";

const addresses = require("./addresses.json");
const { deployData } = require("./utils");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer: ", deployer.address);

  const StableCoin = await ethers.getContractFactory("StableCoin");
  const stablecoin = await StableCoin.deploy();
  await stablecoin.deployed();
  console.log("StableCoin deployed at: ", stablecoin.address);

  addresses.stablecoin = stablecoin.address;
  fs.writeFileSync(
    "./deploy/addresses.json",
    JSON.stringify(addresses, null, 2)
  );

  if (deployData.verify) {
    await run("verify:verify", {
      address: addresses.stablecoin,
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
