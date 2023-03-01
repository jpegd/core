// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

contract MockAuction {
    mapping(address => bool) public isAuthorized;

    function setAuthorized(address _account, bool _authorized) external {
        isAuthorized[_account] = _authorized;
    }
}
