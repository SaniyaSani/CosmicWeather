"use client";

import { useEffect, useMemo, useState } from "react";
import { SHAPE_DESCRIPTIONS, SHAPE_ORDER, amplitudeUnit, areaUnit, eventCode, formatDuration, formatNumber, toDisplayAmplitude, type PulseAnalysis, type ShapeClass } from "@/lib/signal/analysis";
import { accidentalRateHz, findCoincidences, type CoincidenceCluster, type StationEvents } from "@/lib/signal/coincidence";
import { samplePeriodOf, type PulseRecord } from "@/lib/signal/types";
import type { SignalPrefs } from "./instrument";
import { PanelHeading, Prov, formatTime } from "./primitives";
import { SignalThumbnail, WaveformPlot, analyzeRecord } from "./waveform";

export type AnalyzedPulse = { pulse: PulseRecord; analysis: PulseAnalysis };

export function useAnalyzed(records: PulseRecord[], prefs: SignalPrefs): AnalyzedPulse[] {
  return useMemo(() => records.map((pulse) => ({ pulse, analysis: analyzeRecord(pulse, prefs.polarity, prefs.windows[String(pulse.id)]) })), [records, prefs.polarity, prefs.windows]);
}

// --- Recent signals ----------------------------------------------------------------

export function RecentSignals({ records, prefs, onViewAll, selectedId }: { records: PulseRecord[]; prefs: SignalPrefs; onViewAll: () => void; selectedId?: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(timer); }, []);
  // A brand-new event is shown in the Live Signal first and joins this strip after ~1 s.
  const shown = records.filter((pulse) => now - pulse.at > 1_000).slice(0, 8);
  return <section className="iw-panel iw-recent" aria-labelledby="recent-title">
    <PanelHeading title={<span id="recent-title">RECENT SIGNALS</span>} meta={<button type="button" className="iw-text-link" onClick={onViewAll}>VIEW ALL <span aria-hidden="true">→</span></button>} />
    {shown.length ? <div className="iw-thumb-row">
      {shown.map((pulse, index) => <SignalThumbnail key={pulse.id} pulse={pulse} polarity={prefs.polarity} calibration={prefs.calibration} active={selectedId === pulse.id} fresh={index === 0 && now - pulse.at < 2_600} onSelect={() => prefs.openEvent(pulse.id)} />)}
    </div> : <p className="iw-empty">NO SIGNALS YET. EACH CAPTURED WAVEFORM APPEARS HERE.</p>}
    <span className="iw-plus" aria-hidden="true">+</span>
  </section>;
}

// --- Top signals --------------------------------------------------------------------

type SortKey = "area" | "peak" | "snr" | "width" | "time";

