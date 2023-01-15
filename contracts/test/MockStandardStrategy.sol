// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "../interfaces/INFTStrategy.sol";

contract MockStandardStrategy is INFTStrategy {

    IERC721 nft;
    bool sendBack;

    constructor(IERC721 _nft) {
        nft = _nft;
        sendBack = true;
    }

    function shouldSendBack(bool _sendBack) external {
        sendBack = _sendBack;
    }

    function afterDeposit(address, uint256[] calldata, bytes calldata) external override {}

    function withdraw(address, address _recipient, uint256 _nftIndex) external override {
        if (sendBack)
            nft.transferFrom(address(this), _recipient, _nftIndex);
    }

    function depositAddress(address) external view override returns (address) {
        return address(this);
    }

    function kind() external pure override returns (INFTStrategy.Kind) {
        return INFTStrategy.Kind.STANDARD;
    }

    function isDeposited(address, uint256 _nftIndex) external view override returns (bool) {
        return nft.ownerOf(_nftIndex) == address(this);
    }

}