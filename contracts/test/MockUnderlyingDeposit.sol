// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockUnderlyingDeposit {
    IERC20 depositToken;
    IERC20 receiptToken;

    constructor(IERC20 _depositToken, IERC20 _receiptToken) {
        depositToken = _depositToken;
        receiptToken = _receiptToken;
    }

    function deposit(address _to, uint256 _amount) external returns (uint256) {
        depositToken.transferFrom(msg.sender, address(this), _amount);
        uint256 _returnAmount = receiptToken.balanceOf(address(this));
        receiptToken.transfer(_to, _returnAmount);
        return _returnAmount;
    }
}