export function TopSignalsTable({ items, prefs, title = "TOP SIGNALS", subtitle = "TODAY", limit = 5 }: { items: AnalyzedPulse[]; prefs: SignalPrefs; title?: string; subtitle?: string; limit?: number }) {
  const [sort, setSort] = useState<SortKey>("area");
  const [preview, setPreview] = useState<{ item: AnalyzedPulse; x: number; y: number } | null>(null);
  const sorted = useMemo(() => {
    const key = (item: AnalyzedPulse) => sort === "area" ? item.analysis.area : sort === "peak" ? item.analysis.peak : sort === "snr" ? item.analysis.snr : sort === "width" ? item.analysis.fwhmUs : item.pulse.at;
    return [...items].sort((a, b) => key(b) - key(a)).slice(0, limit);
  }, [items, sort, limit]);
  const unit = amplitudeUnit(prefs.calibration);
  return <section className="iw-panel iw-top" aria-labelledby="top-title">
    <PanelHeading title={<span id="top-title">{title}</span>} meta={<span>{subtitle}</span>} />
    <div className="iw-seg iw-sort" role="group" aria-label="Sort signals by">
      {(["area", "peak", "snr", "width", "time"] as SortKey[]).map((key) => <button type="button" key={key} className={sort === key ? "on" : ""} onClick={() => setSort(key)} aria-pressed={sort === key}>{key.toUpperCase()}</button>)}
    </div>
    <div className="iw-table-scroll">
      <table className="iw-table">
        <thead><tr><th>#</th><th>EVENT</th><th>PEAK ({unit})</th><th>AREA ({areaUnit(prefs.calibration)})</th><th>SNR</th><th>FWHM</th><th>SHAPE</th><th>TIME</th></tr></thead>
        <tbody>
          {sorted.length ? sorted.map((item, index) => <tr key={item.pulse.id} tabIndex={0} onClick={() => prefs.openEvent(item.pulse.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); prefs.openEvent(item.pulse.id); } }}
            onMouseEnter={(event) => setPreview({ item, x: event.clientX, y: event.clientY })} onMouseMove={(event) => setPreview({ item, x: event.clientX, y: event.clientY })} onMouseLeave={() => setPreview(null)}>
            <td>{String(index + 1).padStart(2, "0")}</td>
            <td>{eventCode(item.pulse.id).replace("#IW-", "#")}{item.pulse.source === "demo" ? <small> DEMO</small> : null}</td>
            <td>{formatNumber(toDisplayAmplitude(item.analysis.peak, prefs.calibration))}</td>
            <td>{formatNumber(toDisplayAmplitude(item.analysis.area, prefs.calibration))}</td>
            <td>{item.analysis.snr.toFixed(1)}</td>
            <td>{formatDuration(item.analysis.fwhmUs)}</td>
            <td>{item.analysis.primaryShape}</td>
            <td>{formatTime(item.pulse.at)}</td>
          </tr>) : <tr><td colSpan={8} className="iw-empty">NO ACCEPTED SIGNALS TODAY.</td></tr>}
        </tbody>
      </table>
    </div>
    {preview && <div className="iw-row-preview" style={{ left: preview.x + 18, top: preview.y - 70 }} aria-hidden="true"><SignalThumbnail pulse={preview.item.pulse} polarity={prefs.polarity} calibration={prefs.calibration} showMeta={false} /></div>}
    <span className="iw-plus" aria-hidden="true">+</span>
  </section>;
}

// --- Gallery + taxonomy ----------------------------------------------------------------

type GalleryFilter = "ALL" | "HIGH AREA" | "HIGH SNR" | "DOUBLE" | "NOISY" | "COINCIDENCE" | ShapeClass;

export function SignalGallery({ items, prefs, coincidentIds, timeFilter, onClearTimeFilter }: { items: AnalyzedPulse[]; prefs: SignalPrefs; coincidentIds: Set<number>; timeFilter: { from: number; to: number } | null; onClearTimeFilter: () => void }) {
  const [filter, setFilter] = useState<GalleryFilter>("ALL");
  const [limit, setLimit] = useState(24);
  const timed = timeFilter ? items.filter((item) => item.pulse.at >= timeFilter.from && item.pulse.at <= timeFilter.to) : items;
  const areaCut = useMemo(() => { const areas = timed.map((item) => item.analysis.area).sort((a, b) => b - a); return areas[Math.max(0, Math.floor(areas.length * 0.2) - 1)] ?? Infinity; }, [timed]);
  const counts = useMemo(() => Object.fromEntries(SHAPE_ORDER.map((shape) => [shape, timed.filter((item) => item.analysis.shapes.includes(shape)).length])) as Record<ShapeClass, number>, [timed]);
  const visible = timed.filter((item) => {
    if (filter === "ALL") return true;
    if (filter === "HIGH AREA") return item.analysis.area >= areaCut;
    if (filter === "HIGH SNR") return item.analysis.snr >= 15;
    if (filter === "COINCIDENCE") return coincidentIds.has(item.pulse.id);
    return item.analysis.shapes.includes(filter as ShapeClass);
  });
  return <section className="iw-gallery" aria-labelledby="gallery-title">
    <PanelHeading title={<span id="gallery-title">SIGNAL ARCHIVE</span>} meta={<span>{visible.length} / {timed.length} WAVEFORMS · ACCEPTED AND REJECTED</span>} />
    {timeFilter && <div className="iw-filter-chip"><span>TIME WINDOW {formatTime(timeFilter.from, false)} – {formatTime(timeFilter.to, false)} · FROM COSMIC WEATHER</span><button type="button" onClick={onClearTimeFilter}>CLEAR ×</button></div>}
    <div className="iw-seg iw-gallery-filters" role="group" aria-label="Filter signals">
      {(["ALL", "HIGH AREA", "HIGH SNR", "DOUBLE", "NOISY", "COINCIDENCE"] as GalleryFilter[]).map((key) => <button type="button" key={key} className={filter === key ? "on" : ""} onClick={() => setFilter(key)} aria-pressed={filter === key}>{key}</button>)}
    </div>
    <div className="iw-taxonomy" aria-label="Signal shape taxonomy">
      {SHAPE_ORDER.map((shape) => <button type="button" key={shape} className={filter === shape ? "on" : ""} onClick={() => setFilter(filter === shape ? "ALL" : shape)} title={SHAPE_DESCRIPTIONS[shape]}>
        <ShapeGlyph shape={shape} /><b>{shape}</b><span>{counts[shape]}</span>
      </button>)}
      <p>SHAPE CLASSES DESCRIBE WAVEFORM MORPHOLOGY ONLY — THEY DO NOT IDENTIFY THE PARTICLE.</p>
    </div>
    {visible.length ? <div className="iw-gallery-grid">
      {visible.slice(0, limit).map((item) => <SignalThumbnail key={item.pulse.id} pulse={item.pulse} polarity={prefs.polarity} calibration={prefs.calibration} onSelect={() => prefs.openEvent(item.pulse.id)} />)}
    </div> : <p className="iw-empty">{filter === "COINCIDENCE" ? "NO COINCIDENCE CANDIDATES. THEY NEED AT LEAST TWO SHARING DETECTORS." : "NO WAVEFORMS MATCH THIS FILTER YET."}</p>}
    {visible.length > limit && <button type="button" className="iw-text-link iw-more" onClick={() => setLimit((value) => value + 24)}>SHOW MORE <span aria-hidden="true">↓</span></button>}
  </section>;
}

