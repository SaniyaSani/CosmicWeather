"use client";

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { analyzePulse, amplitudeUnit, areaUnit, eventCode, formatDuration, formatNumber, toDisplayAmplitude, type InputCalibration, type PulseAnalysis } from "@/lib/signal/analysis";
import { samplePeriodOf, type PulseRecord } from "@/lib/signal/types";
import { niceTicks, useSize } from "./primitives";

export function analyzeRecord(pulse: PulseRecord, polarity: "positive" | "negative" | "either", window?: [number, number]) {
  return analyzePulse(pulse.samples.length ? pulse.samples : [0, 0, 0, 0], {
    polarity: pulse.source === "demo" ? "negative" : polarity,
    noiseSigma: pulse.noise ?? (pulse.snr ? pulse.peak / pulse.snr : undefined),
    samplePeriodUs: samplePeriodOf(pulse),
    clipped: pulse.clipped || pulse.reason === "raw input clipped",
    window,
  });
}

type PlotProps = {
  samples: number[];
  samplePeriodUs: number;
  analysis?: PulseAnalysis | null;
  calibration: InputCalibration;
  /** Trigger threshold (FS, relative to calibrated baseline). */
  threshold?: number | null;
  orientation?: 1 | -1;
  height?: number;
  showArea?: boolean;
  showFwhm?: boolean;
  callouts?: boolean;
  editable?: boolean;
  onWindowChange?: (window: [number, number]) => void;
  flashKey?: string | number | null;
  eventLabel?: string | null;
  live?: boolean;
  /** Zoom the time axis onto the pulse (integration window plus margin). */
  zoom?: boolean;
  ariaLabel: string;
};

/**
 * Oscilloscope-style waveform with axes, baseline, threshold, integration
 * area and optional draggable t_start / t_end handles. Rendered in SVG at the
 * container's real pixel size so lines and labels stay crisp.
 */
