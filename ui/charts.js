/* Small SVG chart kit: line/step charts with crosshair tooltips, bar charts, and the live flow diagram. */
const HEX = ["#3987e5", "#d95926", "#199e70"];   // validated categorical slots 1-3 (dark surface)
const fmtN = (x, d = 2) => Number(x).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

function lineChart(el, series, { yFmt = v => fmtN(v), xFmt = t => new Date(t * 1000).toLocaleTimeString(), step = false, height = 230 } = {}) {
  const pts = series.flatMap(s => s.points);
  if (!pts.length) { el.innerHTML = '<div class="empty">no data yet</div>'; return; }
  const W = 640, H = height, L = 60, R = 16, T = 10, B = 26;
  let x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x)); if (x1 === x0) x1 = x0 + 1;
  let y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y));
  const pad = (y1 - y0) * 0.12 || Math.abs(y1) * 0.01 || 1; y0 -= pad; y1 += pad;
  if (series.some(s => s.zero)) y0 = Math.min(0, y0);
  const X = x => L + (x - x0) / (x1 - x0) * (W - L - R), Y = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  let g = "";
  for (let i = 0; i <= 4; i++) { const v = y0 + (y1 - y0) * i / 4; g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="11">${yFmt(v)}</text>`; }
  for (let i = 0; i <= 3; i++) { const v = x0 + (x1 - x0) * i / 3; g += `<text x="${X(v)}" y="${H - 6}" text-anchor="middle" fill="var(--muted)" font-size="11">${xFmt(v)}</text>`; }
  let p = "";
  series.forEach(s => {
    if (!s.points.length) return;
    let d = "";
    s.points.forEach((q, i) => { d += i === 0 ? `M${X(q.x)},${Y(q.y)}` : step ? `H${X(q.x)}V${Y(q.y)}` : `L${X(q.x)},${Y(q.y)}`; });
    if (step) d += `H${X(x1)}`;
    p += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    const last = s.points[s.points.length - 1];
    p += `<circle cx="${step ? X(x1) : X(last.x)}" cy="${Y(last.y)}" r="4" fill="${s.color}" stroke="var(--panel)" stroke-width="2"/>`;
  });
  const legend = series.length > 1 ? `<div class="legend">${series.map(s => `<span><span class="dot" style="background:${s.color}"></span>${s.name}</span>`).join("")}</div>` : "";
  el.innerHTML = `${legend}<svg viewBox="0 0 ${W} ${H}">${g}${p}<line class="xh" y1="${T}" y2="${H - B}" stroke="var(--text2)" stroke-dasharray="3 3" style="display:none"/><rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg><div class="tip"></div>`;
  const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), xh = el.querySelector(".xh"), hit = el.querySelector(".hit");
  hit.addEventListener("mousemove", ev => {
    const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) / r.width * W, xv = x0 + (sx - L) / (W - L - R) * (x1 - x0);
    const rows = series.map(s => { let best = null; for (const q of s.points) if (q.x <= xv + 1e-9) best = q; if (!best && !step) best = s.points[0];
      return best ? `<div><span class="dot" style="background:${s.color}"></span>${s.name}: <b>${yFmt(best.y)}</b></div>` : ""; }).join("");
    xh.setAttribute("x1", sx); xh.setAttribute("x2", sx); xh.style.display = "";
    tip.innerHTML = `<div class="muted">${xFmt(xv)}</div>${rows}`; tip.style.display = "block";
    const px = ev.clientX - el.getBoundingClientRect().left; tip.style.left = Math.max(0, Math.min(px + 12, el.clientWidth - tip.offsetWidth)) + "px"; tip.style.top = "30px";
  });
  hit.addEventListener("mouseleave", () => { tip.style.display = "none"; xh.style.display = "none"; });
}

function barChart(el, bars, { vFmt = v => fmtN(v, 0), height = 210 } = {}) {
  if (!bars.length || bars.every(b => !b.v)) { el.innerHTML = '<div class="empty">no data yet</div>'; return; }
  const W = 640, H = height, L = 48, R = 14, T = 20, B = 30, max = Math.max(...bars.map(b => b.v)) || 1;
  const slot = (W - L - R) / bars.length, bw = Math.min(110, slot * 0.55);
  let s = "";
  for (let i = 0; i <= 3; i++) { const v = max * i / 3, y = T + (1 - v / max) * (H - T - B); s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" fill="var(--muted)" font-size="11">${vFmt(v)}</text>`; }
  bars.forEach((b, i) => {
    const h = Math.max(1, b.v / max * (H - T - B)), x = L + slot * i + (slot - bw) / 2, y = H - B - h, r = Math.min(4, h);
    s += `<path d="M${x},${H - B} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${H - B} Z" fill="${b.color}"><title>${b.label}: ${vFmt(b.v)}</title></path>`;
    s += `<text x="${x + bw / 2}" y="${y - 6}" text-anchor="middle" fill="var(--text)" font-size="12">${vFmt(b.v)}</text>`;
    s += `<text x="${x + bw / 2}" y="${H - 10}" text-anchor="middle" fill="var(--text2)" font-size="12">${b.label}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${s}</svg>`;
}

function drawFlow(svg, makers) {
  const node = (id, x, y, w, t, sub) => `<g class="node" id="n-${id}"><rect x="${x}" y="${y}" width="${w}" height="62" rx="12"/><text x="${x + 14}" y="${y + 26}">${t}</text><text class="sub" x="${x + 14}" y="${y + 46}">${sub}</text></g>`;
  const edge = (id, d) => `<path class="edge" id="e-${id}" d="${d}"/>`;
  let s = edge("t-p", "M170,160 H225") + edge("p-h", "M395,160 H450") + edge("h-r", "M640,160 H695") + edge("cl-r", "M800,290 V195");
  [0, 1, 2].forEach(i => { s += edge(`r-w${i}`, `M905,160 C950,160 950,${68 + i * 98} 990,${68 + i * 98}`); });
  s += node("t", 20, 129, 150, "Trader", "any Uniswap user")
     + node("p", 225, 129, 170, `<tspan fill="var(--uni)">Uniswap v4</tspan> pool`, "WETH/USDC, no own liquidity")
     + node("h", 450, 129, 190, "WalletIndex hook", "best quote of all wallets")
     + node("r", 695, 129, 210, `<tspan fill="var(--aqua)">SwapVM</tspan> router`, "1inch opcodes + opcode 34")
     + node("cl", 695, 290, 210, "Chainlink ETH &amp; BTC", "fresh, or no quote at all");
  (makers || []).slice(0, 3).forEach((m, i) => {
    const y = 37 + i * 98;
    s += `<g class="node" id="n-w${i}"><rect x="990" y="${y}" width="190" height="62" rx="12"/><circle cx="1008" cy="${y + 26}" r="6" fill="${HEX[i]}"/><text x="1022" y="${y + 31}">${m.name}'s wallet</text><text class="sub" x="1022" y="${y + 49}">via <tspan fill="var(--aqua)">1inch Aqua</tspan></text></g>`;
  });
  s += `<text x="990" y="340" fill="var(--good)" font-size="13">agent retunes the wallets on-chain</text>`;
  svg.innerHTML = s;
}

function lightFlow(walletIdx) {
  document.querySelectorAll(".flow .hot").forEach(e => e.classList.remove("hot"));
  ["e-t-p", "e-p-h", "e-h-r", `e-r-w${walletIdx}`, "n-t", "n-p", "n-h", "n-r", `n-w${walletIdx}`].forEach(id => { const e = document.getElementById(id); if (e) e.classList.add("hot"); });
  clearTimeout(lightFlow.t); lightFlow.t = setTimeout(() => document.querySelectorAll(".flow .hot").forEach(e => e.classList.remove("hot")), 7000);
}