function ShapeGlyph({ shape }: { shape: ShapeClass }) {
  const paths: Record<ShapeClass, string> = {
    SHARP: "M0 20 L14 20 L17 3 L20 20 L40 20",
    REGULAR: "M0 20 L12 20 L17 5 L24 20 L40 20",
    BROAD: "M0 20 L6 20 C12 4 26 4 34 20 L40 20",
    DOUBLE: "M0 20 L8 20 L11 5 L15 17 L19 7 L23 20 L40 20",
    ASYMMETRIC: "M0 20 L10 20 L12 4 C18 10 26 18 40 20",
    SATURATED: "M0 20 L10 20 L12 4 L24 4 L26 20 L40 20",
    NOISY: "M0 18 L4 22 L8 15 L12 21 L15 6 L18 22 L23 14 L27 21 L31 16 L35 22 L40 18",
  };
  return <svg viewBox="0 0 40 24" aria-hidden="true"><line x1="0" y1="20" x2="40" y2="20" className="g-base" /><path d={paths[shape]} /></svg>;
}

// --- Event inspector -----------------------------------------------------------------------

export function EventInspector({ item, prefs, onClose, onPrev, onNext, coincidence, detectorLabel, spaceContext = [] }: { item: AnalyzedPulse; prefs: SignalPrefs; onClose: () => void; onPrev?: () => void; onNext?: () => void; coincidence: CoincidenceCluster | null; detectorLabel: string; spaceContext?: string[] }) {
  const { pulse, analysis } = item;
  const [zoomed, setZoomed] = useState(true);
  const unit = amplitudeUnit(prefs.calibration); const aUnit = areaUnit(prefs.calibration);
  const conv = (fs: number) => formatNumber(toDisplayAmplitude(fs, prefs.calibration));
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); if (event.key === "ArrowLeft" && onPrev) onPrev(); if (event.key === "ArrowRight" && onNext) onNext(); };
    window.addEventListener("keydown", key);
    document.body.classList.add("iw-lock");
    return () => { window.removeEventListener("keydown", key); document.body.classList.remove("iw-lock"); };
  }, [onClose, onPrev, onNext]);
  const rows: [string, string, Parameters<typeof Prov>[0]["kind"]][] = [
    ["TIMESTAMP", `${new Date(pulse.at).toISOString().replace("T", " ").slice(0, 23)} UTC`, "MEASURED"],
    ["LOCAL TIME", new Date(pulse.at).toLocaleString("en-GB"), "MEASURED"],
    ["PEAK", `${conv(analysis.peak)} ${unit}`, "MEASURED"],
    ["BASELINE", `${conv(analysis.baseline)} ${unit}`, "MEASURED"],
    ["NOISE σ", pulse.noise ? `${conv(pulse.noise)} ${unit}` : "—", "MEASURED"],
    ["WIDTH (FWHM)", formatDuration(analysis.fwhmUs), "DERIVED"],
    ["RISE / FALL", `${formatDuration(analysis.riseUs)} / ${formatDuration(analysis.fallUs)}`, "DERIVED"],
    ["PULSE AREA", `${conv(analysis.area)} ${aUnit}`, "DERIVED"],
    ["SNR", analysis.snr.toFixed(1), "DERIVED"],
    ["THRESHOLD", pulse.threshold ? `${conv(pulse.threshold)} ${unit}` : "—", "SETTING"],
    ["INTEGRATION", `${formatNumber(analysis.startIndex * analysis.samplePeriodUs, 3)} – ${formatNumber(analysis.endIndex * analysis.samplePeriodUs, 3)} µs`, "SETTING"],
    ["SHAPE", analysis.shapes.join(" · "), "DERIVED"],
    ["DECISION", pulse.accepted ? "PARTICLE CANDIDATE" : pulse.reason.toUpperCase(), "DERIVED"],
    ["DETECTOR", pulse.source === "demo" ? "DEMO STREAM · SIMULATED" : `${pulse.inputLabel ?? detectorLabel} · ${String(pulse.mode ?? "").toUpperCase()}`, "MEASURED"],
    ["COINCIDENCE", coincidence ? `${coincidence.stations.length} STATIONS · Δt ${coincidence.spanMs} ms · CANDIDATE` : "NONE FOUND", coincidence ? "INFERENCE" : "DERIVED"],
    ["SPACE WEATHER", spaceContext.length ? `TEMPORAL OVERLAP · ${spaceContext.join(" · ")}` : "NO EVENT IN WINDOW", "INFERENCE"],
    ["PARTICLE ENERGY", "UNAVAILABLE — NEEDS ENERGY CALIBRATION", "UNAVAILABLE"],
    ["PARTICLE IDENTITY", "CANDIDATE ONLY — NOT IDENTIFIABLE FROM ONE PULSE", "INFERENCE"],
  ];
  return <div className="iw-inspector" role="dialog" aria-modal="true" aria-labelledby="inspector-title">
    <div className="iw-inspector-backdrop" onClick={onClose} />
    <article className="iw-inspector-panel">
      <header>
        <div><span className="iw-kicker">EVENT INSPECTOR · {pulse.source === "demo" ? "DEMO" : "RECORDED"}</span><h2 id="inspector-title">EVENT {eventCode(pulse.id)}</h2></div>
        <nav aria-label="Event navigation">
          <button type="button" onClick={onPrev} disabled={!onPrev} aria-label="Previous event">←</button>
          <button type="button" onClick={onNext} disabled={!onNext} aria-label="Next event">→</button>
          <button type="button" onClick={onClose} aria-label="Close inspector">×</button>
        </nav>
      </header>
      <div className="iw-inspector-body">
        <div className="iw-inspector-plot">
          <WaveformPlot samples={pulse.samples} samplePeriodUs={samplePeriodOf(pulse)} analysis={analysis} calibration={prefs.calibration} threshold={pulse.threshold ?? null} orientation={analysis.orientation} editable showFwhm zoom={zoomed} onWindowChange={(next) => prefs.setWindow(pulse.id, next)} eventLabel={eventCode(pulse.id)} flashKey={`${pulse.id}-${zoomed}`} height={380} ariaLabel={`Detailed waveform of event ${eventCode(pulse.id)}`} />
          <div className="iw-seg iw-zoom" role="group" aria-label="Time axis"><button type="button" className={zoomed ? "on" : ""} onClick={() => setZoomed(true)}>PULSE</button><button type="button" className={!zoomed ? "on" : ""} onClick={() => setZoomed(false)}>FULL WINDOW</button></div>
          <p className="iw-plot-note">DRAG OR USE ← → ON THE t₀ / t₁ HANDLES. THE PULSE AREA UPDATES LIVE. <button type="button" className="iw-text-link muted" onClick={() => prefs.setWindow(pulse.id, null)}>RESET TO AUTO WINDOW</button></p>
        </div>
        <dl className="iw-inspector-metrics">
          {rows.map(([label, value, kind]) => <div key={label}><dt>{label} <Prov kind={kind} /></dt><dd>{value}</dd></div>)}
        </dl>
      </div>
      <footer><span><Prov kind="MEASURED" /> MEASURED</span><span><Prov kind="DERIVED" /> DERIVED FROM WAVEFORM</span><span><Prov kind="SETTING" /> SETTING</span><span><Prov kind="INFERENCE" /> INFERENCE / CANDIDATE</span></footer>
    </article>
  </div>;
}

