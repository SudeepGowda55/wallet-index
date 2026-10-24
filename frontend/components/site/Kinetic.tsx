"use client";
// Kinetic type and the scroll-velocity marquee.
import { createElement, useEffect, useRef } from "react";

type Seg = string | [string, string];
/** Headline split into masked words that rise in when the Shell's reveal observer adds `.in`. Spaces stay outside the masks. */
export function Split({ as = "h1", parts, className = "" }: { as?: string; parts: Seg[]; className?: string }) {
  let n = 0;
  const words = parts.flatMap(p => { const [t, c] = typeof p === "string" ? [p, ""] : p; return t.split(" ").filter(Boolean).map(w => ({ w, c })); });
  return createElement(as, { className: `split ${className}`, "data-reveal": "", "aria-label": words.map(x => x.w).join(" ") },
    words.map(({ w, c }, i) => <span key={i} aria-hidden><span className="wm"><span className={`wi ${c}`} style={{ "--i": n++ } as React.CSSProperties}>{w}</span></span>{i < words.length - 1 ? " " : ""}</span>));
}

/** Ticker whose speed and skew follow scroll velocity (measured from scrollY per frame). */
export function Marquee({ items }: { items: string[] }) {
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let x = 0, last = scrollY, v = 0, raf = 0;
    const loop = () => {
      const d = scrollY - last; last = scrollY; v += (d - v) * 0.12;
      const el = track.current; if (!el) return;
      x -= 0.6 + Math.abs(v) * 0.35; const w = el.scrollWidth / 2; if (-x > w) x += w;
      el.style.transform = `translateX(${x}px) skewX(${Math.max(-14, Math.min(14, -v * 0.6))}deg)`;
      raf = requestAnimationFrame(loop);
    };
    loop(); return () => cancelAnimationFrame(raf);
  }, []);
  const row = items.map((t, i) => <span key={i}>{t}<b aria-hidden>◆</b></span>);
  return <div className="marquee" aria-label={items.join(", ")}><div className="mq-track" ref={track} aria-hidden>{row}{row}</div></div>;
}
