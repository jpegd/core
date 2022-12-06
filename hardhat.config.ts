import dotenv from "dotenv";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-web3"; //For openzeppelin
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-etherscan";
import "hardhat-gas-reporter";
import "hardhat-abi-exporter";
import "solidity-coverage";
import "@typechain/hardhat";
import "@openzeppelin/hardhat-upgrades";
import "./deploy/1_deploy_JPEG";
import "./deploy/2_deploy_TokenSale";
import "./deploy/3_deploy_JPEGStaking";
import "./deploy/4_deploy_PreJPEG";
import "./deploy/5_deploy_Stablecoin";
import "./deploy/6_deploy_JPEGLock";
import "./deploy/7_deploy_CryptoPunksHelper";
import "./deploy/8_deploy_EtherRocksHelper";
import "./deploy/9_deploy_JPEGCardsCigStaking";
import "./deploy/10_deploy_NFTVault";
import "./deploy/11_configure_CryptoPunksHelper";
import "./deploy/12_configure_EtherRocksHelper";
import "./deploy/13_deploy_FungibleAssetVaultForDAO";
import "./deploy/14_deploy_JPEGDLPFarming";
import "./deploy/15_transferOwnership";
import "./deploy/16_deploy_Vault";
import "./deploy/17_deploy_StrategyPUSDConvex";
import "./deploy/18_deploy_ApeStake"

dotenv.config();

module.exports = {
  defaultNetwork: "hardhat",
  gasReporter: {
    showTimeSpent: true,
    currency: "USD",
  },
  networks: {
    hardhat: {
      forking: {
        url: "https://eth-mainnet.alchemyapi.io/v2/" + process.env.ALCHEMY_API_KEY,
        blockNumber: 16097722
      }
    },
    kovan: {
      url: "https://eth-kovan.alchemyapi.io/v2/" + process.env.ALCHEMY_API_KEY,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    goerli: {
      url: "https://eth-goerli.alchemyapi.io/v2/" + process.env.ALCHEMY_API_KEY,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    mainnet: {
      url: "https://eth-mainnet.alchemyapi.io/v2/" + process.env.ALCHEMY_API_KEY,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    }
  },
  solidity: {
    compilers: [
      {
        version: "0.8.4",
        settings: {
          optimizer: {
            enabled: true,
            runs: 800,
          },
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./tests",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 200000,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  abiExporter: {
    path: "./abi",
    clear: true,
    flat: true,
    spacing: 2,
  },
  typechain: {
    outDir: "types",
    target: "ethers-v5",
  },
};
