import { ethers } from "ethers";

export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const WETH = "0x4200000000000000000000000000000000000006";
export const BTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
export const POOL_MANAGER = "0x498581fF718922c3f8e6A244956aF099B2652b2b";
export const EOA_TRAITS = "0x00000000000000000000000000000000000000000041";
export const HEX = ["#3987e5", "#d95926", "#199e70"];
export const LADDER = [100, 1000, 5000, 10000];
const ORDER = "tuple(address maker,uint256 traits,bytes data)";
const ERC20 = ["function balanceOf(address) view returns (uint256)"];
const FEED = ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"];
const HOOK = ["function count() view returns (uint256)", `function listing(uint256) view returns (${ORDER} order, bool active)`,
  "function bestQuote(address,address,uint256) returns (uint256 id, uint256 amountOut)",
  "event Filled(uint256 indexed id, address indexed maker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)",
  "event Replaced(uint256 indexed id, address indexed maker)"];
const ROUTER = [`function quote(${ORDER} order,address tokenIn,address tokenOut,uint256 amount,bytes takerTraits) returns (uint256,uint256,bytes32)`,
  `function swap(${ORDER} order,address tokenIn,address tokenOut,uint256 amount,bytes takerTraits) returns (uint256,uint256,bytes32)`];
const AQUA = ["function rawBalances(address,address,bytes32,address) view returns (uint248,uint8)"];
const SWAPPER = ["function swap(tuple(address,address,uint24,int24,address) key, tuple(bool,int256,uint160) params, tuple(bool,bool) settings, bytes data) payable returns (int256)"];
const PULLED = ethers.id("Pulled(address,address,bytes32,address,uint256)");
const MIN_SQRT = 4295128740n, MAX_SQRT = 1461446703485210103287273052203988822378723970341n;
const coder = ethers.AbiCoder.defaultAbiCoder();

export const fmt = (x: number, d = 2) => Number(x).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
export const usd0 = (x: number) => "$" + Number(x).toLocaleString(undefined, { maximumFractionDigits: 0 });
export const short = (a?: string) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "–");
export const regime = (m: number) => m < 15 ? { name: "calm", cls: "good", rule: "tighten spreads" } : m < 40 ? { name: "normal", cls: "t2", rule: "default spreads" } : { name: "jumpy", cls: "warn", rule: "widen spreads" };

export type Program = { salt: string; op: string; lenHex: string; args: string; base: number; min: number; max: number; gain: number; maxAge: number; saltN: number; assets: { token: string; feed: string; target: number }[] };
export function decodeProgram(data: string): Program | null {
  const hex = data.slice(2).toLowerCase(), i = hex.search(/1408[0-9a-f]{16}22/);
  if (i < 0) return null;
  const len = parseInt(hex.slice(i + 22, i + 24), 16), args = hex.slice(i + 24, i + 24 + len * 2), h = (a: number, b: number) => parseInt(args.slice(a * 2, b * 2), 16);
  const c: Program = { salt: hex.slice(i, i + 20), op: hex.slice(i + 20, i + 22), lenHex: hex.slice(i + 22, i + 24), args, base: h(0, 2), min: h(2, 4), max: h(4, 6),
    gain: h(6, 10), maxAge: h(10, 14), saltN: parseInt(hex.slice(i + 4, i + 20), 16), assets: [] };
  for (let o = 14; o + 43 <= len; o += 43) c.assets.push({ token: "0x" + args.slice(o * 2, o * 2 + 40), feed: "0x" + args.slice(o * 2 + 40, o * 2 + 80), target: h(o + 41, o + 43) });
  return c;
}

export class Chain {
  dep: any; net: string; provider: ethers.JsonRpcProvider; trader: ethers.NonceManager | null = null;
  hook: ethers.Contract; router: ethers.Contract; aqua: ethers.Contract; feedEth: ethers.Contract; feedBtc: ethers.Contract;
  txFrom: Record<string, string> = {}; blockTime: Record<number, number> = {};

  constructor(dep: any, net: string) {
    this.dep = dep; this.net = net;
    this.provider = new ethers.JsonRpcProvider(dep.rpc);
    const key = dep.keys && (dep.keys.ui || dep.keys.trader);
    if (key) this.trader = new ethers.NonceManager(new ethers.Wallet(key, this.provider));
    this.hook = new ethers.Contract(dep.hook, HOOK, this.provider);
    this.router = new ethers.Contract(dep.router, ROUTER, this.provider);
    this.aqua = new ethers.Contract(dep.aqua, AQUA, this.provider);
    this.feedEth = new ethers.Contract(dep.feedEth, FEED, this.provider);
    this.feedBtc = new ethers.Contract(dep.feedBtc, FEED, this.provider);
  }
  nameOf(id: any) { return (this.dep.makers[Number(id)] || { name: "#" + id }).name; }

