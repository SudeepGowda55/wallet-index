// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { WalletIndexRouter } from "../src/swapvm/WalletIndexRouter.sol";
import { WalletIndexHook } from "../src/hooks/WalletIndexHook.sol";
import { StrategyBuilder } from "../src/lib/StrategyBuilder.sol";
import { BaseConfig } from "../src/lib/BaseConfig.sol";

interface IFeedD { function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80); }

/// @notice Deploys the hook (mined CREATE2 address), the WETH/USDC v4 pool, a demo swap router, seeds the hook
///         float, and lists three maker baskets. Also ships a plain official 1inch curve from maker 1 to show
///         Aqua shared liquidity. The WalletIndexRouter is deployed beforehand (see scripts/deploy.sh).
///         Real transactions only: identical on a local fork and on Base mainnet.
contract Deploy is Script {
    struct MakerCfg { uint16 base; uint16 tEth; uint16 tUsdc; uint16 tBtc; }

    function makers() public pure returns (MakerCfg[3] memory m) {
        m[0] = MakerCfg(8, 3000, 5000, 2000);    // alice
        m[1] = MakerCfg(10, 5000, 3000, 2000);   // bob
        m[2] = MakerCfg(12, 7000, 2000, 1000);   // carol
    }

    function basketOrder(address maker, uint8 op, MakerCfg memory c, uint16 base, uint64 salt, address feedEth, address feedBtc, uint32 maxAge)
        public pure returns (ISwapVM.Order memory)
    {
        return StrategyBuilder.aquaOrder(maker, StrategyBuilder.basketProgram(op, salt,
            BaseConfig.cryptoBasketWith(base, c.tEth, c.tUsdc, c.tBtc, feedEth, feedBtc, maxAge)));
    }

    /// @dev Same wallet, second strategy, on the OFFICIAL 1inch router: plain 0.3% x*y=k over a small slice of its
    ///      WETH/USDC (a plain curve ignores the live price, so it only gets a small share of the wallet).
    /// @dev Seeds the curve's slice so its starting price equals the live oracle price (value-balanced WETH/USDC).
    function _shipCurveAtOraclePrice(address m, uint256 maxWeth, uint256 maxUsdc, address feedEth) internal {
        (, int256 px,,,) = IFeedD(feedEth).latestRoundData();
        uint256 usdcForMaxWeth = maxWeth * uint256(px) / 1e20;
        if (usdcForMaxWeth <= maxUsdc) _shipCurve(m, maxWeth, usdcForMaxWeth);
        else _shipCurve(m, maxUsdc * 1e20 / uint256(px), maxUsdc);
    }

    function _shipCurve(address m, uint256 weth, uint256 usdc) internal {
        ISwapVM.Order memory curve = StrategyBuilder.aquaOrder(m, StrategyBuilder.curveProgram(3_000_000));
        address[] memory t2 = new address[](2); t2[0] = BaseConfig.WETH; t2[1] = BaseConfig.USDC;
        uint256[] memory a2 = new uint256[](2); a2[0] = weth; a2[1] = usdc;
        IAqua(BaseConfig.AQUA).ship(BaseConfig.OFFICIAL_AQUA_ROUTER, abi.encode(curve), t2, a2);
        console.log("CURVE_ORDER", vm.toString(abi.encode(curve)));
    }

    function _setupMaker(uint256 i, uint256 pk, address router, address hook, uint8 op, address feedEth, address feedBtc, uint32 maxAge) internal {
        address m = vm.addr(pk);
        ISwapVM.Order memory o = basketOrder(m, op, makers()[i], makers()[i].base, 1, feedEth, feedBtc, maxAge);
        address[] memory tokens = BaseConfig.basketTokens();
        uint256[] memory amts = new uint256[](3);
        for (uint256 j; j < 3; j++) amts[j] = IERC20(tokens[j]).balanceOf(m);
        vm.startBroadcast(pk);
        for (uint256 j; j < 3; j++) IERC20(tokens[j]).approve(BaseConfig.AQUA, type(uint256).max);
        IAqua(BaseConfig.AQUA).ship(router, abi.encode(o), tokens, amts);
        WalletIndexHook(hook).list(o);
        if (i == 0 && vm.envOr("SHARED_CURVE", true)) _shipCurveAtOraclePrice(m, amts[0] / 5, amts[1] / 5, feedEth);
        vm.stopBroadcast();
    }

    function run() external virtual {
        address router = vm.envAddress("ROUTER");
        address feedEth = vm.envOr("FEED_ETH", BaseConfig.FEED_ETH_USD);
        address feedBtc = vm.envOr("FEED_BTC", BaseConfig.FEED_BTC_USD);
        uint32 maxAge = uint32(vm.envOr("MAX_AGE", uint256(BaseConfig.MAX_AGE)));
        uint8 op = WalletIndexRouter(payable(router)).portfolioSkewOpcode();

        vm.startBroadcast(vm.envUint("DEPLOYER_PK"));
        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG);
        bytes memory cargs = abi.encode(BaseConfig.POOL_MANAGER, BaseConfig.AQUA, router);
        (address hook, bytes32 salt) = HookMiner.find(BaseConfig.CREATE2_DEPLOYER, flags, type(WalletIndexHook).creationCode, cargs);
        (bool ok,) = BaseConfig.CREATE2_DEPLOYER.call(abi.encodePacked(salt, abi.encodePacked(type(WalletIndexHook).creationCode, cargs)));
        require(ok && hook.code.length > 0, "hook deploy failed");
        PoolKey memory key = PoolKey({ currency0: Currency.wrap(BaseConfig.WETH), currency1: Currency.wrap(BaseConfig.USDC), fee: 0, tickSpacing: 10, hooks: IHooks(hook) });
        IPoolManager(BaseConfig.POOL_MANAGER).initialize(key, 79228162514264337593543950336);
        PoolSwapTest swapper = new PoolSwapTest(IPoolManager(BaseConfig.POOL_MANAGER));
        IERC20(BaseConfig.USDC).transfer(hook, vm.envUint("FLOAT_USDC"));
        IERC20(BaseConfig.WETH).transfer(hook, vm.envUint("FLOAT_WETH"));
        vm.stopBroadcast();

        string[3] memory envs = ["MAKER1_PK", "MAKER2_PK", "MAKER3_PK"];
        for (uint256 i; i < 3; i++) _setupMaker(i, vm.envUint(envs[i]), router, hook, op, feedEth, feedBtc, maxAge);
        console.log("HOOK", hook);
        console.log("SWAPPER", address(swapper));
        console.log("OPCODE", op);
    }
}
