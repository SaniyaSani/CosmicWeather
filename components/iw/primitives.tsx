"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Measure an element's content box (px). */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Four tiny technical corner marks around a box. */
export function CornerMarks({ size = 9 }: { size?: number }) {
  return <span className="iw-corners" aria-hidden="true" style={{ "--corner": `${size}px` } as CSSProperties}><i /><i /><i /><i /></span>;
}

/** A thin technical frame with optional "+" crosses. */
export function Plaque({ children, className = "", label, plus = true, as = "section", id }: { children: ReactNode; className?: string; label?: ReactNode; plus?: boolean; as?: "section" | "div" | "aside" | "article"; id?: string }) {
  const Tag = as;
  return <Tag id={id} className={`iw-plaque ${className}`}>
    {label && <div className="iw-plaque-label">{label}</div>}
    {children}
    {plus && <span className="iw-plus" aria-hidden="true">+</span>}
  </Tag>;
}

/** Panel heading in the reference style: TITLE ——   small right meta. */
export function PanelHeading({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return <header className="iw-panel-heading">
    <h2>{title}<span className="iw-rule" aria-hidden="true" /></h2>
    {meta && <div className="iw-panel-meta">{meta}</div>}
    {children}
  </header>;
}

export type Provenance = "MEASURED" | "DERIVED" | "ESTIMATED" | "SETTING" | "UNAVAILABLE" | "MODEL" | "INFERENCE";

/** Small tag that states where a number comes from. */
export function Prov({ kind }: { kind: Provenance }) {
  const short = { MEASURED: "M", DERIVED: "D", ESTIMATED: "E", SETTING: "S", UNAVAILABLE: "—", MODEL: "MOD", INFERENCE: "INF" }[kind];
  return <abbr className={`iw-prov prov-${kind.toLowerCase()}`} title={kind}>{short}</abbr>;
}

export function StatusDot({ state }: { state: "live" | "ok" | "warn" | "off" | "demo" }) {
  return <span className={`iw-dot dot-${state}`} aria-hidden="true" />;
}

/** Digits that roll softly when the value changes (respecting reduced motion via CSS). */
export function Ticker({ value }: { value: string }) {
  return <span className="iw-ticker" key={value}>{value}</span>;
}

export type AnnotationSpec = {
  id: string;
  /** Anchor point in container pixels. */
  x: number; y: number;
  /** Label point in container pixels (where the text block starts). */
  lx: number; ly: number;
  title: string;
  lines?: string[];
  align?: "left" | "right";
  delay?: number;
  emphasis?: boolean;
};

/**
 * Annotation overlay: tiny square anchor, 1 px line with one bend, and an
 * HTML label (so text stays crisp and accessible). Lines are drawn in SVG.
 */
export function AnnotationLayer({ width, height, items, className = "" }: { width: number; height: number; items: AnnotationSpec[]; className?: string }) {
  if (!width || !height) return null;
  return <div className={`iw-annotations ${className}`} aria-hidden={false}>
    <svg className="iw-annotation-lines" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {items.map((item) => {
        const elbowX = item.lx + (item.align === "right" ? 14 : -14);
        const path = `M ${item.x} ${item.y} L ${elbowX} ${item.ly} L ${item.align === "right" ? item.lx - 2 : item.lx + 2} ${item.ly}`;
        return <g key={item.id} className="iw-annotation-g" style={{ "--delay": `${item.delay ?? 0}ms` } as CSSProperties}>
          <path d={path} pathLength={1} className="iw-annotation-path" />
          <rect x={item.x - 5} y={item.y - 5} width={10} height={10} className="iw-annotation-anchor" />
          <rect x={item.x - 1.5} y={item.y - 1.5} width={3} height={3} className="iw-annotation-core" />
        </g>;
      })}
    </svg>
    {items.map((item) => <div key={item.id} className={`iw-annotation-label ${item.align === "right" ? "align-right" : ""} ${item.emphasis ? "emphasis" : ""}`} style={{ left: item.lx, top: item.ly, "--delay": `${(item.delay ?? 0) + 260}ms` } as CSSProperties}>
      <strong>{item.title}</strong>
      {item.lines?.map((line) => <span key={line}>{line}</span>)}
    </div>)}
  </div>;
}

/** Expandable "Why does this matter?" note. */
export function WhyNote({ title, children }: { title: string; children: ReactNode }) {
  return <details className="iw-why"><summary><span>+</span>{title}</summary><p>{children}</p></details>;
}

/** Inline term with a tap/hover definition. */
export function Term({ term, children }: { term: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <span className="iw-term">
    <button type="button" onClick={() => setOpen((value) => !value)} onBlur={() => setOpen(false)} aria-expanded={open}>{term}</button>
    {open && <span role="tooltip" className="iw-term-tip">{children}</span>}
  </span>;
}

export function niceTicks(min: number, max: number, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const span = max - min;
  const step0 = span / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= step0) ?? 10 * magnitude;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

export function formatTime(time: number, withSeconds = true) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}) }).format(time);
}

export function formatAgo(ms: number) {
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 48 * 3_600_000) return `${Math.round(ms / 3_600_000)} h ago`;
  return `${Math.round(ms / 86_400_000)} d ago`;
}
