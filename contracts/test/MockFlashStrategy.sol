// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "../interfaces/INFTStrategy.sol";

contract MockFlashStrategy is INFTStrategy {

    IERC721 nft;
    bool sendBack;

    constructor(IERC721 _nft) {
        nft = _nft;
        sendBack = true;
    }

    function shouldSendBack(bool _sendBack) external {
        sendBack = _sendBack;
    }

    function afterDeposit(address, uint256[] calldata _nftIndexes, bytes calldata) external override {
        if (sendBack) {
            for (uint256 i; i < _nftIndexes.length; ++i) {
                nft.transferFrom(address(this), msg.sender, _nftIndexes[i]);
            }
        }
    }

    function withdraw(address, address, uint256) external pure override {
        revert();
    }

    function depositAddress(address) external view override returns (address) {
        return address(this);
    }

    function kind() external pure override returns (INFTStrategy.Kind) {
        return INFTStrategy.Kind.FLASH;
    }

}