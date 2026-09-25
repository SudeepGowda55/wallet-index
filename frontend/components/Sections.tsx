"use client";
import { useState } from "react";
import { BarChart, LineChart } from "./Charts";
import { BTC, fmt, HEX, LADDER, regime, short, USDC, WETH } from "@/lib/chain";

const ASSETS = ["ETH", "USDC", "cbBTC"];
const argmin = (arr: (number | null)[]) => { let b = -1, bv = Infinity; arr.forEach((v, i) => { if (v != null && v < bv) { bv = v; b = i; } }); return b; };

export function Kpis({ d }: { d: any }) {
  const last = d.agentLast, reg = last ? regime(last.live.move_bps) : null;
  const tiles: [string, React.ReactNode, React.ReactNode][] = [
    ["Liquidity in wallets", d.liquidity, `${d.listed} wallets listed, money stays in each`],
    ["Swaps filled via Uniswap", d.swaps, "since deployment"],
    ["Volume routed", d.volume, "USDC side of each fill"],
    ["Best price now ($500 buy)", d.bestCost, d.bestFrom],
    ["On-chain retunes", d.retunes, "Aqua dock + ship + replace"],
    ["Live Base ETH/USD", last ? "$" + fmt(last.live.eth / 1e8) : "–", last ? `Chainlink, ${last.live.age_s}s old at the last tick` : "Chainlink"],
    ["Price freshness", d.ageNode, `wallets refuse to quote past ${d.maxAge}s`],
    ["Agent's market reading", reg ? <span className={reg.cls}>{reg.name}</span> : "–", last ? `largest move ${last.live.move_bps} bps${last.scenario !== undefined ? " (scenario)" : ""}` : "–"],
  ];
  return <div className="grid g-kpi">{tiles.map(([k, v, s]) => <div key={k} className="panel kpi"><div className="k">{k}</div><div className="v">{v}</div><div className="s">{s}</div></div>)}</div>;
}

export function WalletCard({ w, idx, dep, ladders, best, stats }: any) {
  const id = w.l.id, m = dep.makers[id] || { name: "maker " + id }, color = HEX[idx % 3];
  const ids = Object.keys(ladders);
  const win = (side: "buy" | "sell") => LADDER.map((_, i) => ids[argmin(ids.map(x => ladders[x][side][i]))]);
  const wB = win("buy"), wS = win("sell"), lad = ladders[id], fs = stats[id] || { n: 0, vol: 0 };
  const amounts = [fmt(w.bal[0] / 1e18, 4), fmt(w.bal[1] / 1e6, 2), fmt(w.bal[2] / 1e8, 5)];
  const cell = (v: number | null, isWin: boolean, k: number) => v == null ? <td key={k} className="muted">refuses</td> : <td key={k} className={isWin ? "win" : ""}>{fmt(v, 1)}</td>;
  return (
    <div className={`panel wallet ${id === best.buy || id === best.sell ? "best" : ""}`}>
      <div className="whead"><span className="dot" style={{ background: color, width: 12, height: 12 }} /><span className="wname">{m.name}</span>
        {id === best.buy && <span className="badge">best to buy ETH from</span>}{id === best.sell && <span className="badge">best to sell ETH to</span>}</div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{short(w.l.order[0])} · {w.l.active ? <span className="good">listed</span> : <span className="bad">delisted</span>} · strategy #{w.p?.saltN ?? "?"} · base spread <b style={{ color: "var(--text)" }}>{w.p?.base ?? "?"} bps</b></div>
      <div className="kv"><span className="k">Wallet value</span><span className="v"><b>${fmt(w.tot)}</b></span></div>
      <div className="kv"><span className="k">Holdings</span><span className="v">{amounts.map((a, i) => `${a} ${ASSETS[i]}`).join(" · ")}</span></div>
      <div style={{ margin: "10px 0 2px" }} className="muted">Mix vs target</div>
      {ASSETS.map((n, i) => { const pct = w.tot ? w.v[i] / w.tot * 100 : 0, tgt = w.p ? w.p.assets[i].target / 100 : 0;
        return <div key={n} className="asset"><span className="t2">{n}</span><div className="track" title={`${fmt(pct, 1)}% now, target ${fmt(tgt, 0)}%`}><span style={{ width: `${Math.min(100, pct)}%`, background: color }} /><i style={{ left: `${tgt}%` }} /></div><span className="v">{fmt(pct, 1)}% <span className="muted">/ {fmt(tgt, 0)}%</span></span></div>; })}
      {lad ? <table className="ladder"><thead><tr><th>cost, bps</th>{LADDER.map(u => <th key={u}>${u >= 1000 ? u / 1000 + "k" : u}</th>)}</tr></thead><tbody>
        <tr><td>buy ETH</td>{lad.buy.map((v: any, i: number) => cell(v, wB[i] === String(id), i))}</tr>
        <tr><td>sell ETH</td>{lad.sell.map((v: any, i: number) => cell(v, wS[i] === String(id), i))}</tr></tbody></table>
        : <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>quote ladder loading…</div>}
      <div className="kv" style={{ marginTop: 8 }}><span className="k">Uniswap swaps won</span><span className="v">{fs.n} · ${fmt(fs.vol, 0)}</span></div>
    </div>
  );
}

