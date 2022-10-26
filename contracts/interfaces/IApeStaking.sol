// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

interface IApeStaking {
    
    struct SingleNft {
        uint256 tokenId;
        uint256 amount;
    }

    function nftPosition(uint256 _poolId, uint256 _nftId) external view returns (uint256, int256);

    function depositBAYC(SingleNft[] calldata _nfts) external;
    function depositMAYC(SingleNft[] calldata _nfts) external;
    function withdrawBAYC(SingleNft[] calldata _nfts, address _recipient) external;
    function withdrawMAYC(SingleNft[] calldata _nfts, address _recipient) external;
    function claimBAYC(uint256[] calldata _nfts, address _recipient) external;
    function claimMAYC(uint256[] calldata _nfts, address _recipient) external;
}