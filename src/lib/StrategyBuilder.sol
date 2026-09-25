// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/src/libs/MakerTraits.sol";

/// @title StrategyBuilder
/// @notice Encodes WalletIndex basket strategies (salt + portfolio-skew instruction) and plain official curves.
library StrategyBuilder {
    uint8 internal constant OP_SALT = 20;
    uint8 internal constant OP_FLAT_FEE = 21;
    uint8 internal constant OP_XYC_SWAP = 17;

    struct Asset { address token; address feed; uint8 decimals; uint16 targetBps; }

    function basketArgs(uint16 baseBps, uint16 minBps, uint16 maxBps, uint32 gain, uint32 maxAge, Asset[] memory assets)
        internal pure returns (bytes memory a)
    {
        a = abi.encodePacked(baseBps, minBps, maxBps, gain, maxAge);
        for (uint256 i; i < assets.length; i++) {
            a = bytes.concat(a, abi.encodePacked(assets[i].token, assets[i].feed, assets[i].decimals, assets[i].targetBps));
        }
    }

    function basketProgram(uint8 opcode, uint64 salt, bytes memory args) internal pure returns (bytes memory) {
        require(args.length <= 255, "args too long");
        return abi.encodePacked(OP_SALT, uint8(8), salt, opcode, uint8(args.length), args);
    }

    /// @notice Plain official 1inch curve: flat fee (1e9 = 100%) then x*y=k.
    function curveProgram(uint32 feeBps1e9) internal pure returns (bytes memory) {
        return abi.encodePacked(OP_FLAT_FEE, uint8(4), feeBps1e9, OP_XYC_SWAP, uint8(0));
    }

    function aquaOrder(address maker, bytes memory program) internal pure returns (ISwapVM.Order memory) {
        return MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker, receiver: address(0), shouldUnwrapWeth: false, useAquaInsteadOfSignature: true, allowZeroAmountIn: false,
            hasPreTransferInHook: false, hasPostTransferInHook: false, hasPreTransferOutHook: false, hasPostTransferOutHook: false,
            preTransferInTarget: address(0), preTransferInData: "", postTransferInTarget: address(0), postTransferInData: "",
            preTransferOutTarget: address(0), preTransferOutData: "", postTransferOutTarget: address(0), postTransferOutData: "",
            program: program
        }));
    }

    /// @notice Taker traits for a plain EOA taker paying via transferFrom (quote/swap from a wallet).
    function eoaTakerTraits() internal pure returns (bytes memory) {
        return hex"00000000000000000000000000000000000000000041";
    }
}
