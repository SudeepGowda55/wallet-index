"""Terminal demo: walks the whole WalletIndex story with real on-chain calls and transactions.

  python3 scripts/demo.py            # runs straight through
  PAUSE=1 python3 scripts/demo.py    # waits for Enter between steps (for presenting)

Needs the local environment running (./scripts/start_local.sh).
"""
import json, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wi

B, G, C, Y, R, D, X = "\033[1m", "\033[32m", "\033[36m", "\033[33m", "\033[31m", "\033[2m", "\033[0m"
PAUSE = os.environ.get("PAUSE") == "1"
d = wi.dep("local"); RPC = d["rpc"]; PK = d["keys"]["cli"]   # terminal/API wallet: the UI labels its actions "terminal / API"


def ui(msg):
    print(f"  {Y}>> in the UI:{X} {msg}")


def step(n, title):
    if PAUSE and n > 1: input(f"{D}  [Enter] next{X}")
    print(f"\n{B}{C}── {n}. {title} {'─' * max(0, 60 - len(title))}{X}")


def show_wallets():
    w = wi.wallets(d, 500)
    print(f"  {'wallet':7} {'ETH':>9} {'USDC':>10} {'cbBTC':>9}  {'ETH weight / target':>20}  {'spread':>6}  {'buy $500 ETH':>12}  {'sell $500 ETH':>13}")
    for x in w["wallets"]:
        buy = x["costToBuy500UsdEthBps"] if "costToBuy500UsdEthBps" in x else x.get("costToBuy500.0UsdEthBps")
        sell = x["costToSell500UsdEthBps"] if "costToSell500UsdEthBps" in x else x.get("costToSell500.0UsdEthBps")
        f = lambda v: "can't" if v is None else f"{v:.1f} bps"
        print(f"  {x['name']:7} {x['balances']['WETH']:9.4f} {x['balances']['USDC']:10.2f} {x['balances']['cbBTC']:9.5f}  "
              f"{x['ethWeightPct']:8.1f}% / {x['ethTargetPct']:4.0f}%   {x['baseSpreadBps']:4} bps  {f(buy):>12}  {f(sell):>13}")
    return w


def agent(scenario):
    env = dict(os.environ, NETWORK="local", INTERVAL="1", SCENARIO=scenario, SIM_TRADER="0")
    r = subprocess.run([sys.executable, os.path.join(wi.ROOT, "agent", "agent.py"), "1"], capture_output=True, text=True, env=env, cwd=wi.ROOT)
    for line in r.stdout.splitlines():
        if "agent ->" in line or "tick" in line or "mirrored" in line: print("  " + line.strip())


