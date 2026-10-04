/**
 * External data adapters. Each adapter returns the normalised internal model
 * and never leaks upstream formats to the client. No adapter needs an API key;
 * if a future source does, read it from the Worker `env` here — never from
 * client code.
 */
import { CACHE_MS, REFERENCE_STATIONS } from "../config";
import { parseAlerts, parseDonkiCme, parseDonkiSimple, parseFlares, parseKp, parseNmdbAscii, parseOpenMeteo, parseProtons, parseXray } from "../parsers";
import type { CosmicEvent, EnvironmentPayload, EventsPayload, FeedStatus, ReferencePayload, ReferenceStation, SpacePayload } from "../types";
import { cached, errorText, fetchJson, fetchText } from "./http";

// --- weatherService ------------------------------------------------------------

export async function weatherService(latitude: number, longitude: number): Promise<EnvironmentPayload> {
  const lat = Math.round(latitude * 100) / 100; const lon = Math.round(longitude * 100) / 100;
  // surface_pressure = pressure at the model terrain height (not reduced to sea level).
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + "&current=surface_pressure,temperature_2m,relative_humidity_2m"
    + "&hourly=surface_pressure,temperature_2m,relative_humidity_2m"
    + "&past_days=7&forecast_days=1&timezone=UTC&timeformat=unixtime";
  const result = await cached(`open-meteo:${lat}:${lon}`, CACHE_MS.environment.ttl, CACHE_MS.environment.staleMax, async () => parseOpenMeteo(await fetchJson(url)));
  const { series, current, elevationM } = result.value;
  // Append the 15-minute "current" value so the trend reaches the present.
  const merged = current && (!series.length || current.timestamp > series[series.length - 1].timestamp) ? [...series, current] : series;
  return { fetchedAt: result.storedAt, latitude: lat, longitude: lon, elevationM, series: merged, current, sensor: null, sensorSeries: [], source: "open-meteo", stale: result.stale, error: result.error };
}

// --- noaaService ----------------------------------------------------------------

const SWPC = "https://services.swpc.noaa.gov";

async function feed<T>(key: string, loader: () => Promise<T>, empty: T): Promise<{ value: T; status: FeedStatus }> {
  try {
    const result = await cached(key, CACHE_MS.space.ttl, CACHE_MS.space.staleMax, loader);
    return { value: result.value, status: { ok: true, stale: result.stale, error: result.error, fetchedAt: result.storedAt } };
  } catch (error) {
    return { value: empty, status: { ok: false, error: errorText(error), fetchedAt: null } };
  }
}

export async function noaaService(): Promise<SpacePayload> {
  const [kp, xray, protons, flares, alerts] = await Promise.all([
    feed("swpc:kp", async () => parseKp(await fetchJson(`${SWPC}/products/noaa-planetary-k-index.json`)), []),
    feed("swpc:xray", async () => parseXray(await fetchJson(`${SWPC}/json/goes/primary/xrays-1-day.json`)), []),
    feed("swpc:protons", async () => {
      const json = await fetchJson(`${SWPC}/json/goes/primary/integral-protons-1-day.json`);
      return { series10: parseProtons(json, ">=10 MeV"), series100: parseProtons(json, ">=100 MeV") };
    }, { series10: [], series100: [] }),
    feed("swpc:flares", async () => parseFlares(await fetchJson(`${SWPC}/json/goes/primary/xray-flares-7-day.json`)), [] as CosmicEvent[]),
    feed("swpc:alerts", async () => parseAlerts(await fetchJson(`${SWPC}/products/alerts.json`)).slice(0, 20), [] as CosmicEvent[]),
  ]);
  return {
    fetchedAt: Date.now(),
    kp: { series: kp.value, status: kp.status },
    xray: { series: xray.value, status: xray.status },
    protons: { ...protons.value, status: protons.status },
    flares: { events: flares.value, status: flares.status },
    alerts: { events: alerts.value, status: alerts.status },
  };
}

// --- nasaDonkiService ---------------------------------------------------------------

/** DONKI moved to ccmc.gsfc.nasa.gov/DONKI-API on 2026-09-30 (no API key required). */
const DONKI = "https://ccmc.gsfc.nasa.gov/DONKI-API/get";

export async function nasaDonkiService(now = Date.now()): Promise<EventsPayload> {
  const day = (offset: number) => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
  const range = `startDate=${day(-7)}&endDate=${day(1)}`;
  try {
    const result = await cached(`donki:${day(0)}`, CACHE_MS.events.ttl, CACHE_MS.events.staleMax, async () => {
      const kinds = ["CME", "FLR", "SEP", "IPS", "GST"] as const;
      const responses = await Promise.allSettled(kinds.map((kind) => fetchJson(`${DONKI}/${kind}?${range}`, 12_000)));
      if (responses.every((response) => response.status === "rejected")) throw new Error((responses[0] as PromiseRejectedResult).reason?.message ?? "DONKI unavailable");
      const events: CosmicEvent[] = [];
      responses.forEach((response, index) => {
        if (response.status !== "fulfilled") return;
        const kind = kinds[index];
        events.push(...(kind === "CME" ? parseDonkiCme(response.value) : parseDonkiSimple(response.value, kind)));
      });
      return events.sort((a, b) => b.timestamp - a.timestamp);
    });
    return { fetchedAt: result.storedAt, events: result.value, status: { ok: true, stale: result.stale, error: result.error, fetchedAt: result.storedAt } };
  } catch (error) {
    return { fetchedAt: now, events: [], status: { ok: false, error: errorText(error), fetchedAt: null } };
  }
}

// --- nmdbService -----------------------------------------------------------------------

function nmdbUrl(code: string, days: number) {
  const params = new URLSearchParams({
    formchk: "1", tabchoice: "revori", dtype: "corr_for_efficiency", tresolution: "60", yunits: "0",
    date_choice: "last", last_days: String(days), last_label: "days_label", output: "ascii",
  });
  return `https://www.nmdb.eu/nest/draw_graph.php?${params.toString()}&stations%5B%5D=${encodeURIComponent(code)}`;
}

export async function nmdbService(): Promise<ReferencePayload> {
  let anyStale = false;
  const stations = await Promise.all(REFERENCE_STATIONS.map(async (meta): Promise<ReferenceStation> => {
    const base = { code: meta.code, name: meta.name, altitudeM: meta.altitudeM, cutoffGV: meta.cutoffGV, operator: meta.operator };
    try {
      const result = await cached(`nmdb:${meta.code}`, CACHE_MS.reference.ttl, CACHE_MS.reference.staleMax, async () => {
        const series = parseNmdbAscii(await fetchText(nmdbUrl(meta.code, 8), 15_000, "text/plain, text/html"));
        if (!series.length) throw new Error(`NMDB returned no ${meta.code} data`);
        return series;
      });
      anyStale ||= result.stale;
      return { ...base, series: result.value, ok: true, error: result.stale ? result.error : undefined };
    } catch (error) {
      return { ...base, series: [], ok: false, error: errorText(error) };
    }
  }));
  return { fetchedAt: Date.now(), stations, stale: anyStale };
}
