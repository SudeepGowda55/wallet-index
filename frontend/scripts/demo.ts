/* Terminal demo: walks the whole WalletIndex story with real on-chain calls and transactions.
 *   npx tsx scripts/demo.ts            (PAUSE=1 waits for Enter between steps, for presenting)
 * Needs the local environment running (./scripts/start_local.sh). Pauses the background agent while it runs. */
import fs from "fs";
import path from "path";
import readline from "readline";
import { spawnSync, spawn } from "child_process";
import { ethers } from "ethers";
import { EOA_TRAITS, USDC, WETH, decodeProgram } from "../lib/chain";
import { ROOT, apiQuote, apiSwap, apiWallets, chainFor, liveMarket, wallet } from "../lib/server";

const B = "\x1b[1m", G = "\x1b[32m", C = "\x1b[36m", Y = "\x1b[33m", R = "\x1b[31m", D = "\x1b[2m", X = "\x1b[0m";
const PAUSE = process.env.PAUSE === "1";
const c = chainFor("local"), dep = c.dep;
const ORDER = "tuple(address maker,uint256 traits,bytes data)";
const ask = () => new Promise<void>(r => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(`${D}  [Enter] next${X}`, () => { rl.close(); r(); }); });
const ui = (msg: string) => console.log(`  ${Y}>> in the UI:${X} ${msg}`);
async function step(n: number, title: string) { if (PAUSE && n > 1) await ask(); console.log(`\n${B}${C}── ${n}. ${title} ${"─".repeat(Math.max(0, 60 - title.length))}${X}`); }

async function showWallets() {
  const w = await apiWallets("local", 500), f = (v: number | null) => v == null ? "can't" : `${v.toFixed(1)} bps`;
  console.log(`  ${"wallet".padEnd(7)} ${"ETH".padStart(9)} ${"USDC".padStart(10)} ${"cbBTC".padStart(9)}  ${"ETH weight / target".padStart(20)}  spread  ${"buy $500 ETH".padStart(12)}  ${"sell $500 ETH".padStart(13)}`);
  for (const x of w.wallets) console.log(`  ${x.name.padEnd(7)} ${x.balances.WETH.toFixed(4).padStart(9)} ${x.balances.USDC.toFixed(2).padStart(10)} ${x.balances.cbBTC.toFixed(5).padStart(9)}  ${(x.ethWeightPct.toFixed(1) + "% / " + x.ethTargetPct + "%").padStart(20)}  ${String(x.baseSpreadBps).padStart(3)} bps  ${f(x.costToBuyEthBps).padStart(12)}  ${f(x.costToSellEthBps).padStart(13)}`);
}
function agent(scenario: string) {
  const r = spawnSync("npx", ["tsx", "scripts/agent.ts", "1"], { cwd: path.join(ROOT, "frontend"), encoding: "utf8", env: { ...process.env, NETWORK: "local", INTERVAL: "1", SCENARIO: scenario, SIM_TRADER: "0" } });
  for (const line of (r.stdout || "").split("\n")) if (/agent ->|tick|mirrored/.test(line)) console.log("  " + line.trim());
}

