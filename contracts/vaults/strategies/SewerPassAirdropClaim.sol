// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import "../../interfaces/IFlashNFTStrategy.sol";

interface SewerPassClaim {
    function claimBaycBakc(uint256 baycTokenId, uint256 bakcTokenId) external;

    function claimBayc(uint256 baycTokenId) external;

    function claimMaycBakc(uint256 maycTokenId, uint256 bakcTokenId) external;

    function claimMayc(uint256 maycTokenId) external;
}

contract SewerPassAirdropClaim is
    AccessControl,
    IFlashNFTStrategy,
    IERC721Receiver
{
    error Unauthorized();

    enum Collections {
        BAYC,
        MAYC
    }

    struct BAKCInfo {
        uint256 bakcId;
        bool fromWallet;
    }

    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");

    SewerPassClaim public constant CLAIM_CONTRACT =
        SewerPassClaim(0xBA5a9E9CBCE12c70224446C24C111132BECf9F1d);
    IERC721 public constant SEWER_PASS =
        IERC721(0x764AeebcF425d56800eF2c84F2578689415a2DAa);
    IERC721 public constant BAYC =
        IERC721(0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D);
    IERC721 public constant MAYC =
        IERC721(0x60E4d786628Fea6478F785A6d7e704777c86a7c6);
    IERC721 public constant BAKC =
        IERC721(0xba30E5F9Bb24caa003E9f2f0497Ad287FDF95623);

    address private currentLoanee;

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function kind() external pure override returns (Kind) {
        return Kind.FLASH;
    }

    function depositAddress(address) external view override returns (address) {
        return address(this);
    }

    /// @dev Allows claiming sewer passes. Can only be called by the vault.
    /// @param _owner The owner of the NFTs and the address to send the sewer pass to
    /// @param _recipient The address to send the loaned NFTs to (usually the vault or a strategy)
    /// @param _nftIndexes The NFTs to claim passes with (BAYC/MAYC)
    /// @param _additionalData ABI encoded data, containing the list of BAKC IDs to use to claim (`BAKCInfo`) and the collection (BAYC/MAYC)
    function afterDeposit(
        address _owner,
        address _recipient,
        uint256[] calldata _nftIndexes,
        bytes calldata _additionalData
    ) external override onlyRole(VAULT_ROLE) {
        currentLoanee = _owner;

        (BAKCInfo[] memory _bakcInfo, Collections _collection) = abi.decode(
        _additionalData,
        (BAKCInfo[], Collections)
    );

        for (uint256 i; i < _nftIndexes.length; ++i) {
            if (_bakcInfo.length > i) {
                address _bakcRecipient;
                if (_bakcInfo[i].fromWallet) {
                    BAKC.transferFrom(_owner, address(this), _bakcInfo[i].bakcId);
                    _bakcRecipient = _owner;
                } else
                    _bakcRecipient = _recipient;
                
                if (_collection == Collections.BAYC) {
                    CLAIM_CONTRACT.claimBaycBakc(_nftIndexes[i], _bakcInfo[i].bakcId);
                    BAYC.transferFrom(address(this), _recipient, _nftIndexes[i]);
                } else {
                    CLAIM_CONTRACT.claimMaycBakc(_nftIndexes[i], _bakcInfo[i].bakcId);
                    MAYC.transferFrom(address(this), _recipient, _nftIndexes[i]);
                }

                BAKC.transferFrom(address(this), _bakcRecipient, _bakcInfo[i].bakcId);
            } else {
                if (_collection == Collections.BAYC) {
                    CLAIM_CONTRACT.claimBayc(_nftIndexes[i]);
                    BAYC.transferFrom(address(this), _recipient, _nftIndexes[i]);
                } else {
                    CLAIM_CONTRACT.claimMayc(_nftIndexes[i]);
                    MAYC.transferFrom(address(this), _recipient, _nftIndexes[i]);
                }
            }
        }

        delete currentLoanee;
    }

    /// @dev Transfers `_tokenId` to `currentLoanee`
    function onERC721Received(
        address,
        address,
        uint256 _tokenId,
        bytes calldata
    ) external override returns (bytes4) {
        address _current = currentLoanee;
        if (_current == address(0)) revert Unauthorized();

        SEWER_PASS.transferFrom(address(this), _current, _tokenId);

        return IERC721Receiver.onERC721Received.selector;
    }
}
