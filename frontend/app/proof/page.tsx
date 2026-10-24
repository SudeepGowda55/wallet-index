import { Split } from "@/components/site/Kinetic";
import ProofBars from "@/components/site/ProofBars";
import { Footer } from "@/components/site/Home";
import { pageMeta } from "@/lib/site";

export const metadata = pageMeta("/proof", "Proof", "Mainnet-fork evidence: a $50k EUR→JPY trade costs 15 bps through a WalletIndex basket vs 158 bps on today's route.");

const SAFETY = [["Stale price past the freshness limit", "every wallet refuses to quote"], ["Wallet over-committed across strategies", "drops out, routing falls back"],
  ["Maker value at the oracle", "never decreases (fuzzed)"], ["Round trip by a taker", "always costs the taker"], ["Third-party liquidity / exact-output", "rejected"],
  ["Hook float runs dry", "clean revert; permissionless sweep refills"]];

export default function Page() {
  return <main className="page">
    <header className="wrap pagehead">
      <span className="eyebrow" data-reveal>Proof · recorded on real Ethereum mainnet state</span>
      <Split parts={["158 bps", ["down to 15.", "hl"]]} />
      <p className="lede" data-reveal>A 5-currency basket (USD / EUR / JPY / CHF / SGD) on the same instruction, against today&apos;s route through USDC on real Uniswap v4 pools. Numbers are from the latest fork run and move with the market.</p>
    </header>
    <section className="wrap block"><span className="eyebrow" data-reveal>§ EUR → JPY, cost by size</span><ProofBars />
      <p className="t2" data-reveal>JPY→SGD and JPY→CHF, which have no pool at all, fill directly within 0.2% of the live cross rate.</p>
      <div className="code" data-reveal>forge test --match-contract FxEvidenceEthereumTest -vv</div></section>
    <section className="wrap block">
      <span className="eyebrow" data-reveal>§ Safety, tested on mainnet forks</span>
      <Split as="h2" parts={["What can't", ["go wrong.", "hl"]]} />
      <div className="grid g-3 safety">{SAFETY.map(([k, v], i) => <div key={k} className="panel" data-reveal style={{ "--d": i % 3 } as React.CSSProperties}><span className="num">0{i + 1}</span><h3>{k}</h3><p className="t2">{v}</p></div>)}</div>
      <p className="t2" data-reveal>Also asserted: after a wallet is knocked off target, the helpful direction is cheaper than the harmful one, and routing rotates to the next wallet as the cheapest one rebalances.</p>
    </section>
    <Footer />
  </main>;
}
