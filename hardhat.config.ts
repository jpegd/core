import dotenv from "dotenv";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@typechain/hardhat";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-abi-exporter";

dotenv.config();

module.exports = {
    defaultNetwork: "hardhat",
    gasReporter: {
        showTimeSpent: true,
        currency: "USD"
    },
    networks: {
        hardhat: {
            allowUnlimitedContractSize: true
        },
        kovan: {
            url:
                "https://eth-kovan.alchemyapi.io/v2/" +
                process.env.ALCHEMY_API_KEY,
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
        },
        mainnet: {
            url:
                "https://eth-mainnet.alchemyapi.io/v2/" +
                process.env.ALCHEMY_API_KEY,
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
        }
    },
    solidity: {
        compilers: [
            {
                version: "0.8.4",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 300
                    }
                }
            }
        ]
    },
    paths: {
        sources: "./contracts",
        tests: "./tests",
        cache: "./cache",
        artifacts: "./artifacts"
    },
    mocha: {
        timeout: 200000
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY
    },
    abiExporter: {
        path: "./abi",
        clear: true,
        flat: true,
        spacing: 2
    },
    typechain: {
        outDir: "types",
        target: "ethers-v5"
    }
};
