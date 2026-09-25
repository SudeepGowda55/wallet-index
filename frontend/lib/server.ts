// Server-side helpers for the Next.js API routes and the Node scripts (agent, demo, checks).
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { Chain, USDC, WETH, POOL_MANAGER } from "./chain";

export const ROOT = process.env.WI_ROOT || path.resolve(process.cwd(), process.cwd().endsWith("frontend") ? ".." : ".");
export const DEPLOYMENTS = path.join(ROOT, "deployments");
export const LIVE_RPC = process.env.LIVE_RPC || "https://mainnet.base.org";
export const LIVE_ETH = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
export const LIVE_BTC = "0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D";
const FEED = ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)"];
const PM6909 = ["function balanceOf(address owner, uint256 id) view returns (uint256)"];
const HOOK_SWEEP = ["function sweepClaims(address currency, uint256 amount)"];

export function loadDep(net = "local") { return JSON.parse(fs.readFileSync(path.join(DEPLOYMENTS, `${net}.json`), "utf8")); }
export function loadState(net = "local") { const p = path.join(DEPLOYMENTS, `${net}.state.json`); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; }
export function chainFor(net = "local") { return new Chain(loadDep(net), net); }
export const wallet = (pk: string, c: Chain) => new ethers.NonceManager(new ethers.Wallet(pk, c.provider));

const LIVE_RPCS = [LIVE_RPC, "https://base-rpc.publicnode.com", "https://base.drpc.org", "https://1rpc.io/base"];
/** Live Base mainnet Chainlink read; rotates across public RPCs because free endpoints rate-limit. */
export async function liveMarket() {
  let last: any;
  for (let attempt = 0; attempt < 8; attempt++) {
    try { return await liveMarketFrom(LIVE_RPCS[attempt % LIVE_RPCS.length]); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 400 * (attempt + 1))); }
  }
  throw last;
}
async function liveMarketFrom(url: string) {
  const p = new ethers.JsonRpcProvider(url, 8453, { staticNetwork: true });
  const fe = new ethers.Contract(LIVE_ETH, FEED, p), fb = new ethers.Contract(LIVE_BTC, FEED, p);
  const [r, b] = await Promise.all([fe.latestRoundData(), fb.latestRoundData()]);
  const prices = [Number(r[1])];
  for (let k = 1; k < 8; k++) { try { prices.push(Number((await fe.getRoundData(r[0] - BigInt(k)))[1])); } catch { break; } }
  const moves = prices.slice(0, -1).map((v, i) => Math.abs(v / prices[i + 1] - 1) * 1e4);
  return { eth: Number(r[1]), btc: Number(b[1]), move_bps: Math.round((moves.length ? Math.max(...moves) : 0) * 10) / 10, age_s: Math.floor(Date.now() / 1000) - Number(r[3]) };
}

/** Permissionless keeper call: convert the hook's settled ERC-6909 claims back into its working float. */
export async function keeperSweep(c: Chain) {
  const pk = c.dep.keys?.deployer || process.env.DEPLOYER_PK; if (!pk) return [];
  const pm = new ethers.Contract(POOL_MANAGER, PM6909, c.provider), hook = new ethers.Contract(c.dep.hook, HOOK_SWEEP, wallet(pk, c));
  const swept: [string, string][] = [];
  for (const [tok, name] of [[USDC, "USDC"], [WETH, "WETH"]] as const) {
    const claims: bigint = await pm.balanceOf(c.dep.hook, BigInt(tok));
    if (claims > 0n) { await (await hook.sweepClaims(tok, claims)).wait(); swept.push([name, claims.toString()]); }
  }
  return swept;
}

export async function apiStatus(net: string) {
  const c = chainFor(net), m = await c.market(), st = loadState(net);
  let live: any; try { const l = await liveMarket(); live = { ethUsd: l.eth / 1e8, ageSeconds: l.age_s }; } catch (e: any) { live = { error: e.message }; }
  return { network: c.dep.network, block: m.block, router: c.dep.router, hook: c.dep.hook, opcode: 34, walletsPriceEthUsd: m.ethPx,
    priceAgeSeconds: m.age, maxAgeSeconds: c.dep.maxAge, liveBaseMainnet: live, agentLastTick: st?.events?.[st.events.length - 1] ?? null };
}

