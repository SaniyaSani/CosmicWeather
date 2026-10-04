"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BASELINE_OPTIONS, DEFAULT_LOCATION, NMDB_ACKNOWLEDGEMENT, PROVISIONAL_BETA_PCT_PER_HPA, type BaselineId } from "@/lib/cosmic/config";
import { detectorModes, detectorSeries, getDetectorVersion, subscribeDetector } from "@/lib/cosmic/detector-store";
import { compareLocal, compareReference, interpret, pressureContext, referenceEvents, spaceWeatherActive, temporalOverlaps, CORRELATION_WINDOWS_MS } from "@/lib/cosmic/interpretation";
import { fluxToClass, kpLabel, protonLabel, solarActivityLabel } from "@/lib/cosmic/parsers";
import { correctionActive, estimateBeta, loadCorrectionConfig, saveCorrectionConfig, type PressureCorrectionConfig } from "@/lib/cosmic/pressure";
import { interpolate, mean, rollingDeviation } from "@/lib/cosmic/stats";
import type { CosmicEvent, SourceState, TimePoint } from "@/lib/cosmic/types";
import { buildSourceStatuses, useCosmicWeather } from "@/lib/cosmic/use-cosmic-weather";
import { PanelHeading, Prov, StatusDot, Term, WhyNote, formatAgo } from "@/components/iw/primitives";
import { CosmicTimeline, eventGlyph, relevanceText, type TimelineToggles } from "./timeline";

type Props = {
  location: { latitude: number; longitude: number; name: string };
  stationId?: string;
  detector: { connected: boolean; calibrated: boolean; demo: boolean; mode: string; lastPulseAt: number | null; clipping: boolean; acceptedFraction: number | null };
  onInspectSignals: (from: number, to: number) => void;
  onOpenSignal: () => void;
};

