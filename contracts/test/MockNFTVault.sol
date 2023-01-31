// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

contract MockNFTVault {
    event DoActionsCalled(address _account, uint8[] _actions, bytes[] _data);
    event ForceCloseCalled(
        address _account,
        uint256 _nftIndex,
        address _recipient
    );
    event ImportPositionCalled(
        address _account,
        uint256 _nftIndex,
        uint256 _amount,
        bool _insurance,
        address _strategy
    );

    struct Position {
        uint8 borrowType;
        uint256 debtPrincipal;
        uint256 debtPortion;
        uint256 debtAmountForRepurchase;
        uint256 liquidatedAt;
        address liquidator;
        address strategy;
    }

    bool internal _hasStrategy;
    uint256 internal forceCloseReturn;
    address public stablecoin;
    address public nftContract;

    mapping(uint256 => Position) public positions;

    constructor(address _stablecoin, address _nftContract) {
        stablecoin = _stablecoin;
        nftContract = _nftContract;
    }

    function doActionsFor(
        address _account,
        uint8[] calldata _actions,
        bytes[] calldata _data
    ) external {
        emit DoActionsCalled(_account, _actions, _data);
    }

    function forceClosePosition(
        address _account,
        uint256 _nftIndex,
        address _recipient
    ) external returns (uint256) {
        emit ForceCloseCalled(_account, _nftIndex, _recipient);
        return forceCloseReturn;
    }

    function importPosition(
        address _account,
        uint256 _nftIndex,
        uint256 _amount,
        bool _insurance,
        address _strategy
    ) external {
        emit ImportPositionCalled(
            _account,
            _nftIndex,
            _amount,
            _insurance,
            _strategy
        );
    }

    function hasStrategy(address) external view returns (bool) {
        return _hasStrategy;
    }

    function setHasStrategy(bool _has) external {
        _hasStrategy = _has;
    }

    function setPosition(Position calldata _position, uint256 _idx) external {
        positions[_idx] = _position;
    }

    function setForceCloseReturn(uint256 _ret) external {
        forceCloseReturn = _ret;
    }

    function setStablecoin(address _stablecoin) external {
        stablecoin = _stablecoin;
    }

    function setNFT(address _nft) external {
        nftContract = _nft;
    }
}
