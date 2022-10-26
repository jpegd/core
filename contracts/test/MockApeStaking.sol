// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import "./TestERC20.sol";
import "../interfaces/IApeStaking.sol";

contract MockApeStaking is IApeStaking {

    uint256 constant BAYC_ID = 1;
    uint256 constant MAYC_ID = 2;

    TestERC20 ape;
    IERC721 bayc;
    IERC721 mayc;

    mapping(uint256 => mapping(uint256 => uint256)) depositedAmounts;

    constructor(TestERC20 _ape, IERC721 _bayc, IERC721 _mayc) {
        ape = _ape;
        bayc = _bayc;
        mayc = _mayc;
    }

    function nftPosition(uint256 _poolId, uint256 _nftId) external view override returns (uint256, int256) {
        return (depositedAmounts[_poolId][_nftId], 0);
    }

    function depositBAYC(SingleNft[] calldata _nfts) external override {
        _depositNFT(_nfts, BAYC_ID, bayc);
    }

    function depositMAYC(SingleNft[] calldata _nfts) external override {
        _depositNFT(_nfts, MAYC_ID, mayc);
    }

    function withdrawBAYC(SingleNft[] calldata _nfts, address _recipient) external override {
        _withdrawNFT(_nfts, _recipient, BAYC_ID, bayc);
    }

    function withdrawMAYC(SingleNft[] calldata _nfts, address _recipient) external override {
        _withdrawNFT(_nfts, _recipient, MAYC_ID, mayc);
    }
    function claimBAYC(uint256[] calldata _nfts, address _recipient) external override {
        _claimNFT(_nfts, _recipient, bayc);
    }
    function claimMAYC(uint256[] calldata _nfts, address _recipient) external override {
        _claimNFT(_nfts, _recipient, mayc);
    }

    function _depositNFT(SingleNft[] calldata _nfts, uint256 poolId, IERC721 _contract) internal {
        uint256 totalAmount;
        for (uint256 i; i < _nfts.length; ++i) {
            SingleNft memory nft = _nfts[i];
            require(_contract.ownerOf(nft.tokenId) == msg.sender);
            depositedAmounts[poolId][nft.tokenId] += nft.amount;
            totalAmount += nft.amount;
        }

        ape.transferFrom(msg.sender, address(this), totalAmount);
    }

    function _withdrawNFT(SingleNft[] calldata _nfts, address _recipient, uint256 poolId, IERC721 _contract) internal {
        uint256 totalAmount;
        for (uint256 i; i < _nfts.length; ++i) {
            SingleNft memory nft = _nfts[i];
            require(_contract.ownerOf(nft.tokenId) == msg.sender);
            depositedAmounts[poolId][_nfts[i].tokenId] -= nft.amount;
            totalAmount += nft.amount;
        }

        ape.transfer(_recipient, totalAmount);
    }

    function _claimNFT(uint256[] calldata _nfts, address _recipient, IERC721 _contract) internal {
        for (uint256 i; i < _nfts.length; ++i) {
            require(_contract.ownerOf(_nfts[i]) == msg.sender);
        }

        ape.mint(_recipient, _nfts.length * 1 ether);
    }

}