export function Protocol({ p, shared, dep }: any) {
  const nm: Record<string, string> = { [WETH.toLowerCase()]: "WETH", [USDC.toLowerCase()]: "USDC", [BTC.toLowerCase()]: "cbBTC" };
  const chips: [string, string, boolean?][] = p ? [["salt (opcode 20)", `#${p.saltN}`], ["opcode", "0x22 = 34", true], ["base spread", p.base + " bps"], ["min", p.min + " bps"], ["max", p.max + " bps"],
    ["rebalance gain", String(p.gain)], ["freshness limit", p.maxAge + " s"], ...p.assets.map((a: any) => [`${nm[a.token] || short(a.token)} target`, `${a.target / 100}% · ${/^0x0+$/.test(a.feed) ? "$1" : "feed " + short(a.feed)}`] as [string, string])] : [];
  const contracts = [["WalletIndexRouter (SwapVM + opcode 34)", dep.router], ["WalletIndex hook (Uniswap v4)", dep.hook], ["1inch Aqua (official)", dep.aqua],
    ["1inch AquaSwapVMRouter (official)", dep.officialRouter], ["Uniswap v4 PoolManager", "0x498581fF718922c3f8e6A244956aF099B2652b2b"], ["ETH/USD price feed", dep.feedEth]];
  const safety = [["Stale price (past the freshness limit)", "every wallet refuses to quote"], ["Wallet over-committed across strategies", "drops out, routing falls back"],
    ["Maker value at the oracle", "never decreases (fuzzed)"], ["Round trip by a taker", "always costs the taker"], ["Third-party liquidity / exact-output", "rejected"],
    ["Hook float runs dry", "clean revert; permissionless sweep refills"]];
  return (
    <div className="grid g-2">
      <div className="panel"><h3><span className="aq">SwapVM</span> program of Alice&apos;s basket</h3>
        <p className="t2" style={{ marginTop: 0 }}>Read live from the hook listing. Opcode 34 is our native instruction, appended after 1inch&apos;s 34 official opcodes.</p>
        <div className="code">{p ? <><span className="muted">{p.salt}</span> <span style={{ color: "var(--aqua)", fontWeight: 700 }}>{p.op}</span> <span className="muted">{p.lenHex}</span> {p.args}</> : "–"}</div>
        <div className="bytes">{chips.map(([k, v, ours]) => <div key={k} className={`byte ${ours ? "ours" : ""}`}><b>{k}</b>{v}</div>)}</div></div>
      <div className="panel"><h3><span className="aq">1inch Aqua</span> shared liquidity: Alice</h3>
        <p className="t2" style={{ marginTop: 0 }}>One wallet balance backs several strategies. The basket never quotes more than the wallet really holds.</p>
        {shared && <><BarChart height={170} vFmt={v => fmt(v, 3)} bars={[{ label: "real in wallet", v: shared.real, color: "#8b8a82" }, { label: "basket allocation", v: shared.basket, color: HEX[0] }, { label: "curve allocation", v: shared.curve, color: "#4fd1db" }]} />
          <div className="kv"><span className="k">Real WETH in Alice&apos;s wallet</span><span className="v">{fmt(shared.real, 4)} WETH</span></div>
          <div className="kv"><span className="k">Allocated to the basket (our router, via Uniswap)</span><span className="v">{fmt(shared.basket, 4)} WETH</span></div>
          <div className="kv"><span className="k">Allocated to the plain curve (official 1inch router)</span><span className="v">{fmt(shared.curve, 4)} WETH</span></div>
          <div className="kv"><span className="k">Total allocated vs held</span><span className="v">{shared.real ? fmt((shared.basket + shared.curve) / shared.real * 100, 0) + "% of the real balance" : "–"}</span></div></>}
      </div>
      <div className="panel"><h3>Contracts</h3>{contracts.map(([k, v]) => <div key={k} className="kv"><span className="k">{k}</span><span className="v" style={{ fontFamily: "ui-monospace,Menlo,monospace", fontSize: 12.5 }} title={v}>{short(v)}</span></div>)}</div>
      <div className="panel"><h3>Safety guarantees (tested on mainnet forks)</h3>{safety.map(([k, v]) => <div key={k} className="kv"><span className="k">{k}</span><span className="v">{v}</span></div>)}</div>
    </div>
  );
}

