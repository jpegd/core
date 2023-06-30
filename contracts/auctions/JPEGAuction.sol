// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import "../utils/RateLib.sol";

import "../interfaces/IJPEGCardsCigStaking.sol";

contract JPEGAuction is OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.UintSet;
    using RateLib for RateLib.Rate;

    event NewAuction(
        IERC721Upgradeable indexed nft,
        uint256 indexed index,
        uint256 startTime
    );
    event NewBid(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 bidValue
    );
    event JPEGWithdrawn(address indexed account, uint256 amount);
    event CardWithdrawn(address indexed account, uint256 index);
    event NFTClaimed(uint256 indexed auctionId);
    event BidWithdrawn(
        uint256 indexed auctionId,
        address indexed account,
        uint256 bidValue
    );
    event BidTimeIncrementChanged(uint256 newTime, uint256 oldTime);
    event MinimumIncrementRateChanged(
        RateLib.Rate newIncrementRate,
        RateLib.Rate oldIncrementRate
    );

    enum StakeMode {
        CIG,
        JPEG,
        CARD,
        LEGACY
    }

    struct UserInfo {
        StakeMode stakeMode;
        uint256 stakeArgument; //unused for CIG
        uint256 unlockTime; //unused for CIG
    }

    struct Auction {
        IERC721Upgradeable nftAddress;
        uint256 nftIndex;
        uint256 startTime;
        uint256 endTime;
        uint256 minBid;
        address highestBidOwner;
        bool ownerClaimed;
        mapping(address => uint256) bids;
    }

    IERC20Upgradeable public jpeg;
    IERC721Upgradeable public cards;

    address internal unused1;
    address internal unused2;
    uint256 internal unused3;
    uint256 internal unused4;

    uint256 public bidTimeIncrement;
    uint256 public auctionsLength;

    RateLib.Rate public minIncrementRate;

    mapping(address => UserInfo) public userInfo;
    mapping(address => EnumerableSetUpgradeable.UintSet) internal userAuctions;
    mapping(uint256 => Auction) public auctions;

    function initialize(
        uint256 _bidTimeIncrement,
        RateLib.Rate memory _incrementRate
    ) external initializer {
        __Ownable_init();
        __ReentrancyGuard_init();

        setBidTimeIncrement(_bidTimeIncrement);
        setMinimumIncrementRate(_incrementRate);
    }

    /// @notice Allows the owner to create a new auction
    /// @param _nft The address of the NFT to sell
    /// @param _idx The index of the NFT to sell
    /// @param _startTime The time at which the auction starts
    /// @param _endTime The time at which the auction ends
    /// @param _minBid The minimum bid value
    function newAuction(
        IERC721Upgradeable _nft,
        uint256 _idx,
        uint256 _startTime,
        uint256 _endTime,
        uint256 _minBid
    ) external onlyOwner {
        require(address(_nft) != address(0), "INVALID_NFT");
        require(_startTime > block.timestamp, "INVALID_START_TIME");
        require(_endTime > _startTime, "INVALID_END_TIME");
        require(_minBid > 0, "INVALID_MIN_BID");

        Auction storage auction = auctions[auctionsLength++];
        auction.nftAddress = _nft;
        auction.nftIndex = _idx;
        auction.startTime = _startTime;
        auction.endTime = _endTime;
        auction.minBid = _minBid;

        _nft.transferFrom(msg.sender, address(this), _idx);

        emit NewAuction(_nft, _idx, _startTime);
    }

    /// @notice Allows users to bid on an auction. In case of multiple bids by the same user,
    /// the actual bid value is the sum of all bids.
    /// @param _auctionIndex The index of the auction to bid on
    function bid(uint256 _auctionIndex) public payable nonReentrant {
        Auction storage auction = auctions[_auctionIndex];
        uint256 endTime = auction.endTime;

        require(block.timestamp >= auction.startTime, "NOT_STARTED");
        require(block.timestamp < endTime, "ENDED_OR_INVALID");

        uint256 previousBid = auction.bids[msg.sender];
        uint256 totalBid = msg.value + previousBid;
        uint256 currentMinBid = auction.bids[auction.highestBidOwner];
        currentMinBid +=
            (currentMinBid * minIncrementRate.numerator) /
            minIncrementRate.denominator;

        require(
            totalBid >= currentMinBid && totalBid >= auction.minBid,
            "INVALID_BID"
        );

        auction.highestBidOwner = msg.sender;
        auction.bids[msg.sender] = totalBid;

        if (previousBid == 0)
            assert(userAuctions[msg.sender].add(_auctionIndex));

        uint256 bidIncrement = bidTimeIncrement;
        if (bidIncrement > endTime - block.timestamp)
            auction.endTime = block.timestamp + bidIncrement;

        emit NewBid(_auctionIndex, msg.sender, totalBid);
    }

    /// @notice Allows the highest bidder to claim the NFT they bid on if the auction is already over.
    /// @param _auctionIndex The index of the auction to claim the NFT from
    function claimNFT(uint256 _auctionIndex) external nonReentrant {
        Auction storage auction = auctions[_auctionIndex];

        require(auction.highestBidOwner == msg.sender, "NOT_WINNER");
        require(block.timestamp >= auction.endTime, "NOT_ENDED");
        require(
            userAuctions[msg.sender].remove(_auctionIndex),
            "ALREADY_CLAIMED"
        );

        auction.nftAddress.transferFrom(
            address(this),
            msg.sender,
            auction.nftIndex
        );

        emit NFTClaimed(_auctionIndex);
    }

    /// @notice Allows bidders to withdraw their bid. Only works if `msg.sender` isn't the highest bidder.
    /// @param _auctionIndex The auction to claim the bid from.
    function withdrawBid(uint256 _auctionIndex) public nonReentrant {
        Auction storage auction = auctions[_auctionIndex];

        require(auction.highestBidOwner != msg.sender, "HIGHEST_BID_OWNER");

        uint256 bidAmount = auction.bids[msg.sender];
        require(bidAmount > 0, "NO_BID");

        auction.bids[msg.sender] = 0;
        assert(userAuctions[msg.sender].remove(_auctionIndex));

        (bool sent, ) = payable(msg.sender).call{ value: bidAmount }("");
        require(sent, "ETH_TRANSFER_FAILED");

        emit BidWithdrawn(_auctionIndex, msg.sender, bidAmount);
    }

    /// @notice Allows bidders to withdraw multiple bids. Only works if `msg.sender` isn't the highest bidder.
    /// @param _indexes The auctions to claim the bids from.
    function withdrawBids(uint256[] calldata _indexes) external {
        for (uint256 i; i < _indexes.length; i++) {
            withdrawBid(_indexes[i]);
        }
    }

    /// @notice Allows users that deposited a Card in the previous JPEGAuction implementation to withdraw it.
    function withdrawCard() external nonReentrant {
        UserInfo memory user = userInfo[msg.sender];
        require(user.stakeMode == StakeMode.CARD, "CARD_NOT_DEPOSITED");

        delete userInfo[msg.sender];

        uint256 cardIndex = user.stakeArgument;

        cards.transferFrom(address(this), msg.sender, cardIndex);

        emit CardWithdrawn(msg.sender, cardIndex);
    }

    /// @notice Allows users that deposited JPEG in the previous JPEGAuction implementation to withdraw it.
    function withdrawJPEG() external nonReentrant {
        UserInfo memory user = userInfo[msg.sender];
        require(user.stakeMode == StakeMode.JPEG, "JPEG_NOT_DEPOSITED");

        delete userInfo[msg.sender];

        uint256 jpegAmount = user.stakeArgument;

        jpeg.transfer(msg.sender, jpegAmount);

        emit JPEGWithdrawn(msg.sender, jpegAmount);
    }

    /// @return The list of active bids for an account.
    /// @param _account The address to check.
    function getActiveBids(
        address _account
    ) external view returns (uint256[] memory) {
        return userAuctions[_account].values();
    }

    /// @return The active bid of an account for an auction.
    /// @param _auctionIndex The auction to retrieve the bid from.
    /// @param _account The bidder's account
    function getAuctionBid(
        uint256 _auctionIndex,
        address _account
    ) external view returns (uint256) {
        return auctions[_auctionIndex].bids[_account];
    }

    /// @notice Allows the owner to withdraw ETH after a successful auction.
    /// @param _auctionIndex The auction to withdraw the ETH from
    function withdrawETH(uint256 _auctionIndex) external onlyOwner {
        Auction storage auction = auctions[_auctionIndex];

        require(block.timestamp >= auction.endTime, "NOT_ENDED");
        address highestBidder = auction.highestBidOwner;
        require(highestBidder != address(0), "NFT_UNSOLD");
        require(!auction.ownerClaimed, "ALREADY_CLAIMED");

        auction.ownerClaimed = true;

        (bool sent, ) = payable(msg.sender).call{
            value: auction.bids[highestBidder]
        }("");
        require(sent, "ETH_TRANSFER_FAILED");
    }

    /// @notice Allows the owner to withdraw an unsold NFT
    /// @param _auctionIndex The auction to withdraw the NFT from.
    function withdrawUnsoldNFT(uint256 _auctionIndex) external onlyOwner {
        Auction storage auction = auctions[_auctionIndex];

        require(block.timestamp >= auction.endTime, "NOT_ENDED");
        address highestBidder = auction.highestBidOwner;
        require(highestBidder == address(0), "NFT_SOLD");
        require(!auction.ownerClaimed, "ALREADY_CLAIMED");

        auction.ownerClaimed = true;

        auction.nftAddress.transferFrom(
            address(this),
            msg.sender,
            auction.nftIndex
        );
    }

    /// @notice Allows the owner to set the amount of time to increase an auction by if a bid happens in the last few minutes
    /// @param _newTime The new amount of time
    function setBidTimeIncrement(uint256 _newTime) public onlyOwner {
        require(_newTime > 0, "INVALID_TIME");

        emit BidTimeIncrementChanged(_newTime, bidTimeIncrement);

        bidTimeIncrement = _newTime;
    }

    /// @notice Allows the owner to set the minimum increment rate from the last highest bid.
    /// @param _newIncrementRate The new increment rate.
    function setMinimumIncrementRate(
        RateLib.Rate memory _newIncrementRate
    ) public onlyOwner {
        require(
            _newIncrementRate.denominator != 0 &&
                _newIncrementRate.denominator >= _newIncrementRate.numerator,
            "INVALID_RATE"
        );

        emit MinimumIncrementRateChanged(_newIncrementRate, minIncrementRate);

        minIncrementRate = _newIncrementRate;
    }
}
