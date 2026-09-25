# Uniswap Developer Feedback

*Draft: review and edit before submitting the [Uniswap Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback).*

## What we built on the Uniswap stack
A Uniswap v4 hook (`beforeSwap` + `beforeSwapReturnDelta`) whose pool has no liquidity of its own: every swap is filled from wallet-held 1inch Aqua strategies, choosing the best of many makers per swap. Deployed via a mined CREATE2 address against the real Base PoolManager.

## What worked well
- `beforeSwapReturnDelta` makes "pool filled from external liquidity" possible without touching core.
- `HookMiner` + the canonical CREATE2 deployer made flag-valid deployment straightforward.
- `PoolSwapTest` / `PoolModifyLiquidityTest` were enough to test end to end on a mainnet fork.

## Friction we hit
- **Filling synchronously from an external venue inside `beforeSwap`**: the swapper's input isn't in the PoolManager yet, so a real `take` reverts. We had to mint ERC-6909 claims and fund the external fill from a pre-seeded float, then sweep claims later. A documented pattern (or helper in `uniswap-hooks`) for synchronous external fills would save teams a lot of time.
- **Routing**: a hook pool is invisible to Uniswap routing until allowlisted through a form. There's no self-serve way to test or demo "real users reach my hook" during a hackathon.
- **Forge + via_ir**: `forge script` failed to decode constructor args of a large via_ir contract ("ABI decoding failed: buffer overrun") and aborted the broadcast; we deployed that contract with a raw `cast send --create`.
- **Public RPC limits on forks**: long-running anvil forks of Base hit "archive requests require a token" and 2,000-block `eth_getLogs` limits.

## One improvement with the biggest impact
A sandbox/allowlist path for hook routing during hackathons (or a routing simulator that shows whether and when the Uniswap router would pick a given hook pool).
