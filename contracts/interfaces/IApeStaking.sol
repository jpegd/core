// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

interface IApeStaking {
    
    struct SingleNft {
        uint256 tokenId;
        uint256 amount;
    }

    struct PairNft {
        uint256 mainTokenId;
        uint256 bakcTokenId;
    }

    struct PairNftWithAmount {
        uint256 mainTokenId;
        uint256 bakcTokenId;
        uint256 amount;
    }

    function nftPosition(uint256 _poolId, uint256 _nftId) external view returns (uint256, int256);
    function bakcToMain(uint256 _nftId, uint256 _poolId) external view returns (uint256, bool);
    function mainToBakc(uint256 _poolId, uint256 _nftId) external view returns (uint256, bool);

    function depositBAYC(SingleNft[] calldata _nfts) external;
    function depositMAYC(SingleNft[] calldata _nfts) external;
    function depositBAKC(PairNftWithAmount[] calldata _baycPairs, PairNftWithAmount[] calldata _maycPairs) external;
    function withdrawBAYC(SingleNft[] calldata _nfts, address _recipient) external;
    function withdrawMAYC(SingleNft[] calldata _nfts, address _recipient) external;
    function withdrawBAKC(PairNftWithAmount[] calldata _baycPairs, PairNftWithAmount[] calldata _maycPairs) external;
    function claimBAYC(uint256[] calldata _nfts, address _recipient) external;
    function claimMAYC(uint256[] calldata _nfts, address _recipient) external;
    function claimBAKC(PairNft[] calldata _baycPairs, PairNft[] calldata _maycPairs, address _recipient) external;
}