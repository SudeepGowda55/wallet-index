"use client";
// Site chrome: nav, Lenis smooth scroll wired to ScrollTrigger, the column-curtain page transition,
// scroll reveals, cursor follower, magnetic buttons and press ripples.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { PAGES, SITE } from "@/lib/site";

gsap.registerPlugin(ScrollTrigger);
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname(), router = useRouter();
  const curtain = useRef<HTMLDivElement>(null), dot = useRef<HTMLDivElement>(null), ring = useRef<HTMLDivElement>(null);
  const lenis = useRef<Lenis | null>(null), leaving = useRef(false);

  // smooth scroll on the gsap ticker
  useEffect(() => {
    if (reduced()) return;
    const l = new Lenis({ anchors: { offset: -120 } }); lenis.current = l;
    l.on("scroll", ScrollTrigger.update);
    const tick = (t: number) => l.raf(t * 1000);
    gsap.ticker.add(tick); gsap.ticker.lagSmoothing(0);
    return () => { gsap.ticker.remove(tick); l.destroy(); lenis.current = null; };
  }, []);

  // route arrived: reset scroll, lift the curtain, re-arm reveals
  useEffect(() => {
    lenis.current?.scrollTo(0, { immediate: true }); if (!location.hash) scrollTo(0, 0);
    const bars = curtain.current?.querySelectorAll("i");
    if (bars && leaving.current) gsap.to(bars, { scaleY: 0, transformOrigin: "50% 0%", duration: 0.55, ease: "power3.inOut", stagger: 0.06, delay: 0.05 });
    leaving.current = false;
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    const arm = () => document.querySelectorAll("[data-reveal]:not(.in)").forEach(el => io.observe(el));
    // content that renders after data loads gets armed too
    const mo = new MutationObserver(arm); mo.observe(document.body, { childList: true, subtree: true });
    arm(); const t = setTimeout(() => ScrollTrigger.refresh(), 400);
    return () => { clearTimeout(t); io.disconnect(); mo.disconnect(); };
  }, [path]);

  // curtain down before internal navigation
  useEffect(() => {
    const on = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank") return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname || url.pathname.startsWith("/api")) return;
      e.preventDefault();
      if (reduced()) return router.push(url.pathname + url.search);
      leaving.current = true;
      gsap.fromTo(curtain.current!.querySelectorAll("i"), { scaleY: 0, transformOrigin: "50% 100%" },
        { scaleY: 1, duration: 0.5, ease: "power3.inOut", stagger: 0.06, onComplete: () => router.push(url.pathname + url.search) });
    };
    // capture phase, so this runs before next/link (which skips clicks that are already defaultPrevented)
    document.addEventListener("click", on, true);
    return () => document.removeEventListener("click", on, true);
  }, [router]);

  // pointer life: follower, magnetic pull, ripples
  useEffect(() => {
    if (reduced() || matchMedia("(pointer: coarse)").matches) return;
    document.documentElement.classList.add("has-cursor");
    const p = { x: innerWidth / 2, y: innerHeight / 2 }, r = { ...p };
    let raf = 0, mag: HTMLElement | null = null;
    const move = (e: PointerEvent) => {
      p.x = e.clientX; p.y = e.clientY;
      document.documentElement.classList.add("cur-on");
      const t = (e.target as HTMLElement).closest<HTMLElement>("a,button,input,select,[data-magnetic]");
      ring.current?.classList.toggle("hover", !!t);
      const m = (e.target as HTMLElement).closest<HTMLElement>("[data-magnetic]");
      if (mag && mag !== m) { gsap.to(mag, { x: 0, y: 0, duration: 0.5, ease: "elastic.out(1,.5)" }); }
      mag = m;
      if (m) { const b = m.getBoundingClientRect(); gsap.to(m, { x: (e.clientX - b.left - b.width / 2) * 0.3, y: (e.clientY - b.top - b.height / 2) * 0.35, duration: 0.3 }); }
    };
    const down = (e: PointerEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("button,.btn"); if (!b) return;
      const box = b.getBoundingClientRect(), s = document.createElement("span");
      s.className = "ripple"; s.style.left = e.clientX - box.left + "px"; s.style.top = e.clientY - box.top + "px";
      b.appendChild(s); setTimeout(() => s.remove(), 650);
    };
    const loop = () => {
      r.x += (p.x - r.x) * 0.18; r.y += (p.y - r.y) * 0.18;
      if (dot.current) dot.current.style.transform = `translate(${p.x}px,${p.y}px)`;
      if (ring.current) ring.current.style.transform = `translate(${r.x}px,${r.y}px)`;
      raf = requestAnimationFrame(loop);
    };
    loop();
    addEventListener("pointermove", move); addEventListener("pointerdown", down);
    return () => { cancelAnimationFrame(raf); removeEventListener("pointermove", move); removeEventListener("pointerdown", down); document.documentElement.classList.remove("has-cursor", "cur-on"); };
  }, []);

  return <>
    <nav className="topnav" aria-label="Main">
      <Link href="/" className="logo" data-magnetic><span className="logo-mark" aria-hidden><i /><i /><i /></span>WalletIndex</Link>
      <div className="links">{PAGES.map(([href, label]) => <Link key={href} href={href} className={path === href ? "on" : ""}>{label}</Link>)}</div>
      <a className="gh" href={SITE.repo} target="_blank" rel="noreferrer" aria-label="GitHub repository" data-magnetic>
        <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
      </a>
    </nav>
    {children}
    <div className="curtain" ref={curtain} aria-hidden><i /><i /><i /><i /></div>
    <div className="cur-dot" ref={dot} aria-hidden /><div className="cur-ring" ref={ring} aria-hidden />
  </>;
}
