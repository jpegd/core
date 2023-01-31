// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "./SubCollectionHelper.sol";

contract FidenzasHelper is SubCollectionHelper {

    uint256 public constant FIDENZAS_START_INDEX = 78000000;
    uint256 public constant FIDENZAS_END_INDEX = 78000998;

    function isValid(uint256 _idx) internal pure override returns (bool) {
        return _idx >= FIDENZAS_START_INDEX && _idx <= FIDENZAS_END_INDEX;
    }

}