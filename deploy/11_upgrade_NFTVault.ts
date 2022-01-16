import { ethers, upgrades } from "hardhat";

const addresses = require("./addresses.json");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer: ", deployer.address);

  const NFTVault = await ethers.getContractFactory("NFTVault");
  await upgrades.upgradeProxy(addresses.nftVault, NFTVault);
  console.log("NFTVault upgraded");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
