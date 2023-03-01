// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "../utils/NoContract.sol";

contract MockNoContract is NoContract {
    function protectedFunction() external noContract {}

    function callProtectedFunction() external {
        this.protectedFunction();
    }
}
