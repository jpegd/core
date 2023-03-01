// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IStrategy.sol";

contract MockStrategy is IStrategy {
    address public want;
    address public baseRewardPool;

    constructor(address _want, address _baseRewardPool) {
        want = _want;
        baseRewardPool = _baseRewardPool;
    }

    function deposit() external override {}

    function withdraw(address to, address token) external override {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(to, balance);
    }

    function withdraw(address to, uint256 amount) external override {
        IERC20(want).transfer(to, amount);
    }

    function withdrawAll() external override {
        uint256 balance = IERC20(want).balanceOf(address(this));
        IERC20(want).transfer(msg.sender, balance);
    }

    function totalAssets() external view override returns (uint256) {
        return IERC20(want).balanceOf(address(this));
    }
}
