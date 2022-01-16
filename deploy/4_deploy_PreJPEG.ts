import { ethers, run } from "hardhat";
import fs from "fs";

const addresses = require("./addresses.json");
const { deployData } = require("./utils");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer: ", deployer.address);

  const PreJPEG = await ethers.getContractFactory("PreJPEG");
  const preJpeg = await PreJPEG.deploy(addresses.jpeg);

  await preJpeg.deployed();

  console.log("PreJPEG deployed at: ", preJpeg.address);

  addresses.preJpeg = preJpeg.address;
  fs.writeFileSync(
    "./deploy/addresses.json",
    JSON.stringify(addresses, null, 2)
  );

  await (
    await preJpeg.grantRole(
      "0xc23e4cf9f9c5137c948ad4a95211794895d43271639a97b001bd23951d54c84a",
      deployData.dao
    )
  ).wait(); // vesting_controller_role

  await (
    await preJpeg.grantRole(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      deployData.dao
    )
  ).wait(); // admin_role

  await (
    await preJpeg.revokeRole(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      deployer.address
    )
  ).wait(); // admin_role

  if (deployData.verify) {
    await run("verify:verify", {
      address: preJpeg.address,
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
