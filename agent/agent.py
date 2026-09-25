"""WalletIndex agent: watches the live market and manages every maker wallet on-chain.

Each tick:
  1. reads live Base mainnet Chainlink ETH/USD + BTC/USD (price, recent volatility, age)
  2. local mode only: pushes those live answers into the fork's MirrorFeeds so the fork tracks the real market
  3. decides each wallet's base spread from volatility (calm -> tighter, jumpy -> wider)
  4. retunes on-chain when the decision changes (Aqua dock + ship fresh strategy + hook.replace)
  5. sweeps the hook's settled claims back into its working float
  6. optional (local mode): a clearly labelled simulated trader swaps through the Uniswap pool
  7. writes deployments/<net>.state.json for the UI
"""
import json, os, subprocess, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NET = os.environ.get("NETWORK", "local")
DEP = json.load(open(os.path.join(ROOT, "deployments", f"{NET}.json")))
RPC = DEP["rpc"]; LIVE = os.environ.get("LIVE_RPC", "https://mainnet.base.org")
STATE = os.path.join(ROOT, "deployments", f"{NET}.state.json")
USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; WETH = "0x4200000000000000000000000000000000000006"
LIVE_ETH = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"; LIVE_BTC = "0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D"
PM = "0x498581fF718922c3f8e6A244956aF099B2652b2b"
# local: dev keys live in the deployment file. mainnet: keys only ever come from the environment (.env), never from files.
KEYS = DEP.get("keys") or {"deployer": os.environ["DEPLOYER_PK"], "makers": [os.environ["MAKER1_PK"], os.environ["MAKER2_PK"], os.environ["MAKER3_PK"]], "trader": os.environ.get("TRADER_PK", "")}
NAMES = ["alice", "bob", "carol"]; DEFAULT_BASE = [8, 10, 12]

def sh(*a, env=None):
    r = subprocess.run(a, capture_output=True, text=True, env=env, cwd=ROOT)
    return r.stdout.strip(), r.returncode, r.stderr.strip()

def call(to, sig, *args, rpc=None):
    out, _, _ = sh("cast", "call", to, sig, *args, "--rpc-url", rpc or RPC)
    return out

def send(pk, to, sig, *args):
    _, rc, err = sh("cast", "send", to, sig, *args, "--private-key", pk, "--rpc-url", RPC)
    return rc == 0, err

def round_data(feed, rpc, rid=None):
    sig = "latestRoundData()(uint80,int256,uint256,uint256,uint80)" if rid is None else "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)"
    parts = call(feed, sig, *([] if rid is None else [str(rid)]), rpc=rpc).split("\n")
    return int(parts[0].split()[0]), int(parts[1].split()[0]), int(parts[3].split()[0])

def live_market():
    rid, eth, upd = round_data(LIVE_ETH, LIVE)
    prices = [eth]
    for k in range(1, 8):
        try: prices.append(round_data(LIVE_ETH, LIVE, rid - k)[1])
        except Exception: break
    move = max(abs(prices[i] / prices[i + 1] - 1) * 1e4 for i in range(len(prices) - 1)) if len(prices) > 1 else 0.0
    _, btc, _ = round_data(LIVE_BTC, LIVE)
    return {"eth": eth, "btc": btc, "move_bps": round(move, 1), "age_s": int(time.time()) - upd}

def decide(move_bps, default):
    if move_bps < 15: return max(4, default - 4), "calm market -> tighten"
    if move_bps < 40: return default, "normal market -> default"
    return default + 10, "jumpy market -> widen to avoid being picked off"

def load_state():
    if os.path.exists(STATE): return json.load(open(STATE))
    return {"makers": [{"name": n, "base": b, "salt": 1, "listing": i} for i, (n, b) in enumerate(zip(NAMES, DEFAULT_BASE))], "events": []}

def retune(i, m, new_base):
    env = dict(os.environ, MAKER_PK=KEYS["makers"][i], MAKER_INDEX=str(i), LISTING_ID=str(m["listing"]), ROUTER=DEP["router"], HOOK=DEP["hook"],
               FEED_ETH=DEP["feedEth"], FEED_BTC=DEP["feedBtc"], MAX_AGE=str(DEP["maxAge"]),
               OLD_BASE=str(m["base"]), OLD_SALT=str(m["salt"]), NEW_BASE=str(new_base), NEW_SALT=str(m["salt"] + 1))
    out, rc, err = sh("forge", "script", "script/Retune.s.sol", "--rpc-url", RPC, "--broadcast", env=env)
    ok = "ONCHAIN EXECUTION COMPLETE & SUCCESSFUL" in out
    if ok: m["base"], m["salt"] = new_base, m["salt"] + 1
    return ok

