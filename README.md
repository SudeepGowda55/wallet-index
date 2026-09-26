# WalletIndex

**Your wallet becomes a market maker on Uniswap v4: 1inch Aqua keeps the money in your wallet, a new SwapVM instruction prices every pair off your whole portfolio, and trades that rebalance you are charged less.**

## What it does

1. A maker keeps a basket (e.g. ETH / USDC / cbBTC) in their own wallet and picks target weights (e.g. 30 / 50 / 20).
2. The basket is shipped as a **1inch Aqua** strategy. Nothing is deposited or locked.
3. Our **native SwapVM instruction** prices any pair at the live oracle rate, then tightens the fee for trades that move the wallet toward its targets and widens it for trades that push it away. The wallet is paid to rebalance itself.
4. A **Uniswap v4 hook** makes every listed wallet reachable from a normal Uniswap pool. Each swap is quoted against all wallets and filled by the cheapest; a wallet that can't quote (stale price, out of inventory) is skipped.
5. An **agent** watches live Chainlink prices and retunes every wallet's fee on-chain as the market calms down or gets jumpy. A keeper refills the hook's working float.
6. **Aqua shared liquidity:** the same wallet also backs a plain curve on the **official, unmodified** 1inch router. One balance, two strategies, two kinds of taker, zero funds moved.

## Where the integrations are (for judges)

| Piece | File | Key lines |
|---|---|---|
| **SwapVM: new native instruction** | [src/swapvm/PortfolioSkewInstruction.sol](src/swapvm/PortfolioSkewInstruction.sol) | `_portfolioSkewXD` L61, rebalancing fee L85, oracle freshness guard L45 |
| **SwapVM: modified router** (official opcode table + 1 appended instruction = opcode 34) | [src/swapvm/WalletIndexRouter.sol](src/swapvm/WalletIndexRouter.sol) | `_instructions` L19–24 |
| **Aqua**: ship / dock / push, shared liquidity | [script/Deploy.s.sol](script/Deploy.s.sol), [script/Retune.s.sol](script/Retune.s.sol), [src/hooks/WalletIndexHook.sol](src/hooks/WalletIndexHook.sol) L95 | official Aqua `0x1111113C…a90a`, official router `0x11111133…0De` |
| **Uniswap v4 hook**: best-quote routing across wallets | [src/hooks/WalletIndexHook.sol](src/hooks/WalletIndexHook.sol) | `bestQuote` L71, `_fillFromExternalLiquidity` L82, `list/replace/delist` L45–64 |
| **Uniswap v4**: pool filled from external liquidity | [src/hooks/AsyncLiquidityHook.sol](src/hooks/AsyncLiquidityHook.sol) | `_beforeSwap` L169, `sweepClaims` L202, permissions L219 |
| Agent (live prices → on-chain retunes → sweeps) | [frontend/scripts/agent.ts](frontend/scripts/agent.ts) | |
| UI (Next.js 16 + React 19 + ethers v6) | [frontend/app/page.tsx](frontend/app/page.tsx), [frontend/components/](frontend/components/), [frontend/lib/chain.ts](frontend/lib/chain.ts) | |

Contracts used on Base mainnet: Aqua `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a`, official AquaSwapVMRouter `0x111111338c5091E8440b67B168bAe16a668AC0De`, Uniswap v4 PoolManager `0x498581fF718922c3f8e6A244956aF099B2652b2b`, Chainlink ETH/USD `0x7104…Bb70`, BTC/USD `0x07DA…A59f9D`.

## Evidence (mainnet-fork tests on real deployed contracts)

- **Direct currency crosses beat today's route** (Ethereum fork, real Uniswap v4 pools, 5-currency basket USD/EUR/JPY/CHF/SGD):

  | EUR→JPY | today (EUR→USDC→JPY on Uniswap v4) | WalletIndex (one hop) |
  |---|---|---|
  | $1k | 18 bps | 4 bps |
  | $10k | 31 bps | 7 bps |
  | $50k | 158 bps | 15 bps |

  JPY→SGD and JPY→CHF (no pool exists) fill within 0.2% of the live cross rate. Numbers are from the latest fork run and move with the market.
- **Self-rebalancing:** after a wallet is knocked off target, the helpful direction is cheaper than the harmful one (asserted in tests).
- **Competing wallets:** routing rotates to the next wallet automatically as the cheapest one rebalances.
- **Safety:** the maker's value at the oracle never drops (fuzzed); round trips always cost the taker; stale prices freeze quotes; exact-output, third-party LP and unknown tokens are rejected; float exhaustion reverts cleanly and a permissionless sweep restores it.

## Run it

Requirements: [Foundry](https://getfoundry.sh), Node 20+ (for the Next.js UI in `frontend/`, built automatically by `start_local.sh`). After cloning run `./scripts/setup.sh` (submodules + swap-vm JS deps + build).

```bash
./scripts/test_all.sh        # build + all fork tests + local environment + end-to-end check (leaves it running)
open http://localhost:8787/
./scripts/stop_local.sh      # stop the fork, agent and UI
```

### Terminal demo (real transactions, printed tx hashes)

```bash
(cd frontend && npm run demo)         
```

Walks the whole story: live price → the three wallets and their live costs → the SwapVM program with opcode 34 → a Uniswap v4 swap and which wallet filled it → routing moving to the next wallet → a direct trade on the official 1inch router from the same wallet → the agent retuning every wallet on-chain for a jumpy then calm market → a stale price freezing every wallet.

### HTTP API

```bash
curl http://localhost:8787/api/status                          # deployment, block, prices, agent's last decision
curl "http://localhost:8787/api/wallets?usd=500"                # balances, mix vs target, spread, live cost per wallet
curl "http://localhost:8787/api/quote?side=buy&usd=500"         # which wallet the Uniswap pool routes to, and the cost
curl -X POST "http://localhost:8787/api/swap?side=buy&usd=500"  # local fork: real swap through the pool (tx + who filled it)
```

Step-by-step manual validation: **[VALIDATION.md](VALIDATION.md)**.

Base mainnet (tiny sizes, ~₹1000 of inventory that stays in your wallets, ~$0.16 of gas to deploy):

```bash
cp .env.example .env   # fill in keys; makers hold small WETH/USDC/cbBTC
forge build && ./scripts/deploy_mainnet.sh
set -a; source .env; set +a; (cd frontend && NETWORK=mainnet npx tsx scripts/agent.ts)
open "http://localhost:8787/?net=mainnet"   # after: (cd frontend && npm run build && WI_ROOT=.. npx next start -p 8787)
```

## Honest notes

- **Local fork prices:** a fork's Chainlink feeds freeze at the fork block. In local mode only, the agent mirrors the live Base mainnet Chainlink answers into `MirrorFeed` contracts each tick (clearly labelled in the UI). On mainnet the real Chainlink feeds are used directly.
- **The local "simulated trader"** is our own wallet generating flow on the fork so the demo has activity; it is labelled as simulated.
- **Modified SwapVM:** 1inch's rules allow redeploying a modified SwapVM. Ours is the official Aqua opcode table unchanged plus one appended instruction, so every existing program behaves identically; the official router is also used directly for the shared-liquidity curve.
- **Reused code:** `AsyncLiquidityHook.sol` (the v4 base that fills pools from external liquidity) is reused from our earlier project Aqueduct; everything else was written for this project.
- **Not yet done:** Uniswap routing allowlisting (so real Uniswap users reach the pool) and 1inch resolver flow (Aqua incentives only count fills by 1inch's verified resolvers).
