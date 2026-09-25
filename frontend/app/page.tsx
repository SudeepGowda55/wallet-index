"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Chain, fmt, HEX, short, usd0 } from "@/lib/chain";
import { Flow } from "@/components/Charts";
import { ActivityRow, Agent, ApiConsole, BarChart, Evidence, Kpis, LineChart, Protocol, WalletCard } from "@/components/Sections";

type Toast = { id: number; html: React.ReactNode; src: any };
const SECTIONS = ["overview", "flow", "wallets", "charts", "trade", "protocol", "agent", "activity", "api", "evidence"];

export default function Page() {
  const chain = useRef<Chain | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const first = useRef(true);
  const [net, setNet] = useState("local");
  const [err, setErr] = useState("");
  const [m, setM] = useState<any>(null);
  const [state, setState] = useState<any>(null);
  const [wallets, setWallets] = useState<any[]>([]);
  const [best, setBest] = useState<any>({ buy: -1, sell: -1 });
  const [ladders, setLadders] = useState<any>({});
  const [shared, setShared] = useState<any>(null);
  const [act, setAct] = useState<any>({ items: [], stats: {}, swaps: 0, retunes: 0, volume: 0, volSeries: [] });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hot, setHot] = useState<number | null>(null);
  const [flowMsg, setFlowMsg] = useState<React.ReactNode>("waiting for the next fill…");
  const [amt, setAmt] = useState(500);
  const [tradeMsg, setTradeMsg] = useState<any>(null);
  const [directMsg, setDirectMsg] = useState<any>(null);

  const toast = (html: React.ReactNode, src: any) => {
    const id = Date.now() + Math.random();
    setToasts(t => [{ id, html, src }, ...t].slice(0, 5));
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 7000);
  };

  const refresh = useCallback(async () => {
    const c = chain.current; if (!c) return;
    try {
      const mk = await c.market(); setM(mk);
      try { setState(await (await fetch(`/deployments/${c.net}.state.json?${Date.now()}`)).json()); } catch { setState(null); }
      const ls = await c.listings();
      const [ws, b] = await Promise.all([c.wallets(ls, mk.ethPx, mk.btcPx), c.best(mk.ethPx)]);
      setWallets(ws); setBest(b);
      if (ls.length) setShared(await c.shared(ls[0].order));
      const a = await c.activity();
      const fresh: any[] = [];
      for (const i of a.items) if (!seen.current.has(i.key)) { if (!first.current) { fresh.push(i); i.isNew = true; } seen.current.add(i.key); }
      first.current = false;
      for (const i of fresh.slice(0, 4).reverse()) {
        const txt = i.kind === "fill" ? <><span className="un">Uniswap swap</span> filled by <b>{i.name}</b>: {i.desc}</>
          : i.kind === "retune" ? <><span className="aq">Retune</span>: <b>{i.name}</b> shipped a new strategy</>
          : <><span className="aq">Official 1inch router</span> trade from <b>alice</b>&apos;s wallet: {i.desc} out</>;
        toast(txt, i.src);
      }
      const nf = fresh.find(i => i.kind === "fill");
      if (nf) { setHot(nf.wallet); setTimeout(() => setHot(null), 7000); setFlowMsg(<><span className="un">Uniswap swap</span> filled by <b>{nf.name}</b>: {nf.desc} <span className={`srcpill ${nf.src.cls}`}>from {nf.src.label}</span></>); }
      setAct(a); setErr("");
    } catch (e: any) { setErr(e.shortMessage || e.message); }
  }, []);

  const loadLadders = useCallback(async () => {
    const c = chain.current; if (!c) return;
    try { const mk = await c.market(); setLadders(await c.ladders(await c.listings(), mk.ethPx)); } catch {}
  }, []);

  useEffect(() => {
    const n = new URLSearchParams(location.search).get("net") || "local"; setNet(n);
    let t1: any, t2: any;
    (async () => {
      try {
        const dep = await (await fetch(`/deployments/${n}.json?${Date.now()}`)).json();
        chain.current = new Chain(dep, n);
        await refresh(); t1 = setInterval(refresh, 5000);
        await loadLadders(); t2 = setInterval(loadLadders, 15000);
      } catch { setErr(`could not load deployments/${n}.json — run ./scripts/start_local.sh first`); }
    })();
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [refresh, loadLadders]);

  const c = chain.current, dep = c?.dep;
  const last = state?.events?.[state.events.length - 1];
  const bestCost = best.buy >= 0 && m ? (1 - Number(best.buyOut) / 1e18 / (500 / m.ethPx)) * 1e4 : null;
  const kpi = {
    liquidity: usd0(wallets.reduce((a, w) => a + w.tot, 0)), listed: wallets.filter(w => w.l.active).length, swaps: act.swaps, volume: usd0(act.volume), retunes: act.retunes,
    bestCost: bestCost != null ? <>{fmt(bestCost, 1)} <span style={{ fontSize: 15 }} className="t2">bps</span></> : <span className="bad">none</span>,
    bestFrom: best.buy >= 0 && c ? `from ${c.nameOf(best.buy)}'s wallet, vs Chainlink` : "every wallet refused (stale price?)",
    ageNode: m ? <span className={m.age > (dep?.maxAge || 3600) ? "bad" : m.age > (dep?.maxAge || 3600) * 0.7 ? "warn" : "good"}>{m.age}s</span> : "–",
    maxAge: dep?.maxAge || 3600, agentLast: last,
  };
  const agentAgo = state?.updated ? Math.floor(Date.now() / 1000) - state.updated : null;
  const evs = state?.events || [];
  const base = [8, 10, 12];

  return (<>
    <div id="toasts">{toasts.map(t => <div key={t.id} className="toast">{t.html}<div className={`tsrc ${t.src.cls}`}>from {t.src.label}</div></div>)}</div>
    <header><div className="wrap hdr">
      <div className="brand">WalletIndex<small>{err ? <span className="bad">{err}</span> : dep ? (dep.network === "local" ? "local fork of Base mainnet · chain 8453" : "Base mainnet") : "loading…"}</small></div>
      <nav>{SECTIONS.map(s => <a key={s} href={`#${s}`}>{s === "api" ? "API" : s === "flow" ? "Live flow" : s[0].toUpperCase() + s.slice(1)}</a>)}</nav>
      <div className="hdr-right"><span className="pill">block {m?.block ?? "–"}</span><span className="pill">agent {agentAgo != null ? <span className={agentAgo < 120 ? "good" : "warn"}>{agentAgo}s ago</span> : "–"}</span></div>
    </div></header>

    <main className="wrap">
      <section className="hero" id="overview">
        <h1>Wallets that market-make on <span className="u">Uniswap v4</span>, priced by a new <span className="a">1inch SwapVM</span> instruction, with money that never leaves <span className="a">Aqua</span> wallets.</h1>
        <p className="lede">Each wallet sets target weights. Every swap in the Uniswap pool is quoted against every wallet and filled by the cheapest; trades that pull a wallet back toward its targets are charged less. An agent retunes every wallet on-chain as the live market changes.</p>
        <Kpis d={kpi} />
      </section>

      <section id="flow"><h2>Live flow</h2><p className="lede">Every real fill lights up the path it took and the wallet that won it.</p>
        <div className="panel flow"><Flow makers={dep?.makers || []} hot={hot} /><div className="t2" style={{ marginTop: 8 }}>{flowMsg}</div></div></section>

      <section id="wallets"><h2>Wallets</h2>
        <p className="lede">Each card is one maker&apos;s own wallet. Bars show the real mix against the target (white tick). The ladder is the live cost of trading with that wallet right now, in bps versus Chainlink; the cheapest wallet per column is green.</p>
        <div className="grid g-3">{wallets.length ? wallets.map((w, i) => <WalletCard key={w.l.id} w={w} idx={i} dep={dep} ladders={ladders} best={best} stats={act.stats} />) : <div className="panel empty">loading wallets…</div>}</div></section>

      <section id="charts"><h2>Charts</h2><div className="grid g-2">
        <div className="panel"><h3>ETH/USD the wallets priced with</h3><div className="t2" style={{ fontSize: 13 }}>live Base Chainlink answers, recorded by the agent each tick</div>
          <LineChart series={[{ name: "ETH/USD", color: HEX[0], points: evs.map((e: any) => ({ x: e.t, y: e.live.eth / 1e8 })) }]} yFmt={v => "$" + fmt(v, 2)} /></div>
        <div className="panel"><h3>Cumulative volume filled, per wallet</h3><div className="t2" style={{ fontSize: 13 }}>USD, from on-chain Filled events</div>
          <LineChart series={act.volSeries} yFmt={v => "$" + fmt(v, 0)} step /></div>
        <div className="panel"><h3>Base spread set by the agent, per wallet</h3><div className="t2" style={{ fontSize: 13 }}>bps; each step is an on-chain retune</div>
          <LineChart step yFmt={v => fmt(v, 0) + " bps"} series={(dep?.makers || []).slice(0, 3).map((mk: any, i: number) => {
            const pts: any[] = []; let cur = base[i]; if (evs.length) pts.push({ x: evs[0].t, y: cur });
            for (const e of evs) for (const d of e.decisions || []) if (d.maker === mk.name && d.ok) { cur = d.to; pts.push({ x: e.t, y: cur }); }
            return { name: mk.name, color: HEX[i], points: pts, zero: true }; })} /></div>
        <div className="panel"><h3>Uniswap swaps won, per wallet</h3><div className="t2" style={{ fontSize: 13 }}>count of fills each wallet won</div>
          <BarChart bars={(dep?.makers || []).slice(0, 3).map((mk: any, i: number) => ({ label: mk.name, v: (act.stats[i] || { n: 0 }).n, color: HEX[i] }))} /></div>
      </div></section>

      <section id="trade"><h2>Trade</h2><div className="grid g-2">
        <div className="panel"><h3>Through the <span className="un">Uniswap v4</span> pool</h3><p className="t2" style={{ marginTop: 0 }}>Quoted against every wallet, filled by the cheapest.</p>
          <div className="row"><input id="amt" type="number" value={amt} min={1} onChange={e => setAmt(Number(e.target.value))} /><span className="muted">USD</span>
            <button id="buy" className="primary" disabled={!c?.trader} onClick={async () => { setTradeMsg("sending swap through the Uniswap v4 pool…"); const r = await c!.uniTrade(true, amt, m.ethPx); setTradeMsg(<span className={r.ok ? "good" : "bad"}>{r.msg}</span>); refresh(); }}>Buy ETH</button>
            <button id="sell" className="primary" disabled={!c?.trader} onClick={async () => { setTradeMsg("sending swap through the Uniswap v4 pool…"); const r = await c!.uniTrade(false, amt, m.ethPx); setTradeMsg(<span className={r.ok ? "good" : "bad"}>{r.msg}</span>); refresh(); }}>Sell ETH</button></div>
          <div className="kv" style={{ marginTop: 10 }}><span className="k">Best wallet to buy ETH from</span><span className="v" id="bestBuy">{best.buy >= 0 && c && m ? `${c.nameOf(best.buy)} · ${fmt(Number(best.buyOut) / 1e18, 5)} ETH for $500 (${fmt(bestCost, 1)} bps)` : "no wallet can fill"}</span></div>
          <div className="kv"><span className="k">Best wallet to sell ETH to</span><span className="v" id="bestSell">{best.sell >= 0 && c ? `${c.nameOf(best.sell)} · $${fmt(Number(best.sellOut) / 1e6)} for $500 of ETH (${fmt((1 - Number(best.sellOut) / 1e6 / 500) * 1e4, 1)} bps)` : "no wallet can fill"}</span></div>
          <div className="t2" id="tradeMsg" style={{ marginTop: 8 }}>{tradeMsg || "–"}</div></div>
        <div className="panel"><h3>Directly on the <span className="aq">official 1inch router</span></h3><p className="t2" style={{ marginTop: 0 }}>Alice&apos;s same wallet also backs a plain curve on 1inch&apos;s unmodified router: one balance, two strategies.</p>
          <div className="row"><button id="direct" disabled={!c?.trader} onClick={async () => { setDirectMsg("sending a direct SwapVM trade to the official 1inch router…"); const r = await c!.directTrade(); setDirectMsg(<span className={r.ok ? "good" : "bad"}>{r.msg}</span>); refresh(); }}>Buy $20 ETH from Alice&apos;s plain curve</button></div>
          <div className="t2" id="directMsg" style={{ marginTop: 8 }}>{directMsg || "–"}</div></div>
      </div></section>

      <section id="protocol"><h2>Protocol</h2>{dep && <Protocol p={wallets[0]?.p} shared={shared} dep={dep} />}</section>
      <section id="agent"><h2>Agent</h2><Agent state={state} /></section>
      <section id="activity"><h2>On-chain activity</h2><p className="lede">Every row is a real transaction. The label says who sent it: the terminal/API, a UI button, or the agent.</p>
        <div className="panel"><div className="feed" id="feed">{act.items.length ? act.items.map((i: any) => <ActivityRow key={i.key} i={i} />) : <div className="empty">waiting for activity…</div>}</div></div></section>
      <section id="api"><h2>API console</h2><p className="lede">The same data and actions over HTTP. Each button calls the live API and shows the exact curl command.</p><ApiConsole net={net} onPost={refresh} /></section>
      <section id="evidence"><h2>Evidence (recorded on real Ethereum mainnet state)</h2>
        <p className="lede">A 5-currency basket (USD / EUR / JPY / CHF / SGD) on the same instruction, against today&apos;s real route through USDC on real Uniswap v4 pools. Reproduce: <code>forge test --match-contract FxEvidenceEthereumTest -vv</code></p><Evidence /></section>
      <footer>WalletIndex · official 1inch Aqua &amp; SwapVM, Uniswap v4, Chainlink · built with Next.js · {dep?.mirror ? "local fork: the agent mirrors live Base Chainlink answers into on-chain MirrorFeeds each tick" : "Base mainnet, live Chainlink feeds"} · router {short(dep?.router)}</footer>
    </main>
  </>);
}
