/* Safety moment for the live demo: make the price 2 hours old on the fork -> every wallet refuses to quote -> restore. */
import { apiQuote, chainFor } from "../lib/server";
(async () => {
  const c = chainFor("local");
  const snap = await c.provider.send("evm_snapshot", []);
  await c.provider.send("evm_increaseTime", [7200]); await c.provider.send("evm_mine", []);
  const q1 = await apiQuote("local", "buy", 500);
  console.log(`price made 2 hours old -> can the pool fill a $500 buy? ${q1.fillable}  (every wallet refuses to quote on a stale price)`);
  await c.provider.send("evm_revert", [snap]);
  const q2: any = await apiQuote("local", "buy", 500);
  console.log(`price fresh again      -> can the pool fill a $500 buy? ${q2.fillable}  (best: ${q2.bestWallet}, ${q2.costBps} bps)`);
})().catch(e => { console.error(e); process.exit(1); });
