// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "../utils/RateLib.sol";

contract MockUnderlyingDeposit is ERC20Burnable {
    using RateLib for RateLib.Rate;

    IERC20 depositToken;
    RateLib.Rate exchangeRate;

    constructor(
        IERC20 _depositToken,
        RateLib.Rate memory _exchangeRate
    ) ERC20("", "") {
        depositToken = _depositToken;
        exchangeRate = _exchangeRate;
    }

    function deposit(address _to, uint256 _amount) external returns (uint256) {
        depositToken.transferFrom(msg.sender, address(this), _amount);
        uint256 _mintAmount = exchangeRate.calculate(_amount);
        _mint(_to, _mintAmount);
        return _mintAmount;
    }

    function withdraw(address _to, uint256 _amount) external returns (uint256) {
        _burn(msg.sender, _amount);
        uint256 _returnAmount = (_amount * exchangeRate.denominator) /
            exchangeRate.numerator;
        depositToken.transfer(_to, _returnAmount);
        return _returnAmount;
    }
}
