/* WalletIndex UI: live data from the chain + agent state, actions through the Uniswap pool / official 1inch router / API. */
const E = ethers;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", WETH = "0x4200000000000000000000000000000000000006", BTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const EOA_TRAITS = "0x00000000000000000000000000000000000000000041";
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
const MIN_SQRT = 4295128740n, MAX_SQRT = 1461446703485210103287273052203988822378723970341n;
const LADDER = [100, 1000, 5000, 10000];
const PULLED = E.id("Pulled(address,address,bytes32,address,uint256)");

const net = new URLSearchParams(location.search).get("net") || "local";
let dep, state, provider, trader, hook, router, aqua, feedEth, feedBtc, ethPx = 0, btcPx = 0;
let listings = [], walletData = [], ladderCache = {}, bestIds = { buy: -1, sell: -1 }, fillStats = {};
const txFrom = {}, blockTime = {}, seen = new Set(); let firstFeed = true;
const $ = id => document.getElementById(id);
const fmt = fmtN, usd0 = x => "$" + Number(x).toLocaleString(undefined, { maximumFractionDigits: 0 });
const short = a => a ? a.slice(0, 6) + "…" + a.slice(-4) : "–";
const coder = E.AbiCoder.defaultAbiCoder();
const nameOf = id => (dep.makers[Number(id)] || { name: "#" + id }).name;
const regime = m => m < 15 ? { name: "calm", cls: "good", rule: "tighten spreads" } : m < 40 ? { name: "normal", cls: "t2", rule: "default spreads" } : { name: "jumpy", cls: "warn", rule: "widen spreads" };
const buyCost = (out, usd) => out == null ? null : (1 - Number(out) / 1e18 / (usd / ethPx)) * 1e4;
const sellCost = (out, usd) => out == null ? null : (1 - Number(out) / 1e6 / usd) * 1e4;
function argmin(arr) { let b = -1, bv = Infinity; arr.forEach((v, i) => { if (v != null && v < bv) { bv = v; b = i; } }); return b; }

