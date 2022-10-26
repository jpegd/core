// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "./AbstractApeStakingStrategy.sol";

contract MAYCApeStakingStrategy is AbstractApeStakingStrategy {
    
    function _depositSelector() internal override pure returns (bytes4) {
        return IApeStaking.depositBAYC.selector;
    }

    function _withdrawSelector() internal override pure returns (bytes4) {
        return IApeStaking.withdrawBAYC.selector;
    }

    function _claimSelector() internal override pure returns (bytes4) {
        return IApeStaking.claimBAYC.selector;
    }

}
