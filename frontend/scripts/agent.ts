/* WalletIndex agent: watches the live market and manages every maker wallet on-chain.
 *   npx tsx scripts/agent.ts [ticks]       (env: NETWORK, INTERVAL, SCENARIO="5,60,20", SIM_TRADER=0|1)
 * Each tick: read live Base mainnet Chainlink (price, recent volatility, age) -> local fork: mirror it into MirrorFeeds
 * -> decide each wallet's base spread -> retune on-chain (Aqua dock + ship + hook.replace) -> keeper sweep
 * -> optional simulated trader (local only) -> write deployments/<net>.state.json for the UI and API. */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { ethers } from "ethers";
import { USDC, WETH } from "../lib/chain";
import { DEPLOYMENTS, ROOT, chainFor, keeperSweep, liveMarket, wallet } from "../lib/server";

const NET = process.env.NETWORK || "local";
const c = chainFor(NET), dep = c.dep;
const KEYS = dep.keys || { deployer: process.env.DEPLOYER_PK, makers: [process.env.MAKER1_PK, process.env.MAKER2_PK, process.env.MAKER3_PK], trader: process.env.TRADER_PK };
const STATE = path.join(DEPLOYMENTS, `${NET}.state.json`);
const NAMES = ["alice", "bob", "carol"], DEFAULT_BASE = [8, 10, 12];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function decide(move: number, def: number): [number, string] {
  if (move < 15) return [Math.max(4, def - 4), "calm market -> tighten"];
  if (move < 40) return [def, "normal market -> default"];
  return [def + 10, "jumpy market -> widen to avoid being picked off"];
}

function loadState() {
  if (fs.existsSync(STATE)) return JSON.parse(fs.readFileSync(STATE, "utf8"));
  return { makers: NAMES.map((n, i) => ({ name: n, base: DEFAULT_BASE[i], salt: 1, listing: i })), events: [] };
}

function retune(i: number, m: any, newBase: number) {
  const env = { ...process.env, MAKER_PK: KEYS.makers[i], MAKER_INDEX: String(i), LISTING_ID: String(m.listing), ROUTER: dep.router, HOOK: dep.hook,
    FEED_ETH: dep.feedEth, FEED_BTC: dep.feedBtc, MAX_AGE: String(dep.maxAge), OLD_BASE: String(m.base), OLD_SALT: String(m.salt), NEW_BASE: String(newBase), NEW_SALT: String(m.salt + 1) };
  const r = spawnSync("forge", ["script", "script/Retune.s.sol", "--rpc-url", dep.rpc, "--broadcast"], { cwd: ROOT, env, encoding: "utf8" });
  const ok = (r.stdout || "").includes("ONCHAIN EXECUTION COMPLETE & SUCCESSFUL");
  if (ok) { m.base = newBase; m.salt += 1; }
  return ok;
}

const SWAPPER = ["function swap(tuple(address,address,uint24,int24,address) key, tuple(bool,int256,uint160) params, tuple(bool,bool) settings, bytes data) payable returns (int256)"];
async function simulatedTrade(tick: number, ethPx8: number) {
  const sw = new ethers.Contract(dep.swapper, SWAPPER, wallet(KEYS.trader, c));
  const buy = tick % 2 === 0, amt = buy ? 500_000000n : BigInt(Math.floor(500 * 1e18 * 1e8 / ethPx8));
  try {
    await (await sw.swap([WETH, USDC, 0, 10, dep.hook], [!buy, -amt, buy ? 1461446703485210103287273052203988822378723970341n : 4295128740n], [false, false], "0x")).wait();
    return { what: buy ? "buy $500 of ETH" : "sell $500 of ETH", ok: true };
  } catch { return { what: buy ? "buy $500 of ETH" : "sell $500 of ETH", ok: false }; }
}

async function main() {
  const ticks = Number(process.argv[2] || Infinity), interval = Number(process.env.INTERVAL || 30) * 1000;
  const scenario = process.env.SCENARIO ? process.env.SCENARIO.split(",").map(Number) : null;
  const st = loadState(); st.updated ??= Math.floor(Date.now() / 1000); fs.writeFileSync(STATE, JSON.stringify(st, null, 1));
  for (let tick = 0; tick < ticks; tick++) {
    try { await runTick(tick, st, scenario); }
    catch (e: any) { console.log(`[tick ${tick}] error, will retry next tick: ${e.shortMessage || e.message}`); }
    if (tick + 1 < ticks) await sleep(interval);
  }
}

async function runTick(tick: number, st: any, scenario: number[] | null) {
  const MIRROR = ["function push(int256)"];
  {
    const ev: any = { t: Math.floor(Date.now() / 1000), tick };
    const mk = await liveMarket(); ev.live = mk;
    if (scenario) { mk.move_bps = scenario[Math.min(tick, scenario.length - 1)]; ev.scenario = mk.move_bps; }
    console.log(`[tick ${tick}] LIVE Base ETH/USD $${(mk.eth / 1e8).toFixed(2)} BTC/USD $${Math.round(mk.btc / 1e8)} | recent move ${mk.move_bps} bps | oracle age ${mk.age_s}s${scenario ? " (scenario)" : ""}`);
    if (dep.mirror) {
      const d = wallet(KEYS.deployer, c);
      await (await new ethers.Contract(dep.feedEth, MIRROR, d).push(mk.eth)).wait();
      await (await new ethers.Contract(dep.feedBtc, MIRROR, d).push(mk.btc)).wait();
      console.log("   mirrored live Chainlink ETH & BTC into the fork's MirrorFeeds");
    }
    ev.decisions = [];
    st.makers.forEach((m: any, i: number) => {
      const [want, why] = decide(mk.move_bps, DEFAULT_BASE[i]);
      if (want !== m.base) {
        const old = m.base, ok = retune(i, m, want);
        console.log(`   agent -> ${m.name}: ${old} -> ${want} bps (${why}) ${ok ? "retuned on-chain" : "RETUNE FAILED"}`);
        ev.decisions.push({ maker: m.name, from: old, to: want, why, ok });
      } else console.log(`   agent -> ${m.name}: keep ${m.base} bps`);
    });
    ev.swept = await keeperSweep(c);
    for (const [n, amt] of ev.swept) console.log(`   keeper swept ${amt} ${n} claims back into the hook float`);
    if (NET === "local" && process.env.SIM_TRADER !== "0") {
      ev.trade = await simulatedTrade(tick, mk.eth);
      console.log(`   simulated trader: ${ev.trade.what} through the Uniswap v4 pool -> ${ev.trade.ok ? "filled" : "FAILED"}`);
    }
    st.events = [...(st.events || []), ev].slice(-50); st.updated = Math.floor(Date.now() / 1000);
    fs.writeFileSync(STATE, JSON.stringify(st, null, 1));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