async function init() {
  dep = await (await fetch(`/deployments/${net}.json?${Date.now()}`)).json();
  provider = new E.JsonRpcProvider(dep.rpc);
  if (dep.keys && (dep.keys.ui || dep.keys.trader)) trader = new E.NonceManager(new E.Wallet(dep.keys.ui || dep.keys.trader, provider));
  hook = new E.Contract(dep.hook, HOOK, provider); router = new E.Contract(dep.router, ROUTER, provider); aqua = new E.Contract(dep.aqua, AQUA, provider);
  feedEth = new E.Contract(dep.feedEth, FEED, provider); feedBtc = new E.Contract(dep.feedBtc, FEED, provider);
  $("netLabel").textContent = dep.network === "local" ? "local fork of Base mainnet · chain 8453" : "Base mainnet";
  $("footNet").textContent = dep.mirror ? "local fork: the agent mirrors live Base Chainlink answers into on-chain MirrorFeeds each tick" : "Base mainnet, live Chainlink feeds";
  $("contracts").innerHTML = [["WalletIndexRouter (SwapVM + opcode 34)", dep.router], ["WalletIndex hook (Uniswap v4)", dep.hook], ["1inch Aqua (official)", dep.aqua],
    ["1inch AquaSwapVMRouter (official)", dep.officialRouter], ["Uniswap v4 PoolManager", "0x498581fF718922c3f8e6A244956aF099B2652b2b"], ["ETH/USD price feed", dep.feedEth]]
    .map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="v" style="font-family:ui-monospace,Menlo,monospace;font-size:12.5px" title="${v}">${short(v)}</span></div>`).join("");
  if (!trader) ["buy", "sell", "direct"].forEach(b => { $(b).disabled = true; $(b).title = "trading from the page is enabled on the local fork"; });
  $("buy").onclick = () => uniTrade(true); $("sell").onclick = () => uniTrade(false); $("direct").onclick = directTrade;
  document.querySelectorAll("[data-api]").forEach(b => b.onclick = () => callApi(b.dataset.api));
  drawFlow($("flowSvg"), dep.makers);
  barChart($("chEvidence"), [{ label: "Today (two hops via USDC)", v: 158, color: "#8b8a82" }, { label: "WalletIndex basket", v: 15, color: HEX[0] }], { vFmt: v => fmt(v, 0) + " bps" });
  await refresh(); setInterval(refresh, 5000);
  await ladders(); setInterval(ladders, 15000);
}

async function refresh() {
  try {
    const [blk, fe, fb] = await Promise.all([provider.getBlock("latest"), feedEth.latestRoundData(), feedBtc.latestRoundData()]);
    ethPx = Number(fe[1]) / 1e8; btcPx = Number(fb[1]) / 1e8;
    const age = blk.timestamp - Number(fe[3]);
    $("blk").textContent = `block ${blk.number}`;
    $("kAge").innerHTML = `<span class="${age > dep.maxAge ? "bad" : age > dep.maxAge * 0.7 ? "warn" : "good"}">${age}s</span>`;
    $("kAgeS").textContent = `wallets refuse to quote past ${dep.maxAge}s`;
    try { state = await (await fetch(`/deployments/${net}.state.json?${Date.now()}`)).json(); } catch { state = null; }
    const last = state && state.events && state.events[state.events.length - 1];
    if (last) {
      const reg = regime(last.live.move_bps), sc = last.scenario !== undefined ? " (scenario)" : "";
      $("kEth").textContent = "$" + fmt(last.live.eth / 1e8); $("kEthS").textContent = `Chainlink, ${last.live.age_s}s old at the last tick`;
      $("kReg").innerHTML = `<span class="${reg.cls}">${reg.name}</span>`; $("kRegS").textContent = `largest move ${last.live.move_bps} bps${sc}`;
      $("agMove").textContent = `${last.live.move_bps} bps${sc}`; $("agReg").innerHTML = `<span class="${reg.cls}">${reg.name}</span> → ${reg.rule}`;
      $("agLast").textContent = `tick ${last.tick} · ${new Date(last.t * 1000).toLocaleTimeString()}`;
      $("agKeep").textContent = (last.swept || []).length ? `swept ${last.swept.map(s => s[0]).join(" & ")} claims back into the hook float` : "float healthy";
    } else $("kEth").textContent = "$" + fmt(ethPx);
    if (state && state.updated) { const ago = Math.floor(Date.now() / 1000) - state.updated; $("agentPill").innerHTML = `agent <span class="${ago < 120 ? "good" : "warn"}">${ago}s ago</span>`; }
    await loadListings();
    await loadWallets();
    renderWallets();
    await renderProtocol();
    await renderActivity();
    renderAgent();
  } catch (e) { console.error(e); $("tradeMsg").textContent = "refresh error: " + (e.shortMessage || e.message); }
}

async function loadListings() {
  const n = Number(await hook.count());
  const out = [];
  for (let i = 0; i < n; i++) { const [o, active] = await hook.listing(i); out.push({ id: i, order: [o[0], o[1], o[2]], active }); }
  listings = out;
}

function decodeProgram(data) {
  const hex = data.slice(2).toLowerCase(), i = hex.search(/1408[0-9a-f]{16}22/);
  if (i < 0) return null;
  const len = parseInt(hex.slice(i + 22, i + 24), 16), args = hex.slice(i + 24, i + 24 + len * 2), h = (a, b) => parseInt(args.slice(a * 2, b * 2), 16);
  const c = { salt: hex.slice(i, i + 20), op: hex.slice(i + 20, i + 22), lenHex: hex.slice(i + 22, i + 24), args, base: h(0, 2), min: h(2, 4), max: h(4, 6),
    gain: h(6, 10), maxAge: h(10, 14), saltN: parseInt(hex.slice(i + 4, i + 20), 16), assets: [] };
  for (let o = 14; o + 43 <= len; o += 43) c.assets.push({ token: "0x" + args.slice(o * 2, o * 2 + 40), feed: "0x" + args.slice(o * 2 + 40, o * 2 + 80), target: h(o + 41, o + 43) });
  return c;
}

async function quoteOf(order, tin, tout, amt) {
  try { const r = await router.quote.staticCall(order, tin, tout, amt, EOA_TRAITS, { from: dep.trader }); return r[1]; } catch { return null; }
}

async function loadWallets() {
  const buyAmt = 500n * 1000000n, sellAmt = BigInt(Math.round(500 / ethPx * 1e18));
  try { const r = await hook.bestQuote.staticCall(USDC, WETH, buyAmt); bestIds.buy = r[1] > 0n ? Number(r[0]) : -1; bestIds.buyOut = r[1]; } catch { bestIds.buy = -1; }
  try { const r = await hook.bestQuote.staticCall(WETH, USDC, sellAmt); bestIds.sell = r[1] > 0n ? Number(r[0]) : -1; bestIds.sellOut = r[1]; } catch { bestIds.sell = -1; }
  $("bestBuy").textContent = bestIds.buy >= 0 ? `${nameOf(bestIds.buy)} · ${fmt(Number(bestIds.buyOut) / 1e18, 5)} ETH for $500 (${fmt(buyCost(bestIds.buyOut, 500), 1)} bps)` : "no wallet can fill";
  $("bestSell").textContent = bestIds.sell >= 0 ? `${nameOf(bestIds.sell)} · $${fmt(Number(bestIds.sellOut) / 1e6)} for $500 of ETH (${fmt(sellCost(bestIds.sellOut, 500), 1)} bps)` : "no wallet can fill";
  $("kBest").innerHTML = bestIds.buy >= 0 ? `${fmt(buyCost(bestIds.buyOut, 500), 1)} <span style="font-size:15px" class="t2">bps</span>` : '<span class="bad">none</span>';
  $("kBestS").textContent = bestIds.buy >= 0 ? `from ${nameOf(bestIds.buy)}'s wallet, vs Chainlink` : "every wallet refused (stale price?)";
  const out = [];
  for (const l of listings) {
    const bal = await Promise.all([WETH, USDC, BTC].map(t => new E.Contract(t, ERC20, provider).balanceOf(l.order[0])));
    const v = [Number(bal[0]) / 1e18 * ethPx, Number(bal[1]) / 1e6, Number(bal[2]) / 1e8 * btcPx];
    out.push({ l, bal, v, tot: v[0] + v[1] + v[2], p: decodeProgram(l.order[2]) });
  }
  walletData = out;
  $("kLiq").textContent = usd0(walletData.reduce((a, w) => a + w.tot, 0));
  $("kLiqS").textContent = `${walletData.filter(w => w.l.active).length} wallets listed, money stays in each`;
}