export function WaveformPlot({ samples, samplePeriodUs, analysis, calibration, threshold, orientation = -1, height = 300, showArea = true, showFwhm = false, callouts = true, editable = false, onWindowChange, flashKey, eventLabel, live = false, zoom = false, ariaLabel }: PlotProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<"start" | "end" | null>(null);
  const width = Math.max(1, size.width);
  const compact = width < 520;
  const margin = { left: compact ? 40 : 52, right: 14, top: 18, bottom: 34 };
  const plotW = Math.max(10, width - margin.left - margin.right);
  const plotH = Math.max(10, height - margin.top - margin.bottom);
  const toUnits = (fs: number) => toDisplayAmplitude(fs, calibration);
  const baseline = analysis?.baseline ?? 0;

  const n = Math.max(2, samples.length);
  const start = analysis?.startIndex ?? 0; const end = analysis?.endIndex ?? 0;
  const [v0, v1] = useMemo(() => {
    if (!zoom || !analysis) return [0, n - 1];
    const pad = Math.max(8, Math.round((end - start) * 0.9));
    let a = Math.max(0, Math.min(start, Math.floor(analysis.fwhmStart)) - pad);
    let b = Math.min(n - 1, Math.max(end, Math.ceil(analysis.fwhmEnd)) + pad * 2);
    if (b - a < 32) { const grow = Math.ceil((32 - (b - a)) / 2); a = Math.max(0, a - grow); b = Math.min(n - 1, b + grow); }
    return [a, b];
  // Zoom is fixed per event so the view does not jump while a handle is dragged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, n, analysis?.peakIndex, flashKey]);
  const range = useMemo(() => {
    const visible = samples.slice(v0, v1 + 1);
    const values = visible.length ? visible.map((value) => toUnits(value - baseline)) : [0];
    const thresholdUnits = threshold ? Math.abs(toUnits(threshold)) : 0;
    const extent = Math.max(Math.abs(Math.min(...values)), Math.abs(Math.max(...values)), thresholdUnits * 1.2, calibration.mvPerFs ? 0.05 : 0.5) * 1.15;
    return { min: -extent, max: extent };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, baseline, threshold, calibration.mvPerFs, v0, v1]);

  const x = (index: number) => margin.left + ((index - v0) / Math.max(1, v1 - v0)) * plotW;
  const y = (units: number) => margin.top + (1 - (units - range.min) / (range.max - range.min)) * plotH;
  const ys = (fs: number) => y(toUnits(fs - baseline));
  const spanUs = (v1 - v0) * samplePeriodUs;
  const timeUnitMs = spanUs >= 2000;
  const tScale = timeUnitMs ? 1000 : 1;
  const xTicks = niceTicks((v0 * samplePeriodUs) / tScale, (v1 * samplePeriodUs) / tScale, compact ? 4 : 6);
  const yTicks = niceTicks(range.min, range.max, compact ? 4 : 5);
  const path = samples.slice(v0, v1 + 1).map((value, offset) => `${offset ? "L" : "M"}${x(v0 + offset).toFixed(1)} ${ys(value).toFixed(1)}`).join(" ");
  const areaPath = analysis && showArea && end > start
    ? `M${x(start)} ${y(0)} ` + samples.slice(start, end + 1).map((value, offset) => `L${x(start + offset).toFixed(1)} ${ys(value).toFixed(1)}`).join(" ") + ` L${x(end)} ${y(0)} Z`
    : null;

  const indexFromClient = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.round(Math.max(v0, Math.min(v1, v0 + ((clientX - rect.left - margin.left) / plotW) * (v1 - v0))));
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    if (!drag || !analysis || !onWindowChange) return;
    const index = indexFromClient(event.clientX);
    if (drag === "start") onWindowChange([Math.min(index, end - 1), end]);
    else onWindowChange([start, Math.max(index, start + 1)]);
  };
  const handle = (which: "start" | "end", index: number) => <g className={`wf-handle ${drag === which ? "dragging" : ""}`}
    onPointerDown={(event) => { if (!editable) return; (event.target as Element).setPointerCapture?.(event.pointerId); setDrag(which); }}
    role={editable ? "slider" : undefined} aria-label={which === "start" ? "Integration start" : "Integration end"} aria-valuenow={index} aria-valuemin={0} aria-valuemax={n - 1} tabIndex={editable ? 0 : -1}
    onKeyDown={(event) => {
      if (!editable || !onWindowChange) return;
      const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (!delta) return;
      event.preventDefault();
      if (which === "start") onWindowChange([Math.max(0, Math.min(start + delta, end - 1)), end]);
      else onWindowChange([start, Math.min(n - 1, Math.max(end + delta, start + 1))]);
    }}>
    <line x1={x(index)} x2={x(index)} y1={margin.top} y2={margin.top + plotH} className="wf-handle-line" />
    <rect x={x(index) - 5} y={y(0) - 5} width={10} height={10} className="wf-handle-square" />
    {editable && <rect x={x(index) - 12} y={margin.top} width={24} height={plotH} className="wf-handle-hit" />}
    <text x={x(index)} y={margin.top - 5} textAnchor="middle" className="wf-handle-text">{which === "start" ? "t₀" : "t₁"}</text>
  </g>;

  const peakX = analysis ? x(analysis.peakIndex) : 0;
  const peakY = analysis ? ys(samples[analysis.peakIndex] ?? 0) : 0;
  const areaLabel = analysis ? `A = ${formatNumber(toUnits(analysis.area))} ${areaUnit(calibration)}` : "";
  // Labels sit beside the pulse, in the half of the plot the trace does not occupy.
  const peakLabelLeft = peakX - 270 > margin.left;
  const labelY = Math.min(margin.top + plotH - 22, Math.max(margin.top + 18, peakY));
  const labelX = peakX + (peakLabelLeft ? -78 : 78);
  const calloutX = analysis ? Math.min(width - 160, Math.max(margin.left + 8, x(end) + 34)) : 0;
  const calloutY = analysis ? Math.min(margin.top + plotH - 22, Math.max(margin.top + 22, y(0) + (peakY - y(0)) * 0.55)) : 0;

  return <div className={`wf ${live ? "is-live" : ""}`} ref={ref} style={{ height }}>
    {size.width > 0 && <svg ref={svgRef} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}
      onPointerMove={onPointerMove} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
      <g className="wf-grid">
        {yTicks.map((tick) => <line key={`y${tick}`} x1={margin.left} x2={margin.left + plotW} y1={y(tick)} y2={y(tick)} />)}
        {xTicks.map((tick) => { const index = (tick * tScale) / samplePeriodUs; return <line key={`x${tick}`} x1={x(index)} x2={x(index)} y1={margin.top} y2={margin.top + plotH} />; })}
      </g>
      <g className="wf-axis">
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + plotH} />
        <line x1={margin.left} x2={margin.left + plotW} y1={margin.top + plotH} y2={margin.top + plotH} />
        {yTicks.map((tick) => <text key={`yt${tick}`} x={margin.left - 7} y={y(tick) + 3} textAnchor="end">{formatNumber(tick, 2)}</text>)}
        {xTicks.map((tick) => { const index = (tick * tScale) / samplePeriodUs; return <text key={`xt${tick}`} x={x(index)} y={margin.top + plotH + 16} textAnchor="middle">{formatNumber(tick, 3)}</text>; })}
        <text x={margin.left} y={11} className="wf-axis-title">AMPLITUDE ({amplitudeUnit(calibration)})</text>
        <text x={margin.left + plotW} y={height - 3} textAnchor="end" className="wf-axis-title">TIME ({timeUnitMs ? "ms" : "µs"})</text>
      </g>
      <line x1={margin.left} x2={margin.left + plotW} y1={y(0)} y2={y(0)} className="wf-baseline" />
      {!compact && <text x={margin.left + plotW - 4} y={y(0) - 5} textAnchor="end" className="wf-small">BASELINE</text>}
      {threshold ? <>
        <line x1={margin.left} x2={margin.left + plotW} y1={y(toUnits(threshold) * orientation)} y2={y(toUnits(threshold) * orientation)} className="wf-threshold" />
        {!compact && <text x={margin.left + 4} y={y(toUnits(threshold) * orientation) + (orientation < 0 ? 12 : -5)} className="wf-small">THRESHOLD</text>}
      </> : null}
      {areaPath && <path d={areaPath} className="wf-area" key={`area-${flashKey ?? ""}`} />}
      {showFwhm && analysis && analysis.fwhmUs > 0 && <g className="wf-fwhm">
        <line x1={x(analysis.fwhmStart)} x2={x(analysis.fwhmEnd)} y1={y(toUnits(analysis.signedPeak / 2))} y2={y(toUnits(analysis.signedPeak / 2))} />
        <line x1={x(analysis.fwhmStart)} x2={x(analysis.fwhmStart)} y1={y(toUnits(analysis.signedPeak / 2)) - 4} y2={y(toUnits(analysis.signedPeak / 2)) + 4} />
        <line x1={x(analysis.fwhmEnd)} x2={x(analysis.fwhmEnd)} y1={y(toUnits(analysis.signedPeak / 2)) - 4} y2={y(toUnits(analysis.signedPeak / 2)) + 4} />
        <text x={x(analysis.fwhmEnd) + 6} y={y(toUnits(analysis.signedPeak / 2)) + 3}>FWHM {formatDuration(analysis.fwhmUs)}</text>
      </g>}
      <path d={path} className="wf-trace" key={`trace-${flashKey ?? ""}`} />
      {analysis && showArea && end > start && <>{handle("start", start)}{handle("end", end)}</>}
      {analysis && analysis.peak > 0 && <g className="wf-peak" key={`peak-${flashKey ?? ""}`}>
        <rect x={peakX - 5} y={peakY - 5} width={10} height={10} className="wf-peak-square" />
        {callouts && <>
          <path d={`M${peakX + (peakLabelLeft ? -6 : 6)} ${peakY} L${peakX + (peakLabelLeft ? -26 : 26)} ${labelY} L${labelX + (peakLabelLeft ? 4 : -4)} ${labelY}`} pathLength={1} className="wf-callout-line" />
          <text x={labelX} y={labelY - 4} textAnchor={peakLabelLeft ? "end" : "start"} className="wf-callout">
            {eventLabel ? <tspan x={labelX} dy="0" className="wf-callout-strong">{eventLabel}</tspan> : null}
            <tspan x={labelX} dy={eventLabel ? "14" : "0"}>PEAK {formatNumber(toUnits(analysis.peak))} {amplitudeUnit(calibration)}</tspan>
          </text>
        </>}
      </g>}
      {analysis && showArea && callouts && end > start && <g className="wf-area-callout">
        <path d={`M${x(analysis.peakIndex)} ${(y(0) + peakY) / 2} L${calloutX - 6} ${calloutY - 4}`} className="wf-callout-line" pathLength={1} />
        <text x={calloutX} y={calloutY} className="wf-callout"><tspan className="wf-callout-strong">INTEGRATION AREA</tspan><tspan x={calloutX} dy="13">{areaLabel}</tspan></text>
      </g>}
    </svg>}
  </div>;
}

