import { Split } from "@/components/site/Kinetic";
import { FlowCycle, Simulator } from "@/components/site/HowParts";
import { Footer } from "@/components/site/Home";
import PageTerrain from "@/components/site/PageTerrain";
import { pageMeta } from "@/lib/site";

export const metadata = pageMeta("/how", "How it works", "How a Uniswap v4 swap is routed to the cheapest wallet, and how opcode 34 prices it off the whole portfolio.");

const ARGS = [["base", "2 B", "spread with no rebalancing effect"], ["min · max", "2 B · 2 B", "clamp, 1 and 40 bps"], ["gain", "4 B", "bps of spread per bp of imbalance change × 10⁴"],
  ["maxAge", "4 B", "older Chainlink answer → no quote"], ["n × asset", "43 B each", "token · feed · decimals · target weight"]];

export default function Page() {
  return <main className="page">
    <PageTerrain />
    <header className="wrap pagehead">
      <span className="eyebrow" data-reveal>How it works</span>
      <Split parts={["One swap,", ["every wallet", "hl"], "asked,", ["the cheapest", "hl2"], "fills."]} />
      <p className="lede" data-reveal>A trader uses an ordinary Uniswap v4 pool. The pool holds no liquidity of its own: the WalletIndex hook quotes the swap against every listed wallet through a SwapVM router and fills it from the best one, straight out of that maker&apos;s wallet via 1inch Aqua.</p>
    </header>
    <section className="wrap block"><FlowCycle /></section>
    <section className="wrap block">
      <span className="eyebrow" data-reveal>Opcode 34 · try it</span>
      <Split as="h2" parts={["Push a wallet off target and", ["watch the price", "hl"], "lean back."]} />
      <p className="lede" data-reveal>The instruction values the whole basket at Chainlink prices, measures how far it sits from its targets before and after the trade, and moves the spread by the difference. The wallet is paid to rebalance.</p>
      <Simulator />
    </section>
    <section className="wrap block">
      <span className="eyebrow" data-reveal>The program</span>
      <Split as="h2" parts={["Everything the wallet needs,", ["in its own bytecode.", "hl"]]} />
      <div className="grid g-2">
        <div className="panel" data-reveal>
          <div className="code"><span className="muted">salt</span> <b className="aq">22</b> <span className="muted">len</span> base·min·max·gain·maxAge·assets…</div>
          <p className="t2">Opcode <b>0x22 = 34</b> is appended to 1inch&apos;s official SwapVM opcode table. Settings live in the program args, so <code>quote()</code> and <code>swap()</code> run the same code.</p>
          {ARGS.map(([k, b, v]) => <div key={k} className="kv"><span className="k mono">{k} <span className="muted">{b}</span></span><span className="v">{v}</span></div>)}
        </div>
        <div className="panel" data-reveal style={{ "--d": 1 } as React.CSSProperties}>
          <h3>The agent&apos;s rule</h3>
          <p className="t2">Each tick it reads the last 8 Chainlink rounds on Base and retunes every wallet&apos;s base spread on-chain (Aqua dock, ship, replace the hook listing).</p>
          <div className="regimes"><div><b className="good">calm</b><span>largest move &lt; 15 bps</span><em>tighten</em></div><div><b>normal</b><span>15–40 bps</span><em>default</em></div><div><b className="warn">jumpy</b><span>≥ 40 bps</span><em>widen</em></div></div>
          <p className="t2">A keeper sweeps the hook&apos;s settled claims back into its working float. Stale price past the freshness limit: every wallet refuses to quote.</p>
        </div>
      </div>
    </section>
    <Footer />
  </main>;
}