async function ladders() {
  if (!listings.length || !ethPx) return;
  const res = {};
  for (const l of listings) {
    res[l.id] = { buy: [], sell: [] };
    for (const u of LADDER) {
      res[l.id].buy.push(buyCost(await quoteOf(l.order, USDC, WETH, BigInt(Math.round(u * 1e6))), u));
      res[l.id].sell.push(sellCost(await quoteOf(l.order, WETH, USDC, BigInt(Math.round(u / ethPx * 1e18))), u));
    }
  }
  ladderCache = res; renderWallets();
}

function renderWallets() {
  if (!walletData.length) return;
  const names = ["ETH", "USDC", "cbBTC"];
  const ids = Object.keys(ladderCache);
  const win = side => LADDER.map((_, i) => ids[argmin(ids.map(id => ladderCache[id][side][i]))]);
  const wB = win("buy"), wS = win("sell");
  $("walletGrid").innerHTML = walletData.map((w, idx) => {
    const id = w.l.id, m = dep.makers[id] || { name: "maker " + id }, color = HEX[idx % 3];
    const amounts = [fmt(Number(w.bal[0]) / 1e18, 4), fmt(Number(w.bal[1]) / 1e6, 2), fmt(Number(w.bal[2]) / 1e8, 5)];
    const assets = names.map((n, i) => {
      const pct = w.tot ? w.v[i] / w.tot * 100 : 0, tgt = w.p ? w.p.assets[i].target / 100 : 0;
      return `<div class="asset"><span class="t2">${n}</span><div class="track" title="${fmt(pct, 1)}% now, target ${fmt(tgt, 0)}%"><span style="width:${Math.min(100, pct)}%;background:${color}"></span><i style="left:${tgt}%"></i></div><span class="v">${fmt(pct, 1)}% <span class="muted">/ ${fmt(tgt, 0)}%</span></span></div>`;
    }).join("");
    const lad = ladderCache[id];
    const cell = (v, isWin) => v == null ? '<td class="muted">refuses</td>' : `<td class="${isWin ? "win" : ""}">${fmt(v, 1)}</td>`;
    const ladder = lad ? `<table class="ladder"><thead><tr><th>cost, bps</th>${LADDER.map(u => `<th>$${u >= 1000 ? u / 1000 + "k" : u}</th>`).join("")}</tr></thead><tbody>
      <tr><td>buy ETH</td>${lad.buy.map((v, i) => cell(v, wB[i] === String(id))).join("")}</tr>
      <tr><td>sell ETH</td>${lad.sell.map((v, i) => cell(v, wS[i] === String(id))).join("")}</tr></tbody></table>`
      : '<div class="muted" style="font-size:13px;margin-top:8px">quote ladder loading…</div>';
    const fs = fillStats[id] || { n: 0, vol: 0 };
    return `<div class="panel wallet ${id === bestIds.buy || id === bestIds.sell ? "best" : ""}">
      <div class="whead"><span class="dot" style="background:${color};width:12px;height:12px"></span><span class="wname">${m.name}</span>
        ${id === bestIds.buy ? '<span class="badge">best to buy ETH from</span>' : ""}${id === bestIds.sell ? '<span class="badge">best to sell ETH to</span>' : ""}</div>
      <div class="muted" style="font-size:12.5px;margin-bottom:8px">${short(w.l.order[0])} · ${w.l.active ? '<span class="good">listed</span>' : '<span class="bad">delisted</span>'} · strategy #${w.p ? w.p.saltN : "?"} · base spread <b style="color:var(--text)">${w.p ? w.p.base : "?"} bps</b></div>
      <div class="kv"><span class="k">Wallet value</span><span class="v"><b>$${fmt(w.tot)}</b></span></div>
      <div class="kv"><span class="k">Holdings</span><span class="v">${amounts.map((a, i) => `${a} ${names[i]}`).join(" · ")}</span></div>
      <div style="margin:10px 0 2px" class="muted">Mix vs target</div>${assets}
      ${ladder}
      <div class="kv" style="margin-top:8px"><span class="k">Uniswap swaps won</span><span class="v">${fs.n} · $${fmt(fs.vol, 0)}</span></div>
    </div>`;
  }).join("");
}