async function main() {
  console.log(`${B}WalletIndex — terminal demo${X}  ${D}(local fork of Base mainnet, real 1inch Aqua / SwapVM / Uniswap v4 / Chainlink)${X}`);
  console.log(`  router ${dep.router}  (official 1inch opcodes + our opcode 34)\n  hook   ${dep.hook}  (Uniswap v4 pool filled by wallets)`);

  await step(1, "Live market");
  const live = await liveMarket(), m = await c.market();
  console.log(`  Base mainnet Chainlink ETH/USD right now : ${B}$${(live.eth / 1e8).toFixed(2)}${X} (updated ${live.age_s}s ago)`);
  console.log(`  price the wallets use on-chain           : $${m.ethPx.toFixed(2)}  (age ${m.age}s, freshness limit ${dep.maxAge}s)`);
  ui("the Market tiles show the same live price and its freshness");

  await step(2, "Three wallets, one Uniswap v4 pool");
  console.log(`  ${D}each wallet keeps its own tokens (1inch Aqua); cost is quoted live by the SwapVM instruction${X}`);
  await showWallets();
  ui("the three wallet cards show the same balances, mix bars and live costs");

  await step(3, "The SwapVM program of Alice's basket");
  const p = decodeProgram((await c.listings())[0].order[2])!;
  console.log(`  ${D}${p.salt}${X} ${B}${C}${p.op}${X} ${p.lenHex} ${p.args.slice(0, 56)}…`);
  console.log(`  salt #${p.saltN} · ${C}opcode 0x22 = 34 = our native portfolio-skew instruction${X} (after 1inch's 34 official opcodes)`);
  console.log(`  base ${p.base} bps · min ${p.min} · max ${p.max} · gain ${p.gain} · price fresher than ${p.maxAge}s · targets ` + ["WETH", "USDC", "cbBTC"].map((t, i) => `${t} ${p.assets[i].target / 100}%`).join(", "));
  ui("the Protocol section shows the same bytes, with opcode 34 highlighted");

  await step(4, "1inch Aqua shared liquidity: same wallet, second strategy, official router");
  const o = ethers.AbiCoder.defaultAbiCoder().decode([ORDER], dep.curveOrder)[0], maker = o[0];
  const erc = (t: string) => new ethers.Contract(t, ["function balanceOf(address) view returns (uint256)"], c.provider);
  const [w0, u0] = [Number(await erc(WETH).balanceOf(maker)), Number(await erc(USDC).balanceOf(maker))];
  const buy = w0 / 1e18 * m.ethPx > 50;
  const r = new ethers.Contract(dep.officialRouter, [`function swap(${ORDER},address,address,uint256,bytes) returns (uint256,uint256,bytes32)`], wallet(dep.keys.cli, c));
  const rc = await (await r.swap([o[0], o[1], o[2]], buy ? USDC : WETH, buy ? WETH : USDC, buy ? 20_000000n : BigInt(Math.floor(20 / m.ethPx * 1e18)), EOA_TRAITS)).wait();
  const [w1, u1] = [Number(await erc(WETH).balanceOf(maker)), Number(await erc(USDC).balanceOf(maker))];
  console.log(`  direct SwapVM trade on the OFFICIAL 1inch router ${dep.officialRouter.slice(0, 10)}…: ${G}tx ${rc.hash}${X}`);
  console.log(`  Alice's wallet: WETH ${(w0 / 1e18).toFixed(4)} -> ${(w1 / 1e18).toFixed(4)}, USDC ${(u0 / 1e6).toFixed(2)} -> ${(u1 / 1e6).toFixed(2)}`);
  console.log(`  ${D}the same wallet balance backs her basket (reached via Uniswap) and this plain curve; nothing was moved between them${X}`);
  ui("a pop-up: official 1inch router trade from alice's wallet, labelled from terminal / API; the shared-liquidity panel updates");

  await step(5, "A normal Uniswap v4 swap, filled from a wallet");
  const q = await apiQuote("local", "buy", 500);
  console.log(`  pool quote: best wallet ${B}${q.bestWallet}${X} gives ${(q as any).amountOut.toFixed(5)} ETH for $500 (${(q as any).costBps} bps vs Chainlink)`);
  const s = await apiSwap("local", "buy", 500);
  console.log(`  ${G}swap tx ${s.tx}${X} (block ${s.block})\n  filled by ${B}${s.filledBy}${X}'s wallet: ${s.amountIn!.toFixed(2)} ${s.amountInToken} -> ${s.amountOut!.toFixed(5)} ${s.amountOutToken}`);
  ui("pop-up + highlighted row: Uniswap swap filled by that wallet, labelled from terminal / API; the flow diagram lights up");

  await step(6, "Keep buying: routing moves to the next wallet by itself");
  const seen: string[] = [];
  for (let i = 0; i < 5; i++) { const x = await apiSwap("local", "buy", 1000); seen.push(x.filledBy!); console.log(`  buy $1,000 #${i + 1}: filled by ${B}${x.filledBy!.padEnd(6)}${X} ${D}tx ${x.tx.slice(0, 18)}…${X}`); }
  console.log(`  ${D}each fill moves the wallet away from its target (or empties it), so its price rises and the pool re-routes${X}\n  wallets used: ${B}${[...new Set(seen)].join(" -> ")}${X}`);
  ui("the green best badge moves between wallet cards and the pop-ups name who filled each swap");

  await step(7, "The agent: live market -> on-chain retunes");
  console.log(`  ${Y}market turns jumpy (60 bps moves)${X}`); agent("60"); await showWallets();
  console.log(`  ${G}market calms down (20 bps)${X}`); agent("20"); await showWallets();
  ui("a pop-up per retune; each wallet card shows its new base spread and the Agent panel logs why");

  await step(8, "Safety: a stale price freezes every wallet");
  const snap = await c.provider.send("evm_snapshot", []);
  await c.provider.send("evm_increaseTime", [7200]); await c.provider.send("evm_mine", []);
  const q1 = await apiQuote("local", "buy", 500);
  console.log(`  price made 2 hours old -> pool quote fillable: ${q1.fillable ? G : R}${q1.fillable}${X} (every wallet refuses to quote)`);
  await c.provider.send("evm_revert", [snap]);
  const q2 = await apiQuote("local", "buy", 500);
  console.log(`  price fresh again     -> pool quote fillable: ${G}${q2.fillable}${X} (best: ${(q2 as any).bestWallet})`);
  ui("the freshness tile stays green: the snapshot was reverted");
  console.log(`\n${B}${G}Done.${X} UI: http://localhost:8787/   API: curl http://localhost:8787/api/status`);
}

function pauseAgent() {
  const f = path.join(ROOT, ".run", "agent.pid"), had = fs.existsSync(f);
  if (had) { try { process.kill(Number(fs.readFileSync(f, "utf8"))); } catch {} fs.rmSync(f); }
  spawnSync("pkill", ["-f", "scripts/agent.ts"]);
  return had;
}
function resumeAgent() {
  const log = fs.openSync(path.join(ROOT, ".run", "agent.log"), "a");
  const p = spawn("node", ["--import", "tsx", "scripts/agent.ts"], { cwd: path.join(ROOT, "frontend"), detached: true, stdio: ["ignore", log, log], env: { ...process.env, NETWORK: "local", INTERVAL: process.env.INTERVAL || "30" } });
  fs.writeFileSync(path.join(ROOT, ".run", "agent.pid"), String(p.pid)); p.unref();
}
const was = pauseAgent();
main().then(() => { if (was) resumeAgent(); process.exit(0); }).catch(e => { console.error(e); if (was) resumeAgent(); process.exit(1); });
