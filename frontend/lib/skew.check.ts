// Self-check for the pricing port: npx tsx lib/skew.check.ts
import assert from "node:assert/strict";
import { imbalance, MAKERS, spreadBps } from "./skew";

const { base, targets } = MAKERS[0];
assert.equal(imbalance([3000, 5000, 2000], targets), 0);
// on target: any trade pushes the wallet away, so it never costs less than base
assert.ok(spreadBps([3000, 5000, 2000], targets, base, 1, 0, 500) >= base);
// overweight ETH: buying ETH from the wallet (USDC in, ETH out) helps, selling ETH to it hurts
const heavy = [5000, 3000, 2000];
assert.ok(spreadBps(heavy, targets, base, 1, 0, 1000) < base);
assert.ok(spreadBps(heavy, targets, base, 0, 1, 1000) > base);
// clamped to [MIN, MAX]
assert.equal(spreadBps(heavy, targets, base, 1, 0, 2000), 1); // fully rebalancing: 8 - 40 clamps to MIN
console.log("skew ok");
