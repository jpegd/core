// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "../vaults/NFTValueProvider.sol";

contract MockNFTValueProviderMigration is NFTValueProvider {
    function setJPEG(IERC20Upgradeable _jpeg) external {
        jpeg = _jpeg;
    }

    function setLegacyTraitLock(uint256 _index, uint256 _lockedValue) external {
        traitBoostPositions[_index].isNewToken = false;
        traitBoostPositions[_index].lockedValue = _lockedValue;
    }

    function setLegacyLTVLock(uint256 _index, uint256 _lockedValue) external {
        ltvBoostPositions[_index].isNewToken = false;
        ltvBoostPositions[_index].lockedValue = _lockedValue;
    }
}
