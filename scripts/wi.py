"""Shared on-chain helpers for the terminal demo (scripts/demo.py) and the HTTP API (scripts/serve.py)."""
import json, os, subprocess, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
WETH = "0x4200000000000000000000000000000000000006"
CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"
LIVE_RPC = os.environ.get("LIVE_RPC", "https://mainnet.base.org")
LIVE_ETH = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"
EOA_TRAITS = "0x00000000000000000000000000000000000000000041"
ORDER_T = "(address,uint256,bytes)"
MAX_SQRT = "1461446703485210103287273052203988822378723970341"
MIN_SQRT = "4295128740"
FILLED_TOPIC = None


def dep(net="local"):
    return json.load(open(os.path.join(ROOT, "deployments", f"{net}.json")))


def state(net="local"):
    p = os.path.join(ROOT, "deployments", f"{net}.state.json")
    return json.load(open(p)) if os.path.exists(p) else None


def cast(*args):
    r = subprocess.run(["cast", *args], capture_output=True, text=True, cwd=ROOT)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "cast failed")
    return r.stdout.strip()


def call(rpc, to, sig, *args, sender=None):
    extra = ["--from", sender] if sender else []
    return cast("call", to, sig, *args, "--rpc-url", rpc, *extra)


def num(s):
    return int(s.split()[0])


def feed(rpc, f):
    parts = call(rpc, f, "latestRoundData()(uint80,int256,uint256,uint256,uint80)").split("\n")
    return num(parts[1]) / 1e8, num(parts[3])


def block(rpc):
    return json.loads(cast("block", "latest", "--json", "--rpc-url", rpc))


def listings(d):
    n = num(call(d["rpc"], d["hook"], "count()(uint256)"))
    out = []
    for i in range(n):
        raw = cast("call", d["hook"], "listing(uint256)", str(i), "--rpc-url", d["rpc"])
        maker, traits, data, active = decode_listing(raw)
        out.append({"id": i, "maker": maker, "traits": traits, "data": data, "active": active})
    return out


def decode_listing(raw):
    dec = cast("abi-decode", "f()((address,uint256,bytes),bool)", raw)
    lines = dec.split("\n")
    inner = lines[0].strip()[1:-1]
    maker, traits, data = [x.strip() for x in inner.split(",", 2)]
    traits = traits.split()[0]
    return maker, traits, data, lines[1].strip() == "true"


def order_arg(l):
    return f"({l['maker']},{l['traits']},{l['data']})"


def program(l):
    """Find salt + opcode 34 + args inside the order data."""
    h = l["data"][2:].lower()
    import re
    m = re.search(r"1408([0-9a-f]{16})22([0-9a-f]{2})", h)
    if not m:
        return None
    i = m.start(); ln = int(m.group(2), 16); args = h[i + 24:i + 24 + ln * 2]
    g = lambda a, b: int(args[a * 2:b * 2], 16)
    assets = [{"token": "0x" + args[o * 2:o * 2 + 40], "targetBps": g(o + 41, o + 43)} for o in range(14, ln - 42, 43)]
    return {"hex": h[i:i + 24 + ln * 2], "salt": int(m.group(1), 16), "opcode": 34, "base": g(0, 2), "min": g(2, 4), "max": g(4, 6),
            "gain": g(6, 10), "maxAge": g(10, 14), "assets": assets}


def balances(d, who):
    return {t: num(call(d["rpc"], a, "balanceOf(address)(uint256)", who)) for t, a in (("WETH", WETH), ("USDC", USDC), ("cbBTC", CBBTC))}


def quote(d, l, tin, tout, amt, sender):
    try:
        out = call(d["rpc"], d["router"], f"quote({ORDER_T},address,address,uint256,bytes)(uint256,uint256,bytes32)",
                   order_arg(l), tin, tout, str(amt), EOA_TRAITS, sender=sender).split("\n")
        return num(out[1])
    except Exception:
        return None


