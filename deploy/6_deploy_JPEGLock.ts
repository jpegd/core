import { ethers, run } from "hardhat";
import fs from "fs";

const addresses = require("./addresses.json");
const { deployData } = require("./utils");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer: ", deployer.address);

  const JPEGLock = await ethers.getContractFactory("JPEGLock");
  const punksJpegLock = await JPEGLock.deploy(addresses.jpeg);
  await punksJpegLock.deployed();
  console.log("Punks JPEGLock deployed at: ", punksJpegLock.address);

  const rocksJpegLock = await JPEGLock.deploy(addresses.jpeg);
  await rocksJpegLock.deployed();
  console.log("Rocks JPEGLock deployed at: ", rocksJpegLock.address);

  addresses.punksJpegLock = punksJpegLock.address;
  addresses.rocksJpegLock = rocksJpegLock.address;
  fs.writeFileSync(
    "./deploy/addresses.json",
    JSON.stringify(addresses, null, 2)
  );

  if (deployData.verify) {
    await run("verify:verify", {
      address: addresses.jpegLock,
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
