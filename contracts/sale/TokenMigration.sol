// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract TokenMigration is Ownable, ReentrancyGuard {
    error ZeroAddress();
    error ZeroAmount();

    event TokensMigrated(
        address indexed account,
        uint256 newTokenAmount,
        uint256 oldTokenAmount
    );

    IERC20 public immutable NEW_TOKEN;
    IERC20 public immutable OLD_TOKEN;

    uint256 internal immutable NEW_SUPPLY;
    uint256 internal immutable OLD_SUPPLY;

    constructor(address _newToken, address _oldToken) {
        if (_newToken == address(0) || _oldToken == address(0))
            revert ZeroAddress();

        NEW_TOKEN = IERC20(_newToken);
        OLD_TOKEN = IERC20(_oldToken);

        NEW_SUPPLY = IERC20(_newToken).totalSupply();
        OLD_SUPPLY = IERC20(_oldToken).totalSupply();
    }

    function migrate(uint256 _amount) external nonReentrant {
        if (_amount == 0) revert ZeroAmount();

        uint256 _amountToTransfer = (_amount * NEW_SUPPLY) / OLD_SUPPLY;

        OLD_TOKEN.transferFrom(msg.sender, address(this), _amount);
        NEW_TOKEN.transfer(msg.sender, _amountToTransfer);

        emit TokensMigrated(msg.sender, _amountToTransfer, _amount);
    }

    function withdrawOldToken(uint256 _amount) external onlyOwner {
        OLD_TOKEN.transfer(msg.sender, _amount);
    }

    function withdrawNewToken(uint256 _amount) external onlyOwner {
        NEW_TOKEN.transfer(msg.sender, _amount);
    }
}
