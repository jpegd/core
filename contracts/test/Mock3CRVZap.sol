// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./TestERC20.sol";
import "../interfaces/I3CRVZap.sol";
import "../interfaces/ICurve.sol";

contract Mock3CRVZap is I3CRVZap {
    TestERC20 crv3;
    uint256 nextMintAmount;
    mapping(uint256 => IERC20) tokenIndexes;

    constructor(TestERC20 _crv3) {
        crv3 = _crv3;
    }

    function setTokenIndex(uint256 _idx, IERC20 _token) external {
        tokenIndexes[_idx] = _token;
    }

    function setNextMintAmount(uint256 _next) external {
        nextMintAmount = _next;
    }

    function add_liquidity(
        address _pool,
        uint256[4] calldata _amounts,
        uint256 _minMint
    ) external override returns (uint256) {
        if (_amounts[0] > 0) {
            tokenIndexes[0].transferFrom(
                msg.sender,
                address(this),
                _amounts[0]
            );
            tokenIndexes[0].approve(_pool, _amounts[0]);
        }

        for (uint256 i = 1; i < 4; i++) {
            if (_amounts[i] > 0) {
                tokenIndexes[i].transferFrom(
                    msg.sender,
                    address(this),
                    _amounts[i]
                );
            }
        }

        uint256[2] memory _liqAmounts = [_amounts[0], nextMintAmount];

        crv3.mint(address(this), nextMintAmount);

        uint256 _amount = ICurve(_pool).add_liquidity(_liqAmounts, _minMint);
        ICurve(_pool).transfer(msg.sender, _amount);
        return _amount;
    }
}
