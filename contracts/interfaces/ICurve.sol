// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ICurve is IERC20 {
    function balances(uint256 index) external view returns (uint256);
    function exchange(uint256 i, uint256 j, uint256 _dx, uint256 _min_dy) external payable returns (uint256);
}