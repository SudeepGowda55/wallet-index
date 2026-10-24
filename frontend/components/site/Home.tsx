"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { HERO, scene, sim } from "@/lib/story";
import { fmt, HEX } from "@/lib/chain";
import { MAKERS } from "@/lib/skew";
import { Split } from "./Kinetic";

// start fetching the 3D chunk while the page hydrates
const load = () => import("@/components/three/Terrain");
const early = typeof window !== "undefined" ? load() : null;
const Terrain = dynamic(() => early ?? load(), { ssr: false });

const CHAPTERS = [
  ["Money stays home.", "Each basin is one maker's own wallet: Alice, Bob and Carol, holding ETH, USDC and cbBTC against target weights. 1inch Aqua ships the basket as a strategy. Nothing is deposited, nothing is locked.", "Basin depth = how cheap that wallet is to trade with right now."],
  ["Off target is uphill.", "Prices push wallets off their targets. Opcode 34, our SwapVM instruction, charges more for trades that tip a wallet further and less for trades that bring it back. Every wallet here is off target, so the whole land rises.", "All three wallets pushed off target."],
  ["Flow runs downhill.", "Each swap in the Uniswap v4 pool is quoted against every wallet and filled by the cheapest: the deepest basin. The fill rebalances that wallet, its basin rises, and the stream swings to the next one on its own.", "Watch the flow share rotate between wallets."],
  ["The agent keeps the weather.", "An agent reads live Chainlink rounds. When the market turns jumpy it widens every wallet's spread on-chain and the land turns rough. When it calms, it tightens them again.", "Rough land = wide spreads."],
];
// camera + simulation pose per chapter (the timeline tweens `scene` through these)
const POSE = [
  { fx: -4.4, fz: 1.6, dist: 6.2, lift: 4, orbit: -0.4, shift: 0.17, rise: 0, flow: 0.25, skew: 0, vol: 0 },
  { fx: 0, fz: 0.4, dist: 10.5, lift: 6, orbit: 0.55, shift: 0.15, flow: 0.12, skew: 1, vol: 0 },
  { fx: 0, fz: -1.2, dist: 8.6, lift: 4.6, orbit: Math.PI, shift: 0.15, flow: 1, skew: 0, vol: 0 },
  { fx: 0, fz: 0.4, dist: 14, lift: 9.5, orbit: Math.PI * 2, shift: 0.15, flow: 1, skew: 0, vol: 1 },
];

type Live = { wallets?: any[]; error?: string } | null;

