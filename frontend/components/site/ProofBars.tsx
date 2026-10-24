"use client";
// Scroll-scrubbed race: today's two-hop route vs one WalletIndex hop, bars and counters driven by scroll.
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const ROWS: [string, number, number][] = [["$1,000", 18, 4], ["$10,000", 31, 7], ["$50,000", 158, 15]];
const MAX = 158;

export default function ProofBars() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const els = [...root.current!.querySelectorAll<HTMLElement>("[data-v]")];
    const st = ScrollTrigger.create({ trigger: root.current, start: "top 85%", end: "bottom 45%", scrub: 0.5, onUpdate: s => {
      els.forEach((el, i) => { const p = gsap.utils.clamp(0, 1, s.progress * 1.4 - (i % 2) * 0.15 - Math.floor(i / 2) * 0.1), v = Number(el.dataset.v);
        (el.firstElementChild as HTMLElement).style.width = `${v / MAX * 100 * p}%`; el.querySelector("b")!.textContent = String(Math.round(v * p)); });
    } });
    return () => st.kill();
  }, []);
  return <div className="race" ref={root} role="table" aria-label="EUR to JPY cost in bps: today vs WalletIndex">
    {ROWS.map(([size, today, ours]) => <div key={size} className="race-row" role="row">
      <span className="race-size mono" role="rowheader">{size}</span>
      <div role="cell" aria-label={`today ${today} bps`} className="race-bar today" data-v={today}><span /><em><b>0</b> bps · today, EUR→USDC→JPY</em></div>
      <div role="cell" aria-label={`WalletIndex ${ours} bps`} className="race-bar ours" data-v={ours}><span /><em><b>0</b> bps · WalletIndex, one hop</em></div>
    </div>)}
  </div>;
}
