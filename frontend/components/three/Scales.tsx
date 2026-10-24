"use client";
/* eslint-disable react-hooks/immutability, react-hooks/purity -- R3F mutates memoised three objects inside useFrame by design */
// Three wallets as floating trays. Column heights are each wallet's asset weights, wireframes its targets;
// a tray tilts as far as it is off target. The scroll timeline drives `story` (lib/story.ts).
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { story } from "@/lib/story";
import { MAKERS } from "@/lib/skew";
import { HEX } from "@/lib/chain";

const ASSET = ["#4f5df0", "#1f9a8a", "#ee8a26"];
const INK = "#15171c", UNI = "#e6007a", WARN = "#c9831a";
// percentage-point drift per asset when the market has pushed every wallet off target (illustration)
const DRIFT = [[20, -15, -5], [-18, 13, 5], [-22, 15, 7]];
const R = 2.7, H = 2.8;
const POS = MAKERS.map((_, i) => { const a = Math.PI / 2 + i * Math.PI * 2 / 3; return new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R); });
const ease = { intro: 0, skew: 0, quote: 0, fill: 0, vol: 0 };

function shadowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!, r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  r.addColorStop(0, "rgba(21,23,28,.28)"); r.addColorStop(1, "rgba(21,23,28,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function Tray({ i, shadow }: { i: number; shadow: THREE.Texture }) {
  const g = useRef<THREE.Group>(null!), cols = useRef<THREE.Mesh[]>([]), ghosts = useRef<THREE.LineSegments[]>([]);
  const ring = useRef<THREE.Mesh>(null!), rim = useRef<THREE.Mesh>(null!), sh = useRef<THREE.Mesh>(null!);
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), []);
  const t = MAKERS[i].targets.map(x => x / 1e4);
  useFrame(({ clock }) => {
    const k = ease.skew * (i === 0 ? 1 - ease.fill : 1), time = clock.elapsedTime;
    const w = t.map((x, j) => x + DRIFT[i][j] / 100 * k);
    cols.current.forEach((m, j) => { const h = Math.max(0.02, w[j] * H * ease.intro); m.scale.y = h; m.position.y = 0.06 + h / 2; });
    ghosts.current.forEach((m, j) => { const h = t[j] * H; m.scale.y = h; m.position.y = 0.06 + h / 2; (m.material as THREE.LineBasicMaterial).opacity = 0.25 + 0.45 * ease.intro; });
    const y = Math.sin(time * 0.9 + i * 2) * 0.08 + (ease.intro - 1) * 1.5;
    g.current.position.set(POS[i].x, y, POS[i].z);
    g.current.rotation.z = (w[0] - t[0]) * -1.3; g.current.rotation.x = (w[2] - t[2]) * 2.2;
    const lit = i === 0 ? Math.sin(Math.min(1, ease.fill) * Math.PI) : 0;
    (rim.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.15 + lit * 1.6;
    const pulse = 1 + ease.vol * (0.28 + Math.sin(time * 3 + i) * 0.05);
    ring.current.scale.setScalar(pulse);
    const rm = ring.current.material as THREE.MeshBasicMaterial;
    rm.opacity = 0.12 + ease.vol * 0.55; rm.color.set(ease.vol > 0.55 ? WARN : INK);
    sh.current.position.set(POS[i].x, -1.15, POS[i].z); sh.current.scale.setScalar(3.4 - y * 0.6);
  });
  return <>
    <mesh ref={sh} rotation-x={-Math.PI / 2}><planeGeometry /><meshBasicMaterial map={shadow} transparent depthWrite={false} /></mesh>
    <group ref={g}>
      <mesh><cylinderGeometry args={[1.12, 1.18, 0.12, 64]} /><meshStandardMaterial color="#fbf8f1" roughness={0.55} /></mesh>
      <mesh ref={rim} rotation-x={Math.PI / 2} position-y={0.06}><torusGeometry args={[1.15, 0.04, 12, 96]} /><meshStandardMaterial color={HEX[i]} emissive={HEX[i]} emissiveIntensity={0.15} /></mesh>
      <mesh ref={ring} rotation-x={Math.PI / 2}><torusGeometry args={[1.42, 0.012, 6, 96]} /><meshBasicMaterial color={INK} transparent opacity={0.12} /></mesh>
      {t.map((_, j) => <group key={j}>
        <mesh ref={m => { if (m) cols.current[j] = m; }} position-x={(j - 1) * 0.5}><boxGeometry args={[0.36, 1, 0.36]} /><meshStandardMaterial color={ASSET[j]} roughness={0.35} metalness={0.05} /></mesh>
        <lineSegments ref={m => { if (m) ghosts.current[j] = m; }} geometry={edges} position-x={(j - 1) * 0.5} scale={[0.46, 1, 0.46]}><lineBasicMaterial color={INK} transparent opacity={0.4} /></lineSegments>
      </group>)}
    </group>
  </>;
}