def wallets(d, usd=500):
    eth_px, _ = feed(d["rpc"], d["feedEth"]); btc_px, _ = feed(d["rpc"], d["feedBtc"])
    buy_amt = int(usd * 1e6); sell_amt = int(usd / eth_px * 1e18)
    res = []
    for l in listings(d):
        m = d["makers"][l["id"]] if l["id"] < len(d["makers"]) else {"name": f"maker{l['id']}"}
        b = balances(d, l["maker"])
        v = {"WETH": b["WETH"] / 1e18 * eth_px, "USDC": b["USDC"] / 1e6, "cbBTC": b["cbBTC"] / 1e8 * btc_px}
        tot = sum(v.values()) or 1
        p = program(l)
        qb = quote(d, l, USDC, WETH, buy_amt, d["trader"]); qs = quote(d, l, WETH, USDC, sell_amt, d["trader"])
        res.append({
            "id": l["id"], "name": m["name"], "address": l["maker"], "listed": l["active"],
            "balances": {"WETH": b["WETH"] / 1e18, "USDC": b["USDC"] / 1e6, "cbBTC": b["cbBTC"] / 1e8},
            "valueUsd": round(tot, 2), "ethWeightPct": round(v["WETH"] / tot * 100, 2),
            "ethTargetPct": (p["assets"][0]["targetBps"] / 100) if p else None,
            "baseSpreadBps": p["base"] if p else None, "strategyNumber": p["salt"] if p else None,
            f"costToBuy{usd}UsdEthBps": None if qb is None else round((1 - qb / 1e18 / (usd / eth_px)) * 1e4, 1),
            f"costToSell{usd}UsdEthBps": None if qs is None else round((1 - qs / 1e6 / usd) * 1e4, 1),
        })
    return {"ethUsd": eth_px, "btcUsd": btc_px, "wallets": res}


def best(d, side, usd):
    eth_px, _ = feed(d["rpc"], d["feedEth"])
    tin, tout, amt = (USDC, WETH, int(usd * 1e6)) if side == "buy" else (WETH, USDC, int(usd / eth_px * 1e18))
    out = call(d["rpc"], d["hook"], "bestQuote(address,address,uint256)(uint256,uint256)", tin, tout, str(amt)).split("\n")
    i, o = num(out[0]), num(out[1])
    if o == 0:
        return {"side": side, "usd": usd, "fillable": False}
    got = o / 1e18 if side == "buy" else o / 1e6
    cost = (1 - got / (usd / eth_px)) * 1e4 if side == "buy" else (1 - got / usd) * 1e4
    return {"side": side, "usd": usd, "fillable": True, "bestWallet": d["makers"][i]["name"] if i < len(d["makers"]) else i,
            "amountOut": got, "amountOutToken": "WETH" if side == "buy" else "USDC", "costBps": round(cost, 1), "oracleEthUsd": eth_px}


PM = "0x498581fF718922c3f8e6A244956aF099B2652b2b"


def keeper_sweep(d):
    """Permissionless keeper call: convert the hook's settled claims back into its working float."""
    pk = (d.get("keys") or {}).get("deployer") or os.environ.get("DEPLOYER_PK")
    if not pk:
        return []
    swept = []
    for tok, name in ((USDC, "USDC"), (WETH, "WETH")):
        c = num(call(d["rpc"], PM, "balanceOf(address,uint256)(uint256)", d["hook"], str(int(tok, 16))))
        if c > 0:
            cast("send", d["hook"], "sweepClaims(address,uint256)", tok, str(c), "--private-key", pk, "--rpc-url", d["rpc"])
            swept.append(name)
    return swept


def swap(d, side, usd, pk):
    """Real swap through the Uniswap v4 pool; returns tx hash and which wallet filled it."""
    keeper_sweep(d)
    eth_px, _ = feed(d["rpc"], d["feedEth"])
    key = f"({WETH},{USDC},0,10,{d['hook']})"
    if side == "buy":
        params = f"(false,-{int(usd * 1e6)},{MAX_SQRT})"
    else:
        params = f"(true,-{int(usd / eth_px * 1e18)},{MIN_SQRT})"
    rc = json.loads(cast("send", d["swapper"], "swap((address,address,uint24,int24,address),(bool,int256,uint160),(bool,bool),bytes)",
                         key, params, "(false,false)", "0x", "--private-key", pk, "--rpc-url", d["rpc"], "--json"))
    return {"tx": rc["transactionHash"], "block": int(rc["blockNumber"], 16), "status": int(rc["status"], 16), **filled_from(d, rc)}


def filled_from(d, rc):
    topic = cast("keccak", "Filled(uint256,address,address,address,uint256,uint256)")
    for lg in rc.get("logs", []):
        if lg["address"].lower() == d["hook"].lower() and lg["topics"][0] == topic:
            wid = int(lg["topics"][1], 16)
            data = lg["data"][2:]
            tin = "0x" + data[24:64]; ain = int(data[128:192], 16); aout = int(data[192:256], 16)
            buy = tin.lower() == USDC.lower()
            return {"filledBy": d["makers"][wid]["name"] if wid < len(d["makers"]) else wid,
                    "amountIn": ain / (1e6 if buy else 1e18), "amountInToken": "USDC" if buy else "WETH",
                    "amountOut": aout / (1e18 if buy else 1e6), "amountOutToken": "WETH" if buy else "USDC"}
    return {"filledBy": None}


def live_eth():
    try:
        px, upd = feed(LIVE_RPC, LIVE_ETH)
        return {"ethUsd": px, "ageSeconds": int(time.time()) - upd}
    except Exception as e:
        return {"error": str(e)}
