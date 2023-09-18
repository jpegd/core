// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./TestERC20.sol";

import "../interfaces/ICurve.sol";

contract MockCurvePool is TestERC20, ICurve {
    uint256 nextAmountOut;
    uint256 nextMintAmount;
    mapping(uint256 => IERC20) tokenIndexes;

    constructor(
        string memory _name,
        string memory _symbol
    ) TestERC20(_name, _symbol) {}

    receive() external payable {}

    function setTokenIndex(uint256 _idx, IERC20 _token) external {
        tokenIndexes[_idx] = _token;
    }

    function setNextAmountOut(uint256 _next) external {
        nextAmountOut = _next;
    }

    function setNextMintAmount(uint256 _next) external {
        nextMintAmount = _next;
    }

    function balances(uint256 _idx) external view override returns (uint256) {
        return tokenIndexes[_idx].balanceOf(address(this));
    }

    function exchange(
        uint256 _inputIndex,
        uint256 _outputIndex,
        uint256 _inputAmount,
        uint256 _minOut
    ) external payable override returns (uint256) {
        require(nextAmountOut >= _minOut, "INSUFFICIENT_AMOUNT_OUT");

        tokenIndexes[_inputIndex].transferFrom(
            msg.sender,
            address(this),
            _inputAmount
        );
        tokenIndexes[_outputIndex].transfer(msg.sender, nextAmountOut);

        return nextAmountOut;
    }

    function exchange(
        uint256 _inputIndex,
        uint256 _outputIndex,
        uint256 _inputAmount,
        uint256 _minOut,
        bool _useETH
    ) external payable override returns (uint256) {
        require(nextAmountOut >= _minOut, "INSUFFICIENT_AMOUNT_OUT");

        tokenIndexes[_inputIndex].transferFrom(
            msg.sender,
            address(this),
            _inputAmount
        );
        if (_useETH) {
            (bool _success, ) = msg.sender.call{ value: nextAmountOut }("");
            require(_success, "INSUFFICIENT_ETH");
        } else {
            tokenIndexes[_outputIndex].transfer(msg.sender, nextAmountOut);
        }

        return nextAmountOut;
    }

    function add_liquidity(
        uint256[2] calldata _amounts,
        uint256 _minMintAmount
    ) external override returns (uint256) {
        require(nextMintAmount >= _minMintAmount, "INSUFFICIENT_MINT_AMOUNT");

        if (_amounts[0] > 0)
            tokenIndexes[0].transferFrom(
                msg.sender,
                address(this),
                _amounts[0]
            );
        if (_amounts[1] > 0)
            tokenIndexes[1].transferFrom(
                msg.sender,
                address(this),
                _amounts[1]
            );

        _mint(msg.sender, nextMintAmount);

        return nextMintAmount;
    }
}
