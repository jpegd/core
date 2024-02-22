// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "./ISynthsDebtAggregator.sol";

interface ISynthsController {
    struct VaultData {
        address vaultAddress;
        uint8 assetDecimals;
    }

    function debtAggregator() external returns (address);

    function liquidate(uint256 _positionId, address _receiver) external;
}