def sweep():
    swept = []
    for tok, name in ((USDC, "USDC"), (WETH, "WETH")):
        c = int(call(PM, "balanceOf(address,uint256)(uint256)", DEP["hook"], str(int(tok, 16))).split()[0])
        if c > 0 and send(KEYS["deployer"], DEP["hook"], "sweepClaims(address,uint256)", tok, str(c))[0]: swept.append((name, c))
    return swept

KEY = f"({WETH},{USDC},0,10,{'{hook}'})"
def simulated_trade(tick, eth_px):
    key = KEY.replace("{hook}", DEP["hook"])
    if tick % 2 == 0:
        ok, err = send(KEYS["trader"], DEP["swapper"], "swap((address,address,uint24,int24,address),(bool,int256,uint160),(bool,bool),bytes)",
                       key, "(false,-500000000,1461446703485210103287273052203988822378723970341)", "(false,false)", "0x")
        return ("buy $500 of ETH", ok)
    amt = int(500 * 1e18 * 1e8 / eth_px)
    ok, err = send(KEYS["trader"], DEP["swapper"], "swap((address,address,uint24,int24,address),(bool,int256,uint160),(bool,bool),bytes)",
                   key, f"(true,-{amt},4295128740)", "(false,false)", "0x")
    return ("sell $500 of ETH", ok)

def main():
    ticks = int(sys.argv[1]) if len(sys.argv) > 1 else 10**9
    interval = int(os.environ.get("INTERVAL", "30"))
    scenario = [float(x) for x in os.environ["SCENARIO"].split(",")] if os.environ.get("SCENARIO") else None
    st = load_state()
    st.setdefault("updated", int(time.time())); json.dump(st, open(STATE, "w"), indent=1)   # UI has a state file from the first second
    for tick in range(ticks):
        ev = {"t": int(time.time()), "tick": tick}
        mk = live_market(); ev["live"] = mk
        if scenario: mk["move_bps"] = scenario[min(tick, len(scenario) - 1)]; ev["scenario"] = mk["move_bps"]
        print(f"[tick {tick}] LIVE Base ETH/USD ${mk['eth']/1e8:,.2f} BTC/USD ${mk['btc']/1e8:,.0f} | recent move {mk['move_bps']} bps | oracle age {mk['age_s']}s"
              + (" (scenario)" if scenario else ""), flush=True)
        if DEP.get("mirror"):
            send(KEYS["deployer"], DEP["feedEth"], "push(int256)", str(mk["eth"])); send(KEYS["deployer"], DEP["feedBtc"], "push(int256)", str(mk["btc"]))
            print("   mirrored live Chainlink ETH & BTC into the fork's MirrorFeeds", flush=True)
        ev["decisions"] = []
        for i, m in enumerate(st["makers"]):
            want, why = decide(mk["move_bps"], DEFAULT_BASE[i])
            if want != m["base"]:
                old = m["base"]; ok = retune(i, m, want)
                print(f"   agent -> {m['name']}: {old} -> {want} bps ({why}) {'retuned on-chain' if ok else 'RETUNE FAILED'}", flush=True)
                ev["decisions"].append({"maker": m["name"], "from": old, "to": want, "why": why, "ok": ok})
            else:
                print(f"   agent -> {m['name']}: keep {m['base']} bps", flush=True)
        sw = sweep(); ev["swept"] = sw
        for n, c in sw: print(f"   keeper swept {c} {n} claims back into the hook float", flush=True)
        if NET == "local" and os.environ.get("SIM_TRADER", "1") == "1":
            what, ok = simulated_trade(tick, mk["eth"]); ev["trade"] = {"what": what, "ok": ok}
            print(f"   simulated trader: {what} through the Uniswap v4 pool -> {'filled' if ok else 'FAILED'}", flush=True)
        st["events"] = (st.get("events", []) + [ev])[-50:]
        st["makers"] = st["makers"]; st["updated"] = int(time.time())
        json.dump(st, open(STATE, "w"), indent=1)
        if tick + 1 < ticks: time.sleep(interval)

if __name__ == "__main__":
    main()
