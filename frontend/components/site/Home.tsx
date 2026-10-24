"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { story } from "@/lib/story";
import { fmt, HEX } from "@/lib/chain";
import { Marquee, Split } from "./Kinetic";

// start fetching the 3D chunk while the page hydrates
const load = () => import("@/components/three/Scales");
const early = typeof window !== "undefined" ? load() : null;
const Scales = dynamic(() => early ?? load(), { ssr: false });

const CHAPTERS = [
  ["Money stays home.", "Alice, Bob and Carol keep ETH, USDC and cbBTC in their own wallets and pick target weights. 1inch Aqua ships each basket as a strategy: nothing is deposited, nothing is locked.", "Columns are each wallet's mix, wireframes its targets."],
  ["Off balance? It tilts.", "Prices move and wallets drift off target. Opcode 34, our native SwapVM instruction, prices every pair at the Chainlink rate, then charges less for trades that level the wallet and more for trades that tip it further.", "The further off target, the steeper the tilt."],
  ["The pool asks every wallet.", "A Uniswap v4 hook quotes each swap against every listed wallet and fills from the cheapest. Alice is overweight ETH, so selling it is her cheapest trade: the fill levels her tray.", "Pink rays are quotes; the pulse is the fill."],
  ["The agent keeps time.", "An agent reads live Chainlink rounds. When the market turns jumpy it widens every wallet's spread on-chain; when it calms, it tightens them again.", "The outer ring is each wallet's spread."],
];

type Live = { wallets?: any[]; error?: string } | null;

