# Live demo run-of-show (≈4 minutes, split screen)

**Left:** terminal. **Right:** browser at `http://localhost:8787/`.
Every action fired from the terminal shows up in the UI as a pop-up and a highlighted row labelled **"from terminal / API"**; every UI click shows up in the terminal/API.

Before going on stage: `./scripts/start_local.sh` (or the mainnet deployment), open the UI, `clear` the terminal.

| # | Where | Do | Say |
|---|---|---|---|
| 1 | **UI** | Point at *Market* and the three wallet cards | "Three wallets. Their money never leaves them: 1inch Aqua. Live Base Chainlink price, freshness in green. Each card shows the wallet's mix vs its target and what it charges right now." |
| 2 | **Terminal** | `curl -s localhost:8787/api/quote?side=buy\&usd=500 \| jq` | "Same thing from the API: the Uniswap pool would route a $500 buy to this wallet at this cost." |
| 3 | **Terminal** | `curl -s -X POST localhost:8787/api/swap?side=buy\&usd=500 \| jq` | "A real swap through a Uniswap v4 pool. Here's the transaction and the wallet that filled it." |
| 4 | **UI** | Point at the pop-up *"from terminal / API"*, the highlighted row, the wallet card's new mix | "The UI saw it land: the wallet's mix moved, so its prices moved. It now charges more for the direction that pushes it further off target and less for the direction that brings it back." |
| 5 | **UI** | Click **Buy ETH** 3–4 times | "Watch the green *best* badge. As one wallet fills up it gets pricier and the pool re-routes to the next wallet by itself." |
| 6 | **Terminal** | `curl -s localhost:8787/api/wallets \| jq '.wallets[] \| {name, ethWeightPct, ethTargetPct}'` | "The API confirms the rebalancing the UI just showed." |
| 7 | **UI** | Point at the *SwapVM program* panel | "This is the actual SwapVM bytecode: a salt, then opcode 34, our new instruction added to 1inch's VM, then the wallet's settings." |
| 8 | **UI** | Click **Buy directly on the official 1inch router** | "Same wallet, a second strategy, 1inch's own unmodified router. One balance backs both. Nothing moved between them." |
| 9 | **Terminal** | `pkill -f scripts/agent.ts; (cd frontend && NETWORK=local INTERVAL=3 SCENARIO=60,20 npx tsx scripts/agent.ts 2)` | "The agent reads live Base prices. Jumpy market: it widens every wallet's fee on-chain. Calm: back to normal." |
| 10 | **UI** | Pop-ups *"Retune … from agent"*, the spreads on the cards, the *Agent decisions* panel | "Every retune is a real Aqua transaction: retire the old strategy, ship the new one, swap the listing. The cards show the new fees." |
| 11 | **Terminal** | `(cd frontend && npm run stale-demo)` | "And if the price ever goes stale, every wallet refuses to quote: nobody can trade against an old price. Fresh again: trading resumes." |
| 12 | **Terminal** | `(cd frontend && NETWORK=local nohup node --import tsx scripts/agent.ts >> ../.run/agent.log 2>&1 & echo $! > ../.run/agent.pid)` | (restart the background agent) |

**Fallback / scripted version:** `PAUSE=1 (cd frontend && npm run demo)` walks all 8 steps in the terminal with the same UI cues printed after each one ("`>> in the UI: …`").

**Evidence slide (recorded, not live):** EUR→JPY on real Ethereum state: $50k costs 158 bps via today's two-hop route vs 15 bps from a WalletIndex basket; JPY→SGD / JPY→CHF (no pool exists) fill within 0.2% of the live rate. Run `forge test --match-contract FxEvidenceEthereumTest -vv` to reproduce.