async function renderProtocol() {
  const w = walletData[0]; if (!w || !listings.length) return;
  const p = w.p;
  if (p) {
    $("program").innerHTML = `<span class="muted">${p.salt}</span> <span style="color:var(--aqua);font-weight:700">${p.op}</span> <span class="muted">${p.lenHex}</span> ${p.args}`;
    const nm = { [WETH.toLowerCase()]: "WETH", [USDC.toLowerCase()]: "USDC", [BTC.toLowerCase()]: "cbBTC" };
    const chips = [["salt (opcode 20)", `#${p.saltN}`], ["opcode", "0x22 = 34", true], ["base spread", p.base + " bps"], ["min", p.min + " bps"], ["max", p.max + " bps"],
      ["rebalance gain", p.gain], ["freshness limit", p.maxAge + " s"]]
      .concat(p.assets.map(a => [`${nm[a.token] || short(a.token)} target`, `${a.target / 100}% · ${/^0x0+$/.test(a.feed) ? "$1" : "feed " + short(a.feed)}`]));
    $("bytes").innerHTML = chips.map(([k, v, ours]) => `<div class="byte ${ours ? "ours" : ""}"><b>${k}</b>${v}</div>`).join("");
  }
  if (!dep.curveOrder) return;
  const [maker] = coder.decode([ORDER], dep.curveOrder)[0];
  const basketHash = E.keccak256(coder.encode([ORDER], [listings[0].order])), curveHash = E.keccak256(dep.curveOrder);
  const [real, a, c] = await Promise.all([new E.Contract(WETH, ERC20, provider).balanceOf(maker), aqua.rawBalances(maker, dep.router, basketHash, WETH), aqua.rawBalances(maker, dep.officialRouter, curveHash, WETH)]);
  $("slWallet").textContent = `${fmt(Number(real) / 1e18, 4)} WETH`; $("slBasket").textContent = `${fmt(Number(a[0]) / 1e18, 4)} WETH`; $("slCurve").textContent = `${fmt(Number(c[0]) / 1e18, 4)} WETH`;
  $("slRatio").textContent = Number(real) ? `${fmt((Number(a[0]) + Number(c[0])) / Number(real) * 100, 0)}% of the real balance` : "–";
  barChart($("chShared"), [{ label: "real in wallet", v: Number(real) / 1e18, color: "#8b8a82" }, { label: "basket allocation", v: Number(a[0]) / 1e18, color: HEX[0] },
    { label: "curve allocation", v: Number(c[0]) / 1e18, color: "#4fd1db" }], { vFmt: v => fmt(v, 3), height: 170 });
}

