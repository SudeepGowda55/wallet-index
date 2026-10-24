"use client";
/* eslint-disable react-hooks/immutability, react-hooks/purity -- R3F mutates memoised three objects inside useFrame by design */
// The price landscape. Each wallet is a basin; its depth is how cheap it is to trade with right now. Order flow
// (GPU particles) pours from the Uniswap pool's spring and runs to the deepest basin. Flow fills a basin, which raises
// it (the wallet rebalances, so it gets pricier) and the stream swings to the next wallet. Labelled as a simulation.
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { scene, sim } from "@/lib/story";
import { HEX } from "@/lib/chain";

export const SRC = new THREE.Vector2(0, -4.6);
export const BASINS = [new THREE.Vector2(-4.4, 1.6), new THREE.Vector2(0.6, 3.4), new THREE.Vector2(4.6, 0.6)];
const BASE_DEPTH = [1.55, 1.4, 1.25]; // alice, bob, carol: lower base spread (8/10/12 bps) = deeper basin
const N = 7000;

const HEIGHT = /* glsl */ `
uniform float uTime, uVol, uVel, uPtrOn;
uniform vec2 uPtr, uSrc, uB0, uB1, uB2;
uniform vec3 uDepth;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= .5; } return v; }
float basin(vec2 p, vec2 c, float d){ vec2 q = p - c; return d * exp(-dot(q, q) / 2.6); }
float height(vec2 p){
  float t = uTime;
  float h = (fbm(p * .32 + vec2(t * .025, -t * .018)) - .5) * (1.1 + uVol * 1.8);
  h += sin(p.x * .7 + t * .35) * sin(p.y * .6 - t * .28) * (.08 + uVol * .35);
  h += sin(length(p) * 3. - t * 6.) * uVel * .12;                       // scroll speed ripples the land
  h -= basin(p, uB0, uDepth.x) + basin(p, uB1, uDepth.y) + basin(p, uB2, uDepth.z);
  vec2 s = p - uSrc; h += 1.5 * exp(-dot(s, s) / 1.6);                    // the pool's spring
  vec2 m = p - uPtr; h -= .55 * uPtrOn * exp(-dot(m, m) / .7);            // the pointer presses the land
  return h;
}`;