export default function Home() {
  const storyRef = useRef<HTMLElement>(null);
  const [chap, setChap] = useState(-1), [ready, setReady] = useState(false), [live, setLive] = useState<Live>(null);

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const intro = gsap.to(story, { intro: 1, duration: reduce ? 0 : 1.8, ease: "power3.out", delay: 0.2 });
    const tl = gsap.timeline({ defaults: { ease: "none" }, scrollTrigger: {
      trigger: storyRef.current, start: "top top", end: "bottom bottom", scrub: 0.6,
      onUpdate: s => setChap(s.progress <= 0 ? -1 : Math.min(3, Math.floor(s.progress * 4))),
      onLeaveBack: () => setChap(-1),
    } });
    tl.to(story, { skew: 1, duration: 0.6 }, 1)
      .to(story, { quote: 1, duration: 0.3 }, 2).to(story, { fill: 1, duration: 0.6 }, 2.35).to(story, { quote: 0, duration: 0.25 }, 3.0)
      .to(story, { vol: 1, duration: 0.45 }, 3.15).to(story, { vol: 0.3, duration: 0.4 }, 3.6);
    tl.set({}, {}, 4);
    return () => { intro.kill(); tl.scrollTrigger?.kill(); tl.kill(); Object.assign(story, { intro: 0, skew: 0, quote: 0, fill: 0, vol: 0 }); };
  }, []);

  useEffect(() => {
    fetch("/api/wallets?usd=500").then(r => r.json()).then(setLive).catch(e => setLive({ error: String(e) }));
  }, []);

  return <main>
    <div className="stage-wrap">
      <div className="stage">
        <div className={`canvas ${ready ? "on" : ""}`}><Scales onReady={() => setReady(true)} /></div>
        <div className={`chapter ${chap >= 0 ? "show" : ""}`} aria-live="polite">
          <div className="ch-rail">{CHAPTERS.map((_, i) => <i key={i} className={i <= chap ? "on" : ""} />)}</div>
          {CHAPTERS.map(([h, p, cap], i) => <div key={i} className={`ch ${i === chap ? "on" : ""}`} aria-hidden={i !== chap}>
            <span className="eyebrow">Chapter {String(i + 1).padStart(2, "0")} / 04</span><h2>{h}</h2><p>{p}</p><small>{cap}</small></div>)}
        </div>
        <div className="legend3d" aria-hidden><span><i style={{ background: "#4f5df0" }} />ETH</span><span><i style={{ background: "#1f9a8a" }} />USDC</span><span><i style={{ background: "#ee8a26" }} />cbBTC</span><span><i className="pool" />Uniswap v4 pool</span><em>illustration · real target weights</em></div>
      </div>
      <section className="hero">
        <span className="eyebrow" data-reveal>1inch Aqua · SwapVM opcode 34 · Uniswap v4</span>
        <Split parts={["Your wallet,", ["paid", "hl"], "to rebalance", ["itself.", "hl2"]]} />
        <p className="lede" data-reveal>Keep your basket in your own wallet. A new SwapVM instruction quotes every pair off your whole portfolio and charges less for the trades that move you back toward your targets. Uniswap v4 sends the flow.</p>
        <div className="cta" data-reveal><Link href="/live" className="btn primary" data-magnetic>Open the live wallets</Link><Link href="/how" className="btn" data-magnetic>How it works</Link></div>
        <div className="scrollhint" aria-hidden>scroll the story</div>
      </section>
      <section className="story" ref={storyRef} aria-label="Story in four chapters" />
    </div>

    <Marquee items={["opcode 34 · PortfolioSkew", "money never leaves the wallet", "best of every wallet, per swap", "Chainlink or no quote", "158 → 15 bps on $50k EUR→JPY", "agent retunes on-chain"]} />

    <section className="wrap block">
      <span className="eyebrow" data-reveal>§ Live from the chain</span>
      <Split as="h2" parts={["What the wallets", ["charge right now", "hl"]]} />
      {!live ? <p className="lede">reading the wallets…</p>
        : live.error || !live.wallets ? <p className="lede" data-reveal>No local deployment is running, so there are no live numbers here. Start one with <code>./scripts/start_local.sh</code>, then reload.</p>
        : <div className="grid g-3">{live.wallets.map((w, i) => <div key={w.id} className="panel live-card" data-reveal style={{ "--d": i } as React.CSSProperties}>
          <div className="whead"><span className="dot" style={{ background: HEX[i] }} /><span className="wname">{w.name}</span><span className="muted mono">${fmt(w.valueUsd, 0)}</span></div>
          <div className="asset"><span className="t2">ETH</span><div className="track"><span style={{ width: `${w.ethWeightPct}%`, background: HEX[i] }} /><i style={{ left: `${w.ethTargetPct}%` }} /></div><span className="v">{fmt(w.ethWeightPct, 1)}% <span className="muted">/ {w.ethTargetPct}%</span></span></div>
          <div className="kv"><span className="k">Buy $500 of ETH</span><span className="v">{w.costToBuyEthBps == null ? "refuses" : `${w.costToBuyEthBps} bps`}</span></div>
          <div className="kv"><span className="k">Sell $500 of ETH</span><span className="v">{w.costToSellEthBps == null ? "refuses" : `${w.costToSellEthBps} bps`}</span></div>
        </div>)}</div>}
    </section>

    <section className="wrap block">
      <span className="eyebrow" data-reveal>§ Keep going</span>
      <div className="grid g-3 cards">
        {[["/how", "How it works", "Route a swap, then drag a wallet off target and watch opcode 34 reprice it."], ["/proof", "Proof", "Mainnet-fork numbers against today's route, and the safety properties the tests hold."], ["/live", "Live dashboard", "Wallets, routing, charts, trades, the agent and the API, all on-chain."]].map(([h, t, p], i) =>
          <Link key={h} href={h} className="panel card" data-reveal style={{ "--d": i } as React.CSSProperties}><span className="num">0{i + 1}</span><h3>{t}</h3><p>{p}</p><span className="arrow" aria-hidden>→</span></Link>)}
      </div>
    </section>
    <Footer />
  </main>;
}

export function Footer() {
  return <footer className="wrap sitefoot"><span>WalletIndex · official 1inch Aqua &amp; SwapVM, Uniswap v4, Chainlink</span><span className="muted">Base mainnet · chain 8453</span></footer>;
}