function sourceOf(from) {
  const f = (from || "").toLowerCase();
  if (f === (dep.cliTrader || "").toLowerCase()) return { label: "terminal / API", cls: "src-cli" };
  if (f === (dep.uiTrader || "").toLowerCase()) return { label: "UI button", cls: "src-ui" };
  if (f === (dep.trader || "").toLowerCase()) return { label: "agent's simulated trader", cls: "src-agent" };
  const m = (dep.makers || []).find(x => x.address.toLowerCase() === f);
  if (m) return { label: `agent (as ${m.name})`, cls: "src-agent" };
  return { label: short(from), cls: "muted" };
}
async function fromOf(h) { if (!(h in txFrom)) { const t = await provider.getTransaction(h); txFrom[h] = t ? t.from : ""; } return txFrom[h]; }
async function timeOf(b) { if (!(b in blockTime)) { const x = await provider.getBlock(b); blockTime[b] = x ? x.timestamp : 0; } return blockTime[b]; }
function toast(html) { const el = document.createElement("div"); el.className = "toast"; el.innerHTML = html; $("toasts").prepend(el); setTimeout(() => el.classList.add("out"), 6500); setTimeout(() => el.remove(), 7200); }

async function renderActivity() {
  const latest = await provider.getBlockNumber(), from = Math.max(dep.deployBlock || 0, latest - 1900);
  const [fills, reps, pulls] = await Promise.all([hook.queryFilter(hook.filters.Filled(), from, latest), hook.queryFilter(hook.filters.Replaced(), from, latest),
    provider.getLogs({ address: dep.aqua, topics: [PULLED], fromBlock: from, toBlock: latest })]);
  const items = [], vol = {}, stats = {};
  for (const f of fills) {
    const [id, , tin, , ain, aout] = f.args, buy = tin.toLowerCase() === USDC.toLowerCase(), wid = Number(id);
    const usd = buy ? Number(ain) / 1e6 : Number(aout) / 1e6, name = nameOf(id);
    const desc = buy ? `$${fmt(Number(ain) / 1e6)} USDC → ${fmt(Number(aout) / 1e18, 5)} ETH` : `${fmt(Number(ain) / 1e18, 5)} ETH → $${fmt(Number(aout) / 1e6)} USDC`;
    stats[wid] = stats[wid] || { n: 0, vol: 0 }; stats[wid].n++; stats[wid].vol += usd;
    (vol[wid] = vol[wid] || []).push({ b: f.blockNumber, usd });
    items.push({ key: f.transactionHash + f.index, b: f.blockNumber, tx: f.transactionHash, wallet: wid,
      html: `<span class="un">Uniswap v4 swap</span> filled by <b>${name}</b>'s wallet via <span class="aq">Aqua/SwapVM</span>: ${desc}`,
      toast: `<span class="un">Uniswap swap</span> filled by <b>${name}</b>: ${desc}` });
  }
  fillStats = stats;
  $("kSwaps").textContent = fills.length; $("kVol").textContent = usd0(Object.values(stats).reduce((a, s) => a + s.vol, 0)); $("kRet").textContent = reps.length;
  for (const r of reps) items.push({ key: r.transactionHash + r.index, b: r.blockNumber, tx: r.transactionHash,
    html: `<span class="aq">Aqua</span>: <b>${nameOf(r.args[0])}</b> retired its strategy and shipped a retuned one (hook listing replaced)`,
    toast: `<span class="aq">Retune</span>: <b>${nameOf(r.args[0])}</b> shipped a new strategy` });
  const alice = dep.makers[0] ? dep.makers[0].address.toLowerCase() : "";
  for (const lg of pulls) {
    const [maker, app, , token, amount] = coder.decode(["address", "address", "bytes32", "address", "uint256"], lg.data);
    if (app.toLowerCase() !== (dep.officialRouter || "").toLowerCase() || maker.toLowerCase() !== alice) continue;
    const what = token.toLowerCase() === WETH.toLowerCase() ? `${fmt(Number(amount) / 1e18, 5)} ETH` : `$${fmt(Number(amount) / 1e6)} USDC`;
    items.push({ key: lg.transactionHash + lg.index, b: lg.blockNumber, tx: lg.transactionHash,
      html: `<span class="aq">Official 1inch router</span> trade filled from <b>alice</b>'s same wallet (plain curve): ${what} out`,
      toast: `<span class="aq">Official 1inch router</span> trade from <b>alice</b>'s wallet: ${what} out` });
  }
  items.sort((x, y) => y.b - x.b);
  const shown = items.slice(0, 50);
  await Promise.all(shown.map(async i => { i.src = sourceOf(await fromOf(i.tx)); }));
  const fresh = [];
  for (const i of shown) if (!seen.has(i.key)) { if (!firstFeed) { fresh.push(i); i.isNew = true; } seen.add(i.key); }
  for (const i of fresh.slice(0, 4).reverse()) toast(`${i.toast}<div class="tsrc ${i.src.cls}">from ${i.src.label}</div>`);
  const newFill = fresh.find(i => i.wallet !== undefined);
  if (newFill) { lightFlow(newFill.wallet); $("flowMsg").innerHTML = `${newFill.toast} <span class="srcpill ${newFill.src.cls}">from ${newFill.src.label}</span>`; }
  firstFeed = false;
  $("feed").innerHTML = shown.length ? shown.map(i => `<div class="ev ${i.isNew ? "fresh" : ""}">${i.html} <span class="srcpill ${i.src.cls}">${i.src.label}</span> <span class="muted">· block ${i.b} · tx ${short(i.tx)}</span></div>`).join("") : '<div class="empty">waiting for activity…</div>';

  await Promise.all([...new Set(fills.map(f => f.blockNumber))].map(timeOf));
  const t0 = fills.length ? blockTime[fills[0].blockNumber] : 0;
  const volSeries = (dep.makers || []).slice(0, 3).map((m, i) => {
    let c = 0; const pts = [{ x: t0, y: 0 }];
    for (const e of (vol[i] || [])) { c += e.usd; pts.push({ x: blockTime[e.b], y: c }); }
    return { name: m.name, color: HEX[i], points: fills.length ? pts : [], zero: true };
  });
  lineChart($("chVol"), volSeries, { yFmt: v => "$" + fmt(v, 0), step: true });
  barChart($("chFills"), (dep.makers || []).slice(0, 3).map((m, i) => ({ label: m.name, v: (stats[i] || { n: 0 }).n, color: HEX[i] })));
}

