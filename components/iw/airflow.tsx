"use client";

import { useEffect, useMemo, useRef } from "react";
import { AnnotationLayer, type AnnotationSpec, useSize, usePrefersReducedMotion } from "./primitives";

/** Schematic building section in a 1200 × 760 design space. */
const W = 1200; const H = 760;
type Pt = [number, number];
/** Cubic Bézier chains: [p0, c1, c2, p1, c1, c2, p2, …]. */
type Chain = Pt[];

const FLOWS: { id: string; chain: Chain; strands: number; speed: number; deposit?: boolean; kind: "outdoor" | "indoor" | "radon" | "filter" | "stack" }[] = [
  { id: "outdoor", kind: "outdoor", strands: 5, speed: 0.07, chain: [[-40, 250], [140, 230], [330, 330], [512, 318], [600, 312], [650, 360], [720, 372], [820, 384], [880, 330], [960, 300]] },
  { id: "filter", kind: "filter", strands: 4, speed: 0.06, deposit: true, chain: [[-40, 470], [160, 470], [360, 520], [520, 498], [600, 488], [640, 486], [706, 486], [760, 486], [800, 470], [860, 450]] },
  { id: "radon", kind: "radon", strands: 4, speed: 0.045, chain: [[610, 760], [620, 720], [598, 690], [612, 660], [626, 628], [700, 620], [760, 600], [820, 580], [850, 540], [880, 500]] },
  { id: "indoor", kind: "indoor", strands: 3, speed: 0.05, chain: [[560, 380], [600, 300], [760, 270], [880, 300], [960, 330], [960, 390], [860, 392], [760, 394], [640, 400], [560, 380]] },
  { id: "stack", kind: "stack", strands: 3, speed: 0.05, chain: [[900, 560], [930, 470], [900, 420], [930, 340], [955, 270], [900, 200], [860, 160], [830, 130], [900, 80], [1000, 60]] },
];

function sampleChain(chain: Chain, perSegment = 40) {
  const points: Pt[] = [];
  for (let index = 0; index + 3 < chain.length; index += 3) {
    const [p0, c1, c2, p1] = [chain[index], chain[index + 1], chain[index + 2], chain[index + 3]];
    for (let step = index ? 1 : 0; step <= perSegment; step += 1) {
      const t = step / perSegment; const u = 1 - t;
      points.push([u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]]);
    }
  }
  return points;
}

function chainPath(chain: Chain, dx = 0, dy = 0) {
  let d = `M${chain[0][0] + dx} ${chain[0][1] + dy}`;
  for (let index = 1; index + 2 < chain.length; index += 3) d += ` C${chain[index][0] + dx} ${chain[index][1] + dy} ${chain[index + 1][0] + dx} ${chain[index + 1][1] + dy} ${chain[index + 2][0] + dx} ${chain[index + 2][1] + dy}`;
  return d;
}

function layout(width: number, height: number) {
  const narrow = width < 760;
  // The building section (design x 500–1060) sits in the right half; ribbons reach in from the left.
  const scale = narrow ? Math.min(width / 640, (height * 0.5) / 640) : Math.min((width * 0.44) / 560, (height * 0.92) / 700);
  const offsetX = narrow ? width - 1075 * scale : width * 0.52 - 520 * scale;
  const offsetY = height - H * scale;
  return { scale, offsetX, offsetY, narrow, map: (point: Pt) => ({ x: offsetX + point[0] * scale, y: offsetY + point[1] * scale }) };
}

