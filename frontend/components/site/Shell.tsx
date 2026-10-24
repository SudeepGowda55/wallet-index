"use client";
// Site chrome: survey-bar nav, Lenis smooth scroll wired to ScrollTrigger, the contour-ripple page transition
// (rings spread from the click point, then drain away on the new route), reveals, survey crosshair, magnetic pull.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { PAGES, SITE } from "@/lib/site";

gsap.registerPlugin(ScrollTrigger);
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Paint the wipe: a disc of night with contour rings riding its edge. `hole` drains it from the centre. */
function paint(cv: HTMLCanvasElement, x: number, y: number, r: number, hole: number) {
  const g = cv.getContext("2d")!, w = cv.width = innerWidth, h = cv.height = innerHeight;
  g.clearRect(0, 0, w, h);
  if (r <= 0) return;
  g.fillStyle = "#0d0b10"; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  if (hole > 0) { g.globalCompositeOperation = "destination-out"; g.beginPath(); g.arc(x, y, hole, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = "source-over"; }
  for (let i = 0; i < 9; i++) {
    for (const [edge, dir] of [[r, -1], [hole, 1]] as const) {
      const rr = edge + dir * i * 16; if (rr <= 0 || (hole > 0 && rr < hole) || rr > r) continue;
      g.strokeStyle = `rgba(255,158,109,${(0.75 - i * 0.08).toFixed(2)})`; g.lineWidth = i % 4 === 0 ? 2 : 1;
      g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.stroke();
    }
  }
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname(), router = useRouter();
  const wipe = useRef<HTMLCanvasElement>(null), cross = useRef<HTMLDivElement>(null), coord = useRef<HTMLSpanElement>(null);
  const lenis = useRef<Lenis | null>(null), w = useRef({ x: 0, y: 0, r: 0, hole: 0, active: false });

  useEffect(() => {
    if (reduced()) return;
    const l = new Lenis({ anchors: { offset: -130 }, lerp: 0.09 }); lenis.current = l;
    l.on("scroll", ScrollTrigger.update);
    const tick = (t: number) => l.raf(t * 1000);
    gsap.ticker.add(tick); gsap.ticker.lagSmoothing(0);
    return () => { gsap.ticker.remove(tick); l.destroy(); lenis.current = null; };
  }, []);

  // route arrived: reset scroll, drain the wipe from the centre, arm reveals
  useEffect(() => {
    lenis.current?.scrollTo(0, { immediate: true }); if (!location.hash) scrollTo(0, 0);
    const s = w.current;
    if (s.active) {
      const max = Math.hypot(innerWidth, innerHeight);
      s.x = innerWidth / 2; s.y = innerHeight / 2; s.r = max; s.hole = 0;
      gsap.to(s, { hole: max + 160, duration: 0.9, ease: "expo.inOut", delay: 0.08, onUpdate: () => paint(wipe.current!, s.x, s.y, s.r, s.hole), onComplete: () => { s.active = false; paint(wipe.current!, 0, 0, 0, 0); } });
    }
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    const arm = () => document.querySelectorAll("[data-reveal]:not(.in)").forEach(el => io.observe(el));
    // content that renders after data loads gets armed too
    const mo = new MutationObserver(arm); mo.observe(document.body, { childList: true, subtree: true });
    arm(); const t = setTimeout(() => ScrollTrigger.refresh(), 400);
    return () => { clearTimeout(t); io.disconnect(); mo.disconnect(); };
  }, [path]);

  // capture phase, so this runs before next/link (which skips clicks that are already defaultPrevented)
  useEffect(() => {
    const on = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank") return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname || url.pathname.startsWith("/api")) return;
      e.preventDefault();
      if (reduced()) return router.push(url.pathname + url.search);
      const s = w.current, max = Math.hypot(innerWidth, innerHeight) + 160;
      Object.assign(s, { x: e.clientX, y: e.clientY, r: 0, hole: 0, active: true });
      gsap.to(s, { r: max, duration: 0.75, ease: "expo.in", onUpdate: () => paint(wipe.current!, s.x, s.y, s.r, 0), onComplete: () => router.push(url.pathname + url.search) });
    };
    document.addEventListener("click", on, true);
    return () => document.removeEventListener("click", on, true);
  }, [router]);

  // survey crosshair with live coordinates, magnetic pull, contour rings on press
  useEffect(() => {
    if (reduced() || matchMedia("(pointer: coarse)").matches) return;
    const root = document.documentElement; root.classList.add("has-cross");
    let mag: HTMLElement | null = null;
    const move = (e: PointerEvent) => {
      root.classList.add("cross-on");
      cross.current!.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
      const hit = (e.target as HTMLElement).closest<HTMLElement>("a,button,input,select,[data-magnetic]");
      cross.current!.classList.toggle("hover", !!hit);
      if (coord.current) coord.current.textContent = hit ? (hit.getAttribute("aria-label") || hit.textContent || "").trim().slice(0, 28) || "open"
        : `${(e.clientX / innerWidth * 2 - 1).toFixed(3)}  ${(1 - e.clientY / innerHeight * 2).toFixed(3)}`;
      const m = (e.target as HTMLElement).closest<HTMLElement>("[data-magnetic]");
      if (mag && mag !== m) gsap.to(mag, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1,.4)" });
      mag = m;
      if (m) { const b = m.getBoundingClientRect(); gsap.to(m, { x: (e.clientX - b.left - b.width / 2) * 0.28, y: (e.clientY - b.top - b.height / 2) * 0.32, duration: 0.35 }); }
    };
    const down = (e: PointerEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("button,.btn"); if (!b) return;
      const box = b.getBoundingClientRect();
      for (let i = 0; i < 3; i++) {
        const s = document.createElement("span"); s.className = "press"; s.style.left = e.clientX - box.left + "px"; s.style.top = e.clientY - box.top + "px"; s.style.animationDelay = i * 90 + "ms";
        b.appendChild(s); setTimeout(() => s.remove(), 900);
      }
    };
    addEventListener("pointermove", move, { passive: true }); addEventListener("pointerdown", down);
    return () => { removeEventListener("pointermove", move); removeEventListener("pointerdown", down); root.classList.remove("has-cross", "cross-on"); };
  }, []);

  return <>
    <nav className="survey" aria-label="Main">
      <Link href="/" className="mark" data-magnetic><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden><g fill="none" stroke="currentColor" strokeWidth="1.4"><ellipse cx="12" cy="13" rx="10" ry="6" /><ellipse cx="12" cy="13.5" rx="6.5" ry="3.6" /><ellipse cx="12" cy="14" rx="3" ry="1.5" /></g><circle cx="12" cy="3.5" r="1.6" fill="var(--uni)" /></svg>WalletIndex</Link>
      <div className="links">{PAGES.map(([href, label], i) => <Link key={href} href={href} className={path === href ? "on" : ""}><sup>{String(i + 1).padStart(2, "0")}</sup>{label}</Link>)}</div>
      <a className="gh" href={SITE.repo} target="_blank" rel="noreferrer" aria-label="GitHub repository" data-magnetic>
        <svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
      </a>
    </nav>
    {children}
    <canvas className="wipe" ref={wipe} aria-hidden />
    <div className="cross" ref={cross} aria-hidden><i /><span ref={coord} /></div>
  </>;
}