export function Agent({ state }: { state: any }) {
  const evs = state?.events || [], last = evs[evs.length - 1], reg = last ? regime(last.live.move_bps) : null;
  return (
    <div className="grid g-2">
      <div className="panel"><h3>Current decision</h3>
        <div className="kv"><span className="k">Largest move, last 8 Chainlink rounds</span><span className="v">{last ? `${last.live.move_bps} bps${last.scenario !== undefined ? " (scenario)" : ""}` : "–"}</span></div>
        <div className="kv"><span className="k">Regime</span><span className="v">{reg ? <><span className={reg.cls}>{reg.name}</span> → {reg.rule}</> : "–"}</span></div>
        <div className="kv"><span className="k">Rule</span><span className="v t2">calm &lt;15 bps → tighten · normal · jumpy ≥40 bps → widen</span></div>
        <div className="kv"><span className="k">Last tick</span><span className="v">{last ? `tick ${last.tick} · ${new Date(last.t * 1000).toLocaleTimeString()}` : "–"}</span></div>
        <div className="kv"><span className="k">Keeper</span><span className="v">{last && (last.swept || []).length ? `swept ${last.swept.map((s: any) => s[0]).join(" & ")} claims back into the hook float` : "float healthy"}</span></div></div>
      <div className="panel"><h3>Decision timeline</h3><div className="feed">{evs.length ? evs.slice(-25).reverse().map((ev: any) => {
        const ds = (ev.decisions || []).map((x: any) => `${x.maker} ${x.from}→${x.to} bps${x.ok ? "" : " (failed)"}`).join(", "), r = regime(ev.live.move_bps);
        return <div key={ev.t + "-" + ev.tick} className="ev"><span className="good">tick {ev.tick}</span> · {new Date(ev.t * 1000).toLocaleTimeString()} · ETH ${fmt(ev.live.eth / 1e8)} · move {ev.live.move_bps} bps{ev.scenario !== undefined ? " (scenario)" : ""} · <span className={r.cls}>{r.name}</span> → {ds || "no change"}{(ev.swept || []).length ? ` · swept ${ev.swept.map((s: any) => s[0]).join(" & ")}` : ""}{ev.trade ? ` · simulated trader: ${ev.trade.what}` : ""}</div>;
      }) : <div className="empty">waiting for the agent…</div>}</div></div>
    </div>
  );
}

export function ActivityRow({ i }: { i: any }) {
  const body = i.kind === "fill" ? <><span className="un">Uniswap v4 swap</span> filled by <b>{i.name}</b>&apos;s wallet via <span className="aq">Aqua/SwapVM</span>: {i.desc}</>
    : i.kind === "retune" ? <><span className="aq">Aqua</span>: <b>{i.name}</b> retired its strategy and shipped a retuned one (hook listing replaced)</>
    : <><span className="aq">Official 1inch router</span> trade filled from <b>alice</b>&apos;s same wallet (plain curve): {i.desc} out</>;
  return <div className={`ev ${i.isNew ? "fresh" : ""}`}>{body} <span className={`srcpill ${i.src.cls}`}>{i.src.label}</span> <span className="muted">· block {i.b} · tx {short(i.tx)}</span></div>;
}

export function ApiConsole({ net, onPost }: { net: string; onPost: () => void }) {
  const [curl, setCurl] = useState("curl …"), [out, setOut] = useState("{ }");
  const calls = [["GET", "/api/status", "GET /api/status"], ["GET", "/api/wallets?usd=500", "GET /api/wallets"], ["GET", "/api/quote?side=buy&usd=500", "GET /api/quote (buy $500)"],
    ["GET", "/api/quote?side=sell&usd=500", "GET /api/quote (sell $500)"], ["POST", "/api/swap?side=buy&usd=250", "POST /api/swap (buy $250)"]];
  const call = async (method: string, path: string) => {
    setCurl(`curl${method === "POST" ? " -X POST" : ""} "${location.origin}${path}"`); setOut("…");
    try { const r = await fetch(path + (path.includes("?") ? "&" : "?") + "net=" + net, { method }); setOut(JSON.stringify(await r.json(), null, 2)); } catch (e) { setOut(String(e)); }
    if (method === "POST") onPost();
  };
  return <div className="panel">
    <div className="row">{calls.map(([m, p, label]) => <button key={label} className={m === "POST" ? "primary" : ""} onClick={() => call(m, p)}>{label}</button>)}</div>
    <div className="code" style={{ marginTop: 12 }}>{curl}</div><pre className="json">{out}</pre></div>;
}

export function Evidence() {
  const rows = [["$1,000", 18, 4], ["$10,000", 31, 7], ["$50,000", 158, 15]];
  return <div className="grid g-2">
    <div className="panel scroll-x"><table className="ev-table"><thead><tr><th>EUR → JPY size</th><th>Today: EUR→USDC→JPY</th><th>WalletIndex basket</th><th>Saving</th></tr></thead>
      <tbody>{rows.map(([s, a, b]) => <tr key={s as string}><td>{s}</td><td>{a} bps</td><td>{b} bps</td><td className="good">{(a as number) - (b as number)} bps</td></tr>)}</tbody></table>
      <p className="t2" style={{ fontSize: 13 }}>JPY→SGD and JPY→CHF, which have no pool at all, fill directly within 0.2% of the live cross rate.</p></div>
    <div className="panel"><h3>Cost of a $50k EUR→JPY trade</h3><BarChart vFmt={v => fmt(v, 0) + " bps"} bars={[{ label: "Today (two hops via USDC)", v: 158, color: "#8b8a82" }, { label: "WalletIndex basket", v: 15, color: HEX[0] }]} /></div>
  </div>;
}

export { LineChart, BarChart };
