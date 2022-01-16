import { ethers, run } from "hardhat";
import fs from "fs";

const addresses = require("./addresses.json");
const { deployData } = require("./utils");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer: ", deployer.address);

  const TokenSale = await ethers.getContractFactory("TokenSale");
  const sale = await TokenSale.deploy(
    deployData.weth,
    deployData.usdc,
    deployData.ethAggregator,
    deployData.usdcAggregator,
    addresses.jpeg,
    deployData.dao
  );
  await sale.deployed();
  console.log("TokenSale deployed at: ", sale.address);

  addresses.tokenSale = sale.address;
  fs.writeFileSync(
    "./deploy/addresses.json",
    JSON.stringify(addresses, null, 2)
  );

  if (deployData.verify) {
    await run("verify:verify", {
      address: sale.address,
      constructorArguments: [
        deployData.weth,
        deployData.usdc,
        deployData.ethAggregator,
        deployData.usdcAggregator,
        addresses.jpeg,
        deployData.dao,
      ],
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
