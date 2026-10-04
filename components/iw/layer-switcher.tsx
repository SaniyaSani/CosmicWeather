"use client";

import { useEffect, useRef } from "react";

export type View = "sky" | "buildings" | "signal" | "build" | "data" | "about";
export type Layer = "sky" | "air";

export const NAV: { id: View; label: string }[] = [
  { id: "sky", label: "SKY" },
  { id: "buildings", label: "BUILDINGS" },
  { id: "signal", label: "SIGNAL" },
  { id: "build", label: "BUILD" },
  { id: "data", label: "DATA" },
  { id: "about", label: "ABOUT" },
];

/** Minimal wireframe globe. Meridians "rotate" by animating their x-radius. */
export function GlobeIcon({ className = "", animated = false }: { className?: string; animated?: boolean }) {
  const meridians = [0, 1, 2, 3, 4, 5];
  return <svg className={`iw-globe ${className}`} viewBox="-50 -50 100 100" aria-hidden="true">
    <circle r="46" className="globe-outline" />
    {[-30, -15, 0, 15, 30].map((lat) => { const y = Math.sin((lat * Math.PI) / 180) * 46; const rx = Math.cos((lat * Math.PI) / 180) * 46; return <ellipse key={lat} cx="0" cy={y} rx={rx} ry={rx * 0.16} className="globe-line" />; })}
    {meridians.map((index) => <ellipse key={index} cx="0" cy="0" ry="46" rx={Math.abs(Math.cos((index / meridians.length) * Math.PI)) * 46} className="globe-line">
      {animated && <animate attributeName="rx" dur="24s" repeatCount="indefinite" values={Array.from({ length: 13 }, (_, step) => (Math.abs(Math.cos(((index / meridians.length) + step / 12) * Math.PI)) * 46).toFixed(2)).join(";")} />}
    </ellipse>)}
    <line x1="-58" y1="0" x2="58" y2="0" className="globe-axis" /><line x1="0" y1="-58" x2="0" y2="58" className="globe-axis" />
    <rect x="-2" y="-2" width="4" height="4" className="globe-core" />
  </svg>;
}

export function LayerSwitcher({ layer, onChange }: { layer: Layer; onChange: (next: Layer) => void }) {
  return <button type="button" className="iw-layer-switch" onClick={() => onChange(layer === "sky" ? "air" : "sky")} aria-label={`Change layer to ${layer === "sky" ? "air (Breathing Buildings)" : "sky (Cosmic Rain)"}`}>
    <span className="iw-layer-label">CHANGE LAYER</span>
    <GlobeIcon className="iw-globe-small" />
    <span className="iw-layer-state"><b className={layer === "sky" ? "on" : ""}>SKY</b><i>↔</i><b className={layer === "air" ? "on" : ""}>AIR</b></span>
  </button>;
}

/**
 * Brief full-screen transition: falling cosmic streaks turn sideways into
 * airflow (sky → air) or the reverse, while the page colour crossfades.
 */
export function LayerTransition({ token, to }: { token: number; to: Layer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!token) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const width = window.innerWidth; const height = window.innerHeight;
    canvas.width = width; canvas.height = height;
    const particles = Array.from({ length: width < 700 ? 120 : 260 }, () => ({ x: Math.random() * width, y: Math.random() * height, speed: 120 + Math.random() * 340, length: 6 + Math.random() * 22 }));
    const start = performance.now(); let frame = 0; let last = start;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 950); const dt = (now - last) / 1000; last = now;
      context.clearRect(0, 0, width, height);
      const turn = to === "air" ? t : 1 - t; // 0 = falling, 1 = sideways airflow
      const angle = (Math.PI / 2) * (1 - turn * 0.92);
      const alpha = Math.sin(Math.PI * t) * 0.7;
      context.strokeStyle = to === "air" ? `rgba(65,105,225,${alpha})` : `rgba(154,203,255,${alpha})`;
      context.lineWidth = 1;
      for (const particle of particles) {
        particle.x += Math.cos(angle) * particle.speed * dt; particle.y += Math.sin(angle) * particle.speed * dt + Math.sin(particle.x / 60) * turn * 0.6;
        if (particle.x > width) particle.x -= width; if (particle.y > height) particle.y -= height;
        context.beginPath(); context.moveTo(particle.x, particle.y); context.lineTo(particle.x - Math.cos(angle) * particle.length, particle.y - Math.sin(angle) * particle.length); context.stroke();
      }
      if (t < 1) frame = requestAnimationFrame(step); else context.clearRect(0, 0, width, height);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [token, to]);
  return <canvas ref={canvasRef} className="iw-layer-transition" aria-hidden="true" />;
}
