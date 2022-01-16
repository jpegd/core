import { ethers, run } from "hardhat";
import fs from "fs";

const addresses = require("./addresses.json");
const { deployData } = require("./utils");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer: ", deployer.address);

  const JPEG = await ethers.getContractFactory("JPEG");
  const jpeg = await JPEG.deploy(ethers.utils.parseUnits("69420000000"));
  await jpeg.deployed();
  console.log("JPEG deployed at: ", jpeg.address);

  addresses.jpeg = jpeg.address;
  fs.writeFileSync(
    "./deploy/addresses.json",
    JSON.stringify(addresses, null, 2)
  );

  await (
    await jpeg.grantRole(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      deployData.dao
    )
  ).wait();

  await (
    await jpeg.grantRole(
      "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6",
      deployData.dao
    )
  ).wait();

  await (
    await jpeg.revokeRole(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      deployer.address
    )
  ).wait();
  await (
    await jpeg.transfer(deployData.dao, ethers.utils.parseUnits("69420000000"))
  ).wait();

  if (deployData.verify) {
    await run("verify:verify", {
      address: jpeg.address,
      constructorArguments: [ethers.utils.parseUnits("69420000000")],
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
