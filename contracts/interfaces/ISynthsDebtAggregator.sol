// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

interface ISynthsDebtAggregator {
    struct VaultData {
        address vaultAddress;
        uint8 assetDecimals;
    }

    function debtVaults(address _asset) external returns (VaultData memory);
}
