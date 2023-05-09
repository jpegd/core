// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "../interfaces/IApeStaking.sol";

library ApeStakingLib {
    enum Collections {
        BAYC,
        MAYC
    }

    enum Actions {
        DEPOSIT,
        WITHDRAW,
        CLAIM
    }

    /// @notice Allows executing an action (deposit, withdrawal, claim) on the ape staking contract.
    /// @param _apeStaking The ape staking address
    /// @param _action The action to execute
    /// @param _isBAKC Whether the target is a BAKC or a BAYC/MAYC
    /// @param _data ABI encoded data, varies depending on the target action and NFT
    function doApeStakingAction(
        IApeStaking _apeStaking,
        Actions _action,
        bool _isBAKC,
        bytes calldata _data
    ) external {
        if (_isBAKC) {
            if (_action == Actions.DEPOSIT) {
                (
                    uint80 _apeAmount,
                    Collections _collection,
                    uint16 _tokenId,
                    uint16 _bakcTokenId
                ) = abi.decode(_data, (uint80, Collections, uint16, uint16));
                _stakeApeBAKC(
                    _apeStaking,
                    _apeAmount,
                    _collection,
                    _tokenId,
                    _bakcTokenId
                );
            } else if (_action == Actions.WITHDRAW) {
                (
                    uint80 _apeAmount,
                    bool _isUncommit,
                    Collections _collection,
                    uint16 _tokenId,
                    uint16 _bakcTokenId
                ) = abi.decode(
                        _data,
                        (uint80, bool, Collections, uint16, uint16)
                    );
                _unstakeApeBAKC(
                    _apeStaking,
                    _apeAmount,
                    _isUncommit,
                    _collection,
                    _tokenId,
                    _bakcTokenId
                );
            } else {
                (
                    Collections _collection,
                    uint16 _tokenId,
                    uint16 _bakcTokenId
                ) = abi.decode(_data, (Collections, uint16, uint16));
                _claimApeBAKC(_apeStaking, _collection, _tokenId, _bakcTokenId);
            }
        } else {
            if (_action == Actions.DEPOSIT) {
                (
                    uint80 _apeAmount,
                    Collections _collection,
                    uint16 _tokenId
                ) = abi.decode(_data, (uint80, Collections, uint16));
                _stakeApeMain(_apeStaking, _apeAmount, _collection, _tokenId);
            } else if (_action == Actions.WITHDRAW) {
                (
                    uint80 _apeAmount,
                    Collections _collection,
                    uint16 _tokenId
                ) = abi.decode(_data, (uint80, Collections, uint16));
                _unstakeApeMain(_apeStaking, _apeAmount, _collection, _tokenId);
            } else {
                (Collections _collection, uint16 _tokenId) = abi.decode(
                    _data,
                    (Collections, uint16)
                );
                _claimApeMain(_apeStaking, _collection, _tokenId);
            }
        }
    }

    function _stakeApeMain(
        IApeStaking _apeStaking,
        uint80 _apeAmount,
        Collections _collection,
        uint16 _tokenId
    ) internal {
        IApeStaking.SingleNft[] memory _toDeposit = new IApeStaking.SingleNft[](
            1
        );

        _toDeposit[0] = IApeStaking.SingleNft({
            tokenId: _tokenId,
            amount: _apeAmount
        });

        if (_collection == Collections.BAYC)
            _apeStaking.depositBAYC(_toDeposit);
        else _apeStaking.depositMAYC(_toDeposit);
    }

    function _unstakeApeMain(
        IApeStaking _apeStaking,
        uint80 _apeAmount,
        Collections _collection,
        uint16 _tokenId
    ) internal {
        IApeStaking.SingleNft[]
            memory _toWithdraw = new IApeStaking.SingleNft[](1);

        _toWithdraw[0] = IApeStaking.SingleNft({
            tokenId: _tokenId,
            amount: _apeAmount
        });

        if (_collection == Collections.BAYC)
            _apeStaking.withdrawBAYC(_toWithdraw, address(this));
        else _apeStaking.withdrawMAYC(_toWithdraw, address(this));
    }

    function _stakeApeBAKC(
        IApeStaking _apeStaking,
        uint80 _apeAmount,
        Collections _collection,
        uint16 _tokenId,
        uint16 _bakcTokenId
    ) internal {
        IApeStaking.PairNftDepositWithAmount[]
            memory _toDeposit = new IApeStaking.PairNftDepositWithAmount[](1);

        _toDeposit[0] = IApeStaking.PairNftDepositWithAmount({
            mainTokenId: _tokenId,
            bakcTokenId: _bakcTokenId,
            amount: _apeAmount
        });

        if (_collection == Collections.BAYC)
            _apeStaking.depositBAKC(
                _toDeposit,
                new IApeStaking.PairNftDepositWithAmount[](0)
            );
        else
            _apeStaking.depositBAKC(
                new IApeStaking.PairNftDepositWithAmount[](0),
                _toDeposit
            );
    }

    function _unstakeApeBAKC(
        IApeStaking _apeStaking,
        uint80 _apeAmount,
        bool _isUncommit,
        Collections _collection,
        uint16 _tokenId,
        uint16 _bakcTokenId
    ) internal {
        IApeStaking.PairNftWithdrawWithAmount[]
            memory _toWithdraw = new IApeStaking.PairNftWithdrawWithAmount[](1);

        _toWithdraw[0] = IApeStaking.PairNftWithdrawWithAmount({
            mainTokenId: _tokenId,
            bakcTokenId: _bakcTokenId,
            amount: _apeAmount,
            isUncommit: _isUncommit
        });

        if (_collection == Collections.BAYC)
            _apeStaking.withdrawBAKC(
                _toWithdraw,
                new IApeStaking.PairNftWithdrawWithAmount[](0)
            );
        else
            _apeStaking.withdrawBAKC(
                new IApeStaking.PairNftWithdrawWithAmount[](0),
                _toWithdraw
            );
    }

    function _claimApeMain(
        IApeStaking _apeStaking,
        Collections _collection,
        uint16 _tokenId
    ) internal {
        uint256[] memory _toClaim = new uint256[](1);
        _toClaim[0] = _tokenId;

        if (_collection == Collections.BAYC)
            _apeStaking.claimBAYC(_toClaim, address(this));
        else _apeStaking.claimMAYC(_toClaim, address(this));
    }

    function _claimApeBAKC(
        IApeStaking _apeStaking,
        Collections _collection,
        uint16 _tokenId,
        uint16 _bakcTokenId
    ) internal {
        IApeStaking.PairNft[] memory _toClaim = new IApeStaking.PairNft[](1);
        _toClaim[0] = IApeStaking.PairNft({
            mainTokenId: _tokenId,
            bakcTokenId: _bakcTokenId
        });

        if (_collection == Collections.BAYC)
            _apeStaking.claimBAKC(
                _toClaim,
                new IApeStaking.PairNft[](0),
                address(this)
            );
        else
            _apeStaking.claimBAKC(
                new IApeStaking.PairNft[](0),
                _toClaim,
                address(this)
            );
    }
}
