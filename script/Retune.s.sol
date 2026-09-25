// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { WalletIndexHook } from "../src/hooks/WalletIndexHook.sol";
import { BaseConfig } from "../src/lib/BaseConfig.sol";
import { Deploy } from "./Deploy.s.sol";

/// @notice Agent action: retire a maker's strategy on Aqua (dock), ship the retuned one (fresh salt, new base
///         spread, allocations = current wallet balances), and atomically replace the hook listing.
contract Retune is Deploy {
    function _order(address m, string memory baseEnv, string memory saltEnv) internal view returns (ISwapVM.Order memory) {
        return basketOrder(m, 34, makers()[vm.envUint("MAKER_INDEX")], uint16(vm.envUint(baseEnv)), uint64(vm.envUint(saltEnv)),
            vm.envOr("FEED_ETH", BaseConfig.FEED_ETH_USD), vm.envOr("FEED_BTC", BaseConfig.FEED_BTC_USD),
            uint32(vm.envOr("MAX_AGE", uint256(BaseConfig.MAX_AGE))));
    }

    function _currentBalances(address m) internal view returns (uint256[] memory amts) {
        address[] memory tokens = BaseConfig.basketTokens();
        amts = new uint256[](3);
        for (uint256 j; j < 3; j++) amts[j] = IERC20(tokens[j]).balanceOf(m);
    }

    function run() external override {
        uint256 pk = vm.envUint("MAKER_PK");
        address m = vm.addr(pk);
        address router = vm.envAddress("ROUTER");
        bytes32 oldHash = keccak256(abi.encode(_order(m, "OLD_BASE", "OLD_SALT")));
        ISwapVM.Order memory newO = _order(m, "NEW_BASE", "NEW_SALT");
        uint256[] memory amts = _currentBalances(m);
        vm.startBroadcast(pk);
        IAqua(BaseConfig.AQUA).dock(router, oldHash, BaseConfig.basketTokens());
        IAqua(BaseConfig.AQUA).ship(router, abi.encode(newO), BaseConfig.basketTokens(), amts);
        WalletIndexHook(vm.envAddress("HOOK")).replace(vm.envUint("LISTING_ID"), newO);
        vm.stopBroadcast();
    }
}
