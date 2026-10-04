/**
 * DEVELOPMENT-ONLY synthetic data for layout work and failure-state testing.
 *
 * Loaded exclusively through a dynamic import guarded by `import.meta.env.DEV`
 * and the `?cw-fixtures=1` URL flag, so production bundles never use it.
 * Every value here is invented and must never be presented as a measurement.
 */
import type { CosmicEvent, EnvironmentPayload, EventsPayload, ReferencePayload, SpacePayload, TimePoint } from "./types";

const H = 3_600_000;

function series(now: number, hours: number, stepMs: number, fn: (t: number, i: number) => number): TimePoint[] {
  const out: TimePoint[] = [];
  const start = Math.floor((now - hours * H) / stepMs) * stepMs;
  for (let t = start, i = 0; t <= now; t += stepMs, i += 1) out.push({ t, v: fn(t, i) });
  return out;
}

const wobble = (i: number, seed: number) => Math.sin(i * 12.9898 + seed) * 43758.5453 % 1;

export function devFixture(key: "environment" | "space" | "reference" | "events", now: number) {
  if (key === "environment") {
    const points = series(now, 7 * 24, H, (t, i) => 963 + 4 * Math.sin(t / (31 * H)) + 1.2 * Math.sin(t / (6 * H)) - (t > now - 6 * H ? (t - (now - 6 * H)) / H * 0.35 : 0) + wobble(i, 1) * 0.15);
    const payload: EnvironmentPayload = {
      fetchedAt: now, latitude: 47.38, longitude: 8.54, elevationM: 432,
      series: points.map((point) => ({ timestamp: point.t, pressureHpa: Number(point.v.toFixed(1)), temperatureC: 14, humidityPct: 70, source: "open-meteo" })),
      current: { timestamp: now - 10 * 60_000, pressureHpa: Number(points[points.length - 1].v.toFixed(1)), temperatureC: 14, humidityPct: 70, source: "open-meteo" },
      sensor: null, sensorSeries: [], source: "open-meteo",
    };
    return payload;
  }
  if (key === "space") {
    const flarePeak = now - 5 * H;
    const payload: SpacePayload = {
      fetchedAt: now,
      kp: { series: series(now, 7 * 24, 3 * H, (_t, i) => [1.33, 2, 3, 2.67, 3.33, 5, 4, 2.33][i % 8]), status: { ok: true, fetchedAt: now } },
      xray: { series: series(now, 24, 5 * 60_000, (t) => 4e-7 * (1 + 0.3 * Math.sin(t / H)) + 2.4e-5 * Math.exp(-Math.abs(t - flarePeak) / (20 * 60_000))), status: { ok: true, fetchedAt: now } },
      protons: { series10: series(now, 24, 15 * 60_000, () => 0.42), series100: series(now, 24, 15 * 60_000, () => 0.18), status: { ok: true, fetchedAt: now } },
      flares: { events: [{ id: "dev-flare", timestamp: flarePeak, type: "solar-flare", severity: "minor", source: "NOAA SWPC", title: "M2.4 solar flare", description: "DEVELOPMENT FIXTURE — not real data.", link: "https://www.swpc.noaa.gov/" }], status: { ok: true, fetchedAt: now } },
      alerts: { events: [{ id: "dev-alert", timestamp: now - 9 * H, type: "geomagnetic-storm", severity: "minor", source: "NOAA SWPC", title: "ALERT: Geomagnetic K-index of 5", description: "DEVELOPMENT FIXTURE — not real data." }], status: { ok: true, fetchedAt: now } },
    };
    return payload;
  }
  if (key === "reference") {
    const make = (code: string, name: string, altitudeM: number, cutoffGV: number, base: number, dip: number) => ({
      code, name, altitudeM, cutoffGV, operator: "fixture", ok: true,
      series: series(now - H, 8 * 24, H, (t, i) => base * (1 + 0.003 * Math.sin((t / (24 * H)) * 2 * Math.PI) + wobble(i, base) * 0.0015 - (t > now - 20 * H ? dip * Math.min(1, (t - (now - 20 * H)) / (6 * H)) : 0))),
    });
    const payload: ReferencePayload = { fetchedAt: now, stations: [make("JUNG", "Jungfraujoch", 3475, 4.5, 155, 0.012), make("LMKS", "Lomnický štít", 2634, 3.8, 410, 0.01), make("KIEL2", "Kiel", 54, 2.4, 190, 0.008), make("OULU", "Oulu", 15, 0.8, 105, 0.007), { code: "ROME", name: "Rome", altitudeM: 0, cutoffGV: 6.3, operator: "fixture", ok: false, series: [], error: "Simulated: station offline" }] };
    return payload;
  }
  const events: CosmicEvent[] = [
    { id: "dev-cme", timestamp: now - 30 * H, type: "cme", severity: "moderate", source: "NASA DONKI", title: "CME · modelled Earth arrival", description: "DEVELOPMENT FIXTURE — not real data.", estimatedArrival: now + 26 * H },
    { id: "dev-cme-arrival", timestamp: now + 26 * H, type: "cme-arrival", severity: "moderate", source: "NASA DONKI", title: "Modelled CME arrival", description: "DEVELOPMENT FIXTURE — not real data." },
    { id: "dev-ips", timestamp: now - 52 * H, type: "ips", severity: "minor", source: "NASA DONKI", title: "Interplanetary shock at Earth", description: "DEVELOPMENT FIXTURE — not real data." },
  ];
  const payload: EventsPayload = { fetchedAt: now, events, status: { ok: true, fetchedAt: now } };
  return payload;
}

/** Synthetic minute bins for the local detector (sky mode), ~3.8 events/min. */
export function devDetectorBins(now: number) {
  const bins: Record<string, [number, number]> = {};
  const start = Math.floor((now - 3 * 24 * H) / 60_000);
  const end = Math.floor(now / 60_000);
  for (let minute = start; minute <= end; minute += 1) {
    if (minute % 1440 > 1300 && minute < end - 1440) continue; // a gap: detector offline
    const t = minute * 60_000;
    const rate = 3.6 * (1 + (t > now - 4 * H ? 0.04 : 0));
    bins[String(minute)] = [Math.max(0, Math.round(rate + (wobble(minute, 3) - 0.5) * 3.6)), 60];
  }
  return { sky: bins };
}
