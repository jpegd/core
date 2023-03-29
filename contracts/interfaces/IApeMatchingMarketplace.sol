// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

interface IApeMatchingMarketplace {
    enum Collections {
        BAYC,
        MAYC
    }

    struct MainNFT {
        Collections collection;
        uint16 tokenId;
    }

    struct BAKCDeposit {
        uint24 offerNonce;
        bool isDeposited;
    }

    struct MainNFTDeposit {
        uint24 mainOfferNonce;
        uint24 bakcOfferNonce;
        bool isDeposited;
    }

    function mainDeposits(
        Collections _collection,
        uint16 _tokenId
    ) external view returns (MainNFTDeposit memory);

    function bakcDeposits(
        uint16 _tokenId
    ) external view returns (BAKCDeposit memory);

    function doStrategyActions(
        address _caller,
        uint8[] calldata _actions,
        bytes[] calldata _data
    ) external;
}
