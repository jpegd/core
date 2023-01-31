// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "./SubCollectionHelper.sol";

contract RingersHelper is SubCollectionHelper {

    uint256 public constant RINGERS_START_INDEX = 13000000;
    uint256 public constant RINGERS_END_INDEX = 13000999;

    function isValid(uint256 _idx) internal pure override returns (bool) {
        return _idx >= RINGERS_START_INDEX && _idx <= RINGERS_END_INDEX;
    }

}