const RANGES = [{ id: "24h", label: "24 H", ms: 24 * 3_600_000 }, { id: "3d", label: "3 D", ms: 3 * 86_400_000 }, { id: "7d", label: "7 D", ms: 7 * 86_400_000 }] as const;
const fmtPct = (value: number | null | undefined, digits = 1) => (value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toFixed(digits)}%`);
const fmtClock = (t: number) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(t);
const fmtWhen = (t: number, now: number) => {
  const sameDay = new Date(t).toDateString() === new Date(now).toDateString();
  if (sameDay) return fmtClock(t);
  if (Math.abs(now - t) < 2 * 86_400_000 && t < now && new Date(now - 86_400_000).toDateString() === new Date(t).toDateString()) return `YESTERDAY ${fmtClock(t)}`;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(t).toUpperCase();
};

function Dots({ level, of = 5 }: { level: number; of?: number }) {
  return <span className="cw-dots" aria-label={`${level} of ${of}`}>{Array.from({ length: of }, (_, index) => <i key={index} className={index < level ? "on" : ""} />)}</span>;
}

function Spark({ points, className = "" }: { points: TimePoint[]; className?: string }) {
  if (points.length < 2) return <svg className={`cw-spark ${className}`} viewBox="0 0 100 28" aria-hidden="true"><line x1="0" x2="100" y1="14" y2="14" className="empty" /></svg>;
  const values = points.map((point) => point.v); const min = Math.min(...values); const max = Math.max(...values);
  const t0 = points[0].t; const t1 = points[points.length - 1].t;
  const d = points.map((point, index) => `${index ? "L" : "M"}${(((point.t - t0) / Math.max(1, t1 - t0)) * 100).toFixed(1)} ${(26 - ((point.v - min) / Math.max(1e-9, max - min)) * 24).toFixed(1)}`).join(" ");
  return <svg className={`cw-spark ${className}`} viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d={d} /></svg>;
}

function stateLabel(state: SourceState, dataTime: number | null, now: number) {
  if (state === "live") return "LIVE";
  if (state === "updated") return dataTime ? `UPDATED ${formatAgo(now - dataTime).toUpperCase()}` : "UPDATED";
  if (state === "stale") return dataTime ? `STALE · ${formatAgo(now - dataTime).toUpperCase()}` : "STALE DATA";
  if (state === "offline") return dataTime ? `OFFLINE · LAST ${formatAgo(now - dataTime).toUpperCase()}` : "OFFLINE";
  if (state === "loading") return "CONNECTING…";
  if (state === "not-connected") return "NOT CONNECTED";
  return "TEMPORARILY UNAVAILABLE";
}

export function CosmicWeather({ location, stationId, detector, onInspectSignals, onOpenSignal }: Props) {
  const { feeds, meta, online, now: tick } = useCosmicWeather({ latitude: location.latitude ?? DEFAULT_LOCATION.latitude, longitude: location.longitude ?? DEFAULT_LOCATION.longitude, stationId });
  const detectorVersion = useSyncExternalStore(subscribeDetector, getDetectorVersion, () => 0);
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]["id"]>("3d");
  const [baselineId, setBaselineId] = useState<BaselineId>("24h");
  const [toggles, setToggles] = useState<TimelineToggles>({ local: true, corrected: true, pressure: true, jung: true, solar: true, geomagnetic: true });
  const [selected, setSelected] = useState<CosmicEvent | null>(null);
  const [correction, setCorrection] = useState<PressureCorrectionConfig>(() => loadCorrectionConfig());
  const [logMode, setLogMode] = useState("sky");
  const [fixtureBins, setFixtureBins] = useState(false);
  const now = tick;

  // Development fixtures for the local detector (never in production builds).
  useEffect(() => {
    if (!import.meta.env.DEV || fixtureBins || new URLSearchParams(window.location.search).get("cw-fixtures") !== "1") return;
    void Promise.all([import("@/lib/cosmic/dev-fixtures"), import("@/lib/cosmic/detector-store")]).then(([fixtures, store]) => { store.__replaceDetectorBinsForDev(fixtures.devDetectorBins(Date.now())); setFixtureBins(true); });
  }, [fixtureBins]);

  const updateCorrection = (next: PressureCorrectionConfig) => { setCorrection(next); saveCorrectionConfig(next); };
  const range = RANGES.find((item) => item.id === rangeId) ?? RANGES[1];
  const baselineMs = BASELINE_OPTIONS.find((item) => item.id === baselineId)?.ms ?? 24 * 3_600_000;
  const from = now - range.ms; const to = now + (rangeId === "24h" ? 2 * 3_600_000 : 8 * 3_600_000);

  const env = feeds.environment; const space = feeds.space; const reference = feeds.reference; const donki = feeds.events;
  const pressure: TimePoint[] = useMemo(() => {
    const sensor = env?.sensorSeries ?? [];
    const source = sensor.length >= 3 ? sensor : env?.series ?? [];
    return source.filter((state) => state.pressureHpa !== null).map((state) => ({ t: state.timestamp, v: state.pressureHpa as number }));
  }, [env]);
  const referenceHpa = correction.referencePressure ?? mean(pressure.filter((point) => point.t > now - 7 * 86_400_000).map((point) => point.v));
  const active = correctionActive(correction) && referenceHpa !== null;

  const derived = useMemo(() => {
    void detectorVersion; void fixtureBins;
    const hourly = detectorSeries(logMode, from - baselineMs, now + 1, 60).map((bin) => ({ ...bin, pressureHpa: interpolate(pressure, bin.timestamp + 30 * 60_000) }));
    const tenMin = detectorSeries(logMode, now - baselineMs - 7 * 3_600_000, now + 1, 10);
    const beta = (correction.barometricCoefficient ?? 0) / 100;
    const corrFactor = (p: number | null | undefined) => (active && typeof p === "number" ? Math.exp(-beta * (p - (referenceHpa as number))) : 1);
    const localRaw: (TimePoint & { sigma: number })[] = []; const localCorrected: TimePoint[] = [];
    hourly.forEach((bin) => {
      if (bin.exposureS < 600 || bin.timestamp < from) return;
      const base = hourly.filter((other) => other.timestamp < bin.timestamp && other.timestamp >= bin.timestamp - baselineMs && other.exposureS >= 600);
      const baseCounts = base.reduce((sum, other) => sum + other.count, 0); const baseExposure = base.reduce((sum, other) => sum + other.exposureS, 0);
      if (baseCounts < 20 || !bin.count) return;
      const rate = bin.count / bin.exposureS; const baseRate = baseCounts / baseExposure;
      localRaw.push({ t: bin.timestamp + 30 * 60_000, v: (rate / baseRate - 1) * 100, sigma: Math.sqrt(1 / bin.count + 1 / baseCounts) * 100 });
      if (active) {
        const baseCorr = base.reduce((sum, other) => sum + other.count * corrFactor(other.pressureHpa), 0) / baseExposure;
        localCorrected.push({ t: bin.timestamp + 30 * 60_000, v: ((rate * corrFactor(bin.pressureHpa)) / baseCorr - 1) * 100 });
      }
    });
    const local = compareLocal(tenMin, now, baselineMs, pressure, referenceHpa, correction, detector.connected && detector.calibrated && !detector.demo);
    const stations = reference?.stations ?? [];
    const jungStation = stations.find((station) => station.code === "JUNG");
    const jung = jungStation ? compareReference(jungStation, now, local.windowMs, baselineMs) : null;
    const others = stations.filter((station) => station.code !== "JUNG").map((station) => compareReference(station, now, local.windowMs, baselineMs));
    const kpSeries = space?.kp.series ?? [];
    const last24 = (series: TimePoint[] | undefined) => (series ?? []).filter((point) => point.t > now - 24 * 3_600_000);
    const xrayMax24h = Math.max(0, ...last24(space?.xray.series).map((point) => point.v)) || null;
    const kpEvents: CosmicEvent[] = kpSeries.filter((point) => point.v >= 5 && point.t > now - 7 * 86_400_000).map((point) => ({ id: `kp-${point.t}`, timestamp: point.t, type: "kp", severity: point.v >= 7 ? "strong" : point.v >= 6 ? "moderate" : "minor", source: "NOAA SWPC", title: `Kp reached ${point.v.toFixed(point.v % 1 ? 2 : 0)}`, description: `${kpLabel(point.v)} (3-hour planetary index).`, link: "https://www.swpc.noaa.gov/products/planetary-k-index" }));
    const merged = [...(space?.flares.events ?? []), ...(space?.alerts.events ?? []), ...(donki?.events ?? []), ...kpEvents, ...referenceEvents(stations, now)];
    const seen = new Set<string>();
    const events = merged.filter((event) => {
      const key = event.type === "solar-flare" ? `flare-${event.title}-${Math.round(event.timestamp / 1_800_000)}` : event.id;
      if (seen.has(key)) return false; seen.add(key); return true;
    }).sort((a, b) => b.timestamp - a.timestamp);
    const spaceCtx = { kpNow: kpSeries.at(-1)?.v ?? null, kpMax24h: Math.max(...last24(kpSeries).map((point) => point.v), 0) || (kpSeries.at(-1)?.v ?? null), protons10: space?.protons.series10.at(-1)?.v ?? null, protons100: space?.protons.series100.at(-1)?.v ?? null, xrayMax24h, recentEvents: events.filter((event) => event.timestamp > now - 72 * 3_600_000 && event.timestamp < now + 48 * 3_600_000) };
    const pctx = pressureContext(pressure, now, local.windowMs, baselineMs);
    const interpretation = interpret({ now, local, pressure: pctx, jung, others, space: spaceCtx, correction, signalQuality: { acceptedFraction: detector.acceptedFraction, clipping: detector.clipping } });
    if (interpretation.classification === "LOCAL ANOMALY") events.unshift({ id: `local-${Math.floor(now / 600_000)}`, timestamp: now - local.windowMs / 2, type: "local-anomaly", severity: "info", source: "Local detector", title: `Local detector ${fmtPct(local.pct)}`, description: "Local anomaly candidate from the interpretation engine." });
    const betaEstimate = estimateBeta(hourly.filter((bin) => bin.timestamp > now - 7 * 86_400_000));
    return { localRaw, localCorrected, local, jung, others, events, spaceCtx, pctx, interpretation, betaEstimate, jungStation, kpSeries, xrayMax24h };
  }, [detectorVersion, fixtureBins, logMode, from, now, baselineMs, pressure, correction, active, referenceHpa, reference, space, donki, detector.connected, detector.calibrated, detector.demo, detector.acceptedFraction, detector.clipping]);

  const { local, jung, others, events, spaceCtx, pctx, interpretation, betaEstimate, jungStation } = derived;
  const jungSeriesPct = useMemo(() => rollingDeviation(jungStation?.series ?? [], baselineMs), [jungStation, baselineMs]);
  const othersMean = mean(others.filter((item) => item.ok && item.pct !== null).map((item) => item.pct as number));
  const statuses = buildSourceStatuses(feeds, meta, now, online, {
    state: detector.demo ? "not-connected" : detector.connected ? detector.calibrated ? "live" : "stale" : "not-connected",
    dataTime: detector.lastPulseAt,
    message: detector.demo ? "Demo stream is not recorded" : detector.connected && !detector.calibrated ? "Calibration required" : undefined,
  });
  const statusOf = (id: string) => statuses.find((status) => status.id === id);
  const solar = solarActivityLabel(derived.xrayMax24h);
  const protons = protonLabel(spaceCtx.protons10);
  const currentPressure = env?.current?.pressureHpa ?? pressure.at(-1)?.v ?? null;
  const swActive = spaceWeatherActive(spaceCtx);
  const overlaps = useMemo(() => (interpretation.classification === "NORMAL" || interpretation.classification === "INSUFFICIENT DATA" ? [] : temporalOverlaps(now - local.windowMs / 2, events.filter((event) => event.type !== "local-anomaly"), 1)), [interpretation.classification, now, local.windowMs, events]);
  const hasLocalData = local.countsWindow + local.countsBaseline > 0;
  const modes = detectorModes();

  const layers = [
    { id: "building", kicker: "01 · THE BUILDING", title: "LOCAL DETECTOR", value: local.ratePerMin !== null ? local.ratePerMin.toFixed(2) : "—", unit: "events / min", line: local.sufficient ? `${fmtPct(local.pct)} vs ${baselineId} baseline · ±${local.sigmaPct?.toFixed(1)}%` : local.status, prov: "MEASURED" as const, status: statusOf("detector") },
    { id: "atmosphere", kicker: "02 · THE ATMOSPHERE", title: "SURFACE PRESSURE", value: currentPressure !== null ? currentPressure.toFixed(1) : "—", unit: "hPa", line: pctx.trend3h !== null ? `${pctx.trend3h > 0.2 ? "↑" : pctx.trend3h < -0.2 ? "↓" : "→"} ${Math.abs(pctx.trend3h).toFixed(1)} hPa / 3 h` : "trend —", prov: env?.source === "sensor" ? "MEASURED" as const : "MODEL" as const, status: statusOf("pressure") },
    { id: "flux", kicker: "03 · THE PARTICLE FLUX", title: "JUNGFRAUJOCH", value: jung?.pct !== null && jung?.pct !== undefined ? fmtPct(jung.pct, 2) : "—", unit: "vs baseline", line: `3475 m · NEUTRON MONITOR${othersMean !== null ? ` · EUROPE ${fmtPct(othersMean, 2)}` : ""}`, prov: "MEASURED" as const, status: statusOf("nmdb") },
    { id: "magnetic", kicker: "04 · MAGNETIC ENVIRONMENT", title: "GEOMAGNETIC Kp", value: spaceCtx.kpNow !== null ? spaceCtx.kpNow.toFixed(spaceCtx.kpNow % 1 ? 2 : 0) : "—", unit: kpLabel(spaceCtx.kpNow).toLowerCase(), line: `max 24 h ${spaceCtx.kpMax24h?.toFixed(1) ?? "—"}`, prov: "MEASURED" as const, status: statusOf("noaa-kp") },
    { id: "sun", kicker: "05 · THE SUN", title: "SOLAR ACTIVITY", value: solar.label, unit: `peak 24 h ${fluxToClass(derived.xrayMax24h)}`, line: `PROTONS ≥10 MeV ${protons.label}${spaceCtx.protons10 !== null ? ` · ${spaceCtx.protons10.toFixed(2)} pfu` : ""}`, prov: "MEASURED" as const, status: statusOf("noaa-xray"), dots: solar.level },
  ];

  return <section className="cw" aria-labelledby="cw-title">
    <header className="cw-hero">
      <div>
        <span className="iw-dash" aria-hidden="true" />
        <h1 id="cw-title" className="iw-display cw-display"><span>COSMIC</span><span>WEATHER.</span></h1>
        <p className="iw-subtitle">DATA LAYER</p>
      </div>
      <div className="cw-hero-copy">
        <p className="iw-lede">WE ARE NOT JUST COUNTING PARTICLES.<br />WE OBSERVE SEVERAL INVISIBLE LAYERS<br />OF THE ENVIRONMENT AT ONCE.</p>
        <p className="iw-microcopy">YOUR DETECTOR ↔ ATMOSPHERE ↔ JUNGFRAUJOCH ↔ SUN · {location.name.toUpperCase()} {location.latitude.toFixed(2)}°N {location.longitude.toFixed(2)}°E · TIMES IN {Intl.DateTimeFormat().resolvedOptions().timeZone.toUpperCase()}</p>
      </div>
    </header>

    {/* COSMIC CONDITIONS — the layered chain from building to Sun (summary first on mobile) */}
    <section className="cw-chain" aria-label="Cosmic conditions summary">
      <div className="cw-chain-title"><span className="iw-kicker">COSMIC CONDITIONS</span><span className="iw-kicker">LOCAL → SPACE</span></div>
      <ol>
        {layers.map((layer) => <li key={layer.id} className={`cw-layer state-${layer.status?.state ?? "loading"}`}>
          <span className="cw-anchor" aria-hidden="true" />
          <span className="iw-kicker">{layer.kicker}</span>
          <h3>{layer.title} <Prov kind={layer.prov} /></h3>
          <strong>{layer.value}{"dots" in layer && layer.dots ? <Dots level={layer.dots} /> : null}</strong>
          <small>{layer.unit}</small>
          <p>{layer.line}</p>
          <em><StatusDot state={layer.status?.state === "live" || layer.status?.state === "updated" ? "live" : layer.status?.state === "stale" || layer.status?.state === "offline" ? "warn" : "off"} />{layer.status ? stateLabel(layer.status.state, layer.status.dataTime, now) : "—"}</em>
        </li>)}
      </ol>
      {(correction.correctionCalibrationStatus !== "CALIBRATED" || !correction.pressureCorrectionEnabled) && <p className="cw-correction-flag"><span>■</span>{correctionActive(correction) ? `PRESSURE CORRECTION: PROVISIONAL (β = ${correction.barometricCoefficient?.toFixed(2)} %/hPa)` : "PRESSURE CORRECTION NOT YET CALIBRATED — LOCAL VALUES ARE RAW"}</p>}
    </section>

    {/* WHAT ARE WE SEEING? */}
    <section className="cw-seeing" aria-labelledby="cw-seeing-title">
      <div className="cw-seeing-main">
        <span className="iw-kicker">AUTOMATIC INTERPRETATION · DETERMINISTIC RULES</span>
        <h2 id="cw-seeing-title">WHAT ARE WE SEEING?</h2>
        <div className={`cw-class cls-${interpretation.classification.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
          <b>{interpretation.classification}</b>
          <span>CONFIDENCE <Dots level={interpretation.confidence === "HIGH" ? 3 : interpretation.confidence === "MEDIUM" ? 2 : 1} of={3} /> {interpretation.confidence}</span>
        </div>
        <div className="cw-narrative">{interpretation.narrative.map((line) => <p key={line}>{line}</p>)}</div>
        <p className="cw-explanation"><strong>{interpretation.title}.</strong> {interpretation.explanation}</p>
        {hasLocalData && <button type="button" className="iw-text-link" onClick={() => onInspectSignals(now - local.windowMs, now)}>INSPECT SIGNALS FROM THIS WINDOW <span aria-hidden="true">→</span></button>}
      </div>
      <aside className="cw-seeing-side">
        <h3 className="iw-kicker">REASONS FOR CONFIDENCE</h3>
        <ul>{interpretation.reasons.length ? interpretation.reasons.map((reason) => <li key={reason}>{reason}</li>) : <li>Not enough independent evidence yet.</li>}</ul>
        <h3 className="iw-kicker">CAVEATS</h3>
        <ul className="muted">{interpretation.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
        {overlaps.length > 0 && <><h3 className="iw-kicker">TEMPORAL OVERLAP</h3><ul>{overlaps.slice(0, 4).map(({ event, offsetMs }) => <li key={event.id}>{eventGlyph(event.type)} {event.title} · {offsetMs > 0 ? "+" : "−"}{formatAgo(Math.abs(offsetMs)).replace(" ago", "")} · {event.source}</li>)}</ul><p className="cw-note">Temporal overlap — not “caused by”.</p></>}
      </aside>
    </section>

    {/* SHARED TIMELINE */}
    <section className="cw-timeline-panel" aria-labelledby="cw-timeline-title">
      <PanelHeading title={<span id="cw-timeline-title">ONE SHARED TIMELINE</span>} meta={<>
        <div className="iw-seg" role="group" aria-label="Time range">{RANGES.map((item) => <button type="button" key={item.id} className={rangeId === item.id ? "on" : ""} onClick={() => setRangeId(item.id)}>{item.label}</button>)}</div>
        <div className="iw-seg" role="group" aria-label="Rolling baseline"><span className="iw-seg-label">BASELINE</span>{BASELINE_OPTIONS.map((item) => <button type="button" key={item.id} className={baselineId === item.id ? "on" : ""} onClick={() => setBaselineId(item.id)}>{item.label}</button>)}</div>
      </>} />
      <div className="cw-toggles" role="group" aria-label="Timeline layers">
        {([["local", "LOCAL DETECTOR (RAW)", "raw"], ["corrected", "PRESSURE CORRECTED", "corrected"], ["pressure", "ATMOSPHERIC PRESSURE", "pressure"], ["jung", "JUNGFRAUJOCH", "jung"], ["solar", "SOLAR EVENTS", "solar"], ["geomagnetic", "GEOMAGNETIC EVENTS", "geo"]] as [keyof TimelineToggles, string, string][]).map(([key, label, swatch]) =>
          <label key={key} className={key === "corrected" && !active ? "disabled" : ""}><input type="checkbox" checked={toggles[key]} onChange={() => setToggles((current) => ({ ...current, [key]: !current[key] }))} disabled={key === "corrected" && !active} /><i className={`sw sw-${swatch}`} />{label}{key === "corrected" && !active ? " · NOT CALIBRATED" : ""}</label>)}
      </div>
      <CosmicTimeline series={{ localRaw: derived.localRaw, localCorrected: derived.localCorrected, jung: jungSeriesPct, pressure, kp: derived.kpSeries }} events={events} from={from} to={to} toggles={toggles} correctionActive={active} now={now} onSelectEvent={(event) => setSelected(event)} selectedEventId={selected?.id ?? null} />
      <p className="cw-note">Each series is shown as % difference from its own rolling {baselineId} baseline — raw count rates of different detector types are never compared directly. The pale band is the local ±1σ Poisson uncertainty. {logMode !== "sky" ? `Showing ${logMode.toUpperCase()}-mode log.` : "Local log uses Ambient-sky mode only."}{modes.length > 1 && <> <select className="cw-mode-select" value={logMode} onChange={(event) => setLogMode(event.target.value)} aria-label="Detector log mode">{modes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></>}</p>
      {selected && <div className="cw-event-card" role="dialog" aria-label={selected.title}>
        <button type="button" className="cw-close" onClick={() => setSelected(null)} aria-label="Close event details">×</button>
        <span className="iw-kicker">{eventGlyph(selected.type)} {selected.type.replace(/-/g, " ").toUpperCase()} · {selected.severity.toUpperCase()}</span>
        <h3>{selected.title}</h3>
        <p className="cw-event-time">{new Date(selected.timestamp).toLocaleString("en-GB")} · {new Date(selected.timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC{selected.estimatedArrival ? ` · MODELLED ARRIVAL ${new Date(selected.estimatedArrival).toLocaleString("en-GB")}` : ""}</p>
        <p>{selected.description}</p>
        <p className="cw-relevance"><b>COULD IT RELATE TO OUR DATA?</b> {relevanceText(selected)}</p>
        <div className="cw-event-actions">
          <span>SOURCE: {selected.source}</span>
          {selected.link && <a href={selected.link} target="_blank" rel="noreferrer">ORIGINAL DATA ↗</a>}
          {hasLocalData && <button type="button" className="iw-text-link" onClick={() => { const w = CORRELATION_WINDOWS_MS[selected.type] ?? 3_600_000; onInspectSignals(selected.timestamp - w, selected.timestamp + w); }}>INSPECT SIGNALS ±{Math.round((CORRELATION_WINDOWS_MS[selected.type] ?? 3_600_000) / 60_000)} MIN →</button>}
        </div>
      </div>}
    </section>

    {/* COMPARISON + JUNGFRAUJOCH + EVENTS */}
    <div className="cw-grid">
      <section className="iw-panel cw-compare" aria-labelledby="cw-compare-title">
        <PanelHeading title={<span id="cw-compare-title">LOCAL vs REFERENCE</span>} meta={<span>Δ VS {baselineId.toUpperCase()} BASELINE · LAST {Math.round(local.windowMs / 3_600_000)} H</span>} />
        <div className="cw-compare-cols">
          {[
            { label: "YOUR DETECTOR", place: location.name.toUpperCase(), pct: local.sufficient ? local.pct : null, sigma: local.sufficient ? local.sigmaPct : null, note: local.sufficient ? (local.corrected ? "PRESSURE-CORRECTED" : "RAW · UNCORRECTED") : "COLLECTING BASELINE…" },
            { label: "JUNGFRAUJOCH", place: "3475 M · NEUTRONS", pct: jung?.pct ?? null, sigma: null, note: jung?.ok ? `NMDB · ${jung.lastTime ? formatAgo(now - jung.lastTime).toUpperCase() : ""}` : "UNAVAILABLE" },
            { label: "GLOBAL REFERENCE", place: `${others.filter((item) => item.ok).length} NMDB STATIONS`, pct: othersMean, sigma: null, note: "MEAN, PRESSURE-CORRECTED" },
          ].map((column) => <div key={column.label} className="cw-compare-col">
            <span className="iw-kicker">{column.label}</span>
            <small>{column.place}</small>
            <strong className={column.pct === null ? "muted" : ""}>{fmtPct(column.pct, column.label === "YOUR DETECTOR" ? 1 : 2)}</strong>
            {(() => { const k = 46 / Math.max(5, Math.abs(column.pct ?? 0) + (column.sigma ?? 0)); return <div className="cw-compare-bar" aria-hidden="true"><i style={{ left: "50%", width: `${Math.abs(column.pct ?? 0) * k}%`, transform: (column.pct ?? 0) < 0 ? "translateX(-100%)" : undefined }} />{column.sigma ? <b style={{ left: `${50 + ((column.pct ?? 0) - column.sigma) * k}%`, width: `${column.sigma * 2 * k}%` }} /> : null}</div>; })()}
            <em>{column.sigma ? `±${column.sigma.toFixed(1)}% (1σ) · ` : ""}{column.note}</em>
          </div>)}
        </div>
        <ul className="cw-stations">
          {others.map((item) => { const meta = (reference?.stations ?? []).find((station) => station.code === item.code); return <li key={item.code} className={item.ok ? "" : "off"}><span>{item.name}</span><small>{meta ? `${meta.altitudeM} m · ${meta.cutoffGV} GV` : ""}</small><b>{item.ok ? fmtPct(item.pct, 2) : "UNAVAILABLE"}</b></li>; })}
        </ul>
        <p className="cw-note">Our detector mostly sees secondary muons (or other charged secondaries) near ground level; neutron monitors count secondary neutrons. They respond differently, so only the direction and timing of relative changes are compared — never the absolute rates.</p>
        <span className="iw-plus" aria-hidden="true">+</span>
      </section>

      <section className="iw-panel cw-jung" aria-labelledby="cw-jung-title">
        <PanelHeading title={<span id="cw-jung-title">JUNGFRAUJOCH</span>} meta={<span className="iw-live-state"><StatusDot state={statusOf("nmdb")?.state === "live" ? "live" : statusOf("nmdb")?.state === "stale" ? "warn" : "off"} />{stateLabel(statusOf("nmdb")?.state ?? "loading", statusOf("nmdb")?.dataTime ?? null, now)}</span>} />
        <div className="cw-jung-figure"><strong>{fmtPct(jung?.pct, 2)}</strong><span>CURRENT COUNT RELATIVE TO ROLLING {baselineId.toUpperCase()} BASELINE</span></div>
        <Spark points={(jungStation?.series ?? []).filter((point) => point.t > now - 72 * 3_600_000)} className="jung" />
        <dl className="cw-jung-meta"><div><dt>ALTITUDE</dt><dd>3475 m</dd></div><div><dt>CUTOFF RIGIDITY</dt><dd>≈ 4.5 GV</dd></div><div><dt>LAST VALUE</dt><dd>{jungStation?.series.at(-1) ? `${jungStation.series.at(-1)?.v.toFixed(2)} counts/s` : "—"}</dd></div><div><dt>DATA</dt><dd>hourly · corrected for pressure &amp; efficiency</dd></div></dl>
        <p>Jungfraujoch is an independent high-altitude cosmic-ray monitor. Comparing our local detector with it helps distinguish local detector changes from larger-scale cosmic-ray variations.</p>
        <p className="iw-source">SOURCE: <a href="https://www.nmdb.eu/nest/" target="_blank" rel="noreferrer">NMDB</a> · STATION: JUNGFRAUJOCH (IGY) · PHYSIKALISCHES INSTITUT, UNIVERSITY OF BERN</p>
        <span className="iw-plus" aria-hidden="true">+</span>
      </section>

      <section className="iw-panel cw-feed" aria-labelledby="cw-feed-title">
        <PanelHeading title={<span id="cw-feed-title">RECENT COSMIC EVENTS</span>} meta={<span>{swActive.active ? "ACTIVE CONDITIONS" : "QUIET CONDITIONS"}</span>} />
        <ol className="cw-feed-list">
          <li className="now"><span className="cw-feed-time">NOW</span><span className="cw-feed-glyph">⊕</span><div><b>Kp {spaceCtx.kpNow?.toFixed(spaceCtx.kpNow % 1 ? 2 : 0) ?? "—"}</b><small>{kpLabel(spaceCtx.kpNow)} geomagnetic conditions · NOAA SWPC</small></div></li>
          {events.filter((event) => event.timestamp <= now + 7 * 86_400_000).slice(0, 30).map((event) => <li key={event.id} className={`sev-${event.severity} ${event.timestamp > now ? "future" : ""}`}>
            <span className="cw-feed-time">{event.timestamp > now ? "EXPECTED" : fmtWhen(event.timestamp, now)}</span>
            <span className="cw-feed-glyph" aria-hidden="true">{eventGlyph(event.type)}</span>
            <div><button type="button" onClick={() => setSelected(event)}>{event.title}</button><small>{event.source}{event.estimatedArrival ? ` · modelled Earth arrival ${fmtWhen(event.estimatedArrival, now)}` : ""}{event.timestamp > now ? ` · ${new Date(event.timestamp).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</small></div>
          </li>)}
          {!events.length && <li><span className="cw-feed-time">—</span><span /> <div><small>{statusOf("donki")?.state === "unavailable" && statusOf("noaa-xray")?.state === "unavailable" ? "EVENT SOURCES TEMPORARILY UNAVAILABLE" : "NO NOTABLE EVENTS IN THE LAST 7 DAYS"}</small></div></li>}
        </ol>
        <p className="cw-note">Icons: ☀ solar flare · ◌ CME / shock · ⚡ particle event · ⊕ geomagnetic · ☄ ground cosmic-ray monitors · ■ local detector.</p>
        <span className="iw-plus" aria-hidden="true">+</span>
      </section>
    </div>

    {/* PRESSURE CORRECTION + SOURCES + EDUCATION */}
    <div className="cw-grid cw-grid-2">
      <section className="iw-panel cw-correction" aria-labelledby="cw-correction-title">
        <PanelHeading title={<span id="cw-correction-title">PRESSURE CORRECTION</span>} meta={<span className={`cw-status-badge s-${correction.correctionCalibrationStatus.toLowerCase()}`}>{correction.correctionCalibrationStatus}</span>} />
        <p className="cw-formula">N<sub>corr</sub> = N · exp(−β · (P − P<sub>ref</sub>))</p>
        <div className="cw-form">
          <label><span>ENABLED</span><input type="checkbox" checked={correction.pressureCorrectionEnabled} onChange={(event) => updateCorrection({ ...correction, pressureCorrectionEnabled: event.target.checked })} disabled={correction.barometricCoefficient === null} /></label>
          <label><span>β (%/hPa)</span><input type="number" step="0.01" value={correction.barometricCoefficient ?? ""} placeholder="not set" onChange={(event) => { const value = event.target.value === "" ? null : Number(event.target.value); updateCorrection({ ...correction, barometricCoefficient: value !== null && Number.isFinite(value) ? value : null, correctionCalibrationStatus: value === null ? "UNCALIBRATED" : correction.correctionCalibrationStatus === "UNCALIBRATED" ? "PROVISIONAL" : correction.correctionCalibrationStatus, pressureCorrectionEnabled: value === null ? false : correction.pressureCorrectionEnabled }); }} /></label>
          <label><span>P<sub>ref</sub> (hPa)</span><input type="number" step="0.1" value={correction.referencePressure ?? ""} placeholder={referenceHpa ? `auto ${referenceHpa.toFixed(1)}` : "auto"} onChange={(event) => updateCorrection({ ...correction, referencePressure: event.target.value === "" ? null : Number(event.target.value) })} /></label>
          <label><span>STATUS</span><select value={correction.correctionCalibrationStatus} onChange={(event) => updateCorrection({ ...correction, correctionCalibrationStatus: event.target.value as PressureCorrectionConfig["correctionCalibrationStatus"] })} disabled={correction.barometricCoefficient === null}><option value="UNCALIBRATED">UNCALIBRATED</option><option value="PROVISIONAL">PROVISIONAL</option><option value="CALIBRATED" disabled={!betaEstimate?.usable && correction.calibratedAt == null}>CALIBRATED</option></select></label>
        </div>
        <div className="cw-beta">
          <span className="iw-kicker"><span className="nocase">β</span> ESTIMATED FROM YOUR DETECTOR · LAST 7 DAYS <Prov kind="ESTIMATED" /></span>
          {betaEstimate ? <>
            <strong>{betaEstimate.betaPctPerHpa.toFixed(3)} ± {betaEstimate.stderr.toFixed(3)} %/hPa</strong>
            <small>{betaEstimate.n} hourly bins · {betaEstimate.totalCounts} counts · pressure range {betaEstimate.pressureRangeHpa.toFixed(1)} hPa · r = {betaEstimate.r.toFixed(2)}</small>
            <small className={betaEstimate.usable ? "ok" : ""}>{betaEstimate.reason}</small>
            <button type="button" className="iw-text-link" disabled={!betaEstimate.usable} onClick={() => updateCorrection({ ...correction, barometricCoefficient: Number(betaEstimate.betaPctPerHpa.toFixed(4)), coefficientUncertainty: Number(betaEstimate.stderr.toFixed(4)), correctionCalibrationStatus: "CALIBRATED", pressureCorrectionEnabled: true, calibratedAt: Date.now(), note: `${betaEstimate.n} h, ${betaEstimate.totalCounts} counts` })}>ADOPT AS CALIBRATION →</button>
          </> : <small>Needs at least a few hours of Ambient-sky detector data with pressure.</small>}
        </div>
        <div className="cw-correction-actions">
          <button type="button" className="iw-text-link muted" onClick={() => updateCorrection({ ...correction, barometricCoefficient: PROVISIONAL_BETA_PCT_PER_HPA, correctionCalibrationStatus: "PROVISIONAL", pressureCorrectionEnabled: true, calibratedAt: null, note: "literature-typical value for ground-level muons" })}>USE PROVISIONAL <span className="nocase">β = {PROVISIONAL_BETA_PCT_PER_HPA} %/hPa</span></button>
          <button type="button" className="iw-text-link muted" onClick={() => updateCorrection({ referencePressure: null, barometricCoefficient: null, pressureCorrectionEnabled: false, correctionCalibrationStatus: "UNCALIBRATED", coefficientUncertainty: null, calibratedAt: null })}>RESET</button>
        </div>
        <p className="cw-note">The provisional value is a typical literature coefficient for ground-level muons. It has not been measured for this detector and is always labelled PROVISIONAL. Pressure source: {env?.source === "sensor" ? `local sensor ${env.sensor?.sensorId ?? ""}` : `Open-Meteo surface pressure (model, ${env?.elevationM ?? "—"} m terrain height)`}.</p>
        <span className="iw-plus" aria-hidden="true">+</span>
      </section>

      <section className="iw-panel cw-sources" aria-labelledby="cw-sources-title">
        <PanelHeading title={<span id="cw-sources-title">DATA SOURCES</span>} meta={<span>{online ? "ONLINE" : "OFFLINE · SHOWING LAST KNOWN VALUES"}</span>} />
        <ul>
          {statuses.map((status) => <li key={status.id} className={`state-${status.state}`} title={status.message}>
            <StatusDot state={status.state === "live" || status.state === "updated" ? "live" : status.state === "stale" || status.state === "offline" ? "warn" : "off"} />
            <span>{status.label}</span>
            <b>{stateLabel(status.state, status.dataTime, now)}</b>
            <a href={status.href} target="_blank" rel="noreferrer">{status.attribution} ↗</a>
          </li>)}
        </ul>
        <p className="cw-note">{NMDB_ACKNOWLEDGEMENT} Space-weather data: NOAA Space Weather Prediction Center; event catalogue: NASA CCMC DONKI; weather: Open-Meteo.com (CC BY 4.0).</p>
        <button type="button" className="iw-text-link muted" onClick={onOpenSignal}>OPEN SIGNAL ARCHIVE →</button>
        <span className="iw-plus" aria-hidden="true">+</span>
      </section>
    </div>

    <section className="cw-learn" aria-label="Why does this matter?">
      <WhyNote title="WHY PRESSURE?">Higher atmospheric pressure means more air above the detector. This can slightly change how many secondary cosmic-ray particles reach the ground — typically a fraction of a percent per hPa.</WhyNote>
      <WhyNote title="WHY JUNGFRAUJOCH?">Jungfraujoch hosts a professional cosmic-ray monitor at high altitude. Comparing our detector with it helps us see whether a change is local or widespread.</WhyNote>
      <WhyNote title="WHY WATCH THE SUN?">Solar activity can change the flow of high-energy particles reaching Earth, sometimes producing increases or decreases in ground-level cosmic-ray measurements. A solar flare does not simply mean “more muons”.</WhyNote>
      <p className="cw-terms">TERMS: <Term term="FORBUSH DECREASE">A temporary reduction in galactic cosmic rays following a disturbance in the solar wind, often after a CME passes Earth.</Term> · <Term term="GLE">A rare event in which highly energetic solar particles produce a measurable increase in ground-level cosmic-ray monitors.</Term> · <Term term="Kp">A 0–9 planetary index of geomagnetic disturbance, measured every three hours.</Term> · <Term term="CME">A coronal mass ejection: a cloud of magnetised plasma released by the Sun that can disturb the heliosphere.</Term></p>
    </section>
  </section>;
}
