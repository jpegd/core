// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

contract SimpleUserProxy {
    error Unauthorized();
    error InvalidLength();

    address public owner;
    bool public initialized;

    function initialize(address _owner) external {
       if (initialized)
        revert Unauthorized();

        owner = _owner;
        initialized = true; 
    }

    function doCalls(address[] calldata _targets, bytes[] calldata _data, uint256[] calldata _values) external payable {
        if (msg.sender != owner)
            revert Unauthorized();

        uint256 length = _targets.length;
        if (_data.length != length || _values.length != length)
            revert InvalidLength();

        for (uint256 i = 0; i < length; ++i) {
            (bool success, bytes memory result) =_targets[i].call{value: _values[i]}(_data[i]);
            if (!success) {
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }
        }
    }

}