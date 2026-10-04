/**
 * Pure parsers that turn upstream responses into the internal model.
 * They never throw on a single bad row; malformed rows are skipped.
 */
import type { CosmicEvent, EnvironmentalState, Severity, TimePoint } from "./types";

/** Parse an upstream timestamp that is documented as UTC but may lack a zone suffix. */
export function parseUtc(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let text = value.trim().replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) text += ":00";
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(text)) text += "Z";
  const time = Date.parse(text);
  return Number.isFinite(time) ? time : null;
}

const num = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

// --- Open-Meteo ---------------------------------------------------------------

type OpenMeteoResponse = {
  latitude?: number; longitude?: number; elevation?: number;
  current?: { time?: number; surface_pressure?: number; temperature_2m?: number; relative_humidity_2m?: number };
  hourly?: { time?: number[]; surface_pressure?: (number | null)[]; temperature_2m?: (number | null)[]; relative_humidity_2m?: (number | null)[] };
};

export function parseOpenMeteo(json: unknown, now = Date.now()) {
  const data = (json ?? {}) as OpenMeteoResponse;
  const times = data.hourly?.time ?? [];
  const series: EnvironmentalState[] = [];
  times.forEach((seconds, index) => {
    const timestamp = seconds * 1000;
    const pressure = num(data.hourly?.surface_pressure?.[index]);
    // Keep only the past (hourly also contains a forecast for the rest of today).
    if (timestamp > now || pressure === null) return;
    series.push({
      timestamp, pressureHpa: pressure,
      temperatureC: num(data.hourly?.temperature_2m?.[index]),
      humidityPct: num(data.hourly?.relative_humidity_2m?.[index]),
      source: "open-meteo",
    });
  });
  const c = data.current;
  const current: EnvironmentalState | null = c && num(c.surface_pressure) !== null && typeof c.time === "number"
    ? { timestamp: c.time * 1000, pressureHpa: num(c.surface_pressure), temperatureC: num(c.temperature_2m), humidityPct: num(c.relative_humidity_2m), source: "open-meteo" }
    : null;
  return { series, current, elevationM: num(data.elevation), latitude: num(data.latitude), longitude: num(data.longitude) };
}

// --- NOAA SWPC ----------------------------------------------------------------