export default function Home() {
  const story = useRef<HTMLElement>(null), labels = useRef<(HTMLDivElement | null)[]>([]), shares = useRef<(HTMLElement | null)[]>([]), gauge = useRef<HTMLDivElement>(null);
  const [chap, setChap] = useState(-1), [ready, setReady] = useState(false), [live, setLive] = useState<Live>(null);

  useEffect(() => {
    Object.assign(scene, HERO, { dist: 22, lift: 13 });
    const intro = gsap.to(scene, { dist: HERO.dist, lift: HERO.lift, duration: 2.6, ease: "expo.out", delay: 0.15 });
    const tl = gsap.timeline({ defaults: { ease: "sine.inOut" }, scrollTrigger: {
      trigger: story.current, start: "top top", end: "bottom bottom", scrub: 1,
      onUpdate: s => { setChap(s.progress <= 0.001 ? -1 : Math.min(3, Math.floor(s.progress * 4))); if (gauge.current) gauge.current.style.transform = `scaleY(${s.progress})`; },
    } });
    POSE.forEach((p, i) => tl.to(scene, { ...p, duration: 0.7 }, i));
    tl.to(scene, { vol: 0.15, duration: 0.25 }, 3.75);
    // labels track the basins; scroll velocity ripples the land
    let raf = 0, lastY = scrollY;
    const loop = () => {
      const v = Math.abs(scrollY - lastY); lastY = scrollY; scene.vel += (Math.min(1, v / 60) - scene.vel) * 0.1;
      sim.screen.forEach(([x, y, on], i) => { const el = labels.current[i]; if (el) { el.style.transform = `translate(${x}px,${y}px)`; el.style.opacity = on ? "1" : "0"; } });
      sim.share.forEach((s, i) => { const el = shares.current[i]; if (el) el.textContent = `${Math.round(s * 100)}%`; });
      document.querySelectorAll<HTMLElement>("[data-share]").forEach(el => { el.style.transform = `scaleX(${sim.share[Number(el.dataset.share)]})`; });
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { intro.kill(); tl.scrollTrigger?.kill(); tl.kill(); cancelAnimationFrame(raf); Object.assign(scene, HERO); };
  }, []);

  useEffect(() => { fetch("/api/wallets?usd=500").then(r => r.json()).then(setLive).catch(e => setLive({ error: String(e) })); }, []);

  return <main className="home">
    <div className="stage-wrap">
      <div className="stage">
        <div className={`canvas ${ready ? "on" : ""}`}><Terrain onReady={() => setReady(true)} /></div>
        <div className="tags" aria-hidden>{MAKERS.map((m, i) => <div key={m.name} className="tag" ref={el => { labels.current[i] = el; }} style={{ "--c": HEX[i] } as React.CSSProperties}>
          <b>{m.name}</b><span ref={el => { shares.current[i] = el; }}>33%</span><em>of flow</em></div>)}</div>
        <aside className={`cartouche ${chap >= 0 ? "away" : ""}`} aria-label="Simulated flow share per wallet">
          <div className="ct-head"><span className="blink" />Live simulation<em>spring pulses every 2 s, one Base block</em></div>
          {MAKERS.map((m, i) => <div key={m.name} className="ct-row"><span>{m.name}</span><div className="ct-bar"><i data-share={i} style={{ background: HEX[i] }} /></div></div>)}
          <div className="ct-foot">depth = cheapness · flow = Uniswap v4 swaps</div>
        </aside>
        <div className={`chapters ${chap >= 0 ? "show" : ""}`} aria-live="polite">
          {CHAPTERS.map(([h, p, cap], i) => <div key={i} className={`chap ${i === chap ? "on" : ""}`} aria-hidden={i !== chap}>
            <span className="chap-n">{String(i + 1).padStart(2, "0")}<small>/04</small></span><h2>{h}</h2><p>{p}</p><small>{cap}</small></div>)}
        </div>
        <div className="gauge" aria-hidden><div ref={gauge} /></div>
      </div>
      <section className="hero">
        <Split parts={["Flow finds the", ["wallet", "hl"], "that needs it."]} />
        <div className="hero-foot" data-reveal>
          <p>Keep your basket in your own wallet. A new SwapVM instruction prices every pair off your whole portfolio and charges less for the trades that rebalance you, so Uniswap v4 flow runs to you exactly when you need it.</p>
          <div className="cta"><Link href="/live" className="btn primary" data-magnetic>Open the live wallets</Link><Link href="/how" className="btn" data-magnetic>How it works</Link></div>
        </div>
      </section>
      <section className="story" ref={story} aria-label="Story in four chapters" />
    </div>

    <section className="wrap block">
      <Split as="h2" parts={["Measured on-chain,", ["right now.", "hl"]]} />
      {!live ? <p className="lede">reading the wallets…</p>
        : live.error || !live.wallets ? <p className="lede" data-reveal>No local deployment is running, so there are no live numbers here. Start one with <code>./scripts/start_local.sh</code> and reload.</p>
        : <div className="grid g-3">{live.wallets.map((w, i) => <div key={w.id} className="panel live-card" data-reveal style={{ "--d": i, "--c": HEX[i] } as React.CSSProperties}>
          <div className="whead"><span className="wname">{w.name}</span><span className="mono muted">${fmt(w.valueUsd, 0)}</span></div>
          <div className="asset"><span className="t2">ETH</span><div className="track"><span style={{ width: `${w.ethWeightPct}%`, background: HEX[i] }} /><i style={{ left: `${w.ethTargetPct}%` }} /></div><span className="v">{fmt(w.ethWeightPct, 1)}% <span className="muted">/ {w.ethTargetPct}%</span></span></div>
          <div className="kv"><span className="k">Buy $500 of ETH</span><span className="v">{w.costToBuyEthBps == null ? "refuses" : `${w.costToBuyEthBps} bps`}</span></div>
          <div className="kv"><span className="k">Sell $500 of ETH</span><span className="v">{w.costToSellEthBps == null ? "refuses" : `${w.costToSellEthBps} bps`}</span></div>
        </div>)}</div>}
    </section>

    <section className="wrap block sheets">
      {[["/how", "How it works", "Drag a wallet off target and watch opcode 34 reprice it."], ["/proof", "Proof", "158 → 15 bps on real mainnet state, and what the tests guarantee."], ["/live", "Live", "Wallets, routing, charts, trades, the agent and the API."]].map(([h, t, p], i) =>
        <Link key={h} href={h} className="sheet" data-reveal style={{ "--d": i } as React.CSSProperties}>
          <span className="sheet-n">{String(i + 2).padStart(2, "0")}</span><span className="sheet-t">{t}</span><span className="sheet-p">{p}</span><span className="sheet-a" aria-hidden>↗</span></Link>)}
    </section>
    <Footer />
  </main>;
}

export function Footer() {
  return <footer className="wrap sitefoot"><span>WalletIndex · official 1inch Aqua &amp; SwapVM, Uniswap v4, Chainlink · Base, chain 8453</span>
    <span className="muted">Landscape and flow are a simulation of the routing rule; every number elsewhere comes from the chain or the fork tests.</span></footer>;
}
