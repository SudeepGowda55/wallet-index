# How to validate everything

Every check below runs against **real deployed contracts** (1inch Aqua, SwapVM, Uniswap v4, Chainlink, real tokens) on forks of Base / Ethereum mainnet, or on Base mainnet itself.

## 0. Prerequisites

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup   # forge, cast, anvil
python3 --version                                           # 3.9+
cd walletindex && forge build
```

Public RPCs work but are rate-limited; for reliability set your own (free Alchemy/QuickNode keys work):

```bash
export BASE_RPC=https://base-mainnet.g.alchemy.com/v2/<key>
export ETH_RPC=https://eth-mainnet.g.alchemy.com/v2/<key>
```

## 1. One command

```bash
./scripts/test_all.sh
```

Expected ending:

```
Ran 5 test suites ...: 25 tests passed, 0 failed
  [PASS] agent read live Base mainnet prices every tick
  [PASS] agent retuned wallets on-chain when the market regime changed (12 retunes)
  [PASS] spreads end at the 'normal' regime (8/10/12 bps)
  [PASS] simulated trader's swaps filled through the Uniswap v4 pool
  [PASS] hook Replaced events on-chain for every retune
  [PASS] hook Filled events on-chain for the swaps
  [PASS] UI server serves / ...
ALL CHECKS PASSED.
```

The local environment keeps running afterwards: fork RPC `http://127.0.0.1:8545`, UI `http://localhost:8787/`.

## 2. The test suites, one by one

```bash
forge test --match-contract NativeInstructionTest -vv   # the new SwapVM instruction
forge test --match-contract WalletIndexHookTest -vv     # Uniswap v4 pool filled by competing wallets
forge test --match-contract SharedLiquidityTest -vv     # one wallet, two strategies (ours + official 1inch router)
forge test --match-contract RealDeploymentTest -vv      # hook deployed via the real CREATE2 deployer, pool initialised
forge test --match-contract FxEvidenceEthereumTest -vv  # EUR->JPY direct vs real two-hop, crosses with no pool
```

| Suite | What it proves |
|---|---|
| NativeInstruction | opcode 34 appended after 1inch's 34; quote == swap with real transfers; symmetric on target; wallet steers itself back (helpful < on-target < harmful); direct cbBTC→ETH cross; stale price freezes quotes; unknown token / exact-out / over-allocation rejected; fuzz: spread stays in bounds, maker never loses value at the oracle, round trips always cost the taker |
| WalletIndexHook | cheapest wallet wins and routing rotates to the next as it rebalances; Uniswap swapper gets near-oracle price both ways; list/replace/delist are maker-only; stale prices skip every wallet and the swap reverts; float exhaustion reverts cleanly and a permissionless sweep restores it; third-party LP blocked; exact-output rejected; fuzz: no value extraction from wallets |
| SharedLiquidity | the same WETH is allocated 200% across two strategies; a Uniswap swapper and a direct taker on the **official** 1inch router both fill from the same balance; over-commitment fails safe |
| RealDeployment | hook deploys at a flag-valid mined address through the canonical CREATE2 deployer with no cheatcodes; the real PoolManager accepts the pool |
| FxEvidenceEthereum | prints today's two-hop cost vs the basket for $1k/$10k/$50k; JPY→SGD and JPY→CHF fill within 0.2% of the live rate |

## 3. The live local environment

```bash
./scripts/start_local.sh     # fresh fork + funded wallets + real-tx deployment + agent + UI (keeps running)
tail -f .run/agent.log       # the agent's ticks: live prices, decisions, retunes, sweeps, simulated trades
./scripts/stop_local.sh
```

In the UI (`http://localhost:8787/`) check:

1. **Market**: live Base mainnet ETH/USD, the price the wallets use, and its freshness (green = fresh).
2. **Wallet cards**: balances, ETH weight vs target, the base spread the agent set, the live cost to buy/sell $500 at each wallet; the cheapest is highlighted.
3. Press **Buy ETH** / **Sell ETH**: the swap goes through the Uniswap v4 pool; the message says which wallet filled it. Repeat and watch routing move to another wallet as the first one rebalances.
4. **Shared liquidity panel**: Alice's WETH is allocated >100% across two strategies. Press **Buy directly on the official 1inch router**: it fills from the same wallet.
5. **SwapVM program**: the salt, opcode 34 and the decoded arguments (spreads, freshness limit, targets).
6. **Activity**: on-chain fills and strategy replacements (left), agent decisions (right).

Browser check (Playwright, optional, needs Node):

```bash
npm i playwright@1 && npx playwright install chromium
node scripts/ui_check.js    # clicks Buy / Sell / official-router trade, checks console + mobile, screenshots in .run/
```

Force the agent through market regimes to see on-chain retunes immediately:

```bash
kill $(cat .run/agent.pid)
NETWORK=local INTERVAL=5 SCENARIO="5,60,5,20" python3 agent/agent.py 4   # calm, jumpy, calm, normal
```

Verify anything on-chain yourself with `cast`:

```bash
R=http://127.0.0.1:8545; HOOK=$(python3 -c "import json;print(json.load(open('deployments/local.json'))['hook'])")
cast call $HOOK "count()(uint256)" --rpc-url $R
cast call $HOOK "bestQuote(address,address,uint256)(uint256,uint256)" 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0x4200000000000000000000000000000000000006 500000000 --rpc-url $R
```

## 4. Terminal demo and API

```bash
python3 scripts/demo.py                                         # 8 steps, real transactions, tx hashes printed
curl http://localhost:8787/api/status
curl "http://localhost:8787/api/wallets?usd=500"
curl "http://localhost:8787/api/quote?side=buy&usd=500"
curl -X POST "http://localhost:8787/api/swap?side=buy&usd=500"  # returns the tx hash and which wallet filled it
```

The demo pauses the background agent while it runs and restarts it afterwards.

## 5. Base mainnet

See the README. Dry-run the exact mainnet script against the local fork first (`RPC_URL=http://127.0.0.1:8545 NETNAME=dryrun ./scripts/deploy_mainnet.sh` with funded test keys). Measured: full deployment ≈ 5.2M gas (~$0.16 at 0.006 gwei), one wallet retune ≈ 70k–200k gas (<$0.01).

## 6. Supporting evidence scripts

```bash
python3 analysis/fx_pool_overpay.py 6   # what real FX-stablecoin swappers paid vs the FX rate on today's pools
```

## Known limits

- Public RPCs throttle; a long-running fork needs an RPC that serves older state (Alchemy/QuickNode). If the fork errors with "archive" or "range" messages, restart with `./scripts/start_local.sh`.
- The FX evidence test runs on Ethereum mainnet state and prints live numbers, which change with the market.
