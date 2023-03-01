// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IBooster.sol";

contract MockBooster is IBooster {
    address rewardPool;
    mapping(uint256 => IERC20) pidToken;

    constructor(address _rewardPool) {
        rewardPool = _rewardPool;
    }

    function depositAll(uint256 _pid, bool) external override returns (bool) {
        IERC20 _token = pidToken[_pid];
        uint256 _balance = _token.balanceOf(msg.sender);
        _token.transferFrom(msg.sender, rewardPool, _balance);

        return true;
    }

    function setPidToken(uint256 _pid, IERC20 _token) external {
        pidToken[_pid] = _token;
    }
}
