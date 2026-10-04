/**
 * detectorService — local time series of accepted detector pulses.
 *
 * Counts are stored per UTC minute together with the live exposure time
 * (seconds during which a calibrated detector was actually listening), so a
 * rate is count / exposure and gaps are never mistaken for "zero particles".
 * Demo pulses are never recorded. Data stays in this browser (localStorage).
 */
import type { DetectorState } from "./types";

const KEY = "iw-detector-bins-v1";
const KEEP_MS = 8 * 24 * 3_600_000;

type Bins = Record<string, Record<string, [number, number]>>; // mode → minuteKey → [count, exposureS]

let memory: Bins | null = null;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
let version = 0;
const notify = () => { version += 1; listeners.forEach((listener) => listener()); };
export function getDetectorVersion() { return version; }

function load(): Bins {
  if (memory) return memory;
  if (typeof window === "undefined") return (memory = {});
  try { memory = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Bins; }
  catch { memory = {}; }
  return memory ?? (memory = {});
}

function scheduleFlush() {
  dirty = true;
  if (flushTimer || typeof window === "undefined") return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!dirty) return;
    dirty = false;
    const bins = load();
    const cutoff = Math.floor((Date.now() - KEEP_MS) / 60_000);
    for (const mode of Object.keys(bins)) for (const key of Object.keys(bins[mode])) if (Number(key) < cutoff) delete bins[mode][key];
    try { window.localStorage.setItem(KEY, JSON.stringify(bins)); } catch { /* storage full: keep in memory */ }
    notify();
  }, 1_500);
}

function bin(mode: string, at: number) {
  const bins = load();
  const key = String(Math.floor(at / 60_000));
  bins[mode] ??= {};
  bins[mode][key] ??= [0, 0];
  return bins[mode][key];
}

export function recordPulse(mode: string, at = Date.now()) { bin(mode, at)[0] += 1; scheduleFlush(); }
export function recordExposure(mode: string, seconds: number, at = Date.now()) { bin(mode, at)[1] = Math.min(60, bin(mode, at)[1] + seconds); scheduleFlush(); }

export function subscribeDetector(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Aggregate to bins of `binMinutes` between [from, to). */
export function detectorSeries(mode: string, from: number, to: number, binMinutes = 60): DetectorState[] {
  const minutes = load()[mode] ?? {};
  const size = binMinutes * 60_000;
  const out = new Map<number, DetectorState>();
  for (const [key, [count, exposure]] of Object.entries(minutes)) {
    const t = Number(key) * 60_000;
    if (t < from || t >= to) continue;
    const start = Math.floor(t / size) * size;
    const current = out.get(start) ?? { timestamp: start, binMinutes, count: 0, exposureS: 0, rate: null };
    current.count += count; current.exposureS += exposure;
    out.set(start, current);
  }
  return [...out.values()].sort((a, b) => a.timestamp - b.timestamp).map((state) => ({ ...state, rate: state.exposureS >= 30 ? state.count / (state.exposureS / 60) : null }));
}

export function detectorTotals(mode: string, from: number, to: number) {
  return detectorSeries(mode, from, to, 24 * 60).reduce((sum, state) => ({ count: sum.count + state.count, exposureS: sum.exposureS + state.exposureS }), { count: 0, exposureS: 0 });
}

export function detectorModes() { return Object.keys(load()); }

export function clearDetectorSeries(mode?: string) {
  const bins = load();
  if (mode) delete bins[mode]; else for (const key of Object.keys(bins)) delete bins[key];
  scheduleFlush();
}

/** Development-only helper used by fixtures; never called in production code paths. */
export function __replaceDetectorBinsForDev(next: Bins) { memory = next; notify(); }
