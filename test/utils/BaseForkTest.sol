// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { WalletIndexRouter } from "../../src/swapvm/WalletIndexRouter.sol";
import { WalletIndexHook } from "../../src/hooks/WalletIndexHook.sol";
import { StrategyBuilder } from "../../src/lib/StrategyBuilder.sol";
import { BaseConfig } from "../../src/lib/BaseConfig.sol";

interface IFeedT { function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80); }

/// @notice Shared Base-mainnet fork fixture: modified router, hook at a flag-valid address, WETH/USDC pool, makers.
abstract contract BaseForkTest is Test {
    IAqua internal constant AQUA = IAqua(BaseConfig.AQUA);
    IPoolManager internal constant PM = IPoolManager(BaseConfig.POOL_MANAGER);
    address internal constant USDC = BaseConfig.USDC;
    address internal constant WETH = BaseConfig.WETH;
    address internal constant CBBTC = BaseConfig.CBBTC;

    WalletIndexRouter internal router;
    WalletIndexHook internal hook;
    PoolKey internal key;
    PoolSwapTest internal swapper;
    uint8 internal OP;
    address internal trader = makeAddr("trader");

    function _fork() internal {
        vm.createSelectFork(vm.envOr("BASE_RPC", string("https://mainnet.base.org")));
        router = new WalletIndexRouter(BaseConfig.AQUA, WETH, address(this), "WalletIndex", "1");
        OP = router.portfolioSkewOpcode();
    }

    function _deployHookAndPool(uint256 usdcFloat, uint256 wethFloat) internal {
        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG);
        address h = address(uint160(flags) | (uint160(0x4444) << 144));
        deployCodeTo("WalletIndexHook.sol:WalletIndexHook", abi.encode(PM, AQUA, address(router)), h);
        hook = WalletIndexHook(h);
        deal(USDC, h, usdcFloat); deal(WETH, h, wethFloat);
        key = PoolKey({ currency0: Currency.wrap(WETH), currency1: Currency.wrap(USDC), fee: 0, tickSpacing: 10, hooks: IHooks(h) });
        PM.initialize(key, 79228162514264337593543950336);
        swapper = new PoolSwapTest(PM);
        deal(USDC, trader, 1_000_000e6); deal(WETH, trader, 200 ether); deal(CBBTC, trader, 5e8);
        vm.startPrank(trader);
        IERC20(USDC).approve(address(swapper), type(uint256).max); IERC20(WETH).approve(address(swapper), type(uint256).max);
        IERC20(USDC).approve(address(router), type(uint256).max); IERC20(WETH).approve(address(router), type(uint256).max);
        IERC20(CBBTC).approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function _px(address feed) internal view returns (uint256) { (, int256 a,,,) = IFeedT(feed).latestRoundData(); return uint256(a); }
    function _ethFor(uint256 usd6) internal view returns (uint256) { return usd6 * 1e20 / _px(BaseConfig.FEED_ETH_USD); }
    function _btcFor(uint256 usd6) internal view returns (uint256) { return usd6 * 1e10 / _px(BaseConfig.FEED_BTC_USD); }

    /// @notice Funds `maker` with $ethUsd ETH / $usdc USDC / $btcUsd cbBTC, ships a basket to the router, returns the order.
    function _basketMaker(address maker, uint16 base, uint16 tE, uint16 tU, uint16 tB, uint256 ethUsd, uint256 usdc, uint256 btcUsd, uint64 salt)
        internal returns (ISwapVM.Order memory o)
    {
        deal(WETH, maker, _ethFor(ethUsd)); deal(USDC, maker, usdc); deal(CBBTC, maker, _btcFor(btcUsd));
        o = StrategyBuilder.aquaOrder(maker, StrategyBuilder.basketProgram(OP, salt, BaseConfig.cryptoBasket(base, tE, tU, tB)));
        address[] memory t = BaseConfig.basketTokens();
        uint256[] memory a = new uint256[](3);
        for (uint256 i; i < 3; i++) a[i] = IERC20(t[i]).balanceOf(maker);
        vm.startPrank(maker);
        for (uint256 i; i < 3; i++) IERC20(t[i]).approve(address(AQUA), type(uint256).max);
        AQUA.ship(address(router), abi.encode(o), t, a);
        vm.stopPrank();
    }

    function _quote(ISwapVM.Order memory o, address tin, address tout, uint256 amt) internal returns (uint256 out) {
        vm.prank(trader, trader);
        (, out,) = router.quote(o, tin, tout, amt, StrategyBuilder.eoaTakerTraits());
    }

    function _spreadBps(ISwapVM.Order memory o, address tin, address tout, uint256 amt) internal returns (uint256) {
        uint256 out = _quote(o, tin, tout, amt);
        uint256 fair = _fair(tin, tout, amt);
        return (fair - out) * 10_000 / fair;
    }

    function _fair(address tin, address tout, uint256 amt) internal view returns (uint256) {
        (uint256 pin, uint8 din) = _meta(tin); (uint256 pout, uint8 dout) = _meta(tout);
        return amt * pin * 10 ** dout / (pout * 10 ** din);
    }
    function _meta(address t) internal view returns (uint256, uint8) {
        if (t == USDC) return (1e8, 6);
        if (t == WETH) return (_px(BaseConfig.FEED_ETH_USD), 18);
        return (_px(BaseConfig.FEED_BTC_USD), 8);
    }

    function _walletUsd(address m) internal view returns (uint256) {
        return IERC20(USDC).balanceOf(m) * 1e2 + IERC20(WETH).balanceOf(m) * _px(BaseConfig.FEED_ETH_USD) / 1e18 + IERC20(CBBTC).balanceOf(m) * _px(BaseConfig.FEED_BTC_USD) / 1e8;
    }

    function _uniBuyEth(uint256 usdc6) internal returns (uint256 got) {
        uint256 b = IERC20(WETH).balanceOf(trader);
        vm.prank(trader);
        swapper.swap(key, SwapParams({ zeroForOne: false, amountSpecified: -int256(usdc6), sqrtPriceLimitX96: uint160(1461446703485210103287273052203988822378723970341) }), PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }), "");
        got = IERC20(WETH).balanceOf(trader) - b;
    }
    function _uniSellEth(uint256 wei_) internal returns (uint256 got) {
        uint256 b = IERC20(USDC).balanceOf(trader);
        vm.prank(trader);
        swapper.swap(key, SwapParams({ zeroForOne: true, amountSpecified: -int256(wei_), sqrtPriceLimitX96: uint160(4295128740) }), PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }), "");
        got = IERC20(USDC).balanceOf(trader) - b;
    }
}
