/* End-to-end check against the running local environment: runs the real agent for 4 scripted ticks
 * (calm, jumpy, calm, normal) and verifies on-chain retunes + swaps, the UI and every API endpoint. */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { DEPLOYMENTS, ROOT, chainFor } from "../lib/server";

const UI = `http://localhost:${process.env.UI_PORT || "8787"}`;
let okAll = true;
const check = (name: string, cond: any, detail = "") => { okAll &&= !!cond; console.log(`  [${cond ? "PASS" : "FAIL"}] ${name} ${detail}`); };

(async () => {
  const c = chainFor("local"), from = c.dep.deployBlock;
  // fresh connection per count: a long-lived provider can serve a cached block number after forge broadcasts
  const count = async (n: "Replaced" | "Filled") => { const h = chainFor("local").hook; return (await h.queryFilter((h.filters as any)[n](), from, "latest")).length; };
  const rep0 = await count("Replaced"), fill0 = await count("Filled");
  const r = spawnSync("npx", ["tsx", "scripts/agent.ts", "4"], { cwd: path.join(ROOT, "frontend"), encoding: "utf8", env: { ...process.env, NETWORK: "local", INTERVAL: "1", SCENARIO: "5,60,5,20" } });
  console.log(r.stdout);
  const st = JSON.parse(fs.readFileSync(path.join(DEPLOYMENTS, "local.state.json"), "utf8")), evs = st.events.slice(-4), decs = evs.flatMap((e: any) => e.decisions || []);
  check("agent read live Base mainnet prices every tick", evs.every((e: any) => e.live.eth > 0));
  check("agent retuned wallets on-chain when the market regime changed", decs.length >= 9 && decs.every((d: any) => d.ok), `(${decs.length} retunes)`);
  check("spreads end at the 'normal' regime (8/10/12 bps)", st.makers.map((m: any) => m.base).join() === "8,10,12", `[${st.makers.map((m: any) => m.base)}]`);
  check("simulated trader's swaps filled through the Uniswap v4 pool", evs.every((e: any) => e.trade?.ok));
  const rep1 = await count("Replaced"), fill1 = await count("Filled");
  check("hook Replaced events on-chain for every retune", rep1 - rep0 >= decs.length, `(+${rep1 - rep0})`);
  check("hook Filled events on-chain for the swaps", fill1 - fill0 >= 4, `(+${fill1 - fill0})`);
  for (const p of ["/", "/deployments/local.json", "/deployments/local.state.json"]) { const s = await fetch(UI + p).then(x => x.status).catch(() => 0); check(`UI serves ${p}`, s === 200); }
  try {
    const s = await (await fetch(UI + "/api/status")).json(); check("API /api/status returns block + prices", s.block > 0 && s.walletsPriceEthUsd > 0);
    const w = await (await fetch(UI + "/api/wallets?usd=500")).json(); check("API /api/wallets returns 3 wallets", w.wallets?.length === 3);
    const q = await (await fetch(UI + "/api/quote?side=buy&usd=500")).json(); check("API /api/quote finds a fillable wallet", q.fillable === true, `(best: ${q.bestWallet}, ${q.costBps} bps)`);
    const sw = await (await fetch(UI + "/api/swap?side=sell&usd=300", { method: "POST" })).json(); check("API POST /api/swap executes a real swap", sw.status === 1 && sw.filledBy, `(tx ${String(sw.tx).slice(0, 14)}..., filled by ${sw.filledBy})`);
  } catch (e: any) { check("API endpoints", false, e.message); }
  console.log("\nEND-TO-END:", okAll ? "ALL PASS" : "FAILURES ABOVE");
  process.exit(okAll ? 0 : 1);
})();
