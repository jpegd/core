// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract CappedETHDonation is Ownable {
    error OngoingDonation();
    error ZeroRoot();
    error InvalidProof();
    error InactiveDonation();
    error InvalidAmount();
    error InvalidStart();
    error InvalidDuration();

    event NewDonationEvent(
        uint256 indexed eventId,
        uint256 totalCap,
        uint256 start,
        uint256 end
    );
    event Donation(
        uint256 indexed eventId,
        address indexed account,
        uint256 donatedAmount
    );
    event DonationEnded(uint256 indexed eventId, uint256 ethDonated);

    struct DonationEvent {
        uint256 totalCap;
        uint256 walletCap;
        uint256 whitelistCap;
        bytes32 whitelistRoot;
        uint256 start;
        uint256 whitelistEnd;
        uint256 end;
        uint256 donatedAmount;
        mapping(address => uint256) donations;
    }

    uint256 public donationIndex;
    mapping(uint256 => DonationEvent) public donationEvents;

    receive() external payable {
        donate();
    }

    /// @notice Returns the amount donated by `_account` in `_eventId`.
    function donatedAmount(uint256 _eventId, address _account)
        external
        view
        returns (uint256)
    {
        return donationEvents[_eventId].donations[_account];
    }

    /// @notice Allows the owner to start a donation event. The event can have a whitelist period if `_whitelistDuration` is greater than 0.
    /// @param _cap The maximum amount of ETH that can be donated
    /// @param _walletCap The maximum amount of ETH that can be donated per wallet
    /// @param _whitelistCap The maximum amount of ETH that can be donated per whitelisted wallet
    /// @param _whitelistRoot The merkle root for the whitelist
    /// @param _start The event's start timestamp
    /// @param _whitelistDuration The duration of the whitelist only period, can be 0 for no whitelist
    /// @param _publicDuration The duration of the public donation period
    function newDonationEvent(
        uint256 _cap,
        uint256 _walletCap,
        uint256 _whitelistCap,
        bytes32 _whitelistRoot,
        uint256 _start,
        uint256 _whitelistDuration,
        uint256 _publicDuration
    ) external onlyOwner {
        uint256 _donationIndex = donationIndex;
        DonationEvent storage _donation = donationEvents[_donationIndex];
        if (_donation.end != 0) revert OngoingDonation();

        if (_cap == 0 || _walletCap == 0) revert InvalidAmount();

        if (_start < block.timestamp) revert InvalidStart();
        if (_publicDuration == 0) revert InvalidDuration();

        if (_whitelistDuration > 0) {
            if (_whitelistCap == 0) revert InvalidAmount();
            if (_whitelistRoot == bytes32(0)) revert ZeroRoot();

            _donation.whitelistCap = _whitelistCap;
            _donation.whitelistRoot = _whitelistRoot;
            _donation.whitelistEnd = _start + _whitelistDuration;
        } else _donation.whitelistEnd = _start;

        _donation.totalCap = _cap;
        _donation.walletCap = _walletCap;
        _donation.start = _start;
        uint256 _end = _start + _whitelistDuration + _publicDuration;
        _donation.end = _end;

        emit NewDonationEvent(_donationIndex, _cap, _start, _end);
    }

    /// @notice Allows users to donate ETH in the current donation event.
    function donate() public payable {
        uint256 _donationIndex = donationIndex;
        DonationEvent storage _event = donationEvents[_donationIndex];
        if (
            _event.whitelistEnd > block.timestamp ||
            _event.end <= block.timestamp
        ) revert InactiveDonation();

        uint256 _newDonatedAmount = _event.donatedAmount + msg.value;
        uint256 _newUserDonatedAmount = _event.donations[msg.sender] +
            msg.value;
        if (
            msg.value == 0 ||
            _newUserDonatedAmount > _event.walletCap ||
            _newDonatedAmount > _event.totalCap
        ) revert InvalidAmount();

        _event.donations[msg.sender] = _newUserDonatedAmount;
        _event.donatedAmount = _newDonatedAmount;

        emit Donation(_donationIndex, msg.sender, msg.value);
    }

    /// @notice Allows whitelisted users to donate ETH in the current donation event.
    function donateWhitelist(bytes32[] calldata _merkleProof) external payable {
        uint256 _donationIndex = donationIndex;
        DonationEvent storage _event = donationEvents[_donationIndex];
        if (
            _event.start > block.timestamp ||
            _event.whitelistEnd <= block.timestamp
        ) revert InactiveDonation();

        bytes32 _leaf = keccak256(abi.encodePacked(msg.sender));
        if (!MerkleProof.verify(_merkleProof, _event.whitelistRoot, _leaf))
            revert InvalidProof();

        uint256 _newDonatedAmount = _event.donatedAmount + msg.value;
        uint256 _newUserDonatedAmount = _event.donations[msg.sender] +
            msg.value;
        if (
            msg.value == 0 ||
            _newUserDonatedAmount > _event.whitelistCap ||
            _newDonatedAmount > _event.totalCap
        ) revert InvalidAmount();

        _event.donations[msg.sender] = _newUserDonatedAmount;
        _event.donatedAmount = _newDonatedAmount;

        emit Donation(_donationIndex, msg.sender, msg.value);
    }

    /// @notice Allows the owner to end the donation if it reached the cap or `block.timestamp` is greater than the current donation's `end` timestamp.
    function endDonation() external onlyOwner {
        uint256 _donationIndex = donationIndex;
        DonationEvent storage _event = donationEvents[_donationIndex];

        if (_event.start == 0) revert InactiveDonation();

        uint256 _donatedAmount = _event.donatedAmount;
        if (_event.totalCap != _donatedAmount) {
            if (block.timestamp < _event.end) revert OngoingDonation();
        }

        donationIndex = _donationIndex + 1;

        (bool _sent, ) = msg.sender.call{value: _donatedAmount}("");
        if (!_sent) revert();

        emit DonationEnded(_donationIndex, _donatedAmount);
    }
}
