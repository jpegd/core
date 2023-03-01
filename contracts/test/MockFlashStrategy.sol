// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "../interfaces/IFlashNFTStrategy.sol";

contract MockFlashStrategy is IFlashNFTStrategy {
    IERC721 nft;
    bool sendBack;

    constructor(IERC721 _nft) {
        nft = _nft;
        sendBack = true;
    }

    function shouldSendBack(bool _sendBack) external {
        sendBack = _sendBack;
    }

    function afterDeposit(
        address,
        address _recipient,
        uint256[] calldata _nftIndexes,
        bytes calldata
    ) external override {
        if (sendBack) {
            for (uint256 i; i < _nftIndexes.length; ++i) {
                nft.transferFrom(address(this), _recipient, _nftIndexes[i]);
            }
        }
    }

    function depositAddress(address) external view override returns (address) {
        return address(this);
    }

    function kind() external pure override returns (Kind) {
        return Kind.FLASH;
    }
}