/** Mini waveform card used by Recent Signals, the gallery and table previews. */
export function SignalThumbnail({ pulse, polarity, calibration, active = false, onSelect, showMeta = true, fresh = false }: { pulse: PulseRecord; polarity: "positive" | "negative" | "either"; calibration: InputCalibration; active?: boolean; onSelect?: () => void; showMeta?: boolean; fresh?: boolean }) {
  const analysis = useMemo(() => analyzeRecord(pulse, polarity), [pulse, polarity]);
  const w = 120; const h = 56;
  const all = pulse.samples.length ? pulse.samples : [0];
  // Thumbnails zoom onto the pulse so different morphologies stay recognisable.
  const pad = Math.max(10, Math.round((analysis.endIndex - analysis.startIndex) * 0.8));
  const v0 = Math.max(0, analysis.startIndex - pad);
  const v1 = Math.min(all.length - 1, Math.max(analysis.endIndex + pad * 2, v0 + 40));
  const samples = all.slice(v0, v1 + 1);
  const extent = Math.max(...samples.map((value) => Math.abs(value - analysis.baseline)), 1e-6) * 1.15;
  const px = (index: number) => (index / Math.max(1, samples.length - 1)) * w;
  const py = (value: number) => h / 2 - ((value - analysis.baseline) / extent) * (h / 2 - 3);
  const trace = samples.map((value, index) => `${index ? "L" : "M"}${px(index).toFixed(1)} ${py(value).toFixed(1)}`).join(" ");
  const a0 = analysis.startIndex - v0; const a1 = analysis.endIndex - v0;
  const area = a1 > a0 ? `M${px(a0)} ${h / 2} ` + samples.slice(a0, a1 + 1).map((value, offset) => `L${px(a0 + offset).toFixed(1)} ${py(value).toFixed(1)}`).join(" ") + ` L${px(a1)} ${h / 2} Z` : "";
  const content = <>
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} className="th-baseline" />
      {area && <path d={area} className="th-area" />}
      <path d={trace} className="th-trace" />
    </svg>
    {showMeta && <span className="th-meta">
      <span>{new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(pulse.at)}</span>
      <span>A = {formatNumber(toDisplayAmplitude(analysis.area, calibration))}</span>
      <span className="th-id">{eventCode(pulse.id).replace("#IW-", "#")} · {pulse.source === "demo" ? "DEMO" : analysis.primaryShape}</span>
    </span>}
  </>;
  if (!onSelect) return <div className={`iw-thumb ${active ? "active" : ""} ${pulse.accepted ? "" : "rejected"}`}>{content}</div>;
  return <button type="button" className={`iw-thumb ${active ? "active" : ""} ${fresh ? "fresh" : ""} ${pulse.accepted ? "" : "rejected"}`} onClick={onSelect} aria-pressed={active} aria-label={`Open event ${eventCode(pulse.id)}`}>{content}</button>;
}
