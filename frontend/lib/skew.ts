// TypeScript port of PortfolioSkewInstruction._portfolioSkewXD (src/swapvm/PortfolioSkewInstruction.sol),
// with the parameters the deploy script ships (script/Deploy.s.sol, src/lib/BaseConfig.sol).
export const MIN_BPS = 1, MAX_BPS = 40, GAIN = 100;
export const ASSETS = ["ETH", "USDC", "cbBTC"] as const;
export const MAKERS = [
  { name: "alice", base: 8, targets: [3000, 5000, 2000] },
  { name: "bob", base: 10, targets: [5000, 3000, 2000] },
  { name: "carol", base: 12, targets: [7000, 2000, 1000] },
];

/** sum over assets of |weight - target|, in bps (integer maths as on-chain) */
export function imbalance(usd: number[], targets: number[]) {
  const tot = usd.reduce((a, b) => a + b, 0);
  if (!tot) return 0;
  return usd.reduce((s, u, i) => s + Math.abs(Math.floor(u * 1e4 / tot) - targets[i]), 0);
}

/** spread in bps charged for swapping `amtUsd` of asset iIn into the wallet for asset iOut */
export function spreadBps(usd: number[], targets: number[], base: number, iIn: number, iOut: number, amtUsd: number) {
  const before = imbalance(usd, targets), after = [...usd];
  after[iIn] += amtUsd; after[iOut] = Math.max(0, after[iOut] - amtUsd);
  const a = imbalance(after, targets);
  const s = a < before ? base - Math.floor((before - a) * GAIN / 1e4) : base + Math.floor((a - before) * GAIN / 1e4);
  return Math.min(MAX_BPS, Math.max(MIN_BPS, s));
}