  async market() {
    const [blk, fe, fb] = await Promise.all([this.provider.getBlock("latest"), this.feedEth.latestRoundData(), this.feedBtc.latestRoundData()]);
    return { block: blk.number, ethPx: Number(fe[1]) / 1e8, btcPx: Number(fb[1]) / 1e8, age: blk.timestamp - Number(fe[3]) };
  }

  async listings() {
    const n = Number(await this.hook.count()), out = [];
    for (let i = 0; i < n; i++) { const [o, active] = await this.hook.listing(i); out.push({ id: i, order: [o[0], o[1], o[2]], active }); }
    return out;
  }

  async quote(order: any[], tin: string, tout: string, amt: bigint): Promise<bigint | null> {
    try { const r = await this.router.quote.staticCall(order, tin, tout, amt, EOA_TRAITS, { from: this.dep.trader }); return r[1]; } catch { return null; }
  }

  async best(ethPx: number) {
    const res: any = { buy: -1, sell: -1 };
    try { const r = await this.hook.bestQuote.staticCall(USDC, WETH, 500n * 1000000n); if (r[1] > 0n) { res.buy = Number(r[0]); res.buyOut = r[1]; } } catch {}
    try { const r = await this.hook.bestQuote.staticCall(WETH, USDC, BigInt(Math.round(500 / ethPx * 1e18))); if (r[1] > 0n) { res.sell = Number(r[0]); res.sellOut = r[1]; } } catch {}
    return res;
  }

  async wallets(listings: any[], ethPx: number, btcPx: number) {
    const out = [];
    for (const l of listings) {
      const bal = await Promise.all([WETH, USDC, BTC].map(t => new ethers.Contract(t, ERC20, this.provider).balanceOf(l.order[0])));
      const v = [Number(bal[0]) / 1e18 * ethPx, Number(bal[1]) / 1e6, Number(bal[2]) / 1e8 * btcPx];
      out.push({ l, bal: bal.map(Number), v, tot: v[0] + v[1] + v[2], p: decodeProgram(l.order[2]) });
    }
    return out;
  }

  async ladders(listings: any[], ethPx: number) {
    const res: Record<number, { buy: (number | null)[]; sell: (number | null)[] }> = {};
    for (const l of listings) {
      res[l.id] = { buy: [], sell: [] };
      for (const u of LADDER) {
        const b = await this.quote(l.order, USDC, WETH, BigInt(Math.round(u * 1e6)));
        const s = await this.quote(l.order, WETH, USDC, BigInt(Math.round(u / ethPx * 1e18)));
        res[l.id].buy.push(b == null ? null : (1 - Number(b) / 1e18 / (u / ethPx)) * 1e4);
        res[l.id].sell.push(s == null ? null : (1 - Number(s) / 1e6 / u) * 1e4);
      }
    }
    return res;
  }

  async shared(basketOrder: any[]) {
    if (!this.dep.curveOrder) return null;
    const [maker] = coder.decode([ORDER], this.dep.curveOrder)[0];
    const basketHash = ethers.keccak256(coder.encode([ORDER], [basketOrder])), curveHash = ethers.keccak256(this.dep.curveOrder);
    const [real, a, c] = await Promise.all([new ethers.Contract(WETH, ERC20, this.provider).balanceOf(maker),
      this.aqua.rawBalances(maker, this.dep.router, basketHash, WETH), this.aqua.rawBalances(maker, this.dep.officialRouter, curveHash, WETH)]);
    return { real: Number(real) / 1e18, basket: Number(a[0]) / 1e18, curve: Number(c[0]) / 1e18 };
  }

  sourceOf(from: string) {
    const f = (from || "").toLowerCase(), d = this.dep;
    if (f === (d.cliTrader || "").toLowerCase()) return { label: "terminal / API", cls: "src-cli" };
    if (f === (d.uiTrader || "").toLowerCase()) return { label: "UI button", cls: "src-ui" };
    if (f === (d.trader || "").toLowerCase()) return { label: "agent's simulated trader", cls: "src-agent" };
    const m = (d.makers || []).find((x: any) => x.address.toLowerCase() === f);
    if (m) return { label: `agent (as ${m.name})`, cls: "src-agent" };
    return { label: short(from), cls: "muted" };
  }
  async fromOf(h: string) { if (!(h in this.txFrom)) { const t = await this.provider.getTransaction(h); this.txFrom[h] = t ? t.from : ""; } return this.txFrom[h]; }
  async timeOf(b: number) { if (!(b in this.blockTime)) { const x = await this.provider.getBlock(b); this.blockTime[b] = x ? x.timestamp : 0; } return this.blockTime[b]; }