export function AirflowVisualization() {
  const [ref, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const geo = layout(size.width || 1, size.height || 1);
  const sampled = useMemo(() => FLOWS.map((flow) => ({ ...flow, points: sampleChain(flow.chain) })), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !size.width) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(size.width * ratio); canvas.height = Math.round(size.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const { map, scale } = layout(size.width, size.height);
    const lowPower = size.width < 700;
    type Mote = { flow: number; s: number; speed: number; offset: number; size: number; alpha: number; stuck: boolean };
    const motes: Mote[] = Array.from({ length: lowPower ? 70 : 150 }, (_, index) => ({ flow: index % sampled.length, s: Math.random(), speed: 0.6 + Math.random() * 0.9, offset: (Math.random() - 0.5) * 16, size: 0.8 + Math.random() * 1.8, alpha: 0.35 + Math.random() * 0.5, stuck: false }));
    const deposits: { x: number; y: number; size: number }[] = [];
    const filterFace = map([706, 486]);
    let frame = 0; let last = performance.now(); let visible = true;
    const colour = (kind: string, alpha: number) => kind === "radon" ? `rgba(150,92,210,${alpha})` : kind === "filter" ? `rgba(32,120,160,${alpha})` : `rgba(65,105,225,${alpha})`;
    const pointAt = (points: Pt[], s: number) => { const position = Math.min(points.length - 1, Math.max(0, s * (points.length - 1))); const index = Math.floor(position); const k = position - index; const a = points[index]; const b = points[Math.min(points.length - 1, index + 1)]; return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, dx: b[0] - a[0], dy: b[1] - a[1] }; };
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      context.clearRect(0, 0, size.width, size.height);
      for (const mote of motes) {
        const flow = sampled[mote.flow];
        if (!mote.stuck && !reducedMotion) mote.s += flow.speed * mote.speed * dt;
        if (mote.s >= 1) { mote.s = 0; mote.flow = Math.floor(Math.random() * sampled.length); }
        const p = pointAt(flow.points, mote.s);
        const length = Math.hypot(p.dx, p.dy) || 1;
        const sway = Math.sin(now / 900 + mote.offset) * 3;
        const pt = map([p.x - (p.dy / length) * (mote.offset + sway), p.y + (p.dx / length) * (mote.offset + sway)]);
        // Some aerosol on the filter path is captured on the filter face.
        if (flow.deposit && !reducedMotion && Math.abs(pt.x - filterFace.x) < 2.5 * scale && Math.random() < 0.08) {
          deposits.push({ x: filterFace.x + (Math.random() - 0.5) * 6 * scale, y: pt.y + (Math.random() - 0.5) * 4, size: mote.size * 0.8 });
          if (deposits.length > 90) deposits.shift();
          mote.s = 0; mote.flow = Math.floor(Math.random() * sampled.length);
          continue;
        }
        const fade = Math.min(1, mote.s * 8) * Math.min(1, (1 - mote.s) * 8);
        context.fillStyle = colour(flow.kind, mote.alpha * fade);
        context.beginPath(); context.arc(pt.x, pt.y, mote.size * Math.max(0.7, scale), 0, Math.PI * 2); context.fill();
      }
      context.fillStyle = "rgba(21,35,71,0.55)";
      for (const deposit of deposits) context.fillRect(deposit.x - deposit.size / 2, deposit.y - deposit.size / 2, deposit.size, deposit.size);
    };
    const loop = (now: number) => { frame = requestAnimationFrame(loop); if (!visible || document.hidden) { last = now; return; } draw(now); };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }); observer.observe(canvas);
    if (reducedMotion) draw(performance.now()); else frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [size.width, size.height, reducedMotion, sampled]);

  const at = (point: Pt) => geo.map(point);
  const annotations: AnnotationSpec[] = size.width ? [
    ...(geo.narrow ? [] : [{ id: "outdoor", ...xy(at([440, 318])), ...lxy(at([440, 318]), geo.narrow ? -10 : -24, geo.narrow ? -44 : 64), title: "OUTDOOR AIR", lines: geo.narrow ? [] : ["ENTERS THROUGH WINDOWS,", "GAPS AND VENTILATION"], align: "right" as const, delay: 200 }]),
    { id: "filter", ...xy(at([706, 486])), ...lxy(at([706, 486]), geo.narrow ? -20 : 40, geo.narrow ? 70 : 86), title: "FIXED FILTER", lines: geo.narrow ? [] : ["COLLECTS AEROSOL-BOUND", "RADON PROGENY"], align: geo.narrow ? "right" : "left", delay: 420 },
    ...(geo.narrow ? [] : [
      { id: "deposition", ...xy(at([712, 470])), ...lxy(at([712, 470]), 170, -120), title: "PARTICLE DEPOSITION", lines: ["β-DECAYING Pb-214 / Bi-214", "ON THE FILTER FACE"], align: "left" as const, delay: 640 },
      { id: "indoor", ...xy(at([800, 290])), ...lxy(at([800, 290]), 170, -120), title: "INDOOR AIR", lines: ["MIXES, RISES (STACK EFFECT)", "AND LEAVES AGAIN"], align: "left" as const, delay: 860 },
      { id: "airflow", ...xy(at([360, 505])), ...lxy(at([360, 505]), -40, 110), title: "AIRFLOW", lines: ["5 V BLOWER · FIXED VOLUME"], align: "right" as const, delay: 1080 },
    ]),
    { id: "radon", ...xy(at([612, 700])), ...lxy(at([612, 700]), geo.narrow ? 30 : -90, geo.narrow ? 14 : 10), title: "RADON FROM SOIL", lines: geo.narrow ? [] : ["Rn-222 · NOBLE GAS · 3.8 DAYS"], align: geo.narrow ? "left" : "right", delay: 1300 },
  ] : [];

  const g = `translate(${geo.offsetX} ${geo.offsetY}) scale(${geo.scale})`;
  return <div className="iw-air-stage" ref={ref}>
    {size.width > 0 && <svg className="iw-air-svg" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
      <g transform={g}>
        <g className="air-grid">{Array.from({ length: 13 }, (_, index) => <line key={`v${index}`} x1={index * 100} x2={index * 100} y1={0} y2={H} />)}{Array.from({ length: 8 }, (_, index) => <line key={`h${index}`} x1={0} x2={W} y1={index * 100} y2={index * 100} />)}</g>
        <g className="air-soil">
          <line x1="-200" x2="1400" y1="560" y2="560" className="ground" />
          {Array.from({ length: 34 }, (_, index) => <line key={index} x1={index * 40 - 100} y1={760} x2={index * 40 - 60} y2={570} />)}
        </g>
        <g className="air-building">
          <rect x="520" y="560" width="500" height="110" className="basement" />
          <rect x="520" y="400" width="500" height="160" />
          <rect x="520" y="250" width="500" height="150" />
          <path d="M500 250 L770 120 L1040 250" />
          <rect x="512" y="300" width="16" height="42" className="window" />
          <rect x="512" y="452" width="16" height="42" className="window" />
          <path d="M900 560 L900 400 M900 400 L960 400" className="stair" />
          <path d="M600 670 L610 680 L604 690" className="crack" />
          <g className="air-module"><rect x="690" y="470" width="32" height="32" /><line x1="706" x2="706" y1="470" y2="502" className="filter-face" /><rect x="740" y="476" width="22" height="20" className="detector" /><rect x="780" y="478" width="16" height="16" className="blower" /></g>
          <path d="M1020 250 L1040 250 L1040 260" className="eave" />
        </g>
        <g className="air-ribbons">
          {FLOWS.flatMap((flow) => Array.from({ length: flow.strands }, (_, strand) => <path key={`${flow.id}-${strand}`} d={chainPath(flow.chain, 0, (strand - (flow.strands - 1) / 2) * 5)} className={`ribbon ribbon-${flow.kind}`} style={{ animationDelay: `${strand * -1.6}s` }} />))}
        </g>
        <g className="air-dims"><line x1="1060" x2="1060" y1="250" y2="560" /><line x1="1052" x2="1068" y1="250" y2="250" /><line x1="1052" x2="1068" y1="560" y2="560" /><text x="1074" y="410">2 FLOORS</text><text x="1074" y="620">BASEMENT</text><text x="1074" y="700">SOIL</text></g>
      </g>
    </svg>}
    <canvas ref={canvasRef} className="iw-air-canvas" aria-hidden="true" />
    <AnnotationLayer width={size.width} height={size.height} items={annotations} className="air" />
  </div>;
}

const xy = (point: { x: number; y: number }) => ({ x: point.x, y: point.y });
const lxy = (point: { x: number; y: number }, dx: number, dy: number) => ({ lx: point.x + dx, ly: point.y + dy });
