"use client";

import { useMemo, useState } from "react";
import type { CosmicEvent, TimePoint } from "@/lib/cosmic/types";
import { niceTicks, useSize } from "@/components/iw/primitives";

export type TimelineSeries = {
  localRaw: (TimePoint & { sigma: number })[];
  localCorrected: TimePoint[];
  jung: TimePoint[];
  pressure: TimePoint[];
  kp: TimePoint[];
};

export type TimelineToggles = { local: boolean; corrected: boolean; pressure: boolean; jung: boolean; solar: boolean; geomagnetic: boolean };

const SOLAR_TYPES = new Set<CosmicEvent["type"]>(["solar-flare", "cme", "cme-arrival", "sep", "ips", "forbush-candidate", "gle-candidate", "reference-variation"]);
const GEO_TYPES = new Set<CosmicEvent["type"]>(["geomagnetic-storm", "kp", "alert"]);

export function eventGlyph(type: CosmicEvent["type"]) {
  if (type === "solar-flare") return "☀";
  if (type === "cme" || type === "cme-arrival" || type === "ips") return "◌";
  if (type === "sep" || type === "gle-candidate") return "⚡";
  if (type === "geomagnetic-storm" || type === "kp" || type === "alert") return "⊕";
  if (type === "forbush-candidate" || type === "reference-variation") return "☄";
  if (type === "local-anomaly") return "■";
  return "·";
}

export function relevanceText(event: CosmicEvent) {
  switch (event.type) {
    case "solar-flare": return "Flare X-rays are absorbed high in the atmosphere and do not normally change ground-level cosmic-ray rates. Any match with our data would be a temporal overlap only.";
    case "cme": case "cme-arrival": case "ips": return "A CME or shock passing Earth can be followed by a Forbush decrease over hours to days. This event may be relevant, but timing alone does not establish causation.";
    case "sep": case "gle-candidate": return "Only the most energetic solar particle events (Ground Level Enhancements, rare) are seen by ground monitors. Check neutron monitors before linking it to detector data.";
    case "geomagnetic-storm": case "kp": case "alert": return "Geomagnetic storms slightly change the magnetic shielding; at mid-latitudes the effect on ground-level rates is usually small. May be relevant; not a cause by itself.";
    case "forbush-candidate": return "Several neutron monitors show a decrease. A local decrease at the same time would be consistent with it, not proof of it.";
    default: return "This event occurred near the same time as the observed data. Timing alone does not establish causation.";
  }
}

type Props = {
  series: TimelineSeries;
  events: CosmicEvent[];
  from: number;
  to: number;
  toggles: TimelineToggles;
  correctionActive: boolean;
  onSelectEvent: (event: CosmicEvent) => void;
  selectedEventId: string | null;
  now: number;
};

