import type { PulseRecord } from "./types";

/**
 * Small per-browser archive of real (audio) pulses so Top Signals, the gallery
 * and Cosmic Weather "inspect signals" survive a reload. Demo pulses are never
 * persisted. The archive lives only in this browser.
 */
const KEY = "iw-signal-archive-v1";
const LIMIT = 300;

function compact(record: PulseRecord): PulseRecord {
  return { ...record, samples: record.samples.map((value) => Number(value.toPrecision(4))) };
}

export function loadArchive(): PulseRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) as PulseRecord[] : [];
    return Array.isArray(parsed) ? parsed.filter((record) => record && record.source === "audio" && Array.isArray(record.samples)) : [];
  } catch { return []; }
}

export function saveArchive(records: PulseRecord[]) {
  if (typeof window === "undefined") return;
  const audio = records.filter((record) => record.source === "audio").slice(0, LIMIT).map(compact);
  try { window.localStorage.setItem(KEY, JSON.stringify(audio)); }
  catch {
    try { window.localStorage.setItem(KEY, JSON.stringify(audio.slice(0, Math.floor(LIMIT / 3)))); } catch { /* storage full or blocked */ }
  }
}

export function clearArchive() {
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}