/** Quote rays from the pool to every wallet, plus the fill pulse to the winner (alice). */
function Routing() {
  const dots = useRef<THREE.Mesh[]>([]), pulse = useRef<THREE.Mesh>(null!);
  const line = useMemo(() => POS.map(() => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: UNI, transparent: true, opacity: 0 }))), []);
  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    line.forEach((l, i) => {
      const end = POS[i].clone().multiplyScalar(0.62); end.y = 0.3;
      const pos = l.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, 0, 0.3, 0); pos.setXYZ(1, end.x, end.y, end.z); pos.needsUpdate = true;
      const winner = i === 0 && ease.fill > 0.02;
      (l.material as THREE.LineBasicMaterial).opacity = ease.quote * (winner ? 0.95 : 0.45);
      const d = dots.current[i], f = (time * 0.6 + i / 3) % 1;
      d.position.set(end.x * f, 0.3, end.z * f); d.scale.setScalar(ease.quote * 0.09 + 0.0001);
    });
    const f = ease.fill, end = POS[0].clone().multiplyScalar(0.62);
    pulse.current.position.set(end.x * f, 0.3 + Math.sin(f * Math.PI) * 0.6, end.z * f);
    pulse.current.scale.setScalar(f > 0.02 && f < 0.98 ? 0.16 : 0.0001);
  });
  return <>
    {line.map((l, i) => <primitive key={i} object={l} />)}
    {POS.map((_, i) => <mesh key={i} ref={m => { if (m) dots.current[i] = m; }}><sphereGeometry args={[1, 12, 12]} /><meshBasicMaterial color={UNI} /></mesh>)}
    <mesh ref={pulse}><sphereGeometry args={[1, 24, 24]} /><meshStandardMaterial color={UNI} emissive={UNI} emissiveIntensity={0.8} /></mesh>
  </>;
}

function Pool() {
  const r = useRef<THREE.Mesh>(null!);
  useFrame((_, dt) => { r.current.rotation.z += dt * (0.4 + ease.quote * 1.6); r.current.position.y = 0.3 + (ease.intro - 1) * 1.2; });
  return <mesh ref={r} rotation-x={Math.PI / 2}><torusGeometry args={[0.5, 0.13, 24, 96, Math.PI * 1.8]} /><meshStandardMaterial color={UNI} roughness={0.3} /></mesh>;
}

function Rig({ onReady }: { onReady: () => void }) {
  const { camera, size, setDpr } = useThree(), root = useRef<THREE.Group>(null!), pointer = useRef({ x: 0, y: 0 });
  const perf = useRef({ n: 0, sum: 0, ready: false, low: false });
  useEffect(() => {
    const on = (e: PointerEvent) => { pointer.current = { x: e.clientX / innerWidth - 0.5, y: e.clientY / innerHeight - 0.5 }; };
    addEventListener("pointermove", on); return () => removeEventListener("pointermove", on);
  }, []);
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera, portrait = size.width < size.height;
    cam.position.set(0, portrait ? 11 : 6.6, portrait ? 21 : 11); cam.lookAt(0, 0.4, 0);
    // keep the subject clear of the copy: right of it on desktop (portrait is handled per frame below)
    if (!portrait) { cam.setViewOffset(size.width, size.height, -size.width * 0.2, 0, size.width, size.height); cam.updateProjectionMatrix(); }
  }, [camera, size]);
  useFrame((_, dt) => {
    if (size.width < size.height) {
      // portrait: below the hero copy at the top, then above the chapter card once the story starts
      const k = Math.min(1, scrollY / innerHeight), cam = camera as THREE.PerspectiveCamera;
      cam.setViewOffset(size.width, size.height, 0, size.height * (-0.2 + k * 0.38), size.width, size.height); cam.updateProjectionMatrix();
    }
    const k = 1 - Math.pow(0.002, dt);
    for (const key of Object.keys(ease) as (keyof typeof ease)[]) ease[key] += (story[key] - ease[key]) * k;
    root.current.rotation.y += ((pointer.current.x * 0.35 - 0.25 + ease.skew * 0.3) - root.current.rotation.y) * k * 0.5;
    root.current.rotation.x += (pointer.current.y * 0.08 - root.current.rotation.x) * k * 0.5;
    const p = perf.current;
    if (!p.ready) { p.ready = true; onReady(); }
    p.n++; p.sum += dt;
    if (p.n === 90) { if (!p.low && p.sum / p.n > 0.022) { p.low = true; setDpr(1); } p.n = 0; p.sum = 0; }
  });
  const shadow = useMemo(() => shadowTexture(), []);
  return <group ref={root}>
    <Pool /><Routing />
    {MAKERS.map((_, i) => <Tray key={i} i={i} shadow={shadow} />)}
  </group>;
}

export default function Scales({ onReady }: { onReady: () => void }) {
  return (
    <Canvas dpr={[1, 1.5]} gl={{ alpha: true, antialias: true }} camera={{ fov: 38, near: 0.1, far: 60 }} aria-label="Three wallets as trays: column heights are asset weights, wireframes the targets">
      <hemisphereLight args={["#ffffff", "#d9cfbd", 1.4]} />
      <directionalLight position={[4, 8, 5]} intensity={1.6} />
      <directionalLight position={[-6, 3, -4]} intensity={0.4} color="#ffd9b0" />
      <Rig onReady={onReady} />
    </Canvas>
  );
}
