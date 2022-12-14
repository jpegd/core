// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "../utils/RateLib.sol";

contract JPEGIndexSale is Ownable, ReentrancyGuard {
    using RateLib for RateLib.Rate;

    error ZeroAddress();
    error OngoingSale();
    error InactiveSale();
    error InvalidAmount();
    error InvalidStart();
    error InvalidDuration();
    error InsufficientSaleTokens();

    event NewSale(uint256 indexed saleId, uint256 tokenAmount, uint256 start, uint256 duration, RateLib.Rate rate);
    event TokensPurchased(uint256 indexed saleId, address indexed account, uint256 ethAmount, uint256 tokenAmount);
    event SaleEnded(uint256 indexed saleId, uint256 ethRaised, uint256 unsoldTokens);

    struct Sale {
        uint256 tokenAmount;
        uint256 tokensSold;
        uint256 start;
        uint256 end;
        RateLib.Rate rate;
    }

    IERC20 public jpegIndex;

    uint256 public saleIndex;
    mapping(uint256 => Sale) public tokenSales;

    constructor(IERC20 _jpegIndex) {
        if (address(_jpegIndex) == address(0))
            revert ZeroAddress();

        jpegIndex = _jpegIndex;
    }

    receive() external payable {
        buyTokens();
    }


    /// @notice Allows the owner to create a new sale
    /// @param _tokenAmount The amount of tokens to allocate for the sale
    /// @param _start The sale's start timestamp
    /// @param _duration The sale's duration, in seconds
    /// @param _rate The sale's price
    function newSale(uint256 _tokenAmount, uint256 _start, uint256 _duration, RateLib.Rate calldata _rate) external onlyOwner {
        uint256 _saleIndex = saleIndex;
        Sale storage _sale = tokenSales[_saleIndex];
        if (_sale.end != 0)
            revert OngoingSale();

        if (_tokenAmount == 0)
            revert InvalidAmount();
        if (_start < block.timestamp)
            revert InvalidStart();
        if (_duration == 0)
            revert InvalidDuration();
        if (!_rate.isValid() || _rate.isZero())
            revert RateLib.InvalidRate();

        jpegIndex.transferFrom(msg.sender, address(this), _tokenAmount);

        _sale.tokenAmount = _tokenAmount;
        _sale.start = _start;
        _sale.end = _start + _duration;
        _sale.rate = _rate;

        emit NewSale(_saleIndex, _tokenAmount, _start, _duration, _rate);
    }

    /// @notice Allows users to purchase tokens if a sale is ongoing. The amount of tokens received depends on the sale's rate.
    function buyTokens() public payable nonReentrant {
        uint256 _saleIndex = saleIndex;
        Sale storage _sale = tokenSales[_saleIndex];
        if (_sale.start > block.timestamp || _sale.end <= block.timestamp)
            revert InactiveSale();
        
        uint256 _amount = _sale.rate.calculate(msg.value);
        if (_amount == 0)
            revert InvalidAmount();

        uint256 _tokensSold = _sale.tokensSold;
        if (_sale.tokenAmount - _tokensSold < _amount)
            revert InsufficientSaleTokens();

        _sale.tokensSold = _tokensSold + _amount;
        jpegIndex.transfer(msg.sender, _amount);

        emit TokensPurchased(_saleIndex, msg.sender, msg.value, _amount);
    }

    /// @notice Allows the owner to end the sale if all the tokens have been sold or `block.timestamp` is greater than the current sale's `end` timestamp.
    function endSale() external onlyOwner {
        uint256 _saleIndex = saleIndex;
        Sale storage _sale = tokenSales[_saleIndex];

        if (_sale.start == 0)
            revert InactiveSale();

        uint256 _unsold = _sale.tokenAmount - _sale.tokensSold;
        if (_unsold != 0) { 
            if (block.timestamp < _sale.end)
                revert OngoingSale();

            jpegIndex.transfer(msg.sender, _unsold);
        }

        saleIndex = _saleIndex + 1;

        uint256 _amountRaised = address(this).balance;
        (bool _sent,) = msg.sender.call{value: _amountRaised}("");
        if (!_sent)
            revert();

        emit SaleEnded(_saleIndex, _amountRaised, _unsold);
    }
}