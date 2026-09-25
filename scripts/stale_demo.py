"""Safety moment for the live demo: make the price 2 hours old on the fork -> every wallet refuses to quote -> restore."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wi
d = wi.dep("local"); R = d["rpc"]
snap = wi.cast("rpc", "evm_snapshot", "--rpc-url", R).strip('"')
wi.cast("rpc", "evm_increaseTime", "7200", "--rpc-url", R); wi.cast("rpc", "evm_mine", "--rpc-url", R)
q = wi.best(d, "buy", 500)
print(f"price made 2 hours old -> can the pool fill a $500 buy? {q['fillable']}  (every wallet refuses to quote on a stale price)")
wi.cast("rpc", "evm_revert", snap, "--rpc-url", R)
q = wi.best(d, "buy", 500)
print(f"price fresh again      -> can the pool fill a $500 buy? {q['fillable']}  (best: {q.get('bestWallet')}, {q.get('costBps')} bps)")
