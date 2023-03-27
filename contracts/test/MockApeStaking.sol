// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import "./TestERC20.sol";
import "../interfaces/IApeStaking.sol";

contract MockApeStaking is IApeStaking {
    struct PairingStatus {
        uint248 tokenId;
        bool isPaired;
    }

    uint256 constant APE_ID = 0;
    uint256 constant BAYC_ID = 1;
    uint256 constant MAYC_ID = 2;
    uint256 constant BAKC_ID = 3;

    TestERC20 ape;
    IERC721 bayc;
    IERC721 mayc;
    IERC721 bakc;

    mapping(uint256 => mapping(address => mapping(uint256 => uint256)))
        public
        override pendingRewards;
    mapping(uint256 => mapping(uint256 => uint256)) depositedAmounts;
    mapping(uint256 => mapping(uint256 => PairingStatus))
        public
        override bakcToMain;
    mapping(uint256 => mapping(uint256 => PairingStatus))
        public
        override mainToBakc;

    constructor(TestERC20 _ape, IERC721 _bayc, IERC721 _mayc, IERC721 _bakc) {
        ape = _ape;
        bayc = _bayc;
        mayc = _mayc;
        bakc = _bakc;
    }

    function setPendingRewards(
        uint256 _poolId,
        address _account,
        uint256 _tokenId,
        uint256 _rewards
    ) external {
        pendingRewards[_poolId][_account][_tokenId] = _rewards;
    }

    function withdrawApeCoin(
        uint256 _amount,
        address _recipient
    ) external override {
        ape.transfer(_recipient, _amount);
    }

    function depositApeCoin(uint256 _amount, address) external override {
        ape.transferFrom(msg.sender, address(this), _amount);
    }

    function claimApeCoin(address _recipient) external override {
        ape.mint(_recipient, pendingRewards[APE_ID][msg.sender][0]);
        pendingRewards[APE_ID][msg.sender][0] = 0;
    }

    function nftPosition(
        uint256 _poolId,
        uint256 _nftId
    ) external view override returns (uint256, int256) {
        return (depositedAmounts[_poolId][_nftId], 0);
    }

    function depositBAYC(SingleNft[] calldata _nfts) external override {
        _depositNFT(_nfts, BAYC_ID, bayc);
    }

    function depositMAYC(SingleNft[] calldata _nfts) external override {
        _depositNFT(_nfts, MAYC_ID, mayc);
    }

    function depositBAKC(
        PairNftDepositWithAmount[] calldata _baycPairs,
        PairNftDepositWithAmount[] calldata _maycPairs
    ) external override {
        _depositPairNft(BAYC_ID, _baycPairs, bayc);
        _depositPairNft(MAYC_ID, _maycPairs, mayc);
    }

    function withdrawBAYC(
        SingleNft[] calldata _nfts,
        address _recipient
    ) external override {
        _withdrawNFT(_nfts, _recipient, BAYC_ID, bayc);
    }

    function withdrawMAYC(
        SingleNft[] calldata _nfts,
        address _recipient
    ) external override {
        _withdrawNFT(_nfts, _recipient, MAYC_ID, mayc);
    }

    function withdrawBAKC(
        PairNftWithdrawWithAmount[] calldata _baycPairs,
        PairNftWithdrawWithAmount[] calldata _maycPairs
    ) external override {
        _withdrawPairNft(BAYC_ID, _baycPairs, bayc);
        _withdrawPairNft(MAYC_ID, _maycPairs, mayc);
    }

    function claimBAYC(
        uint256[] calldata _nfts,
        address _recipient
    ) external override {
        _claimNFT(BAYC_ID, _nfts, _recipient, bayc);
    }

    function claimMAYC(
        uint256[] calldata _nfts,
        address _recipient
    ) external override {
        _claimNFT(MAYC_ID, _nfts, _recipient, mayc);
    }

    function claimBAKC(
        PairNft[] calldata _baycPairs,
        PairNft[] calldata _maycPairs,
        address _recipient
    ) external override {
        _claimPairNft(_baycPairs, _recipient, bayc);
        _claimPairNft(_maycPairs, _recipient, mayc);
    }

    function _depositNFT(
        SingleNft[] calldata _nfts,
        uint256 poolId,
        IERC721 _contract
    ) internal {
        uint256 totalAmount;
        for (uint256 i; i < _nfts.length; ++i) {
            SingleNft memory nft = _nfts[i];
            require(_contract.ownerOf(nft.tokenId) == msg.sender);
            depositedAmounts[poolId][nft.tokenId] += nft.amount;
            totalAmount += nft.amount;
        }

        ape.transferFrom(msg.sender, address(this), totalAmount);
    }

    function _depositPairNft(
        uint256 _poolId,
        PairNftDepositWithAmount[] calldata _pairs,
        IERC721 _contract
    ) internal {
        uint256 totalAmount;
        IERC721 _bakc = bakc;
        uint256 bakcID = BAKC_ID;
        for (uint256 i; i < _pairs.length; ++i) {
            PairNftDepositWithAmount memory nft = _pairs[i];
            require(_contract.ownerOf(nft.mainTokenId) == msg.sender);
            require(_bakc.ownerOf(nft.bakcTokenId) == msg.sender);
            depositedAmounts[bakcID][nft.bakcTokenId] += nft.amount;
            bakcToMain[nft.bakcTokenId][_poolId] = PairingStatus(
                nft.mainTokenId,
                true
            );
            mainToBakc[_poolId][nft.mainTokenId] = PairingStatus(
                nft.bakcTokenId,
                true
            );
            totalAmount += nft.amount;
        }

        ape.transferFrom(msg.sender, address(this), totalAmount);
    }

    function _withdrawNFT(
        SingleNft[] calldata _nfts,
        address _recipient,
        uint256 poolId,
        IERC721 _contract
    ) internal {
        uint256 totalAmount;
        for (uint256 i; i < _nfts.length; ++i) {
            SingleNft memory nft = _nfts[i];
            require(_contract.ownerOf(nft.tokenId) == msg.sender);
            depositedAmounts[poolId][_nfts[i].tokenId] -= nft.amount;
            totalAmount += nft.amount;
        }

        ape.transfer(_recipient, totalAmount);
    }

    function _withdrawPairNft(
        uint256 _poolId,
        PairNftWithdrawWithAmount[] calldata _pairs,
        IERC721 _contract
    ) internal {
        uint256 totalAmount;
        IERC721 _bakc = bakc;
        uint256 bakcID = BAKC_ID;
        for (uint256 i; i < _pairs.length; ++i) {
            PairNftWithdrawWithAmount memory nft = _pairs[i];
            require(_contract.ownerOf(nft.mainTokenId) == msg.sender);
            require(_bakc.ownerOf(nft.bakcTokenId) == msg.sender);
            if (!nft.isUncommit) {
                if (nft.amount > depositedAmounts[bakcID][nft.bakcTokenId])
                    revert();
            }

            if (nft.isUncommit) {
                mainToBakc[_poolId][nft.mainTokenId] = PairingStatus(0, false);
                bakcToMain[nft.bakcTokenId][_poolId] = PairingStatus(0, false);
            }
            uint256 finalWithdrawAmount = nft.isUncommit
                ? depositedAmounts[bakcID][nft.bakcTokenId]
                : nft.amount;
            depositedAmounts[bakcID][nft.bakcTokenId] -= finalWithdrawAmount;
            totalAmount += finalWithdrawAmount;
        }

        ape.transfer(msg.sender, totalAmount);
    }

    function _claimNFT(
        uint256 _poolId,
        uint256[] calldata _nfts,
        address _recipient,
        IERC721 _contract
    ) internal {
        uint256 _totalRewards;
        for (uint256 i; i < _nfts.length; ++i) {
            require(_contract.ownerOf(_nfts[i]) == msg.sender);
            _totalRewards += pendingRewards[_poolId][msg.sender][_nfts[i]];
            pendingRewards[_poolId][msg.sender][_nfts[i]] = 0;
        }

        ape.mint(_recipient, _totalRewards);
    }

    function _claimPairNft(
        PairNft[] calldata _pairs,
        address _recipient,
        IERC721 _contract
    ) internal {
        uint256 _totalRewards;
        IERC721 _bakc = bakc;
        for (uint256 i; i < _pairs.length; ++i) {
            require(_bakc.ownerOf(_pairs[i].bakcTokenId) == msg.sender);
            require(_contract.ownerOf(_pairs[i].mainTokenId) == msg.sender);
            _totalRewards += pendingRewards[BAKC_ID][msg.sender][
                _pairs[i].bakcTokenId
            ];
            pendingRewards[BAKC_ID][msg.sender][_pairs[i].bakcTokenId] = 0;
        }

        ape.mint(_recipient, _totalRewards);
    }
}