function renderAgent() {
  const evs = (state && state.events) || [];
  lineChart($("chPrice"), [{ name: "ETH/USD", color: HEX[0], points: evs.map(e => ({ x: e.t, y: e.live.eth / 1e8 })) }], { yFmt: v => "$" + fmt(v, 2) });
  const base = [8, 10, 12];
  lineChart($("chSpread"), (dep.makers || []).slice(0, 3).map((m, i) => {
    const pts = []; let cur = base[i];
    if (evs.length) pts.push({ x: evs[0].t, y: cur });
    for (const e of evs) for (const d of (e.decisions || [])) if (d.maker === m.name && d.ok) { cur = d.to; pts.push({ x: e.t, y: cur }); }
    return { name: m.name, color: HEX[i], points: pts, zero: true };
  }), { yFmt: v => fmt(v, 0) + " bps", step: true });
  const rows = evs.slice(-25).reverse().map(ev => {
    const ds = (ev.decisions || []).map(d => `${d.maker} ${d.from}→${d.to} bps${d.ok ? "" : " (failed)"}`).join(", "), r = regime(ev.live.move_bps);
    return `<div class="ev"><span class="good">tick ${ev.tick}</span> · ${new Date(ev.t * 1000).toLocaleTimeString()} · ETH $${fmt(ev.live.eth / 1e8)} · move ${ev.live.move_bps} bps${ev.scenario !== undefined ? " (scenario)" : ""} · <span class="${r.cls}">${r.name}</span> → ${ds || "no change"}${(ev.swept || []).length ? ` · swept ${ev.swept.map(s => s[0]).join(" & ")}` : ""}${ev.trade ? ` · simulated trader: ${ev.trade.what}` : ""}</div>`;
  });
  $("agentFeed").innerHTML = rows.length ? rows.join("") : '<div class="empty">waiting for the agent…</div>';
}

