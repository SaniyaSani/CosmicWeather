"use client";

/**
 * Shared Cosmic Weather snapshot used by both the SKY page (compact view) and
 * the DATA page (full observatory), so both always show identical numbers.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DEFAULT_LOCATION } from "./config";
import { detectorSeries, getDetectorVersion, subscribeDetector } from "./detector-store";
import { compareLocal, compareReference, interpret, pressureContext, referenceEvents } from "./interpretation";
import { kpLabel } from "./parsers";
import { correctionActive, estimateBeta, type PressureCorrectionConfig } from "./pressure";
import { interpolate, mean } from "./stats";
import type { CosmicEvent, TimePoint } from "./types";
import { buildSourceStatuses, useCosmicWeather } from "./use-cosmic-weather";

export type DetectorContext = { connected: boolean; calibrated: boolean; demo: boolean; mode: string; lastPulseAt: number | null; clipping: boolean; acceptedFraction: number | null };

export const fmtPct = (value: number | null | undefined, digits = 1) => (value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toFixed(digits)}%`);

export function useCosmicSnapshot({ location, stationId, detector, rangeMs, baselineMs, correction, logMode, enabled = true }: {
  location: { latitude: number; longitude: number };
  stationId?: string;
  detector: DetectorContext;
  rangeMs: number;
  baselineMs: number;
  correction: PressureCorrectionConfig;
  logMode: string;
  enabled?: boolean;
}) {
  const { feeds, meta, online, now: tick } = useCosmicWeather({ latitude: location.latitude ?? DEFAULT_LOCATION.latitude, longitude: location.longitude ?? DEFAULT_LOCATION.longitude, stationId }, enabled);
  const detectorVersion = useSyncExternalStore(subscribeDetector, getDetectorVersion, () => 0);
  const [fixtureBins, setFixtureBins] = useState(false);
  const now = tick;
  const from = now - rangeMs;

  // Development fixtures for the local detector (never in production builds).
  useEffect(() => {
    if (!import.meta.env.DEV || fixtureBins || new URLSearchParams(window.location.search).get("cw-fixtures") !== "1") return;
    void Promise.all([import("@/lib/cosmic/dev-fixtures"), import("@/lib/cosmic/detector-store")]).then(([fixtures, store]) => { store.__replaceDetectorBinsForDev(fixtures.devDetectorBins(Date.now())); setFixtureBins(true); });
  }, [fixtureBins]);


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

  const statuses = buildSourceStatuses(feeds, meta, now, online, {
    state: detector.demo ? "not-connected" : detector.connected ? detector.calibrated ? "live" : "stale" : "not-connected",
    dataTime: detector.lastPulseAt,
    message: detector.demo ? "Demo stream is not recorded" : detector.connected && !detector.calibrated ? "Calibration required" : undefined,
  });
  const statusOf = (id: string) => statuses.find((status) => status.id === id);
  return { feeds, meta, online, now, from, env, pressure, referenceHpa, active, derived, statuses, statusOf };










}
