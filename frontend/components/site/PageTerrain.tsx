"use client";
// Dimmed, lighter instance of the landscape behind sub-page headers.
import dynamic from "next/dynamic";
import { useState } from "react";

const Terrain = dynamic(() => import("@/components/three/Terrain"), { ssr: false });

export default function PageTerrain() {
  const [on, setOn] = useState(false);
  return <div className={`page-terrain ${on ? "on" : ""}`} aria-hidden><Terrain ambient onReady={() => setOn(true)} /></div>;
}
