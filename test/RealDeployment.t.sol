// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { WalletIndexHook } from "../src/hooks/WalletIndexHook.sol";
import { WalletIndexRouter } from "../src/swapvm/WalletIndexRouter.sol";
import { BaseConfig } from "../src/lib/BaseConfig.sol";

/// The hook deploys exactly as on mainnet: mined salt via the canonical CREATE2 deployer, no cheatcodes.
contract RealDeploymentTest is Test {
    function test_hookViaCreate2_andPoolInitializes() public {
        vm.createSelectFork(vm.envOr("BASE_RPC", string("https://mainnet.base.org")));
        WalletIndexRouter router = new WalletIndexRouter(BaseConfig.AQUA, BaseConfig.WETH, address(this), "WalletIndex", "1");
        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG);
        bytes memory args = abi.encode(BaseConfig.POOL_MANAGER, BaseConfig.AQUA, address(router));
        (address predicted, bytes32 salt) = HookMiner.find(BaseConfig.CREATE2_DEPLOYER, flags, type(WalletIndexHook).creationCode, args);
        (bool ok,) = BaseConfig.CREATE2_DEPLOYER.call(abi.encodePacked(salt, abi.encodePacked(type(WalletIndexHook).creationCode, args)));
        assertTrue(ok && predicted.code.length > 0);
        PoolKey memory key = PoolKey({ currency0: Currency.wrap(BaseConfig.WETH), currency1: Currency.wrap(BaseConfig.USDC), fee: 0, tickSpacing: 10, hooks: IHooks(predicted) });
        IPoolManager(BaseConfig.POOL_MANAGER).initialize(key, 79228162514264337593543950336);
    }
}
