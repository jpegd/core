// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../utils/NoContract.sol";
import "../interfaces/IYVault.sol";

/// @title JPEG'd yVault token farm
/// @notice Users can stake their JPEG'd vault tokens and earn JPEG rewards
/// @dev The rewards are taken from the PUSD Convex pool and distributed to stakers based on their share of the total staked tokens.
contract YVaultLPFarming is NoContract {
    using SafeERC20 for IERC20;
    using SafeERC20 for IYVault;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Claim(address indexed user, uint256 rewards);

    IYVault public immutable vault;
    IERC20 public immutable jpeg;

    uint256 public totalStaked;
    bool public isMigrating;

    uint256 internal lastRewardBlock;
    uint256 internal previousBalance;
    uint256 internal accRewardPerShare;

    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) private userLastAccRewardPerShare;
    mapping(address => uint256) private userPendingRewards;

    ///@param _vault The yVault address
    ///@param _jpeg The JPEG token address
    constructor(address _vault, address _jpeg) {
        require(_vault != address(0), "INVALID_VAULT");
        require(_jpeg != address(0), "INVALID_JPEG");

        vault = IYVault(_vault);
        jpeg = IERC20(_jpeg);
    }

    /// @notice Frontend function used to calculate the amount of rewards `_user` can claim
    /// @param _user The address of the user
    /// @return The amount of rewards claimable by user `_user`
    function pendingReward(address _user) external view returns (uint256) {
        uint256 rewardShare = accRewardPerShare;
        uint256 staked = totalStaked;
        //if blockNumber is greater than the pool's `lastRewardBlock` the pool's `accRewardPerShare` is outdated,
        //we need to calculate the up to date amount to return an accurate reward value
        if (block.number > lastRewardBlock && staked > 0) {
            uint256 currentBalance = isMigrating
                ? jpeg.balanceOf(address(this))
                : vault.balanceOfJPEG() + jpeg.balanceOf(address(this));
            rewardShare =
                accRewardPerShare +
                ((currentBalance - previousBalance) * 1e36) /
                totalStaked;
        }
        return
            //rewards that the user had already accumulated but not claimed
            userPendingRewards[_user] +
            //subtracting the user's `lastAccRewardPerShare` from the pool's `accRewardPerShare` results in the amount of rewards per share
            //the pool has accumulated since the user's last claim, multiplying it by the user's shares results in the amount of new rewards claimable
            //by the user
            (balanceOf[_user] *
                (rewardShare - userLastAccRewardPerShare[_user])) /
            1e36;
    }

    /// @notice Allows users to deposit `_amount` of vault tokens. Non whitelisted contracts can't call this function
    /// @dev Emits a {Deposit} event
    /// @param _amount The amount of tokens to deposit
    function deposit(uint256 _amount) external noContract() {
        require(_amount > 0, "INVALID_AMOUNT");
        require(!isMigrating, "DEPOSITS_DISABLED");

        _update();
        _withdrawReward(msg.sender);

        balanceOf[msg.sender] += _amount;
        totalStaked += _amount;

        vault.safeTransferFrom(msg.sender, address(this), _amount);

        emit Deposit(msg.sender, _amount);
    }

    /// @notice Allows users to withdraw `_amount` of vault tokens. Non whitelisted contracts can't call this function
    /// @dev Emits a {Withdraw} event
    /// @param _amount The amount of tokens to withdraw
    function withdraw(uint256 _amount) external noContract() {
        require(_amount > 0, "INVALID_AMOUNT");
        require(balanceOf[msg.sender] >= _amount, "INSUFFICIENT_AMOUNT");

        _update();
        _withdrawReward(msg.sender);

        balanceOf[msg.sender] -= _amount;
        totalStaked -= _amount;

        vault.safeTransfer(msg.sender, _amount);

        emit Withdraw(msg.sender, _amount);
    }

    /// @notice Allows users to claim rewards. Non whitelisted contracts can't call this function
    /// @dev Emits a {Claim} event
    function claim() external noContract() {
        _update();
        _withdrawReward(msg.sender);

        uint256 rewards = userPendingRewards[msg.sender];
        require(rewards > 0, "NO_REWARD");

        userPendingRewards[msg.sender] = 0;
        //we are subtracting the claimed rewards from the previous to have a consistent value next time
        //{_update is called}
        previousBalance -= rewards;

        jpeg.safeTransfer(msg.sender, rewards);

        emit Claim(msg.sender, rewards);
    }

    /// @notice Notifies this contract about an LPFarm migration. Can only be called by the vault
    /// @dev Migration causes the contract to disable deposits and only account for rewards that have already been allocated for farming.
    function migrate() external {
        require(msg.sender == address(vault), "NOT_VAULT");

        _update();
        isMigrating = true;
    }

    /// @dev Updates this contract's rewards state
    function _update() internal {
        if (block.number <= lastRewardBlock) return;

        lastRewardBlock = block.number;

        if (totalStaked == 0) return;

        if (!isMigrating) vault.withdrawJPEG();

        uint256 currentBalance = jpeg.balanceOf(address(this));
        accRewardPerShare +=
            ((currentBalance - previousBalance) * 1e36) /
            totalStaked;
        previousBalance = currentBalance;
    }

    /// @dev Updates `account`'s claimable rewards by adding pending rewards
    /// @param account The account to update
    function _withdrawReward(address account) internal returns (uint256) {
        uint256 pending = (balanceOf[account] *
            (accRewardPerShare - userLastAccRewardPerShare[account])) / 1e36;

        if (pending > 0) userPendingRewards[account] += pending;

        userLastAccRewardPerShare[account] = accRewardPerShare;

        return pending;
    }

    /// @dev Prevent the owner from renouncing ownership. Having no owner would render this contract unusable due to the inability to create new epochs
    function renounceOwnership() public view override onlyOwner {
        revert("Cannot renounce ownership");
    }
}
