// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "./DAONFTVault.sol";

contract PUSDDAONFTVault is DAONFTVault {
    error InvalidOracleResults();

    /// @dev Returns the credit limit of an NFT
    /// @param _nftIndex The NFT to return credit limit of
    /// @return The NFT credit limit
    function _getCreditLimit(
        uint256 _nftIndex
    ) internal view override returns (uint256) {
        uint256 value = _ethToUSD(nftValueProvider.getNFTValueETH(_nftIndex));
        return
            (value * settings.creditLimitRate.numerator) /
            settings.creditLimitRate.denominator;
    }

    /// @dev Converts an ETH value to USD
    function _ethToUSD(uint256 _ethValue) internal view returns (uint256) {
        return
            (_ethValue * _normalizeAggregatorAnswer(ethAggregator)) / 1 ether;
    }

    /// @dev Fetches and converts to 18 decimals precision the latest answer of a Chainlink aggregator
    /// @param aggregator The aggregator to fetch the answer from
    /// @return The latest aggregator answer, normalized
    function _normalizeAggregatorAnswer(
        IAggregatorV3Interface aggregator
    ) internal view returns (uint256) {
        (, int256 answer, , uint256 timestamp, ) = aggregator.latestRoundData();

        if (answer == 0 || timestamp == 0) revert InvalidOracleResults();

        uint8 decimals = aggregator.decimals();

        unchecked {
            //converts the answer to have 18 decimals
            return
                decimals > 18
                    ? uint256(answer) / 10 ** (decimals - 18)
                    : uint256(answer) * 10 ** (18 - decimals);
        }
    }
}