const landVert = /* glsl */ `
${HEIGHT}
varying vec3 vW; varying float vH;
void main(){ vec4 w = modelMatrix * vec4(position, 1.); vH = height(w.xz); w.y += vH; vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const landFrag = /* glsl */ `
uniform float uTime, uVol, uBlock, uFade; uniform vec2 uSrc, uB0, uB1, uB2, uPtr; uniform float uPtrOn;
uniform vec3 uC0, uC1, uC2, uShare;
varying vec3 vW; varying float vH;
float line(float v, float w){ float d = abs(fract(v) - .5) / fwidth(v); return 1. - smoothstep(w - 1., w, d); }
float near(vec2 p, vec2 c, float r){ vec2 q = p - c; return exp(-dot(q, q) / r); }
void main(){
  vec2 p = vW.xz;
  float minor = line(vH * 7. + .5, 1.2), major = line(vH * 1.4 + .5, 1.8);
  vec3 bg = vec3(.051, .043, .063);
  vec3 tint = uC0 * near(p, uB0, 3.) * (.35 + uShare.x) + uC1 * near(p, uB1, 3.) * (.35 + uShare.y) + uC2 * near(p, uB2, 3.) * (.35 + uShare.z);
  vec3 contour = mix(vec3(1., .62, .43), tint * 1.6 + vec3(.15), clamp(length(tint) * 1.4, 0., 1.));
  vec3 col = bg + vec3(.02, .015, .03) * (vH + 1.) + tint * .09;
  col += contour * (minor * .28 + major * .75);
  // block pulse leaving the pool's spring every 2 s
  float d = length(p - uSrc), r = uBlock * 9.;
  col += vec3(1., .24, .6) * exp(-pow((d - r) * 9., 2.)) * (1. - uBlock) * .55;
  col += vec3(1., .3, .62) * near(p, uSrc, .5) * .35;
  col += vec3(1., .85, .7) * near(p, uPtr, .5) * uPtrOn * .25 * (minor + major);
  float edge = smoothstep(9.5, 5.5, length(p * vec2(.85, 1.)));
  gl_FragColor = vec4(col, edge * uFade);
}`;

const flowVert = /* glsl */ `
${HEIGHT}
attribute vec4 aSeed; attribute float aK, aBasin;
uniform float uPix, uFlow; uniform vec3 uC0, uC1, uC2;
varying vec3 vC; varying float vA;
void main(){
  vec2 B = aBasin < .5 ? uB0 : aBasin < 1.5 ? uB1 : uB2;
  vC = aBasin < .5 ? uC0 : aBasin < 1.5 ? uC1 : uC2;
  float k = aK; vec2 p;
  if (k < .78) {
    float t = k / .78, e = t * t * (3. - 2. * t);
    vec2 dir = B - uSrc, n = normalize(vec2(-dir.y, dir.x));
    p = mix(uSrc, B, e) + n * (sin(t * 3.14159) * (aSeed.x - .5) * 2.2 + sin(t * 11. + aSeed.y * 6.28 + uTime * 1.3) * .1);
  } else {
    float t = (k - .78) / .22, a = aSeed.y * 6.28 + t * 7.;
    p = B + vec2(cos(a), sin(a)) * ((1. - t) * 1.1 * aSeed.z + .08);
  }
  vec4 mv = viewMatrix * vec4(p.x, height(p) + .05, p.y, 1.);
  gl_PointSize = (2.2 + aSeed.w * 3.4) * uPix * (8. / -mv.z);
  vA = uFlow * smoothstep(0., .06, k) * (1. - smoothstep(.9, 1., k)) * (.65 + aSeed.w * .35);
  gl_Position = projectionMatrix * mv;
}`;

const flowFrag = /* glsl */ `
varying vec3 vC; varying float vA;
void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; float g = smoothstep(.5, 0., d); gl_FragColor = vec4(vC * (.7 + g), g * vA); }`;

function World({ ambient }: { ambient: boolean }) {
  const { camera, size, gl, setDpr } = useThree();
  const perf = useRef({ n: 0, sum: 0, low: false });
  const ptr = useRef({ x: 0, y: 0, on: 0, tx: 0, ty: 0, inside: false });
  const ray = useMemo(() => new THREE.Raycaster(), []), plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const cols = HEX.map(c => new THREE.Color(c));
  const uniforms = useMemo(() => ({
    uTime: { value: 0 }, uVol: { value: 0 }, uVel: { value: 0 }, uPtrOn: { value: 0 }, uPtr: { value: new THREE.Vector2(99, 99) },
    uSrc: { value: SRC }, uB0: { value: BASINS[0] }, uB1: { value: BASINS[1] }, uB2: { value: BASINS[2] },
    uDepth: { value: new THREE.Vector3(...BASE_DEPTH) }, uShare: { value: new THREE.Vector3(1 / 3, 1 / 3, 1 / 3) },
    uC0: { value: cols[0] }, uC1: { value: cols[1] }, uC2: { value: cols[2] }, uBlock: { value: 0 }, uFade: { value: 0 },
    uPix: { value: 1 }, uFlow: { value: 1 },
  }), []);
  const land = useMemo(() => new THREE.ShaderMaterial({ vertexShader: landVert, fragmentShader: landFrag, uniforms, transparent: true, depthWrite: true }), [uniforms]);
  const landGeo = useMemo(() => new THREE.PlaneGeometry(20, 20, 260, 260).rotateX(-Math.PI / 2), []);
  const flow = useMemo(() => {
    const n = ambient ? 2500 : N, g = new THREE.BufferGeometry(), seed = new Float32Array(n * 4), k = new Float32Array(n), b = new Float32Array(n), speed = new Float32Array(n);
    for (let i = 0; i < n; i++) { seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4); k[i] = Math.random(); b[i] = i % 3; speed[i] = 0.09 + Math.random() * 0.08; }
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    g.setAttribute("aK", new THREE.BufferAttribute(k, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aBasin", new THREE.BufferAttribute(b, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    const m = new THREE.ShaderMaterial({ vertexShader: flowVert, fragmentShader: flowFrag, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    return { g, m, k, b, speed, n };
  }, [ambient, uniforms]);
  const rings = useRef<THREE.Mesh[]>([]), beams = useRef<THREE.Mesh[]>([]);
  const cam = useRef({ orbit: scene.orbit, dist: scene.dist, lift: scene.lift, fx: scene.fx, fz: scene.fz, shift: scene.shift, rise: scene.rise, vol: 0, flow: 1, skew: 0, vel: 0 });
  const tmp = useMemo(() => new THREE.Vector3(), []), ndc = useMemo(() => new THREE.Vector2(), []);

  useEffect(() => {
    const move = (e: PointerEvent) => { ptr.current.tx = e.clientX / innerWidth * 2 - 1; ptr.current.ty = -(e.clientY / innerHeight * 2 - 1); ptr.current.inside = true; };
    const leave = () => { ptr.current.inside = false; };
    addEventListener("pointermove", move, { passive: true }); document.addEventListener("pointerleave", leave);
    return () => { removeEventListener("pointermove", move); document.removeEventListener("pointerleave", leave); };
  }, []);

  useFrame((state, dtRaw) => {
    const pf = perf.current; pf.n++; pf.sum += dtRaw;
    if (pf.n === 90) { if (!pf.low && pf.sum / pf.n > 0.022) { pf.low = true; setDpr(1); } pf.n = 0; pf.sum = 0; }
    const dt = Math.min(dtRaw, 0.05), t = state.clock.elapsedTime, c = cam.current, e = 1 - Math.pow(0.04, dt);
    for (const k of Object.keys(c) as (keyof typeof c)[]) c[k] += ((scene as any)[k] - c[k]) * e;
    const u = uniforms;
    u.uTime.value = t; u.uVol.value = c.vol; u.uVel.value = c.vel; u.uBlock.value = (t % 2) / 2;
    u.uFade.value = Math.min(1, u.uFade.value + dt * 0.8); u.uPix.value = gl.getPixelRatio(); u.uFlow.value = c.flow;

    // routing simulation: deepest basin wins most flow; flow fills it, the agent/market slowly drains it back
    const depth = BASE_DEPTH.map((d, i) => d * (1 - sim.level[i] * 0.7) * (1 - c.skew * 0.55));
    const ex = depth.map(d => Math.exp(d * 7)), sum = ex[0] + ex[1] + ex[2];
    for (let i = 0; i < 3; i++) {
      sim.share[i] = ex[i] / sum;
      sim.level[i] = Math.min(1, Math.max(0, sim.level[i] + (sim.share[i] * 0.16 * c.flow - sim.level[i] * 0.055) * dt));
    }
    u.uDepth.value.set(depth[0], depth[1], depth[2]); u.uShare.value.set(sim.share[0], sim.share[1], sim.share[2]);

    // particles: advance on the CPU, re-pick a basin by share only when a particle respawns at the spring
    const { k, b, speed, n } = flow;
    for (let i = 0; i < n; i++) {
      k[i] += dt * speed[i] * (0.4 + c.flow);
      if (k[i] >= 1) { k[i] -= 1; const r = Math.random(); b[i] = r < sim.share[0] ? 0 : r < sim.share[0] + sim.share[1] ? 1 : 2; }
    }
    flow.g.attributes.aK.needsUpdate = true; flow.g.attributes.aBasin.needsUpdate = true;

    // pointer presses the land where it meets the ground plane
    const P = ptr.current; P.x += (P.tx - P.x) * 0.2; P.y += (P.ty - P.y) * 0.2;
    ray.setFromCamera(ndc.set(P.x, P.y), camera);
    if (ray.ray.intersectPlane(plane, tmp)) u.uPtr.value.set(tmp.x, tmp.z);
    u.uPtrOn.value += ((P.inside ? 1 : 0) - u.uPtrOn.value) * 0.08;

    // wallet rings hover over their basins and swell with the flow they win
    BASINS.forEach((B, i) => {
      const y = -depth[i] * 0.95 + 0.9 + Math.sin(t * 1.4 + i) * 0.06, s = 0.55 + sim.share[i] * 0.7;
      rings.current[i]?.position.set(B.x, y, B.y); rings.current[i]?.scale.setScalar(s);
      if (rings.current[i]) rings.current[i].rotation.z = t * 0.4 + i;
      beams.current[i]?.position.set(B.x, y + 1.2, B.y);
      sim.screen[i] = (() => { tmp.set(B.x, y + 0.9, B.y).project(camera); return [(tmp.x + 1) / 2 * size.width, (1 - tmp.y) / 2 * size.height, tmp.z < 1 ? 1 : 0]; })();
    });

    // camera: scroll-driven orbit around a focus point, slow drift, pointer parallax
    const portrait = size.width < size.height, R = c.dist * (portrait ? 1.5 : 1), ang = c.orbit + Math.sin(t * 0.05) * 0.06 + P.x * 0.05;
    state.camera.position.set(c.fx + Math.sin(ang) * R, c.lift * (portrait ? 1.25 : 1) + P.y * 0.25, c.fz + Math.cos(ang) * R);
    state.camera.lookAt(c.fx, -0.4, c.fz);
    const pc = state.camera as THREE.PerspectiveCamera;
    pc.setViewOffset(size.width, size.height, portrait ? 0 : -c.shift * size.width, size.height * (portrait ? c.rise * 0.4 + 0.08 : c.rise), size.width, size.height);
  });

  return <>
    <mesh geometry={landGeo} material={land} />
    <points geometry={flow.g} material={flow.m} />
    {BASINS.map((_, i) => <group key={i}>
      <mesh ref={m => { if (m) rings.current[i] = m; }} rotation-x={Math.PI / 2}><torusGeometry args={[0.6, 0.025, 8, 80, Math.PI * 1.7]} /><meshBasicMaterial color={HEX[i]} transparent opacity={0.9} /></mesh>
      <mesh ref={m => { if (m) beams.current[i] = m; }}><cylinderGeometry args={[0.008, 0.008, 2.4, 6]} /><meshBasicMaterial color={HEX[i]} transparent opacity={0.45} /></mesh>
    </group>)}
  </>;
}

export default function Terrain({ ambient = false, onReady }: { ambient?: boolean; onReady?: () => void }) {
  return (
    <Canvas dpr={[1, 1.5]} gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }} camera={{ fov: 40, near: 0.1, far: 80 }}
      onCreated={() => requestAnimationFrame(() => onReady?.())} aria-label="Price landscape: wallets are basins, order flow runs to the deepest one (simulation)">
      <World ambient={ambient} />
    </Canvas>
  );
}