def main():
    print(f"{B}WalletIndex — terminal demo{X}  {D}(local fork of Base mainnet, real 1inch Aqua / SwapVM / Uniswap v4 / Chainlink){X}")
    print(f"  router {d['router']}  (official 1inch opcodes + our opcode 34)\n  hook   {d['hook']}  (Uniswap v4 pool filled by wallets)")

    step(1, "Live market")
    live = wi.live_eth(); px, upd = wi.feed(RPC, d["feedEth"]); blk = wi.block(RPC)
    print(f"  Base mainnet Chainlink ETH/USD right now : {B}${live['ethUsd']:,.2f}{X} (updated {live['ageSeconds']}s ago)")
    print(f"  price the wallets use on-chain           : ${px:,.2f}  (age {int(blk['timestamp'], 16) - upd}s, freshness limit {d['maxAge']}s)")

    ui("the Market panel shows the same live price and its freshness")

    step(2, "Three wallets, one Uniswap v4 pool")
    print(f"  {D}each wallet keeps its own tokens (1inch Aqua); cost is quoted live by the SwapVM instruction{X}")
    show_wallets()

    ui("the three wallet cards show the same balances, mix bars and live costs")

    step(3, "The SwapVM program of Alice's basket")
    p = wi.program(wi.listings(d)[0])
    print(f"  {D}{p['hex'][:20]}{X} {B}{C}{p['hex'][20:22]}{X} {p['hex'][22:24]} {p['hex'][24:80]}…")
    print(f"  salt #{p['salt']} · {C}opcode 0x22 = 34 = our native portfolio-skew instruction{X} (after 1inch's 34 official opcodes)")
    print(f"  base {p['base']} bps · min {p['min']} · max {p['max']} · gain {p['gain']} · price fresher than {p['maxAge']}s · targets "
          + ", ".join(f"{t} {a['targetBps'] / 100:.0f}%" for t, a in zip(("WETH", "USDC", "cbBTC"), p["assets"])))

    ui("the SwapVM panel shows the same bytes, with opcode 34 highlighted")

    step(4, "1inch Aqua shared liquidity: same wallet, second strategy, official router")
    if d.get("curveOrder"):
        dec = wi.cast("abi-decode", "f()((address,uint256,bytes))", d["curveOrder"]).strip()[1:-1]
        maker, traits, data = [x.strip() for x in dec.split(",", 2)]; traits = traits.split()[0]
        px, _ = wi.feed(RPC, d["feedEth"])
        weth0 = wi.num(wi.call(RPC, wi.WETH, "balanceOf(address)(uint256)", maker)); usdc0 = wi.num(wi.call(RPC, wi.USDC, "balanceOf(address)(uint256)", maker))
        # trade in whichever direction Alice's wallet can really fill right now
        buy = weth0 / 1e18 * px > 50
        tin, tout, amt = (wi.USDC, wi.WETH, "20000000") if buy else (wi.WETH, wi.USDC, str(int(20 / px * 1e18)))
        rc = json.loads(wi.cast("send", d["officialRouter"], f"swap({wi.ORDER_T},address,address,uint256,bytes)", f"({maker},{traits},{data})",
                                tin, tout, amt, wi.EOA_TRAITS, "--private-key", PK, "--rpc-url", RPC, "--json"))
        weth1 = wi.num(wi.call(RPC, wi.WETH, "balanceOf(address)(uint256)", maker)); usdc1 = wi.num(wi.call(RPC, wi.USDC, "balanceOf(address)(uint256)", maker))
        print(f"  direct SwapVM trade on the OFFICIAL 1inch router {d['officialRouter'][:10]}…: {G}tx {rc['transactionHash']}{X}")
        print(f"  Alice's wallet: WETH {weth0 / 1e18:.4f} -> {weth1 / 1e18:.4f}, USDC {usdc0 / 1e6:,.2f} -> {usdc1 / 1e6:,.2f}")
        print(f"  {D}the same wallet balance backs her basket (reached via Uniswap) and this plain curve; nothing was moved between them{X}")
        if buy:
            got = (weth0 - weth1) / 1e18
            print(f"  $20 USDC -> {got:.5f} ETH ({(1 - got * px / 20) * 1e4:.0f} bps vs Chainlink: a plain curve has price impact, our instruction quotes at the oracle)")
        else:
            paid = (usdc0 - usdc1) / 1e6
            print(f"  $20 of ETH -> ${paid:,.2f} USDC ({(1 - paid / 20) * 1e4:.0f} bps vs Chainlink: a plain curve has price impact, our instruction quotes at the oracle)")

    ui("a pop-up: official 1inch router trade from alice's wallet, labelled from terminal / API; the shared-liquidity panel updates")

    step(5, "A normal Uniswap v4 swap, filled from a wallet")
    q = wi.best(d, "buy", 500)
    print(f"  pool quote: best wallet {B}{q['bestWallet']}{X} gives {q['amountOut']:.5f} ETH for $500 ({q['costBps']} bps vs Chainlink)")
    s = wi.swap(d, "buy", 500, PK)
    print(f"  {G}swap tx {s['tx']}{X} (block {s['block']})")
    print(f"  filled by {B}{s['filledBy']}{X}'s wallet: {s['amountIn']:.2f} {s['amountInToken']} -> {s['amountOut']:.5f} {s['amountOutToken']}")

    ui("pop-up + highlighted row: Uniswap swap filled by that wallet, labelled from terminal / API")

    step(6, "Keep buying: routing moves to the next wallet by itself")
    seen = []
    for i in range(5):
        s = wi.swap(d, "buy", 1000, PK); seen.append(s["filledBy"])
        print(f"  buy $1,000 #{i + 1}: filled by {B}{s['filledBy']:6}{X} {D}tx {s['tx'][:18]}…{X}")
    print(f"  {D}each fill moves the wallet away from its target (or empties it), so its price rises and the pool re-routes{X}")
    print(f"  wallets used: {B}{' -> '.join(dict.fromkeys(seen))}{X}")

    ui("the green best badge moves between wallet cards and the pop-ups name who filled each swap")

    step(7, "The agent: live market -> on-chain retunes")
    print(f"  {Y}market turns jumpy (60 bps moves){X}")
    agent("60")
    show_wallets()
    print(f"  {G}market calms down (20 bps){X}")
    agent("20")
    show_wallets()

    ui("a pop-up per retune; each wallet card shows its new base spread and the Agent decisions panel logs why")

    step(8, "Safety: a stale price freezes every wallet")
    snap = wi.cast("rpc", "evm_snapshot", "--rpc-url", RPC).strip('"')
    wi.cast("rpc", "evm_increaseTime", "7200", "--rpc-url", RPC); wi.cast("rpc", "evm_mine", "--rpc-url", RPC)
    q = wi.best(d, "buy", 500)
    print(f"  price made 2 hours old -> pool quote fillable: {R if not q['fillable'] else G}{q['fillable']}{X} (every wallet refuses to quote)")
    wi.cast("rpc", "evm_revert", snap, "--rpc-url", RPC)
    q = wi.best(d, "buy", 500)
    print(f"  price fresh again     -> pool quote fillable: {G}{q['fillable']}{X} (best: {q.get('bestWallet')})")

    ui("the freshness readout went red, then green again (the snapshot was reverted)")
    print(f"\n{B}{G}Done.{X} UI: http://localhost:8787/   API: curl http://localhost:8787/api/status")


def pause_background_agent():
    pid = os.path.join(wi.ROOT, ".run", "agent.pid")
    if os.path.exists(pid):
        subprocess.run(["kill", open(pid).read().strip()], capture_output=True); os.remove(pid)
        return True
    return False


def resume_background_agent():
    log = open(os.path.join(wi.ROOT, ".run", "agent.log"), "a")
    p = subprocess.Popen([sys.executable, os.path.join(wi.ROOT, "agent", "agent.py")], cwd=wi.ROOT, stdout=log, stderr=log,
                         env=dict(os.environ, NETWORK="local", INTERVAL=os.environ.get("INTERVAL", "30")), start_new_session=True)
    open(os.path.join(wi.ROOT, ".run", "agent.pid"), "w").write(str(p.pid))


if __name__ == "__main__":
    was_running = pause_background_agent()
    try:
        main()
    finally:
        if was_running: resume_background_agent()
