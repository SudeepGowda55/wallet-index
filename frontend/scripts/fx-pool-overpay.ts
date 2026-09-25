/* Evidence: for every recent real swap on today's FX-stablecoin pools, what did the user pay vs the real FX rate,
 * and what would a basket wallet quoting at (rate - OUR_BPS) have saved them?   npx tsx scripts/fx-pool-overpay.ts [ourBps] */
const OUR_BPS = Number(process.argv[2] || 6);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function get(u: string): Promise<any> {
  for (let i = 0; i < 4; i++) { try { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }); if (r.ok) return await r.json(); } catch {} await sleep(3000 + i * 3000); }
  return null;
}
async function fx(sym: string): Promise<[number, number][]> {
  const y = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=7d`), r = y.chart.result[0];
  return r.timestamp.map((t: number, i: number) => [t, r.indicators.quote[0].close[i]]).filter((p: any) => p[1]);
}
const POOLS: [string, string, string, boolean, string][] = [
  ["eth", "JPYC", "JPY=X", true, "0xe7c3d8c9a439fede00d2600032d5db0be71c3c29"], ["eth", "EURC", "EURUSD=X", false, "0x1abaea1f7c830bd89acc67ec4af516284b1bc33c"],
  ["base", "EURC", "EURUSD=X", false, "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42"], ["base", "XSGD", "SGD=X", true, "0x0a4c9cb2778ab3302996a34befcf9a8bc288c33b"],
  ["base", "ZCHF", "CHF=X", true, "0xd4dd9e2f021bb459d5a5f6c24c12fe09c5d45553"], ["base", "AUDD", "AUDUSD=X", false, "0x449b3317a6d1efb1bc3ba0700c9eaa4ffff4ae65"]];

(async () => {
  let totVol = 0, totExtra = 0, totN = 0;
  for (const [net, sym, ysym, inv, tok] of POOLS) {
    const ref = await fx(ysym);
    const usdPer = (t: number) => { let i = -1; for (let k = 0; k < ref.length && ref[k][0] <= t; k++) i = k; return i >= 0 && t - ref[i][0] <= 900 ? (inv ? 1 / ref[i][1] : ref[i][1]) : null; };
    const pl = await get(`https://api.geckoterminal.com/api/v2/networks/${net}/tokens/${tok}/pools?page=1`); await sleep(2200);
    const pools = (pl?.data || []).filter((p: any) => p.attributes.name.toUpperCase().includes("USD")).slice(0, 3);
    let vol = 0, extra = 0; const costs: [number, number][] = [];
    for (const p of pools) {
      const tr = await get(`https://api.geckoterminal.com/api/v2/networks/${net}/pools/${p.attributes.address}/trades`); await sleep(2200);
      for (const t of tr?.data || []) {
        const x = t.attributes, ts = Math.floor(Date.parse(x.block_timestamp) / 1000), r = usdPer(ts), usd = Number(x.volume_in_usd || 0);
        if (!r || usd < 50) continue;
        const bps = (x.kind === "buy" ? (usd / Number(x.to_token_amount)) / r - 1 : 1 - (usd / Number(x.from_token_amount)) / r) * 1e4;
        if (Math.abs(bps) > 2000) continue;
        costs.push([usd, bps]); vol += usd; if (bps > OUR_BPS) extra += usd * (bps - OUR_BPS) / 1e4;
      }
    }
    if (costs.length) {
      const med = costs.map(c => c[1]).sort((a, b) => a - b)[Math.floor(costs.length / 2)], vw = costs.reduce((a, c) => a + c[0] * c[1], 0) / vol;
      console.log(`${net.padEnd(4)} ${sym.padEnd(5)} trades ${String(costs.length).padStart(4)} vol $${Math.round(vol).toLocaleString().padStart(11)} | median cost ${med.toFixed(1).padStart(6)} bps | vol-weighted ${vw.toFixed(1).padStart(6)} bps | overpaid vs ${OUR_BPS}bps wallet $${Math.round(extra).toLocaleString()}`);
    } else console.log(`${net.padEnd(4)} ${sym.padEnd(5)} no matched trades`);
    totVol += vol; totExtra += extra; totN += costs.length;
  }
  console.log(`TOTAL matched trades ${totN} | volume $${Math.round(totVol).toLocaleString()} | users overpaid vs a ${OUR_BPS} bps basket: $${Math.round(totExtra).toLocaleString()}`);
})();
