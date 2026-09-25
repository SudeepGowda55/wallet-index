// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import { ITakerCallbacks } from "@1inch/swap-vm/src/interfaces/ITakerCallbacks.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import { AsyncLiquidityHook } from "./AsyncLiquidityHook.sol";

interface IStrategyRouter {
    function swap(ISwapVM.Order calldata order, address tokenIn, address tokenOut, uint256 amount, bytes calldata takerTraits)
        external returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash);
    function quote(ISwapVM.Order calldata order, address tokenIn, address tokenOut, uint256 amount, bytes calldata takerTraits)
        external returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash);
}

/// @title WalletIndexHook
/// @notice Uniswap v4 hook whose pool is filled entirely from wallet-held 1inch Aqua strategies. Any maker lists
///         its strategy; every swap is quoted against all listed strategies and filled by the best one. A strategy
///         that cannot quote (stale oracle, not enough inventory, docked) is skipped, so fills fall back automatically.
contract WalletIndexHook is AsyncLiquidityHook, ITakerCallbacks {
    error NotRouter();
    error NotMaker();
    error NoFillableStrategy();

    IAqua public immutable aqua;
    address public immutable router;

    struct Listing { ISwapVM.Order order; bool active; }
    Listing[] internal _listings;

    event Listed(uint256 indexed id, address indexed maker);
    event Replaced(uint256 indexed id, address indexed maker);
    event Delisted(uint256 indexed id, address indexed maker);
    event Filled(uint256 indexed id, address indexed maker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    constructor(IPoolManager pm, IAqua aqua_, address router_) AsyncLiquidityHook(pm) {
        aqua = aqua_;
        router = router_;
    }

    function list(ISwapVM.Order calldata order) external returns (uint256 id) {
        if (order.maker != msg.sender) revert NotMaker();
        _listings.push(Listing(order, true));
        id = _listings.length - 1;
        emit Listed(id, msg.sender);
    }

    /// @notice Atomically swap a listing to a new strategy (e.g. after the maker re-ships with new parameters).
    function replace(uint256 id, ISwapVM.Order calldata order) external {
        if (_listings[id].order.maker != msg.sender || order.maker != msg.sender) revert NotMaker();
        _listings[id] = Listing(order, true);
        emit Replaced(id, msg.sender);
    }

    function delist(uint256 id) external {
        if (_listings[id].order.maker != msg.sender) revert NotMaker();
        _listings[id].active = false;
        emit Delisted(id, msg.sender);
    }

    function count() external view returns (uint256) { return _listings.length; }
    function listing(uint256 id) external view returns (ISwapVM.Order memory order, bool active) {
        return (_listings[id].order, _listings[id].active);
    }

    /// @notice Best available output for a swap; eth_call-only helper for UIs and agents.
    function bestQuote(address tokenIn, address tokenOut, uint256 amountIn) public returns (uint256 id, uint256 amountOut) {
        bytes memory td = _takerTraits();
        id = type(uint256).max;
        for (uint256 i; i < _listings.length; i++) {
            if (!_listings[i].active) continue;
            try IStrategyRouter(router).quote(_listings[i].order, tokenIn, tokenOut, amountIn, td) returns (uint256, uint256 o, bytes32) {
                if (o > amountOut) { amountOut = o; id = i; }
            } catch { }
        }
    }

    function _fillFromExternalLiquidity(Currency specified, Currency unspecified, uint256 amount)
        internal
        override
        returns (uint256 amountOut)
    {
        address tokenIn = Currency.unwrap(specified);
        address tokenOut = Currency.unwrap(unspecified);
        (uint256 id,) = bestQuote(tokenIn, tokenOut, amount);
        if (id == type(uint256).max) revert NoFillableStrategy();
        (, amountOut,) = IStrategyRouter(router).swap(_listings[id].order, tokenIn, tokenOut, amount, _takerTraits());
        emit Filled(id, _listings[id].order.maker, tokenIn, tokenOut, amount, amountOut);
    }

    function preTransferInCallback(address maker, address, address tokenIn, address, uint256 amountIn, uint256, bytes32 orderHash, bytes calldata) external {
        if (msg.sender != router) revert NotRouter();
        IERC20(tokenIn).approve(address(aqua), amountIn);
        aqua.push(maker, router, orderHash, tokenIn, amountIn);
    }

    function preTransferOutCallback(address, address, address, address, uint256, uint256, bytes32, bytes calldata) external view {
        if (msg.sender != router) revert NotRouter();
    }

    function _takerTraits() internal view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: address(this), isExactIn: true, shouldUnwrapWeth: false, isStrictThresholdAmount: false,
            isFirstTransferFromTaker: false, useTransferFromAndAquaPush: false, threshold: "", to: address(0), deadline: 0,
            hasPreTransferInCallback: true, hasPreTransferOutCallback: false, preTransferInHookData: "", postTransferInHookData: "",
            preTransferOutHookData: "", postTransferOutHookData: "", preTransferInCallbackData: "", preTransferOutCallbackData: "",
            instructionsArgs: "", signature: ""
        }));
    }
}