async function uniTrade(buy) {
  const usd = Number($("amt").value || 0); if (!usd) return;
  const amt = buy ? BigInt(Math.round(usd * 1e6)) : BigInt(Math.round(usd / ethPx * 1e18));
  const sw = new E.Contract(dep.swapper, SWAPPER, trader);
  $("tradeMsg").textContent = "sending swap through the Uniswap v4 pool…";
  try {
    const tx = await sw.swap([WETH, USDC, 0, 10, dep.hook], [!buy, -amt, buy ? MAX_SQRT : MIN_SQRT], [false, false], "0x");
    const rc = await tx.wait();
    const ev = rc.logs.map(l => { try { return hook.interface.parseLog(l); } catch { return null; } }).find(x => x && x.name === "Filled");
    const who = ev ? nameOf(ev.args[0]) : "?", got = ev ? (buy ? `${fmt(Number(ev.args[5]) / 1e18, 5)} ETH` : `$${fmt(Number(ev.args[5]) / 1e6)}`) : "";
    $("tradeMsg").innerHTML = `<span class="good">filled by ${who}</span>: got ${got} · tx ${short(rc.hash)}`;
  } catch (e) { trader.reset(); $("tradeMsg").innerHTML = `<span class="bad">swap reverted</span>: ${e.shortMessage || e.message}`; }
  refresh();
}

async function directTrade() {
  if (!dep.curveOrder) return;
  const o = coder.decode([ORDER], dep.curveOrder)[0], r = new E.Contract(dep.officialRouter, ROUTER, trader);
  $("directMsg").textContent = "sending a direct SwapVM trade to the official 1inch router…";
  try {
    const tx = await r.swap([o[0], o[1], o[2]], USDC, WETH, 20000000n, EOA_TRAITS); const rc = await tx.wait();
    $("directMsg").innerHTML = `<span class="good">filled from Alice's same wallet</span> by her plain curve on the official router · tx ${short(rc.hash)}`;
  } catch (e) { trader.reset(); $("directMsg").innerHTML = `<span class="bad">reverted</span>: ${e.shortMessage || e.message}`; }
  refresh();
}

async function callApi(spec) {
  const [method, path] = spec.split(" ");
  $("apiCurl").textContent = `curl${method === "POST" ? " -X POST" : ""} "${location.origin}${path}"`;
  $("apiOut").textContent = "…";
  try { const r = await fetch(path + (path.includes("?") ? "&" : "?") + "net=" + net, { method }); $("apiOut").textContent = JSON.stringify(await r.json(), null, 2); }
  catch (e) { $("apiOut").textContent = String(e); }
  if (method === "POST") refresh();
}

init().catch(e => { $("netLabel").innerHTML = `<span class="bad">could not load deployments/${net}.json — run ./scripts/start_local.sh first</span>`; console.error(e); });