  async activity() {
    const latest = await this.provider.getBlockNumber(), from = Math.max(this.dep.deployBlock || 0, latest - 1900);
    const [fills, reps, pulls] = await Promise.all([this.hook.queryFilter(this.hook.filters.Filled(), from, latest), this.hook.queryFilter(this.hook.filters.Replaced(), from, latest),
      this.provider.getLogs({ address: this.dep.aqua, topics: [PULLED], fromBlock: from, toBlock: latest })]);
    const items: any[] = [], vol: Record<number, { b: number; usd: number }[]> = {}, stats: Record<number, { n: number; vol: number }> = {};
    for (const f of fills as ethers.EventLog[]) {
      const [id, , tin, , ain, aout] = f.args, buy = tin.toLowerCase() === USDC.toLowerCase(), wid = Number(id);
      const usd = buy ? Number(ain) / 1e6 : Number(aout) / 1e6, name = this.nameOf(id);
      const desc = buy ? `$${fmt(Number(ain) / 1e6)} USDC → ${fmt(Number(aout) / 1e18, 5)} ETH` : `${fmt(Number(ain) / 1e18, 5)} ETH → $${fmt(Number(aout) / 1e6)} USDC`;
      stats[wid] = stats[wid] || { n: 0, vol: 0 }; stats[wid].n++; stats[wid].vol += usd;
      (vol[wid] = vol[wid] || []).push({ b: f.blockNumber, usd });
      items.push({ key: f.transactionHash + f.index, b: f.blockNumber, tx: f.transactionHash, wallet: wid, kind: "fill", name, desc });
    }
    for (const r of reps as ethers.EventLog[]) items.push({ key: r.transactionHash + r.index, b: r.blockNumber, tx: r.transactionHash, kind: "retune", name: this.nameOf(r.args[0]) });
    const alice = this.dep.makers[0] ? this.dep.makers[0].address.toLowerCase() : "";
    for (const lg of pulls) {
      const [maker, app, , token, amount] = coder.decode(["address", "address", "bytes32", "address", "uint256"], lg.data);
      if (app.toLowerCase() !== (this.dep.officialRouter || "").toLowerCase() || maker.toLowerCase() !== alice) continue;
      const what = token.toLowerCase() === WETH.toLowerCase() ? `${fmt(Number(amount) / 1e18, 5)} ETH` : `$${fmt(Number(amount) / 1e6)} USDC`;
      items.push({ key: lg.transactionHash + lg.index, b: lg.blockNumber, tx: lg.transactionHash, kind: "official", name: "alice", desc: what });
    }
    items.sort((x, y) => y.b - x.b);
    const shown = items.slice(0, 50);
    await Promise.all(shown.map(async i => { i.src = this.sourceOf(await this.fromOf(i.tx)); }));
    await Promise.all([...new Set((fills as ethers.EventLog[]).map(f => f.blockNumber))].map(b => this.timeOf(b)));
    const t0 = fills.length ? this.blockTime[fills[0].blockNumber] : 0;
    const volSeries = (this.dep.makers || []).slice(0, 3).map((m: any, i: number) => {
      let c = 0; const pts = [{ x: t0, y: 0 }];
      for (const e of vol[i] || []) { c += e.usd; pts.push({ x: this.blockTime[e.b], y: c }); }
      return { name: m.name, color: HEX[i], points: fills.length ? pts : [], zero: true };
    });
    return { items: shown, stats, swaps: fills.length, retunes: reps.length, volume: Object.values(stats).reduce((a, s) => a + s.vol, 0), volSeries };
  }

  async uniTrade(buy: boolean, usd: number, ethPx: number) {
    const amt = buy ? BigInt(Math.round(usd * 1e6)) : BigInt(Math.round(usd / ethPx * 1e18));
    const sw = new ethers.Contract(this.dep.swapper, SWAPPER, this.trader);
    try {
      const tx = await sw.swap([WETH, USDC, 0, 10, this.dep.hook], [!buy, -amt, buy ? MAX_SQRT : MIN_SQRT], [false, false], "0x");
      const rc = await tx.wait();
      const ev: any = rc.logs.map((l: any) => { try { return this.hook.interface.parseLog(l); } catch { return null; } }).find((x: any) => x && x.name === "Filled");
      const got = ev ? (buy ? `${fmt(Number(ev.args[5]) / 1e18, 5)} ETH` : `$${fmt(Number(ev.args[5]) / 1e6)}`) : "";
      return { ok: true, msg: `filled by ${ev ? this.nameOf(ev.args[0]) : "?"}: got ${got} · tx ${short(rc.hash)}` };
    } catch (e: any) { this.trader.reset(); return { ok: false, msg: `swap reverted: ${e.shortMessage || e.message}` }; }
  }

  async directTrade() {
    const o = coder.decode([ORDER], this.dep.curveOrder)[0], r = new ethers.Contract(this.dep.officialRouter, ROUTER, this.trader);
    try {
      const tx = await r.swap([o[0], o[1], o[2]], USDC, WETH, 20000000n, EOA_TRAITS); const rc = await tx.wait();
      return { ok: true, msg: `filled from Alice's same wallet by her plain curve on the official router · tx ${short(rc.hash)}` };
    } catch (e: any) { this.trader.reset(); return { ok: false, msg: `reverted: ${e.shortMessage || e.message}` }; }
  }
}
