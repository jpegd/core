import { ethers, upgrades, run } from "hardhat";
import fs from "fs";

const addresses = require("./addresses.json");
const { deployData } = require("./utils");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer: ", deployer.address);

  const JPEGStaking = await ethers.getContractFactory("JPEGStaking");
  const sJpegd = await upgrades.deployProxy(JPEGStaking, [addresses.jpeg]);
  await sJpegd.deployed();
  console.log("JPEGStaking deployed at: ", sJpegd.address);

  const sJpegdImplementation = await (
    await upgrades.admin.getInstance()
  ).getProxyImplementation(sJpegd.address);
  console.log("JPEGStaking implementation deployed at: ", sJpegdImplementation);

  addresses.sJpegd = sJpegd.address;
  addresses.sJpegdImplementation = sJpegdImplementation;
  fs.writeFileSync(
    "./deploy/addresses.json",
    JSON.stringify(addresses, null, 2)
  );

  if (deployData.verify) {
    await run("verify:verify", {
      address: sJpegdImplementation,
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
