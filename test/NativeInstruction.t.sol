// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { StrategyBuilder } from "../src/lib/StrategyBuilder.sol";
import { BaseConfig } from "../src/lib/BaseConfig.sol";
import { PortfolioSkewInstruction } from "../src/swapvm/PortfolioSkewInstruction.sol";
import { BaseForkTest } from "./utils/BaseForkTest.sol";

/// Native self-rebalancing instruction on a Base mainnet fork (official Aqua, live Chainlink feeds).
contract NativeInstructionTest is BaseForkTest {
    address maker = makeAddr("maker");
    ISwapVM.Order order;

    function setUp() public {
        _fork();
        _deployHookAndPool(0, 0);
        order = _basketMaker(maker, 10, 5000, 3000, 2000, 50_000e6, 30_000e6, 20_000e6, 1);   // $100k exactly on target
    }

    function test_opcodeAppendedAfterOfficialTable() public view {
        assertEq(OP, 34);
    }

    function test_quoteEqualsSwap_andRealTransfers() public {
        uint256 q = _quote(order, USDC, WETH, 5_000e6);
        uint256 b = IERC20(WETH).balanceOf(trader);
        vm.prank(trader, trader);
        (, uint256 out,) = router.swap(order, USDC, WETH, 5_000e6, StrategyBuilder.eoaTakerTraits());
        assertEq(out, q, "quote == swap");
        assertEq(IERC20(WETH).balanceOf(trader) - b, out, "real WETH moved to taker");
        assertEq(IERC20(USDC).balanceOf(maker), 35_000e6, "real USDC moved to maker wallet");
    }

    function test_onTargetIsSymmetric() public {
        assertEq(_spreadBps(order, USDC, WETH, 2_000e6), _spreadBps(order, WETH, USDC, _ethFor(2_000e6)));
    }

    function test_walletSteersItselfBackToTarget() public {
        uint256 s0 = _spreadBps(order, USDC, WETH, 5_000e6);
        vm.prank(trader, trader); router.swap(order, USDC, WETH, 20_000e6, StrategyBuilder.eoaTakerTraits());   // wallet now ETH-light
        uint256 harmful = _spreadBps(order, USDC, WETH, 5_000e6);
        uint256 helpful = _spreadBps(order, WETH, USDC, _ethFor(5_000e6));
        console.log("on target:", s0, "| ETH-light -> take more ETH:", harmful);
        console.log("   give ETH back:", helpful);
        assertGt(harmful, helpful);
        assertLt(helpful, s0);
    }

    function test_directCrossBetweenNonUsdAssets() public {
        uint256 btcIn = _btcFor(3_000e6);
        uint256 q = _quote(order, CBBTC, WETH, btcIn);
        uint256 fair = _fair(CBBTC, WETH, btcIn);
        assertLe((fair - q) * 10_000 / fair, BaseConfig.MAX_BPS);
    }

    function test_staleOracleFreezesQuotes() public {
        vm.warp(block.timestamp + 2 hours);
        vm.prank(trader, trader);
        vm.expectRevert();
        router.quote(order, USDC, WETH, 1_000e6, StrategyBuilder.eoaTakerTraits());
    }

    function test_unknownTokenReverts() public {
        vm.prank(trader, trader);
        vm.expectRevert();
        router.quote(order, USDC, address(0xdead), 1_000e6, StrategyBuilder.eoaTakerTraits());
    }

    function test_exactOutRejected() public {
        bytes memory exactOut = TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: address(0), isExactIn: false, shouldUnwrapWeth: false, isStrictThresholdAmount: false, isFirstTransferFromTaker: false,
            useTransferFromAndAquaPush: true, threshold: "", to: address(0), deadline: 0, hasPreTransferInCallback: false,
            hasPreTransferOutCallback: false, preTransferInHookData: "", postTransferInHookData: "", preTransferOutHookData: "",
            postTransferOutHookData: "", preTransferInCallbackData: "", preTransferOutCallbackData: "", instructionsArgs: "", signature: ""
        }));
        vm.prank(trader, trader);
        vm.expectRevert();
        router.swap(order, USDC, WETH, 1e18, exactOut);
    }

    function test_cannotSellMoreThanAllocated() public {
        vm.prank(trader, trader);
        vm.expectRevert();
        router.swap(order, USDC, WETH, 60_000e6, StrategyBuilder.eoaTakerTraits());   // asks for more ETH than the $50k held
    }

    function testFuzz_spreadStaysWithinBounds(uint8 dir, uint256 seed) public {
        uint256 usd = bound(seed, 100e6, 20_000e6);
        address tin; address tout; uint256 amt;
        if (dir % 3 == 0) { tin = USDC; tout = WETH; amt = usd; }
        else if (dir % 3 == 1) { tin = WETH; tout = USDC; amt = _ethFor(usd); }
        else { tin = CBBTC; tout = WETH; amt = _btcFor(usd); }
        uint256 s = _spreadBps(order, tin, tout, amt);
        assertGe(s, BaseConfig.MIN_BPS - 1);
        assertLe(s, BaseConfig.MAX_BPS);
    }

    function testFuzz_makerNeverLosesValueAtOracle(uint8 dir, uint256 seed) public {
        uint256 usd = bound(seed, 50e6, 20_000e6);
        address tin; address tout; uint256 amt;
        if (dir % 3 == 0) { tin = USDC; tout = WETH; amt = usd; }
        else if (dir % 3 == 1) { tin = WETH; tout = USDC; amt = _ethFor(usd); }
        else { tin = CBBTC; tout = USDC; amt = _btcFor(usd); }
        uint256 v0 = _walletUsd(maker);
        vm.prank(trader, trader); router.swap(order, tin, tout, amt, StrategyBuilder.eoaTakerTraits());
        assertGe(_walletUsd(maker) + 2, v0);
    }

    function testFuzz_roundTripAlwaysCostsTheTaker(uint256 seed) public {
        uint256 usd = bound(seed, 100e6, 15_000e6);
        vm.prank(trader, trader); (, uint256 eth,) = router.swap(order, USDC, WETH, usd, StrategyBuilder.eoaTakerTraits());
        vm.prank(trader, trader); (, uint256 back,) = router.swap(order, WETH, USDC, eth, StrategyBuilder.eoaTakerTraits());
        assertLt(back, usd, "no free round trip");
    }
}
