// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "./IApeStaking.sol";
import "./IStandardNFTStrategy.sol";

interface IApeStakingStrategy is IStandardNFTStrategy {
    function mainPoolId() external view returns (uint256);

    function depositTokensBAKC(
        address _owner,
        IApeStaking.PairNftDepositWithAmount[] calldata _nfts
    ) external;

    function withdrawTokensBAKC(
        address _owner,
        IApeStaking.PairNftWithdrawWithAmount[] calldata _nfts
    ) external;

    function transferApeCoin(address _owner, address _recipient) external;

    function transferBAKC(
        address _owner,
        uint256[] memory _nftIndexes,
        address _recipient
    ) external;

    function claimRewardsBAKC(
        address _owner,
        IApeStaking.PairNft[] calldata _nfts,
        address _recipient
    ) external;
}
