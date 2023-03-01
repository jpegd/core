// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "../interfaces/IUniswapV2Oracle.sol";

contract UniswapV2MockOracle is IUniswapV2Oracle {
    uint256 price;

    constructor(uint256 _price) {
        price = _price;
    }

    function consultAndUpdateIfNecessary(
        address,
        uint256
    ) external view override returns (uint256) {
        return price;
    }

    function setPrice(uint256 _price) external {
        price = _price;
    }
}
