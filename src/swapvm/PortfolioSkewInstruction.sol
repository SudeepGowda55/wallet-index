// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Context } from "@1inch/swap-vm/src/libs/VM.sol";

interface IPriceFeed { function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80); }

/// @title PortfolioSkewInstruction
/// @notice Native SwapVM instruction: prices any pair of a maker's basket at oracle fair value, then applies a
///         spread that tightens for trades moving the whole wallet toward its target weights and widens for
///         trades moving it away. Config lives in the program args, so quote() and swap() are identical.
/// @dev args = base(2) min(2) max(2) gain(4) maxAge(4) | n x [token(20) feed(20) decimals(1) targetBps(2)]
///      feed == address(0) prices the token at exactly $1. maxAge == 0 disables the staleness check.
contract PortfolioSkewInstruction {
    error PSExactOutUnsupported();
    error PSUnknownToken();
    error PSBadArgs();
    error PSStalePrice(address feed, uint256 age);
    error PSBadPrice(address feed);
    error PSInsufficientBalance(uint256 want, uint256 have);

    uint256 private constant _HEADER = 14;
    uint256 private constant _ASSET = 43;

    struct PSAsset { address token; address feed; uint8 decimals; uint16 targetBps; }
    struct PSConfig { uint16 baseBps; uint16 minBps; uint16 maxBps; uint32 gain; uint32 maxAge; PSAsset[] assets; }

    function _psDecode(bytes calldata a) internal pure returns (PSConfig memory c) {
        if (a.length < _HEADER + 2 * _ASSET || (a.length - _HEADER) % _ASSET != 0) revert PSBadArgs();
        c.baseBps = uint16(bytes2(a[0:2])); c.minBps = uint16(bytes2(a[2:4])); c.maxBps = uint16(bytes2(a[4:6]));
        c.gain = uint32(bytes4(a[6:10])); c.maxAge = uint32(bytes4(a[10:14]));
        uint256 n = (a.length - _HEADER) / _ASSET;
        c.assets = new PSAsset[](n);
        for (uint256 i; i < n; i++) {
            uint256 o = _HEADER + i * _ASSET;
            c.assets[i] = PSAsset(address(bytes20(a[o:o + 20])), address(bytes20(a[o + 20:o + 40])), uint8(a[o + 40]), uint16(bytes2(a[o + 41:o + 43])));
        }
    }

    function _psPrice(PSAsset memory x, uint32 maxAge) internal view returns (uint256) {
        if (x.feed == address(0)) return 1e8;
        (, int256 p,, uint256 updatedAt,) = IPriceFeed(x.feed).latestRoundData();
        if (p <= 0) revert PSBadPrice(x.feed);
        if (maxAge != 0 && block.timestamp - updatedAt > maxAge) revert PSStalePrice(x.feed, block.timestamp - updatedAt);
        return uint256(p);
    }

    /// @dev sum over assets of |weight - target| in bps
    function _psImbalance(uint256[] memory usd, PSAsset[] memory assets) internal pure returns (uint256 sum) {
        uint256 total;
        for (uint256 i; i < usd.length; i++) total += usd[i];
        if (total == 0) return 0;
        for (uint256 i; i < usd.length; i++) {
            uint256 w = usd[i] * 10_000 / total;
            uint256 t = assets[i].targetBps;
            sum += w > t ? w - t : t - w;
        }
    }

    function _portfolioSkewXD(Context memory ctx, bytes calldata args) internal view {
        if (!ctx.query.isExactIn) revert PSExactOutUnsupported();
        PSConfig memory c = _psDecode(args);
        uint256 n = c.assets.length;
        uint256[] memory usd = new uint256[](n);
        uint256[] memory px = new uint256[](n);
        uint256 iIn = type(uint256).max;
        uint256 iOut = type(uint256).max;
        for (uint256 i; i < n; i++) {
            px[i] = _psPrice(c.assets[i], c.maxAge);
            usd[i] = IERC20(c.assets[i].token).balanceOf(ctx.query.maker) * px[i] / 10 ** c.assets[i].decimals;
            if (c.assets[i].token == ctx.query.tokenIn) iIn = i;
            if (c.assets[i].token == ctx.query.tokenOut) iOut = i;
        }
        if (iIn == type(uint256).max || iOut == type(uint256).max || iIn == iOut) revert PSUnknownToken();

        uint256 fair = ctx.swap.amountIn * px[iIn] * 10 ** c.assets[iOut].decimals / (px[iOut] * 10 ** c.assets[iIn].decimals);
        uint256 before_ = _psImbalance(usd, c.assets);
        usd[iIn] += ctx.swap.amountIn * px[iIn] / 10 ** c.assets[iIn].decimals;
        uint256 outUsd = fair * px[iOut] / 10 ** c.assets[iOut].decimals;
        usd[iOut] = usd[iOut] > outUsd ? usd[iOut] - outUsd : 0;
        uint256 after_ = _psImbalance(usd, c.assets);

        int256 s = int256(uint256(c.baseBps));
        if (after_ < before_) s -= int256((before_ - after_) * c.gain / 10_000);
        else s += int256((after_ - before_) * c.gain / 10_000);
        if (s < int256(uint256(c.minBps))) s = int256(uint256(c.minBps));
        if (s > int256(uint256(c.maxBps))) s = int256(uint256(c.maxBps));

        uint256 out = fair * (10_000 - uint256(s)) / 10_000;
        // Aqua lets one balance back several strategies, so the strategy's allocation can exceed what the wallet
        // really holds. Never quote more than both: an over-committed wallet refuses to quote and routing falls back.
        uint256 held = IERC20(c.assets[iOut].token).balanceOf(ctx.query.maker);
        uint256 cap = ctx.swap.balanceOut < held ? ctx.swap.balanceOut : held;
        if (out > cap) revert PSInsufficientBalance(out, cap);
        ctx.swap.amountOut = out;
    }
}
