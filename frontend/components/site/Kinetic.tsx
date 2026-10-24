"use client";
// Kinetic type: letters fall in scattered order and settle onto the baseline like flow finding its basin.
import { createElement } from "react";

type Seg = string | [string, string];
/** Headline revealed when the Shell's observer adds `.in`. Words never break mid-word; spaces stay plain text. */
export function Split({ as = "h1", parts, className = "" }: { as?: string; parts: Seg[]; className?: string }) {
  const words = parts.flatMap(p => { const [t, c] = typeof p === "string" ? [p, ""] : p; return t.split(" ").filter(Boolean).map(w => ({ w, c })); });
  const total = words.reduce((n, x) => n + x.w.length, 0);
  let n = 0;
  return createElement(as, { className: `settle ${className}`, "data-reveal": "", "aria-label": words.map(x => x.w).join(" ") },
    words.map(({ w, c }, i) => <span key={i} aria-hidden><span className={`sw ${c}`}>{[...w].map((ch, j) => {
      const k = n++, order = (k * 7919) % total; // scattered but deterministic, so SSR and client agree
      return <span key={j} className="sl" style={{ "--o": order, "--r": `${((k * 37) % 21) - 10}deg` } as React.CSSProperties}>{ch}</span>;
    })}</span>{i < words.length - 1 ? " " : ""}</span>));
}
