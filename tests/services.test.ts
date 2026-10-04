/**
 * Server adapters with a mocked upstream (no network):  node --import tsx --test tests/
 * Verifies URL construction, normalisation, caching and stale fallback.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { nasaDonkiService, nmdbService, noaaService, weatherService } from "../lib/cosmic/server/services";

const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString().replace(/\.\d{3}Z$/, "Z");
const requested: string[] = [];
let failing = false;

const SAMPLES: [RegExp, () => string][] = [
  [/api\.open-meteo\.com/, () => JSON.stringify({ elevation: 432, current: { time: Math.floor(NOW / 1000) - 300, surface_pressure: 964.7, temperature_2m: 12, relative_humidity_2m: 70 }, hourly: { time: [Math.floor(NOW / 1000) - 7200, Math.floor(NOW / 1000) - 3600], surface_pressure: [966.8, 965.9], temperature_2m: [12, 12], relative_humidity_2m: [70, 71] } })],
  [/noaa-planetary-k-index/, () => JSON.stringify([{ time_tag: iso(-6 * 3_600_000).slice(0, 19), Kp: 3.33, a_running: 18, station_count: 8 }])],
  [/xrays-1-day/, () => JSON.stringify([{ time_tag: iso(-60_000), satellite: 18, flux: 4.7e-7, energy: "0.1-0.8nm" }, { time_tag: iso(-60_000), satellite: 18, flux: 3e-8, energy: "0.05-0.4nm" }])],
  [/integral-protons-1-day/, () => JSON.stringify([{ time_tag: iso(-300_000), satellite: 18, flux: 0.2, energy: ">=10 MeV" }, { time_tag: iso(-300_000), satellite: 18, flux: 0.18, energy: ">=100 MeV" }])],
  [/xray-flares-7-day/, () => JSON.stringify([{ begin_time: iso(-5 * 3_600_000), max_time: iso(-4.9 * 3_600_000), end_time: iso(-4.8 * 3_600_000), max_class: "M2.4", satellite: 18 }])],
  [/alerts\.json/, () => JSON.stringify([])],
  [/DONKI-API\/get\/CME/, () => JSON.stringify([{ activityID: "X-CME-001", startTime: iso(-30 * 3_600_000).slice(0, 16) + "Z", cmeAnalyses: [{ isMostAccurate: true, speed: 900, enlilList: [{ estimatedShockArrivalTime: iso(26 * 3_600_000).slice(0, 16) + "Z", isEarthGB: true }] }], link: "https://ccmc.gsfc.nasa.gov/DONKI/view/CME/1/-1" }])],
  [/DONKI-API\/get\//, () => JSON.stringify([])],
  [/nmdb\.eu/, () => `<pre>#  start_date_time   RCORR_E\n${Array.from({ length: 30 }, (_, i) => `${new Date(NOW - (30 - i) * 3_600_000).toISOString().slice(0, 13).replace("T", " ")}:00:00;${(155 + Math.sin(i) * 0.3).toFixed(3)}`).join("\n")}\n</pre>`],
];

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  requested.push(url);
  if (failing) throw new Error("network down");
  const match = SAMPLES.find(([pattern]) => pattern.test(url));
  return new Response(match ? match[1]() : "not found", { status: match ? 200 : 404 });
}) as typeof fetch;

test("weatherService uses surface pressure and appends the current value", async () => {
  const env = await weatherService(47.3769, 8.5417);
  assert.ok(requested.some((url) => url.includes("surface_pressure") && !url.includes("pressure_msl") && url.includes("latitude=47.38")));
  assert.equal(env.series.at(-1)?.pressureHpa, 964.7);
  assert.equal(env.elevationM, 432);
  assert.equal(env.stale, false);
});

test("noaaService normalises all feeds independently", async () => {
  const space = await noaaService();
  assert.equal(space.kp.series[0].v, 3.33);
  assert.equal(space.xray.series.length, 1);
  assert.equal(space.protons.series10[0].v, 0.2);
  assert.equal(space.flares.events[0].title, "M2.4 solar flare");
  assert.ok(space.alerts.status.ok);
});

test("nasaDonkiService uses the new CCMC endpoint (no key) and models arrivals", async () => {
  const result = await nasaDonkiService(NOW);
  assert.ok(requested.some((url) => url.startsWith("https://ccmc.gsfc.nasa.gov/DONKI-API/get/CME?startDate=")));
  assert.ok(!requested.some((url) => /api_key|api\.nasa\.gov|kauai/.test(url)));
  assert.ok(result.events.some((event) => event.type === "cme-arrival"));
});

test("nmdbService fetches Jungfraujoch first and parses hourly data", async () => {
  const reference = await nmdbService();
  assert.equal(reference.stations[0].code, "JUNG");
  assert.ok(reference.stations[0].ok);
  assert.equal(reference.stations[0].series.length, 30);
  assert.ok(requested.some((url) => url.includes("stations%5B%5D=JUNG") && url.includes("dtype=corr_for_efficiency")));
});

test("cached values are reused, and served as stale when upstream fails", async () => {
  const before = requested.length;
  await noaaService(); // within TTL → no new requests
  assert.equal(requested.length, before);
  failing = true;
  const original = Date.now;
  Date.now = () => original() + 10 * 60_000; // past the 2-minute TTL
  try {
    const space = await noaaService();
    assert.ok(space.kp.status.ok && space.kp.status.stale, "stale cache served");
    assert.equal(space.kp.series[0].v, 3.33);
  } finally { Date.now = original; failing = false; }
});
