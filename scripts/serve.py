"""Serves the UI at http://localhost:<port>/, deployment/state files at /deployments/, and a JSON API:

  GET  /api/status                       deployment, block, prices, agent's last decision
  GET  /api/wallets?usd=500              every maker wallet: balances, mix vs target, spread, live cost to buy/sell
  GET  /api/quote?side=buy|sell&usd=500  which wallet the Uniswap pool would route to, and at what cost
  POST /api/swap?side=buy|sell&usd=500   local fork only: real swap through the Uniswap v4 pool (returns tx + who filled it)
"""
import http.server, json, os, sys, time, traceback
from urllib.parse import urlparse, parse_qs
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wi

ROOT = wi.ROOT
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787


class Handler(http.server.SimpleHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj, indent=2).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _api(self, method):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        net = q.get("net", "local"); d = wi.dep(net)
        usd = float(q.get("usd", 500)); side = q.get("side", "buy")
        if side not in ("buy", "sell"): return self._json(400, {"error": "side must be buy or sell"})
        try:
            if u.path == "/api/status" and method == "GET":
                b = wi.block(d["rpc"]); px, upd = wi.feed(d["rpc"], d["feedEth"]); st = wi.state(net)
                last = st["events"][-1] if st and st.get("events") else None
                return self._json(200, {"network": d["network"], "block": int(b["number"], 16), "router": d["router"], "hook": d["hook"],
                                        "opcode": 34, "walletsPriceEthUsd": px, "priceAgeSeconds": int(b["timestamp"], 16) - upd,
                                        "maxAgeSeconds": d["maxAge"], "liveBaseMainnet": wi.live_eth(),
                                        "agentLastTick": last})
            if u.path == "/api/wallets" and method == "GET":
                return self._json(200, wi.wallets(d, usd))
            if u.path == "/api/quote" and method == "GET":
                return self._json(200, wi.best(d, side, usd))
            if u.path == "/api/swap" and method == "POST":
                pk = (d.get("keys") or {}).get("cli")
                if not pk: return self._json(403, {"error": "swaps via API are only enabled on the local fork"})
                return self._json(200, wi.swap(d, side, usd, pk))
            return self._json(404, {"error": "unknown endpoint", "endpoints": ["GET /api/status", "GET /api/wallets", "GET /api/quote?side=buy&usd=500", "POST /api/swap?side=buy&usd=500"]})
        except Exception as e:
            return self._json(500, {"error": str(e), "trace": traceback.format_exc().splitlines()[-3:]})

    def do_GET(self):
        if self.path.startswith("/api/"): return self._api("GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"): return self._api("POST")
        self._json(405, {"error": "POST only on /api/"})

    def translate_path(self, path):
        p = path.split("?", 1)[0].split("#", 1)[0]
        if p.startswith("/deployments/"):
            return os.path.join(ROOT, "deployments", os.path.basename(p))
        name = os.path.basename(p)
        if name and os.path.isfile(os.path.join(ROOT, "ui", name)):
            return os.path.join(ROOT, "ui", name)
        return os.path.join(ROOT, "ui", "index.html")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a): pass


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