export function parseKp(json: unknown): TimePoint[] {
  if (!Array.isArray(json)) return [];
  const out: TimePoint[] = [];
  for (const row of json) {
    // Current format: array of objects { time_tag, Kp, a_running, station_count }.
    // Legacy format: array of arrays with a header row [time_tag, Kp, ...].
    if (Array.isArray(row)) {
      const t = parseUtc(row[0]); const v = num(row[1]);
      if (t !== null && v !== null) out.push({ t, v });
    } else if (row && typeof row === "object") {
      const record = row as Record<string, unknown>;
      const t = parseUtc(record.time_tag); const v = num(record.Kp ?? record.kp ?? record.kp_index);
      if (t !== null && v !== null) out.push({ t, v });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** GOES long-channel (0.1–0.8 nm) X-ray flux, decimated to `stepMinutes` maxima. */
export function parseXray(json: unknown, stepMinutes = 5): TimePoint[] {
  if (!Array.isArray(json)) return [];
  const buckets = new Map<number, number>();
  for (const row of json as Record<string, unknown>[]) {
    if (!row || row.energy !== "0.1-0.8nm") continue;
    const t = parseUtc(row.time_tag); const v = num(row.flux);
    if (t === null || v === null || v <= 0) continue;
    const key = Math.floor(t / (stepMinutes * 60_000)) * stepMinutes * 60_000;
    buckets.set(key, Math.max(buckets.get(key) ?? 0, v));
  }
  return [...buckets.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
}

export function parseProtons(json: unknown, energy: ">=10 MeV" | ">=100 MeV", stepMinutes = 15): TimePoint[] {
  if (!Array.isArray(json)) return [];
  const buckets = new Map<number, number>();
  for (const row of json as Record<string, unknown>[]) {
    if (!row || row.energy !== energy) continue;
    const t = parseUtc(row.time_tag); const v = num(row.flux);
    if (t === null || v === null || v < 0) continue;
    const key = Math.floor(t / (stepMinutes * 60_000)) * stepMinutes * 60_000;
    buckets.set(key, Math.max(buckets.get(key) ?? 0, v));
  }
  return [...buckets.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
}

export function flareClassToFlux(value: string | null | undefined) {
  const match = /^([ABCMX])(\d+(?:\.\d+)?)/i.exec(value?.trim() ?? "");
  if (!match) return null;
  const base = { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 }[match[1].toUpperCase() as "A"];
  return base * Number(match[2]);
}

export function fluxToClass(flux: number | null | undefined) {
  if (!flux || flux <= 0) return "—";
  const letters: [string, number][] = [["X", 1e-4], ["M", 1e-5], ["C", 1e-6], ["B", 1e-7], ["A", 1e-8]];
  const [letter, base] = letters.find(([, threshold]) => flux >= threshold) ?? ["A", 1e-8];
  return `${letter}${(flux / base).toFixed(1)}`;
}

export function flareSeverity(flux: number | null): Severity {
  if (!flux) return "info";
  if (flux >= 1e-3) return "extreme";
  if (flux >= 1e-4) return "strong";
  if (flux >= 5e-5) return "moderate";
  if (flux >= 1e-5) return "minor";
  return "info";
}

export function parseFlares(json: unknown): CosmicEvent[] {
  if (!Array.isArray(json)) return [];
  const out: CosmicEvent[] = [];
  for (const row of json as Record<string, unknown>[]) {
    const begin = parseUtc(row?.begin_time); const peak = parseUtc(row?.max_time);
    const cls = typeof row?.max_class === "string" ? row.max_class : null;
    if (!cls || (!begin && !peak)) continue;
    const flux = flareClassToFlux(cls);
    // Below C-class flares are omitted from the feed to keep it readable.
    if (!flux || flux < 1e-6) continue;
    out.push({
      id: `goes-flare-${row.begin_time ?? row.max_time}`,
      timestamp: (peak ?? begin) as number,
      endTime: parseUtc(row.end_time),
      type: "solar-flare",
      severity: flareSeverity(flux),
      source: "NOAA SWPC",
      title: `${cls} solar flare`,
      description: `GOES X-ray peak ${cls} at ${row.max_time ?? "—"} UTC. Flare X-rays reach Earth in ~8 minutes and are absorbed high in the atmosphere; flares alone do not normally change ground-level cosmic-ray rates.`,
      link: "https://www.swpc.noaa.gov/products/goes-x-ray-flux",
      metadata: { satellite: num(row.satellite), beginTime: String(row.begin_time ?? ""), endTime: String(row.end_time ?? "") },
    });
  }
  return out;
}

const ALERT_KEYWORDS: { pattern: RegExp; type: CosmicEvent["type"] }[] = [
  { pattern: /geomagnetic|k-index/i, type: "geomagnetic-storm" },
  { pattern: /proton/i, type: "sep" },
  { pattern: /x-ray/i, type: "solar-flare" },
];

export function parseAlerts(json: unknown): CosmicEvent[] {
  if (!Array.isArray(json)) return [];
  const out: CosmicEvent[] = [];
  for (const row of json as Record<string, unknown>[]) {
    const message = typeof row?.message === "string" ? row.message.replace(/\r/g, "") : "";
    const issued = parseUtc(row?.issue_datetime);
    if (!message || issued === null) continue;
    const headline = message.split("\n").map((line) => line.trim()).find((line) => /^(CONTINUED ALERT|ALERT|WARNING|WATCH|SUMMARY|EXTENDED WARNING|CANCEL[A-Z ]*):/i.test(line));
    if (!headline) continue;
    const match = ALERT_KEYWORDS.find((keyword) => keyword.pattern.test(headline));
    if (!match) continue; // radio bursts, electron flux etc. are not shown in this feed
    const scale = /\b([GSR])([1-5])\b/.exec(message);
    const level = scale ? Number(scale[2]) : 0;
    const severity: Severity = level >= 4 ? "extreme" : level === 3 ? "strong" : level === 2 ? "moderate" : level === 1 ? "minor" : "info";
    out.push({
      id: `swpc-${row.product_id}-${row.issue_datetime}`,
      timestamp: issued,
      type: match.type === "solar-flare" ? "alert" : match.type,
      severity,
      source: "NOAA SWPC",
      title: headline.replace(/\s+/g, " ").slice(0, 110),
      description: message.split("\n").slice(4, 9).join(" ").replace(/\s+/g, " ").trim().slice(0, 280),
      link: "https://www.swpc.noaa.gov/products/alerts-watches-and-warnings",
      metadata: { productId: String(row.product_id ?? "") },
    });
  }
  return out;
}

export function kpLabel(kp: number | null | undefined) {
  if (kp === null || kp === undefined || !Number.isFinite(kp)) return "—";
  if (kp >= 9) return "G5 extreme storm";
  if (kp >= 8) return "G4 severe storm";
  if (kp >= 7) return "G3 strong storm";
  if (kp >= 6) return "G2 moderate storm";
  if (kp >= 5) return "G1 minor storm";
  if (kp >= 4) return "Active";
  if (kp >= 3) return "Unsettled";
  return "Quiet";
}

export function protonLabel(pfu: number | null | undefined) {
  if (pfu === null || pfu === undefined || !Number.isFinite(pfu)) return { label: "—", level: 0 };
  if (pfu >= 1e5) return { label: "S5 EXTREME", level: 5 };
  if (pfu >= 1e4) return { label: "S4 SEVERE", level: 5 };
  if (pfu >= 1e3) return { label: "S3 STRONG", level: 4 };
  if (pfu >= 100) return { label: "S2 MODERATE", level: 3 };
  if (pfu >= 10) return { label: "S1 MINOR", level: 2 };
  return { label: "NORMAL", level: 1 };
}

export function solarActivityLabel(maxFlux24h: number | null | undefined) {
  if (!maxFlux24h) return { label: "—", level: 0 };
  if (maxFlux24h >= 1e-4) return { label: "VERY HIGH", level: 5 };
  if (maxFlux24h >= 5e-5) return { label: "HIGH", level: 4 };
  if (maxFlux24h >= 1e-5) return { label: "MODERATE", level: 3 };
  if (maxFlux24h >= 1e-6) return { label: "LOW", level: 2 };
  return { label: "QUIET", level: 1 };
}

// --- NASA DONKI -----------------------------------------------------------------

type DonkiCme = {
  activityID?: string; startTime?: string; note?: string; link?: string; sourceLocation?: string;
  cmeAnalyses?: { isMostAccurate?: boolean; speed?: number | null; halfAngle?: number | null; type?: string;
    enlilList?: { estimatedShockArrivalTime?: string | null; isEarthGB?: boolean; isEarthMinorImpact?: boolean; kp_90?: number | null; kp_180?: number | null; link?: string }[] | null }[] | null;
};

export function parseDonkiCme(json: unknown): CosmicEvent[] {
  if (!Array.isArray(json)) return [];
  const out: CosmicEvent[] = [];
  for (const cme of json as DonkiCme[]) {
    const start = parseUtc(cme.startTime);
    if (start === null) continue;
    const analysis = cme.cmeAnalyses?.find((item) => item.isMostAccurate) ?? cme.cmeAnalyses?.[0];
    const arrivals = (analysis?.enlilList ?? []).map((model) => ({
      t: parseUtc(model.estimatedShockArrivalTime ?? undefined),
      glancing: Boolean(model.isEarthGB || model.isEarthMinorImpact),
      kp: model.kp_90 ?? model.kp_180 ?? null,
    })).filter((item) => item.t !== null);
    const arrival = arrivals.length ? Math.min(...arrivals.map((item) => item.t as number)) : null;
    const speed = analysis?.speed ?? null;
    const severity: Severity = arrival ? (speed && speed > 1000 ? "strong" : "moderate") : speed && speed > 1500 ? "moderate" : "info";
    out.push({
      id: `donki-${cme.activityID ?? start}`,
      timestamp: start,
      type: "cme",
      severity,
      source: "NASA DONKI",
      title: arrival ? "CME · modelled Earth arrival" : "CME detected",
      description: `${speed ? `Speed ≈ ${Math.round(speed)} km/s. ` : ""}${arrival ? "WSA-ENLIL modelling predicts a shock arrival at Earth (model estimate, often ±7 h or more). " : "No Earth arrival in the model output. "}CMEs can temporarily reduce galactic cosmic rays reaching Earth (Forbush decrease).`,
      estimatedArrival: arrival,
      link: cme.link,
      metadata: { speedKmS: speed, halfAngle: analysis?.halfAngle ?? null, activityId: cme.activityID ?? null },
    });
    if (arrival) {
      out.push({
        id: `donki-arrival-${cme.activityID ?? start}`,
        timestamp: arrival,
        type: "cme-arrival",
        severity,
        source: "NASA DONKI",
        title: "Modelled CME arrival",
        description: "Model-estimated arrival of a CME shock at Earth. Arrival times are uncertain; watch for a possible Forbush decrease in neutron monitors in the following hours to days.",
        link: cme.link,
        metadata: { activityId: cme.activityID ?? null },
      });
    }
  }
  return out;
}

export function parseDonkiSimple(json: unknown, kind: "FLR" | "SEP" | "IPS" | "GST"): CosmicEvent[] {
  if (!Array.isArray(json)) return [];
  const out: CosmicEvent[] = [];
  for (const row of json as Record<string, unknown>[]) {
    const id = String(row.flrID ?? row.sepID ?? row.activityID ?? row.gstID ?? "");
    if (kind === "FLR") {
      const t = parseUtc(row.peakTime) ?? parseUtc(row.beginTime);
      const cls = typeof row.classType === "string" ? row.classType : "";
      const flux = flareClassToFlux(cls);
      if (t === null || !flux || flux < 1e-5) continue; // DONKI flares: M-class and above
      out.push({ id: `donki-flr-${id || t}`, timestamp: t, type: "solar-flare", severity: flareSeverity(flux), source: "NASA DONKI", title: `${cls} solar flare`, description: `Flare from ${row.sourceLocation || "unknown location"}${row.activeRegionNum ? `, AR ${row.activeRegionNum}` : ""}.`, link: typeof row.link === "string" ? row.link : undefined });
    } else if (kind === "SEP") {
      const t = parseUtc(row.eventTime);
      if (t === null) continue;
      out.push({ id: `donki-sep-${id || t}`, timestamp: t, type: "sep", severity: "moderate", source: "NASA DONKI", title: "Solar energetic particle event", description: "Elevated energetic solar particles near Earth. Only the most energetic events (GLEs) are seen by ground-level monitors.", link: typeof row.link === "string" ? row.link : undefined });
    } else if (kind === "IPS") {
      const t = parseUtc(row.eventTime);
      if (t === null || (row.location && row.location !== "Earth")) continue;
      out.push({ id: `donki-ips-${id || t}`, timestamp: t, type: "ips", severity: "minor", source: "NASA DONKI", title: "Interplanetary shock at Earth", description: "A solar-wind shock passed the near-Earth monitors. Shocks and CMEs can be followed by Forbush decreases.", link: typeof row.link === "string" ? row.link : undefined });
    } else {
      const t = parseUtc(row.startTime);
      if (t === null) continue;
      const kps = Array.isArray(row.allKpIndex) ? (row.allKpIndex as { kpIndex?: number }[]).map((item) => num(item.kpIndex)).filter((value): value is number => value !== null) : [];
      const maxKp = kps.length ? Math.max(...kps) : null;
      out.push({ id: `donki-gst-${id || t}`, timestamp: t, type: "geomagnetic-storm", severity: maxKp && maxKp >= 7 ? "strong" : maxKp && maxKp >= 6 ? "moderate" : "minor", source: "NASA DONKI", title: `Geomagnetic storm${maxKp ? ` · Kp ${maxKp}` : ""}`, description: "Geomagnetic storms change the magnetic shielding of Earth slightly; effects on mid-latitude ground-level rates are usually small.", link: typeof row.link === "string" ? row.link : undefined, metadata: { maxKp } });
    }
  }
  return out;
}

// --- NMDB -----------------------------------------------------------------------

/** Parse NMDB NEST ascii output: lines "YYYY-MM-DD hh:mm:ss;value". */
export function parseNmdbAscii(text: string): TimePoint[] {
  const out: TimePoint[] = [];
  const pattern = /^\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*;\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|null|nan)?\s*$/gim;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const t = parseUtc(match[1]); const v = num(match[2]);
    if (t !== null && v !== null && v > 0) out.push({ t, v });
  }
  return out.sort((a, b) => a.t - b.t);
}
