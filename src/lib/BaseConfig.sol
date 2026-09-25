// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { StrategyBuilder } from "./StrategyBuilder.sol";

/// @title BaseConfig
/// @notice Live Base mainnet addresses and the demo basket definitions used by tests, scripts and the agent.
library BaseConfig {
    address internal constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address internal constant OFFICIAL_AQUA_ROUTER = 0x111111338c5091E8440b67B168bAe16a668AC0De;
    address internal constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address internal constant FEED_ETH_USD = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;
    address internal constant FEED_BTC_USD = 0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D;

    uint16 internal constant MIN_BPS = 1;
    uint16 internal constant MAX_BPS = 40;
    uint32 internal constant GAIN = 100;
    uint32 internal constant MAX_AGE = 3600;

    /// @notice ETH / USDC / cbBTC basket with the given target weights (bps, summing to 10_000).
    function cryptoBasket(uint16 baseBps, uint16 tEth, uint16 tUsdc, uint16 tBtc) internal pure returns (bytes memory) {
        return cryptoBasketWith(baseBps, tEth, tUsdc, tBtc, FEED_ETH_USD, FEED_BTC_USD, MAX_AGE);
    }

    function cryptoBasketWith(uint16 baseBps, uint16 tEth, uint16 tUsdc, uint16 tBtc, address feedEth, address feedBtc, uint32 maxAge)
        internal pure returns (bytes memory)
    {
        StrategyBuilder.Asset[] memory a = new StrategyBuilder.Asset[](3);
        a[0] = StrategyBuilder.Asset(WETH, feedEth, 18, tEth);
        a[1] = StrategyBuilder.Asset(USDC, address(0), 6, tUsdc);
        a[2] = StrategyBuilder.Asset(CBBTC, feedBtc, 8, tBtc);
        return StrategyBuilder.basketArgs(baseBps, MIN_BPS, MAX_BPS, GAIN, maxAge, a);
    }

    function basketTokens() internal pure returns (address[] memory t) {
        t = new address[](3);
        t[0] = WETH; t[1] = USDC; t[2] = CBBTC;
    }
}
