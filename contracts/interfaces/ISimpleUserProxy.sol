// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

interface ISimpleUserProxy {
    function doCalls(address[] calldata _targets, bytes[] calldata _data, uint256[] calldata _values) external payable;
    function initialize(address _owner) external;
}