// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

contract MockEscrow {
    address public nftContract;

    constructor(address _addr) {
        nftContract = _addr;
    }

    function setNFTAddress(address _addr) external {
        nftContract = _addr;
    }
}
