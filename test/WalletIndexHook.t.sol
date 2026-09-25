// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { SwapParams, ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { StrategyBuilder } from "../src/lib/StrategyBuilder.sol";
import { BaseConfig } from "../src/lib/BaseConfig.sol";
import { WalletIndexHook } from "../src/hooks/WalletIndexHook.sol";
import { BaseForkTest } from "./utils/BaseForkTest.sol";

/// Uniswap v4 pool filled by competing wallet-held Aqua strategies (Base mainnet fork).
contract WalletIndexHookTest is BaseForkTest {
    address alice = makeAddr("alice"); address bob = makeAddr("bob"); address carol = makeAddr("carol");
    ISwapVM.Order oa; ISwapVM.Order ob; ISwapVM.Order oc;

    function setUp() public {
        _fork();
        _deployHookAndPool(30_000e6, 10 ether);
        oa = _basketMaker(alice, 8, 3000, 5000, 2000, 5_000e6, 3_000e6, 2_000e6, 1);    // ETH-heavy vs 30% target
        ob = _basketMaker(bob, 10, 5000, 3000, 2000, 5_000e6, 3_000e6, 2_000e6, 1);     // on target
        oc = _basketMaker(carol, 12, 7000, 2000, 1000, 5_000e6, 3_000e6, 2_000e6, 1);   // ETH-light vs 70% target
        vm.prank(alice); hook.list(oa);
        vm.prank(bob); hook.list(ob);
        vm.prank(carol); hook.list(oc);
    }

    function test_bestQuoteWins_thenRoutingRotates() public {
        (uint256 id,) = hook.bestQuote(USDC, WETH, 1_000e6);
        assertEq(id, 0, "alice (ETH-heavy) is cheapest to buy ETH from");
        uint256 a0 = IERC20(WETH).balanceOf(alice); uint256 b0 = IERC20(WETH).balanceOf(bob);
        for (uint256 i; i < 6; i++) _uniBuyEth(1_000e6);
        uint256 soldA = a0 - IERC20(WETH).balanceOf(alice); uint256 soldB = b0 - IERC20(WETH).balanceOf(bob);
        console.log("ETH sold alice:", soldA, "bob:", soldB);
        assertGt(soldA, 0); assertGt(soldB, 0, "routing moved to bob once alice rebalanced");
    }

    function test_uniswapSwapperGetsNearOraclePrice() public {
        uint256 got = _uniBuyEth(1_000e6);
        uint256 fair = _ethFor(1_000e6);
        assertLe((fair - got) * 10_000 / fair, BaseConfig.MAX_BPS);
        uint256 usdc = _uniSellEth(0.2 ether);
        assertGt(usdc, 0);
    }

    function test_replaceAndDelist_onlyMaker() public {
        ISwapVM.Order memory tighter = _basketMaker(alice, 4, 3000, 5000, 2000, 5_000e6, 3_000e6, 2_000e6, 2);
        vm.prank(bob); vm.expectRevert(WalletIndexHook.NotMaker.selector); hook.replace(0, tighter);
        vm.prank(alice); hook.replace(0, tighter);
        vm.prank(bob); vm.expectRevert(WalletIndexHook.NotMaker.selector); hook.delist(0);
        vm.prank(alice); hook.delist(0);
        (uint256 id,) = hook.bestQuote(USDC, WETH, 1_000e6);
        assertTrue(id != 0, "delisted strategy no longer quoted");
        vm.prank(bob); vm.expectRevert(WalletIndexHook.NotMaker.selector); hook.list(oa);
    }

    function test_staleOracle_allWalletsSkipped_swapReverts() public {
        vm.warp(block.timestamp + 2 hours);
        (uint256 id,) = hook.bestQuote(USDC, WETH, 1_000e6);
        assertEq(id, type(uint256).max);
        vm.prank(trader);
        vm.expectRevert();
        swapper.swap(key, SwapParams({ zeroForOne: false, amountSpecified: -int256(1_000e6), sqrtPriceLimitX96: uint160(1461446703485210103287273052203988822378723970341) }), PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }), "");
    }

    function test_floatExhaustion_revertsCleanly_thenSweepRestores() public {
        deal(USDC, address(hook), 3_000e6);                          // small working float
        _uniBuyEth(2_000e6);                                        // float 3k -> 1k
        uint256 walletsBefore = _walletUsd(alice) + _walletUsd(bob) + _walletUsd(carol);
        vm.prank(trader);
        vm.expectRevert();                                          // can't fund a 2k fill from a 1k float
        swapper.swap(key, SwapParams({ zeroForOne: false, amountSpecified: -int256(2_000e6), sqrtPriceLimitX96: uint160(1461446703485210103287273052203988822378723970341) }), PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }), "");
        assertEq(_walletUsd(alice) + _walletUsd(bob) + _walletUsd(carol), walletsBefore, "failed swap moved nothing");
        hook.sweepClaims(Currency.wrap(USDC), 2_000e6);             // permissionless keeper call
        assertEq(IERC20(USDC).balanceOf(address(hook)), 3_000e6, "float restored from swappers' settled payments");
        _uniBuyEth(2_000e6);
    }

    function test_thirdPartyCannotAddLiquidity() public {
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(PM);
        vm.expectRevert();
        lp.modifyLiquidity(key, ModifyLiquidityParams({ tickLower: -600, tickUpper: 600, liquidityDelta: 1e18, salt: 0 }), "");
    }

    function test_exactOutputRejected() public {
        vm.prank(trader);
        vm.expectRevert();
        swapper.swap(key, SwapParams({ zeroForOne: false, amountSpecified: int256(0.1 ether), sqrtPriceLimitX96: uint160(1461446703485210103287273052203988822378723970341) }), PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }), "");
    }

    function testFuzz_noValueExtractionFromWallets(bool buy, uint256 seed) public {
        uint256 usd = bound(seed, 20e6, 3_000e6);
        uint256 v0 = _walletUsd(alice) + _walletUsd(bob) + _walletUsd(carol);
        if (buy) _uniBuyEth(usd); else _uniSellEth(_ethFor(usd));
        assertGe(_walletUsd(alice) + _walletUsd(bob) + _walletUsd(carol) + 5, v0);
    }
}
