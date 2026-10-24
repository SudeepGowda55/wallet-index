"use client";
import { useEffect, useState } from "react";
import { Flow } from "@/components/Charts";
import { ASSETS, MAKERS, spreadBps } from "@/lib/skew";
import { fmt, HEX } from "@/lib/chain";

/** The routing diagram, cycling which wallet wins (illustration; the live page lights it from real fills). */
export function FlowCycle() {
  const [hot, setHot] = useState<number | null>(0);
  useEffect(() => { const t = setInterval(() => setHot(h => h === null ? 0 : h === 2 ? null : h + 1), 1800); return () => clearInterval(t); }, []);
  return <div className="panel flow" data-reveal><Flow makers={MAKERS} hot={hot} />
    <p className="muted cap">Illustration: the hook asks every wallet, the router prices each with opcode 34 against Chainlink, the cheapest fills.</p></div>;
}

/** Signature: drag a wallet off target and see what opcode 34 charges each direction. */
export function Simulator() {
  const [mk, setMk] = useState(0), [drift, setDrift] = useState(15), [size, setSize] = useState(1000);
  const m = MAKERS[mk], total = 10_000;
  const w = [m.targets[0] / 100 + drift, m.targets[1] / 100 - drift, m.targets[2] / 100];
  const usd = w.map(x => Math.max(0, x) / 100 * total);
  const buy = spreadBps(usd, m.targets, m.base, 1, 0, size), sell = spreadBps(usd, m.targets, m.base, 0, 1, size);
  const Bar = ({ label, v, help }: { label: string; v: number; help: boolean }) => <div className="sim-bar">
    <div className="row-between"><span>{label}</span><b className={help ? "good" : v > m.base ? "bad" : ""}>{v} bps</b></div>
    <div className="track big"><span style={{ width: `${v / 40 * 100}%`, background: help ? "var(--good)" : v > m.base ? "var(--bad)" : "var(--ink2)" }} /><i style={{ left: `${m.base / 40 * 100}%` }} title="base spread" /></div>
  </div>;
  return <div className="panel sim" data-reveal>
    <div className="sim-controls">
      <div className="seg" role="radiogroup" aria-label="Wallet">{MAKERS.map((x, i) => <button key={x.name} role="radio" aria-checked={mk === i} className={mk === i ? "on" : ""} onClick={() => setMk(i)}><span className="dot" style={{ background: HEX[i] }} />{x.name}</button>)}</div>
      <label>ETH drift from target <b className="mono">{drift > 0 ? "+" : ""}{drift} pts</b>
        <input type="range" min={-25} max={25} value={drift} onChange={e => setDrift(Number(e.target.value))} /></label>
      <label>Trade size <b className="mono">${fmt(size, 0)}</b> <span className="muted">of a $10k wallet</span>
        <input type="range" min={100} max={4000} step={100} value={size} onChange={e => setSize(Number(e.target.value))} /></label>
    </div>
    <div className="sim-out">
      <div className="mix">{ASSETS.map((a, i) => <div key={a} className="asset"><span className="t2">{a}</span>
        <div className="track"><span style={{ width: `${Math.max(0, w[i])}%`, background: ["var(--eth)", "var(--usdc)", "var(--btc)"][i] }} /><i style={{ left: `${m.targets[i] / 100}%` }} /></div>
        <span className="v mono">{fmt(w[i], 0)}% <span className="muted">/ {m.targets[i] / 100}%</span></span></div>)}</div>
      <Bar label="Trader buys ETH from the wallet" v={buy} help={buy < m.base} />
      <Bar label="Trader sells ETH to the wallet" v={sell} help={sell < m.base} />
      <p className="muted cap">Simulation of the on-chain formula (port of <code>PortfolioSkewInstruction.sol</code>, deployed parameters: base {m.base} bps, min 1, max 40, gain 100). Tick = base spread.</p>
    </div>
  </div>;
}
