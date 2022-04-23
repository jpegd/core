import fs from "fs";
import path from "path";
import { task } from "hardhat/config";

task("deploy-jpegLPFarming", "Deploys the JPEGLPFarming contract")
  .setAction(async (_, { network, ethers, run }) => {
    const configFilePath = path.join(__dirname, "config", network.name + ".json");
    const config = await JSON.parse(fs.readFileSync(configFilePath).toString());

    if (!config.jpeg)
      throw "No JPEG address in network's config file";
    if (!config.dao)
      throw "No dao address in network's config file";

    const [deployer] = await ethers.getSigners();
    console.log("Deployer: ", deployer.address);

    const LPFarming = await ethers.getContractFactory("LPFarming");
    const lpFarming = await LPFarming.deploy(config.jpeg);

    console.log("JPEGLPFarming deployed at: ", lpFarming.address);

    config.lpFarming = lpFarming.address;
    fs.writeFileSync(configFilePath, JSON.stringify(config));

    console.log("Configuring JPEGLPFarming")

    await (await lpFarming.transferOwnership(config.dao)).wait();

    if (network.name != "hardhat") {
      console.log("Verifying JPEGLPFarming");

      await run("verify:verify", {
        address: lpFarming.address,
        constructorArguments: [config.jpeg],
      });
    }

    console.log("All done.");
  });