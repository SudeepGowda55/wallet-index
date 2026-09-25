// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test, console } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { WalletIndexRouter } from "../src/swapvm/WalletIndexRouter.sol";
import { StrategyBuilder } from "../src/lib/StrategyBuilder.sol";

interface IFeedE { function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80); }

/// Evidence on an Ethereum mainnet fork: a 5-currency basket (USD/EUR/JPY/CHF/SGD) on the native instruction
/// quotes direct crosses; compared against today's real two-hop route through USDC on real Uniswap v4 pools.
contract FxEvidenceEthereumTest is Test {
    IAqua constant AQUA = IAqua(0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a);
    IPoolManager constant PM = IPoolManager(0x000000000004444c5dc75cB358380D2e3dE08A90);
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant EURC = 0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c;
    address constant JPYC = 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29;
    address constant ZCHF = 0xB58E61C3098d85632Df34EecfB899A1Ed80921cB;
    address constant XSGD = 0x70e8dE73cE538DA2bEEd35d14187F6959a8ecA96;
    address constant F_EUR = 0xb49f677943BC038e9857d61E7d053CaA2C1734C1;
    address constant F_JPY = 0xBcE206caE7f0ec07b545EddE332A47C2F75bbeb3;
    address constant F_CHF = 0x449d117117838fFA61263B61dA6301AA2a88B13A;
    address constant F_SGD = 0xe25277fF4bbF9081C75Ab0EB13B4A13a721f3E13;

    WalletIndexRouter router; PoolSwapTest swapper; ISwapVM.Order order;
    address maker = makeAddr("fxMaker"); address user = makeAddr("fxUser");

    function _p(address f) internal view returns (uint256) { (, int256 a,,,) = IFeedE(f).latestRoundData(); return uint256(a); }
    function _amt(address tok, uint256 usd6) internal view returns (uint256) {
        if (tok == USDC) return usd6;
        if (tok == EURC) return usd6 * 1e8 / _p(F_EUR);
        if (tok == XSGD) return usd6 * 1e8 / _p(F_SGD);
        if (tok == JPYC) return usd6 * 1e20 / _p(F_JPY);
        return usd6 * 1e20 / _p(F_CHF);
    }

    function setUp() public {
        vm.createSelectFork(vm.envOr("ETH_RPC", string("https://ethereum-rpc.publicnode.com")));
        router = new WalletIndexRouter(address(AQUA), WETH, address(this), "WalletIndex", "1");
        StrategyBuilder.Asset[] memory a = new StrategyBuilder.Asset[](5);
        a[0] = StrategyBuilder.Asset(USDC, address(0), 6, 4000);
        a[1] = StrategyBuilder.Asset(EURC, F_EUR, 6, 2000);
        a[2] = StrategyBuilder.Asset(JPYC, F_JPY, 18, 2000);
        a[3] = StrategyBuilder.Asset(ZCHF, F_CHF, 18, 1000);
        a[4] = StrategyBuilder.Asset(XSGD, F_SGD, 6, 1000);
        // FX feeds heartbeat once a day on weekends -> 26h freshness bound
        bytes memory args = StrategyBuilder.basketArgs(4, 1, 15, 100, 93_600, a);
        order = StrategyBuilder.aquaOrder(maker, StrategyBuilder.basketProgram(router.portfolioSkewOpcode(), 1, args));
        address[5] memory toks = [USDC, EURC, JPYC, ZCHF, XSGD];
        uint256[5] memory usd = [uint256(200_000e6), 100_000e6, 100_000e6, 50_000e6, 50_000e6];
        address[] memory t = new address[](5); uint256[] memory amts = new uint256[](5);
        for (uint256 i; i < 5; i++) { deal(toks[i], maker, _amt(toks[i], usd[i])); t[i] = toks[i]; amts[i] = IERC20(toks[i]).balanceOf(maker); }
        vm.startPrank(maker);
        for (uint256 i; i < 5; i++) IERC20(toks[i]).approve(address(AQUA), type(uint256).max);
        AQUA.ship(address(router), abi.encode(order), t, amts);
        vm.stopPrank();
        swapper = new PoolSwapTest(PM);
        for (uint256 i; i < 5; i++) {
            deal(toks[i], user, _amt(toks[i], 100_000e6));
            vm.startPrank(user); IERC20(toks[i]).approve(address(router), type(uint256).max); IERC20(toks[i]).approve(address(swapper), type(uint256).max); vm.stopPrank();
        }
    }

    function _poolSwap(PoolKey memory k, bool zeroForOne, uint256 amt, address tout) internal returns (uint256 out) {
        uint256 b = IERC20(tout).balanceOf(user);
        vm.prank(user);
        swapper.swap(k, SwapParams({ zeroForOne: zeroForOne, amountSpecified: -int256(amt), sqrtPriceLimitX96: zeroForOne ? uint160(4295128740) : uint160(1461446703485210103287273052203988822378723970341) }), PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }), "");
        out = IERC20(tout).balanceOf(user) - b;
    }

    function test_directEURtoJPY_vsRealTwoHopThroughUSDC() public {
        PoolKey memory eurcUsdc = PoolKey({ currency0: Currency.wrap(EURC), currency1: Currency.wrap(USDC), fee: 300, tickSpacing: 6, hooks: IHooks(address(0)) });
        PoolKey memory usdcJpyc = PoolKey({ currency0: Currency.wrap(USDC), currency1: Currency.wrap(JPYC), fee: 500, tickSpacing: 10, hooks: IHooks(address(0)) });
        uint256[3] memory sizes = [uint256(1_000e6), 10_000e6, 50_000e6];
        for (uint256 i; i < 3; i++) {
            uint256 eurIn = _amt(EURC, sizes[i]);
            uint256 fair = eurIn * _p(F_EUR) * 1e12 / _p(F_JPY);
            uint256 snap = vm.snapshotState();
            uint256 twoHop = _poolSwap(usdcJpyc, true, _poolSwap(eurcUsdc, true, eurIn, USDC), JPYC);
            vm.revertToState(snap);
            vm.prank(user, user);
            (, uint256 direct,) = router.swap(order, EURC, JPYC, eurIn, StrategyBuilder.eoaTakerTraits());
            vm.revertToState(snap);
            int256 cTwo = (int256(fair) - int256(twoHop)) * 1e4 / int256(fair);
            int256 cDir = (int256(fair) - int256(direct)) * 1e4 / int256(fair);
            console.log("EUR->JPY $", sizes[i] / 1e6);
            console.logInt(cTwo); console.logInt(cDir);
            if (i == 2) assertLt(cDir, cTwo, "at $50k the basket beats the two-hop route");
        }
    }

    function test_crossesWithNoPoolExecuteInOneHop() public {
        uint256 jpyIn = _amt(JPYC, 5_000e6);
        vm.prank(user, user); (, uint256 sgd,) = router.swap(order, JPYC, XSGD, jpyIn, StrategyBuilder.eoaTakerTraits());
        vm.prank(user, user); (, uint256 chf,) = router.swap(order, JPYC, ZCHF, jpyIn, StrategyBuilder.eoaTakerTraits());
        uint256 fairSgd = jpyIn * _p(F_JPY) / (_p(F_SGD) * 1e12);
        uint256 fairChf = jpyIn * _p(F_JPY) / _p(F_CHF);
        assertApproxEqRel(sgd, fairSgd, 2e15); assertApproxEqRel(chf, fairChf, 2e15);
        console.log("JPY->SGD and JPY->CHF filled directly within 0.2% of the live cross rate");
    }
}
