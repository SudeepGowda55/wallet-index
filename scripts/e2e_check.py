"""End-to-end check against the running local environment (scripts/start_local.sh).
Runs the real agent for 4 scripted ticks (calm, jumpy, calm, normal) and verifies on-chain:
retunes landed (hook Replaced events, new strategies quoted at the new spread), simulated trades filled
through the Uniswap v4 pool (hook Filled events), keeper sweeps, UI + deployment file served."""
import json, os, subprocess, sys, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEP = json.load(open(os.path.join(ROOT, "deployments", "local.json"))); R = DEP["rpc"]
ok_all = True
def check(name, cond, detail=""):
    global ok_all
    ok_all &= bool(cond); print(f"  [{'PASS' if cond else 'FAIL'}] {name} {detail}")
def logs(topic):
    blk = int(subprocess.run(["cast", "block-number", "--rpc-url", R], capture_output=True, text=True).stdout)
    out = subprocess.run(["cast", "logs", "--from-block", str(DEP["deployBlock"]), "--to-block", str(blk), "--address", DEP["hook"], topic, "--rpc-url", R, "--json"], capture_output=True, text=True).stdout
    return json.loads(out or "[]")

before_rep = len(logs("Replaced(uint256,address)")); before_fill = len(logs("Filled(uint256,address,address,address,uint256,uint256)"))
env = dict(os.environ, NETWORK="local", INTERVAL="1", SCENARIO="5,60,5,20")
r = subprocess.run([sys.executable, os.path.join(ROOT, "agent", "agent.py"), "4"], capture_output=True, text=True, env=env, cwd=ROOT)
print(r.stdout)
st = json.load(open(os.path.join(ROOT, "deployments", "local.state.json")))
evs = st["events"][-4:]
decs = [d for e in evs for d in e.get("decisions", [])]
check("agent read live Base mainnet prices every tick", all(e["live"]["eth"] > 0 for e in evs))
check("agent retuned wallets on-chain when the market regime changed", len(decs) >= 9 and all(d["ok"] for d in decs), f"({len(decs)} retunes)")
check("spreads end at the 'normal' regime (8/10/12 bps)", [m["base"] for m in st["makers"]] == [8, 10, 12], str([m["base"] for m in st["makers"]]))
check("simulated trader's swaps filled through the Uniswap v4 pool", all(e.get("trade", {}).get("ok") for e in evs))
after_rep = len(logs("Replaced(uint256,address)")); after_fill = len(logs("Filled(uint256,address,address,address,uint256,uint256)"))
check("hook Replaced events on-chain for every retune", after_rep - before_rep >= len(decs), f"(+{after_rep - before_rep})")
check("hook Filled events on-chain for the swaps", after_fill - before_fill >= 4, f"(+{after_fill - before_fill})")
for path in ("", "deployments/local.json", "deployments/local.state.json"):
    try: code = urllib.request.urlopen(f"http://localhost:{os.environ.get('UI_PORT','8787')}/{path}", timeout=5).status
    except Exception as e: code = str(e)
    check(f"UI server serves /{path}", code == 200)
base = f"http://localhost:{os.environ.get('UI_PORT','8787')}"
def api(path, method="GET"):
    req = urllib.request.Request(base + path, method=method)
    return json.loads(urllib.request.urlopen(req, timeout=60).read())
try:
    st_api = api("/api/status"); check("API /api/status returns block + prices", st_api.get("block", 0) > 0 and st_api.get("walletsPriceEthUsd", 0) > 0)
    w = api("/api/wallets?usd=500"); check("API /api/wallets returns 3 wallets", len(w.get("wallets", [])) == 3)
    q = api("/api/quote?side=buy&usd=500"); check("API /api/quote finds a fillable wallet", q.get("fillable") is True, f"(best: {q.get('bestWallet')}, {q.get('costBps')} bps)")
    sw = api("/api/swap?side=sell&usd=300", "POST"); check("API POST /api/swap executes a real swap", sw.get("status") == 1 and sw.get("filledBy"), f"(tx {str(sw.get('tx'))[:14]}..., filled by {sw.get('filledBy')})")
except Exception as e:
    check("API endpoints", False, str(e))
print("\nEND-TO-END:", "ALL PASS" if ok_all else "FAILURES ABOVE")
sys.exit(0 if ok_all else 1)
