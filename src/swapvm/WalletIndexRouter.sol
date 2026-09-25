// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context } from "@1inch/swap-vm/src/libs/VM.sol";
import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import { SwapVM } from "@1inch/swap-vm/src/SwapVM.sol";
import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { PortfolioSkewInstruction } from "./PortfolioSkewInstruction.sol";

/// @title WalletIndexRouter
/// @notice The official 1inch AquaSwapVMRouter opcode table, unchanged, plus one appended native instruction
///         (`_portfolioSkewXD`) at opcode `portfolioSkewOpcode()`. Every existing Aqua program runs identically.
contract WalletIndexRouter is Simulator, SwapVM, AquaOpcodes, PortfolioSkewInstruction {
    constructor(address aqua, address weth, address owner, string memory name, string memory version)
        SwapVM(aqua, weth, owner, name, version)
        AquaOpcodes(aqua)
    { }

    function _instructions() internal pure override returns (function(Context memory, bytes calldata) internal[] memory result) {
        function(Context memory, bytes calldata) internal[] memory base = _opcodes();
        result = new function(Context memory, bytes calldata) internal[](base.length + 1);
        for (uint256 i; i < base.length; i++) result[i] = base[i];
        result[base.length] = _portfolioSkewXD;
    }

    function portfolioSkewOpcode() external pure returns (uint8) {
        return uint8(_opcodes().length);
    }
}
