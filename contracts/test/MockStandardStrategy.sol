// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "../interfaces/IStandardNFTStrategy.sol";

contract MockStandardStrategy is IStandardNFTStrategy {

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

    function flashLoanStart(address, address _recipient, uint256[] calldata _nftIndexes, bytes calldata) external override returns (address) {
        for (uint256 i; i < _nftIndexes.length; i++) {
            nft.transferFrom(address(this), _recipient, _nftIndexes[i]);
        }

        return address(this);
    }

    function flashLoanEnd(address, uint256[] calldata, bytes calldata) external override {}

    function depositAddress(address) external view override returns (address) {
        return address(this);
    }

    function kind() external pure override returns (Kind) {
        return Kind.STANDARD;
    }

}