// --- Coincidence viewer ----------------------------------------------------------------------

export function CoincidenceViewer({ stations, now }: { stations: StationEvents[]; now: number }) {
  const [windowMs, setWindowMs] = useState(500);
  const span = 60_000;
  const from = now - span;
  const visible = stations.map((station) => ({ ...station, times: station.times.filter((time) => time >= from && time <= now) }));
  const clusters = findCoincidences(visible, windowMs);
  const longClusters = findCoincidences(stations, windowMs);
  const longSpan = Math.max(1, Math.max(...stations.flatMap((station) => station.times), now) - Math.min(...stations.flatMap((station) => station.times), now));
  const rates = stations.map((station) => station.times.length / Math.max(60, longSpan / 1000));
  const accidentalPerHour = accidentalRateHz(rates.filter((rate) => rate > 0).slice(0, 2), windowMs / 1000) * 3600;
  const x = (time: number) => ((time - from) / span) * 100;
  const best = longClusters.at(-1);
  return <section className="iw-panel iw-coincidence" aria-labelledby="coincidence-title">
    <PanelHeading title={<span id="coincidence-title">COINCIDENCE VIEW</span>} meta={<div className="iw-seg" role="group" aria-label="Coincidence window">{[100, 500, 2000].map((value) => <button type="button" key={value} className={windowMs === value ? "on" : ""} onClick={() => setWindowMs(value)}>Δt {value < 1000 ? `${value} ms` : `${value / 1000} s`}</button>)}</div>} />
    <div className="iw-coin-rows">
      {visible.length ? visible.map((station, index) => <div className="iw-coin-row" key={station.stationId}>
        <span className="iw-coin-name">DET {index + 1}<small>{station.local ? "THIS DETECTOR" : station.name}</small></span>
        <div className="iw-coin-track">
          <i className="iw-coin-axis" />
          {clusters.map((cluster) => <b key={cluster.at} className="iw-coin-band" style={{ left: `${x(cluster.at)}%`, width: `${Math.max(0.4, (windowMs / span) * 100)}%` }} />)}
          {station.times.map((time) => <span key={time} className="iw-coin-tick" style={{ left: `${x(time)}%` }} />)}
        </div>
      </div>) : <p className="iw-empty">NO DETECTORS ARE SHARING EVENTS RIGHT NOW.</p>}
      <div className="iw-coin-scale"><span>−60 s</span><span>−30 s</span><span>NOW</span></div>
    </div>
    <div className="iw-coin-summary">
      <p><b>{best ? `Δt = ${best.spanMs} ms · ${best.stations.length} / ${stations.length} DETECTORS` : `${stations.length} DETECTOR${stations.length === 1 ? "" : "S"} · NO COINCIDENCE`}</b>{best ? <span>COINCIDENCE CANDIDATE · {formatTime(best.at)}</span> : null}</p>
      <p>EXPECTED ACCIDENTAL COINCIDENCES ≈ {stations.length > 1 ? `${accidentalPerHour < 0.1 ? accidentalPerHour.toExponential(1) : accidentalPerHour.toFixed(1)} / HOUR` : "— (NEEDS ≥ 2 DETECTORS)"}</p>
      <p className="iw-note">Browser clocks are only synchronised to roughly 10–100 ms, so physics-grade windows (~100 ns) need GPS-disciplined timestamps. A coincidence here is a candidate for a shared air shower, not a confirmed muon.</p>
    </div>
    <span className="iw-plus" aria-hidden="true">+</span>
  </section>;
}
