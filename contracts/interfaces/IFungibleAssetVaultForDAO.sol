// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

interface IFungibleAssetVaultForDAO {
    function deposit(uint256 amount) external payable;

    function borrow(uint256 amount) external;

    function getCreditLimit(uint256 amount) external view returns (uint256);
}