export async function apiWallets(net: string, usd: number) {
  const c = chainFor(net), m = await c.market(), ls = await c.listings(), ws = await c.wallets(ls, m.ethPx, m.btcPx);
  const out = [];
  for (const w of ws) {
    const qb = await c.quote(w.l.order, USDC, WETH, BigInt(Math.round(usd * 1e6)));
    const qs = await c.quote(w.l.order, WETH, USDC, BigInt(Math.round(usd / m.ethPx * 1e18)));
    out.push({ id: w.l.id, name: c.nameOf(w.l.id), address: w.l.order[0], listed: w.l.active,
      balances: { WETH: w.bal[0] / 1e18, USDC: w.bal[1] / 1e6, cbBTC: w.bal[2] / 1e8 }, valueUsd: Math.round(w.tot * 100) / 100,
      ethWeightPct: Math.round(w.v[0] / w.tot * 1e4) / 100, ethTargetPct: w.p ? w.p.assets[0].target / 100 : null,
      baseSpreadBps: w.p?.base ?? null, strategyNumber: w.p?.saltN ?? null,
      costToBuyEthBps: qb == null ? null : Math.round((1 - Number(qb) / 1e18 / (usd / m.ethPx)) * 1e5) / 10,
      costToSellEthBps: qs == null ? null : Math.round((1 - Number(qs) / 1e6 / usd) * 1e5) / 10 });
  }
  return { ethUsd: m.ethPx, btcUsd: m.btcPx, usd, wallets: out };
}

export async function apiQuote(net: string, side: "buy" | "sell", usd: number) {
  const c = chainFor(net), m = await c.market();
  const [tin, tout, amt] = side === "buy" ? [USDC, WETH, BigInt(Math.round(usd * 1e6))] : [WETH, USDC, BigInt(Math.round(usd / m.ethPx * 1e18))];
  const r = await c.hook.bestQuote.staticCall(tin, tout, amt);
  if (r[1] === 0n) return { side, usd, fillable: false };
  const got = side === "buy" ? Number(r[1]) / 1e18 : Number(r[1]) / 1e6;
  const cost = side === "buy" ? (1 - got / (usd / m.ethPx)) * 1e4 : (1 - got / usd) * 1e4;
  return { side, usd, fillable: true, bestWallet: c.nameOf(r[0]), amountOut: got, amountOutToken: side === "buy" ? "WETH" : "USDC",
    costBps: Math.round(cost * 10) / 10, oracleEthUsd: m.ethPx };
}

/** Real swap through the Uniswap v4 pool from the terminal/API wallet; returns tx + which wallet filled it. */
export async function apiSwap(net: string, side: "buy" | "sell", usd: number) {
  const c = chainFor(net), pk = c.dep.keys?.cli;
  if (!pk) throw new Error("swaps via API are only enabled on the local fork");
  await keeperSweep(c);
  const m = await c.market();
  c.trader = wallet(pk, c);
  const SWAPPER = ["function swap(tuple(address,address,uint24,int24,address) key, tuple(bool,int256,uint160) params, tuple(bool,bool) settings, bytes data) payable returns (int256)"];
  const sw = new ethers.Contract(c.dep.swapper, SWAPPER, c.trader);
  const amt = side === "buy" ? BigInt(Math.round(usd * 1e6)) : BigInt(Math.round(usd / m.ethPx * 1e18));
  const tx = await sw.swap([WETH, USDC, 0, 10, c.dep.hook], [side !== "buy", -amt, side === "buy" ? 1461446703485210103287273052203988822378723970341n : 4295128740n], [false, false], "0x");
  const rc = await tx.wait();
  const ev: any = rc.logs.map((l: any) => { try { return c.hook.interface.parseLog(l); } catch { return null; } }).find((x: any) => x && x.name === "Filled");
  const buy = side === "buy";
  return { tx: rc.hash, block: rc.blockNumber, status: rc.status, filledBy: ev ? c.nameOf(ev.args[0]) : null,
    amountIn: ev ? Number(ev.args[4]) / (buy ? 1e6 : 1e18) : null, amountInToken: buy ? "USDC" : "WETH",
    amountOut: ev ? Number(ev.args[5]) / (buy ? 1e18 : 1e6) : null, amountOutToken: buy ? "WETH" : "USDC" };
}
