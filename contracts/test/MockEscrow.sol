// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

contract MockEscrow {

    address public nftAddress;

    constructor(address _addr) {
        nftAddress = _addr;
    }

    function setNFTAddress(address _addr) external {
        nftAddress = _addr;
    }

}

