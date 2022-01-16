import { ethers, upgrades, run } from "hardhat";
import fs from "fs";

const addresses = require("./addresses.json");
const { deployData } = require("./utils");

const units = (value: number) => ethers.utils.parseUnits(value.toString());

const minter_role =
  "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer: ", deployer.address);

  if (!deployData.jpegOracle) {
    const TestJPEGAggregator = await ethers.getContractFactory(
      "MockV3Aggregator"
    );
    const jpegOracle = await TestJPEGAggregator.deploy(8, 1e8);
    await jpegOracle.deployed();
    addresses.jpegOracle = jpegOracle.address;
    deployData.jpegOracle = addresses.jpegOracle;

    console.log("TestJPEGAggregator deployed at: ", addresses.jpegOracle);

    if (deployData.verify) {
      await run("verify:verify", {
        address: addresses.jpegOracle,
        constructorArguments: [8, 1e8],
      });
    }
  }
  if (!deployData.punkOracle) {
    const TestFloorOracle = await ethers.getContractFactory("MockV3Aggregator");
    const floorOracle = await TestFloorOracle.deploy(18, units(50));
    await floorOracle.deployed();
    addresses.punkOracle = floorOracle.address;
    deployData.punkOracle = addresses.punkOracle;

    console.log("TestFloorOracle deployed at: ", floorOracle.address);

    if (deployData.verify) {
      await run("verify:verify", {
        address: floorOracle.address,
        constructorArguments: [18, units(50)],
      });
    }
  }

  const NFTVault = await ethers.getContractFactory("NFTVault");
  const nftVault = await upgrades.deployProxy(NFTVault, [
    addresses.stablecoin,
    addresses.helper,
    deployData.ethAggregator,
    deployData.jpegOracle,
    deployData.punkOracle,
    [
      [
        "0x26bca2ecad19e981c90a8c6efd8ee9856bbc5a2042259e6ee31e310fdc08d970", //APE
        units(2000),
        deployData.apes,
      ],
      [
        "0x3f00f46bb8cf74b3f3e5365e6a583ab26c2d9cffcbff21b7c25fe510854bc81f", //ALIEN
        units(4000),
        deployData.aliens,
      ],
    ],
    addresses.jpegLock,
    [
      [2, 100], //debtInterestApr
      [32, 100], //creditLimitRate
      [33, 100], //liquidationLimitRate
      [25, 100], //valueIncreaseLockRate
      [5, 1000], //organizationFeeRate
      [1, 100], //insuranchePurchaseRate
      [25, 100], //insuranceLiquidationPenaltyRate
      86400 * 3, //insuranceRepurchaseLimit
      units(3000).mul(1000), //borrowAmountCap
    ],
  ]);

  await nftVault.deployed();
  console.log("NFTVault deployed at: ", nftVault.address);

  const nftVaultImplementation = await (
    await upgrades.admin.getInstance()
  ).getProxyImplementation(nftVault.address);
  console.log("NFTVault implementation deployed at: ", nftVaultImplementation);

  addresses.nftVault = nftVault.address;
  addresses.nftVaultImplementation = nftVaultImplementation;
  fs.writeFileSync(
    "./deploy/addresses.json",
    JSON.stringify(addresses, null, 2)
  );

  await (
    await nftVault.grantRole(
      "0x3b5d4cc60d3ec3516ee8ae083bd60934f6eb2a6c54b1229985c41bfb092b2603",
      deployData.dao
    )
  ).wait(); //dao_role

  await (
    await nftVault.revokeRole(
      "0x3b5d4cc60d3ec3516ee8ae083bd60934f6eb2a6c54b1229985c41bfb092b2603",
      deployer.address
    )
  ).wait(); //dao_role

  const stablecoin = await ethers.getContractAt(
    "StableCoin",
    addresses.stablecoin
  );
  await (await stablecoin.grantRole(minter_role, nftVault.address)).wait();

  const jpegLock = await ethers.getContractAt("JPEGLock", addresses.jpegLock);

  await (await jpegLock.transferOwnership(nftVault.address)).wait();

  const helper = await ethers.getContractAt(
    "CryptoPunksHelper",
    addresses.helper
  );

  await (await helper.transferOwnership(nftVault.address)).wait();

  if (deployData.verify) {
    await run("verify:verify", {
      address: addresses.nftVaultImplementation,
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
