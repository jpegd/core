// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

interface IStrategy {
    function want() external view returns (address);

    function deposit() external;

    // NOTE: must exclude any tokens used in the yield
    // Controller role - withdraw should return to Controller
    function withdraw(address) external returns (uint256);

    // Controller | Vault role - withdraw should always return to Vault
    function withdraw(uint256) external;

    // Controller | Vault role - withdraw should always return to Vault
    function withdrawAll() external returns (uint256);

    function balanceOf() external view returns (uint256);

    /*function convexConfig()
        external
        view
        returns (
            address booster,
            address baseRewardPool,
            uint256 pid
        );
*/
}