export function CosmicTimeline({ series, events, from, to, toggles, correctionActive, onSelectEvent, selectedEventId, now }: Props) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const width = Math.max(1, size.width);
  const height = width < 600 ? 300 : 360;
  const m = { left: 46, right: 54, top: 30, bottom: 44 };
  const plotW = Math.max(10, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;
  const kpBand = 34;

  const pctValues = [
    ...(toggles.local ? series.localRaw.flatMap((point) => [point.v + point.sigma, point.v - point.sigma]) : []),
    ...(toggles.corrected && correctionActive ? series.localCorrected.map((point) => point.v) : []),
    ...(toggles.jung ? series.jung.map((point) => point.v) : []),
  ].filter((value) => value >= -60 && value <= 60);
  const pctExtent = Math.max(2, ...pctValues.map((value) => Math.abs(value))) * 1.1;
  const pressures = series.pressure.map((point) => point.v);
  const pMin = pressures.length ? Math.min(...pressures) - 1 : 950; const pMax = pressures.length ? Math.max(...pressures) + 1 : 980;

  const x = (t: number) => m.left + ((t - from) / Math.max(1, to - from)) * plotW;
  const yPct = (v: number) => m.top + (1 - (v + pctExtent) / (2 * pctExtent)) * (plotH - kpBand);
  const yP = (v: number) => m.top + (1 - (v - pMin) / Math.max(0.1, pMax - pMin)) * (plotH - kpBand);
  const line = (points: TimePoint[], y: (v: number) => number, gapMs = 2.5 * 3_600_000) => points.filter((point) => point.t >= from && point.t <= to).map((point, index, all) => `${index && point.t - all[index - 1].t <= gapMs ? "L" : "M"}${x(point.t).toFixed(1)} ${y(point.v).toFixed(1)}`).join(" ");
  const band = (points: (TimePoint & { sigma: number })[]) => {
    const inRange = points.filter((point) => point.t >= from && point.t <= to);
    if (inRange.length < 2) return "";
    const top = inRange.map((point, index) => `${index ? "L" : "M"}${x(point.t).toFixed(1)} ${yPct(Math.min(pctExtent, point.v + point.sigma)).toFixed(1)}`).join(" ");
    const bottom = [...inRange].reverse().map((point) => `L${x(point.t).toFixed(1)} ${yPct(Math.max(-pctExtent, point.v - point.sigma)).toFixed(1)}`).join(" ");
    return `${top} ${bottom} Z`;
  };

  const timeTicks = useMemo(() => {
    const span = to - from; const step = span <= 30 * 3_600_000 ? 3 * 3_600_000 : span <= 4 * 86_400_000 ? 12 * 3_600_000 : 86_400_000;
    const offset = new Date().getTimezoneOffset() * 60_000;
    const ticks: number[] = [];
    for (let t = Math.ceil((from - offset) / step) * step + offset; t <= to; t += step) ticks.push(t);
    return ticks;
  }, [from, to]);
  const shortSpan = to - from <= 30 * 3_600_000;
  const fmtTick = (t: number) => new Intl.DateTimeFormat("en-GB", shortSpan ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", day: "2-digit", hour: "2-digit" }).format(t);
  const tz = new Intl.DateTimeFormat("en-GB", { timeZoneName: "short" }).formatToParts(now).find((part) => part.type === "timeZoneName")?.value ?? "local";

  const shownEvents = events.filter((event) => event.timestamp >= from && event.timestamp <= to && ((toggles.solar && SOLAR_TYPES.has(event.type)) || (toggles.geomagnetic && GEO_TYPES.has(event.type)) || event.type === "local-anomaly"));
  const hoverValues = hover !== null ? {
    raw: series.localRaw.reduce<TimePoint | null>((best, point) => (Math.abs(point.t - hover) < 50 * 60_000 && (!best || Math.abs(point.t - hover) < Math.abs(best.t - hover)) ? point : best), null),
    jung: series.jung.reduce<TimePoint | null>((best, point) => (Math.abs(point.t - hover) < 50 * 60_000 && (!best || Math.abs(point.t - hover) < Math.abs(best.t - hover)) ? point : best), null),
    pressure: series.pressure.reduce<TimePoint | null>((best, point) => (Math.abs(point.t - hover) < 50 * 60_000 && (!best || Math.abs(point.t - hover) < Math.abs(best.t - hover)) ? point : best), null),
  } : null;

  return <div className="cw-timeline" ref={ref} style={{ height }}>
    {size.width > 0 && <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Shared timeline of local detector, pressure, Jungfraujoch and space-weather events"
      onPointerMove={(event) => { const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = event.clientX - rect.left; if (px >= m.left && px <= m.left + plotW) setHover(from + ((px - m.left) / plotW) * (to - from)); else setHover(null); }}
      onPointerLeave={() => setHover(null)}>
      <g className="wf-grid">
        {niceTicks(-pctExtent, pctExtent, 4).map((tick) => <line key={tick} x1={m.left} x2={m.left + plotW} y1={yPct(tick)} y2={yPct(tick)} />)}
        {timeTicks.map((tick) => <line key={tick} x1={x(tick)} x2={x(tick)} y1={m.top} y2={m.top + plotH} />)}
      </g>
      <g className="wf-axis">
        {niceTicks(-pctExtent, pctExtent, 4).map((tick) => <text key={tick} x={m.left - 6} y={yPct(tick) + 3} textAnchor="end">{tick > 0 ? "+" : ""}{tick}%</text>)}
        {toggles.pressure && niceTicks(pMin, pMax, 4).map((tick) => <text key={`p${tick}`} x={m.left + plotW + 6} y={yP(tick) + 3} className="cw-axis-pressure">{tick}</text>)}
        {timeTicks.map((tick) => <text key={tick} x={x(tick)} y={m.top + plotH + 16} textAnchor="middle">{fmtTick(tick)}</text>)}
        <text x={m.left} y={14} className="wf-axis-title">Δ VS ROLLING BASELINE (%)</text>
        {toggles.pressure && <text x={m.left + plotW + m.right - 2} y={14} textAnchor="end" className="wf-axis-title cw-axis-pressure">hPa</text>}
        <text x={m.left + plotW} y={height - 4} textAnchor="end" className="wf-axis-title">TIME ({tz})</text>
      </g>
      <line x1={m.left} x2={m.left + plotW} y1={yPct(0)} y2={yPct(0)} className="wf-baseline" />
      {toggles.geomagnetic && <g className="cw-kp">
        {series.kp.filter((point) => point.t >= from - 3 * 3_600_000 && point.t <= to).map((point) => { const x0 = Math.max(m.left, x(point.t)); const x1 = Math.min(m.left + plotW, x(point.t + 3 * 3_600_000)); if (x1 <= x0) return null; const h = (point.v / 9) * (kpBand - 6); return <rect key={point.t} x={x0 + 0.5} width={Math.max(0.5, x1 - x0 - 1)} y={m.top + plotH - h} height={h} className={point.v >= 5 ? "storm" : ""} />; })}
        <text x={m.left + 4} y={m.top + plotH - kpBand + 10} className="wf-small">Kp</text>
      </g>}
      {toggles.pressure && <path d={line(series.pressure, yP)} className="cw-line-pressure" />}
      {toggles.local && <path d={band(series.localRaw)} className="cw-band-local" />}
      {toggles.local && <path d={line(series.localRaw, yPct)} className={`cw-line-raw ${toggles.corrected && correctionActive ? "dim" : ""}`} />}
      {toggles.corrected && correctionActive && <path d={line(series.localCorrected, yPct)} className="cw-line-corrected" />}
      {toggles.jung && <path d={line(series.jung, yPct)} className="cw-line-jung" />}
      {shownEvents.map((event) => {
        const ex = x(event.timestamp);
        return <g key={event.id} className={`cw-marker sev-${event.severity} ${selectedEventId === event.id ? "selected" : ""} ${event.timestamp > now ? "future" : ""}`} onClick={() => onSelectEvent(event)} role="button" tabIndex={0} aria-label={`${event.title}, ${new Date(event.timestamp).toLocaleString()}`} onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter" || keyEvent.key === " ") { keyEvent.preventDefault(); onSelectEvent(event); } }}>
          <line x1={ex} x2={ex} y1={m.top - 8} y2={m.top + plotH} />
          <rect x={ex - 5} y={m.top - 13} width={10} height={10} />
          <rect x={ex - 14} y={m.top - 22} width={28} height={m.top + plotH + 22} className="cw-marker-hit" />
          <text x={ex} y={m.top - 17} textAnchor="middle">{eventGlyph(event.type)}</text>
        </g>;
      })}
      {to > now && <g className="cw-now"><line x1={x(now)} x2={x(now)} y1={m.top} y2={m.top + plotH} /><text x={x(now) + 4} y={m.top + plotH - 4}>NOW</text></g>}
      {hover !== null && hoverValues && <g className="cw-hover">
        <line x1={x(hover)} x2={x(hover)} y1={m.top} y2={m.top + plotH} />
        <text x={Math.min(x(hover) + 8, width - 150)} y={m.top + 14}>{new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(hover)}</text>
        {hoverValues.raw && toggles.local && <text x={Math.min(x(hover) + 8, width - 150)} y={m.top + 28}>LOCAL {hoverValues.raw.v > 0 ? "+" : ""}{hoverValues.raw.v.toFixed(1)}%</text>}
        {hoverValues.jung && toggles.jung && <text x={Math.min(x(hover) + 8, width - 150)} y={m.top + 42}>JUNG {hoverValues.jung.v > 0 ? "+" : ""}{hoverValues.jung.v.toFixed(2)}%</text>}
        {hoverValues.pressure && toggles.pressure && <text x={Math.min(x(hover) + 8, width - 150)} y={m.top + 56}>{hoverValues.pressure.v.toFixed(1)} hPa</text>}
      </g>}
    </svg>}
  </div>;
}
