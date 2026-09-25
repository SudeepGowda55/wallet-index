// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { console } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { StrategyBuilder } from "../src/lib/StrategyBuilder.sol";
import { BaseConfig } from "../src/lib/BaseConfig.sol";
import { BaseForkTest } from "./utils/BaseForkTest.sol";

interface IOfficialRouter {
    function swap(ISwapVM.Order calldata o, address tin, address tout, uint256 amt, bytes calldata t) external returns (uint256, uint256, bytes32);
}
interface IAquaRawBal { function rawBalances(address, address, bytes32, address) external view returns (uint248, uint8); }

/// Aqua shared liquidity: one wallet backs our basket (modified router, via Uniswap) AND a plain curve on the
/// OFFICIAL 1inch router (direct SwapVM taker) at the same time.
contract SharedLiquidityTest is BaseForkTest {
    IOfficialRouter constant OFFICIAL = IOfficialRouter(BaseConfig.OFFICIAL_AQUA_ROUTER);
    address maker = makeAddr("maker"); address direct = makeAddr("directTaker");
    ISwapVM.Order basket; ISwapVM.Order curve;

    function setUp() public {
        _fork();
        _deployHookAndPool(10_000e6, 3 ether);
        basket = _basketMaker(maker, 8, 4000, 4500, 1500, 5_400e6, 6_000e6, 1_500e6, 1);
        uint256 w = IERC20(WETH).balanceOf(maker);
        curve = StrategyBuilder.aquaOrder(maker, StrategyBuilder.curveProgram(3_000_000));   // 0.3% fee x*y=k
        address[] memory t = new address[](2); t[0] = WETH; t[1] = USDC;
        uint256[] memory a = new uint256[](2); a[0] = w; a[1] = 5_400e6;
        vm.prank(maker); AQUA.ship(BaseConfig.OFFICIAL_AQUA_ROUTER, abi.encode(curve), t, a);
        vm.prank(maker); hook.list(basket);
        deal(USDC, direct, 10_000e6); vm.prank(direct); IERC20(USDC).approve(BaseConfig.OFFICIAL_AQUA_ROUTER, type(uint256).max);
    }

    function _alloc(address app, ISwapVM.Order memory o) internal view returns (uint256 b) {
        (b,) = IAquaRawBal(address(AQUA)).rawBalances(maker, app, keccak256(abi.encode(o)), WETH);
    }

    function test_oneWallet_twoStrategies_twoTakers() public {
        uint256 w0 = IERC20(WETH).balanceOf(maker);
        assertEq(_alloc(address(router), basket) + _alloc(BaseConfig.OFFICIAL_AQUA_ROUTER, curve), 2 * w0, "200% allocated, 0 moved");
        uint256 viaUniswap = _uniBuyEth(1_000e6);
        uint256 b = IERC20(WETH).balanceOf(direct);
        vm.prank(direct, direct); OFFICIAL.swap(curve, USDC, WETH, 1_000e6, StrategyBuilder.eoaTakerTraits());
        uint256 viaOfficial = IERC20(WETH).balanceOf(direct) - b;
        console.log("uniswap swapper got:", viaUniswap, "| official 1inch taker got:", viaOfficial);
        assertEq(w0 - IERC20(WETH).balanceOf(maker), viaUniswap + viaOfficial, "both fills from the same wallet balance");
        assertEq(IERC20(USDC).balanceOf(maker), 8_000e6);
    }

    function test_overcommittedWalletDropsOut_routingFallsBackToAnotherWallet() public {
        address bob = makeAddr("bob");
        ISwapVM.Order memory ob = _basketMaker(bob, 10, 5000, 3000, 2000, 5_000e6, 3_000e6, 2_000e6, 1);
        vm.prank(bob); hook.list(ob);
        // drain Alice's REAL WETH through her other strategy (official 1inch curve); her basket allocation is unchanged
        deal(USDC, direct, 1_000_000e6);
        vm.prank(direct, direct); OFFICIAL.swap(curve, USDC, WETH, 200_000e6, StrategyBuilder.eoaTakerTraits());
        uint256 aliceWeth = IERC20(WETH).balanceOf(maker);
        assertLt(aliceWeth, _ethFor(1_000e6), "alice no longer really holds $1k of WETH");
        assertGt(_alloc(address(router), basket), aliceWeth, "but her basket allocation still says she does");
        (uint256 id,) = hook.bestQuote(USDC, WETH, 1_000e6);
        assertEq(id, 1, "alice refuses to quote more than she holds; bob is best");
        uint256 b0 = IERC20(WETH).balanceOf(bob);
        _uniBuyEth(1_000e6);
        assertLt(IERC20(WETH).balanceOf(bob), b0, "the Uniswap swap filled from bob instead of reverting");
    }

    function test_overcommitment_failsSafe() public {
        for (uint256 i; i < 4; i++) _uniBuyEth(1_100e6);
        uint256 left = IERC20(WETH).balanceOf(maker);
        vm.prank(direct, direct);
        vm.expectRevert();
        OFFICIAL.swap(curve, USDC, WETH, 5_000e6, StrategyBuilder.eoaTakerTraits());
        assertEq(IERC20(WETH).balanceOf(maker), left);
    }
}
