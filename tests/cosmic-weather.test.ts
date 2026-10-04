/**
 * Plain node:test suite (no extra dependencies):  node --import tsx --test tests/
 * Upstream samples below are verbatim excerpts of real responses (Oct 2026).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzePulse, integrate } from "../lib/signal/analysis";
import { accidentalRateHz, findCoincidences } from "../lib/signal/coincidence";
import { compareLocal, interpret, pressureContext, referenceEvents, temporalOverlaps } from "../lib/cosmic/interpretation";
import { DEFAULT_CORRECTION, correctRate, estimateBeta } from "../lib/cosmic/pressure";
import { flareClassToFlux, fluxToClass, kpLabel, parseAlerts, parseDonkiCme, parseFlares, parseKp, parseNmdbAscii, parseOpenMeteo, parseProtons, parseUtc, parseXray } from "../lib/cosmic/parsers";
import { rollingDeviation, seriesDeviation } from "../lib/cosmic/stats";
import type { DetectorState, ReferenceStation, TimePoint } from "../lib/cosmic/types";

test("UTC parsing handles all upstream timestamp styles", () => {
  const iso = Date.UTC(2026, 9, 4, 3, 0, 0);
  assert.equal(parseUtc("2026-10-04T03:00:00"), iso); // NOAA Kp (no zone → UTC)
  assert.equal(parseUtc("2026-10-04T03:00:00Z"), iso); // GOES
  assert.equal(parseUtc("2026-10-04T03:00Z"), iso); // DONKI
  assert.equal(parseUtc("2026-10-04 03:00:00"), iso); // NMDB
  assert.equal(parseUtc("2026-10-01 14:30:29.700"), Date.UTC(2026, 9, 1, 14, 30, 29, 700)); // SWPC alerts
  assert.equal(parseUtc(""), null);
});

test("NOAA Kp object format and legacy array format", () => {
  const objects = parseKp(JSON.parse('[{"time_tag":"2026-10-04T00:00:00","Kp":3.00,"a_running":15,"station_count":8},{"time_tag":"2026-10-04T03:00:00","Kp":3.33,"a_running":18,"station_count":8}]'));
  assert.deepEqual(objects.map((p) => p.v), [3, 3.33]);
  const legacy = parseKp([["time_tag", "Kp", "a_running", "station_count"], ["2026-10-04 00:00:00.000", "2.67", "12", "8"]]);
  assert.equal(legacy.length, 1); assert.equal(legacy[0].v, 2.67);
  assert.equal(kpLabel(3.33), "Unsettled"); assert.equal(kpLabel(5), "G1 minor storm");
});

test("GOES X-ray uses only the 0.1–0.8 nm channel", () => {
  const rows = JSON.parse('[{"time_tag": "2026-09-26T19:17:00Z", "satellite": 18, "flux": 3.37e-08, "energy": "0.05-0.4nm"}, {"time_tag": "2026-09-26T19:17:00Z", "satellite": 18, "flux": 4.787e-07, "energy": "0.1-0.8nm"}, {"time_tag": "2026-09-26T19:18:00Z", "satellite": 18, "flux": 4.73e-07, "energy": "0.1-0.8nm"}]');
  const points = parseXray(rows);
  assert.equal(points.length, 1); assert.equal(points[0].v, 4.787e-07);
  assert.equal(fluxToClass(4.787e-07), "B4.8"); assert.equal(flareClassToFlux("M2.4"), 2.4e-5);
});

test("GOES protons and flares", () => {
  const protons = parseProtons(JSON.parse('[{"time_tag": "2026-10-03T07:45:00Z", "satellite": 18, "flux": 1.0186, "energy": ">=1 MeV"}, {"time_tag": "2026-10-03T07:45:00Z", "satellite": 18, "flux": 0.1999, "energy": ">=10 MeV"}]'), ">=10 MeV");
  assert.equal(protons.length, 1); assert.equal(protons[0].v, 0.1999);
  const flares = parseFlares(JSON.parse('[{"time_tag": "2026-09-27T02:12:00Z", "begin_time": "2026-09-27T02:12:00Z", "begin_class": "B5.2", "max_time": "2026-09-27T02:22:00Z", "max_class": "C1.1", "end_time": "2026-09-27T02:28:00Z", "satellite": 18}, {"begin_time":"2026-10-03T16:10:00Z","max_time": "2026-10-03T16:18:00Z", "max_class": "B4.5"}]'));
  assert.equal(flares.length, 1, "B-class flares are skipped");
  assert.equal(flares[0].title, "C1.1 solar flare");
  assert.ok(!/caused/i.test(flares[0].description));
});

test("SWPC alerts keep geomagnetic/proton items only", () => {
  const alerts = parseAlerts(JSON.parse(String.raw`[{"product_id":"A20F","issue_datetime":"2026-10-01 14:28:54.257","message":"Space Weather Message Code: WATA20\r\nSerial Number: 1128\r\nIssue Time: 2026 Oct 01 1428 UTC\r\n\r\nWATCH: Geomagnetic Storm Category G1 Predicted \nHighest Storm Level Predicted by Day:\nOct 02:  G1 (Minor)"},{"product_id":"TIIA","issue_datetime":"2026-09-30 03:38:29.203","message":"Space Weather Message Code: ALTTP2\r\nSerial Number: 1529\r\nIssue Time: 2026 Sep 30 0338 UTC\r\n\r\nALERT: Type II Radio Emission \nBegin Time: 2026 Sep 30 0252 UTC"}]`));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, "geomagnetic-storm"); assert.equal(alerts[0].severity, "minor");
});

test("DONKI CME with and without modelled arrival", () => {
  const sample = JSON.parse('[{"activityID":"2026-09-26T00:48:00-CME-001","startTime":"2026-09-26T00:48Z","cmeAnalyses":[{"isMostAccurate":true,"speed":478.0,"halfAngle":15.0,"enlilList":[{"estimatedShockArrivalTime":null,"isEarthGB":false}]}],"link":"https://ccmc.gsfc.nasa.gov/DONKI/view/CME/48823/-1"}, {"activityID":"X","startTime":"2026-10-01T10:00Z","cmeAnalyses":[{"isMostAccurate":true,"speed":1200,"enlilList":[{"estimatedShockArrivalTime":"2026-10-03T06:00Z","isEarthGB":true}]}]}]');
  const events = parseDonkiCme(sample);
  assert.equal(events.filter((e) => e.type === "cme").length, 2);
  const arrival = events.find((e) => e.type === "cme-arrival");
  assert.equal(arrival?.timestamp, Date.UTC(2026, 9, 3, 6));
  assert.ok(events.every((e) => !/caused|confirmed/i.test(e.description)));
});

test("NMDB ascii (Jungfraujoch)", () => {
  const text = `#      DATA TYPE: corr_for_efficiency(RCORR_E)\n#\n  start_date_time   RCORR_E\n2026-10-04 02:00:00;154.548\n2026-10-04 03:00:00;154.848\n2026-10-04 04:00:00;null\n2026-10-04 05:00:00;154.665\n</pre>`;
  const points = parseNmdbAscii(text);
  assert.deepEqual(points.map((p) => p.v), [154.548, 154.848, 154.665]);
  assert.equal(points[0].t, Date.UTC(2026, 9, 4, 2));
});

test("Open-Meteo: unixtime, past only, surface pressure", () => {
  const now = Date.UTC(2026, 9, 4, 9);
  const json = { elevation: 432, current: { time: now / 1000 - 600, surface_pressure: 964.7 }, hourly: { time: [now / 1000 - 7200, now / 1000 - 3600, now / 1000 + 3600], surface_pressure: [965.9, 965.1, 964.0] } };
  const parsed = parseOpenMeteo(json, now);
  assert.equal(parsed.series.length, 2, "forecast hour is dropped");
  assert.equal(parsed.current?.pressureHpa, 964.7);
  assert.equal(parsed.elevationM, 432);
});

test("pulse analysis: baseline, FWHM, area and morphology", () => {
  const dt = 1e6 / 48_000; // 20.8 µs
  const pre = Array(16).fill(0.001);
  const pulse = [0.001, -0.01, -0.04, -0.08, -0.06, -0.035, -0.02, -0.01, -0.004, 0.001, 0.001, 0.001];
  const samples = [...pre, ...pulse, ...Array(40).fill(0.001)];
  const result = analyzePulse(samples, { polarity: "negative", noiseSigma: 0.002, samplePeriodUs: dt });
  assert.ok(Math.abs(result.baseline - 0.001) < 1e-9);
  assert.ok(Math.abs(result.peak - 0.081) < 1e-9);
  assert.equal(result.orientation, -1);
  assert.ok(result.fwhmUs > dt && result.fwhmUs < 5 * dt, `fwhm ${result.fwhmUs}`);
  assert.ok(result.area > 0);
  const manual = integrate(samples, result.baseline, -1, result.startIndex, result.endIndex, dt);
  assert.equal(result.area, manual);
  // narrowing the window reduces the area
  const narrower = analyzePulse(samples, { polarity: "negative", noiseSigma: 0.002, samplePeriodUs: dt, window: [result.peakIndex - 1, result.peakIndex + 1] });
  assert.ok(narrower.area < result.area);
  const double = [...pre, 0, -0.05, -0.08, -0.03, -0.005, -0.03, -0.07, -0.05, 0, ...Array(30).fill(0)];
  assert.ok(analyzePulse(double, { polarity: "negative", samplePeriodUs: dt, noiseSigma: 0.002 }).shapes.includes("DOUBLE"));
  const clipped = [...pre, -0.2, -0.99, -0.99, -0.99, -0.99, -0.99, -0.3, 0, ...Array(30).fill(0)];
  assert.equal(analyzePulse(clipped, { polarity: "negative", samplePeriodUs: dt }).primaryShape, "SATURATED");
});

test("coincidences and accidental rate", () => {
  const clusters = findCoincidences([{ stationId: "a", name: "A", times: [1000, 5000] }, { stationId: "b", name: "B", times: [1200, 9000] }], 500);
  assert.equal(clusters.length, 1); assert.equal(clusters[0].spanMs, 200);
  assert.ok(Math.abs(accidentalRateHz([0.05, 0.05], 0.5) - 0.0025) < 1e-12);
});

test("pressure correction is off unless configured", () => {
  assert.equal(correctRate(4, 970, 960, DEFAULT_CORRECTION), null);
  const cfg = { ...DEFAULT_CORRECTION, barometricCoefficient: -0.15, pressureCorrectionEnabled: true, correctionCalibrationStatus: "PROVISIONAL" as const };
  const corrected = correctRate(4, 970, 960, cfg) as number;
  assert.ok(corrected > 4, "higher pressure → corrected rate is raised");
  assert.ok(Math.abs(corrected / 4 - Math.exp(0.015)) < 1e-12);
});

test("β estimation recovers a synthetic coefficient", () => {
  const bins = Array.from({ length: 120 }, (_, i) => {
    const p = 955 + 15 * Math.sin(i / 9);
    const expected = 3600 * 3 * Math.exp(-0.002 * (p - 960)); // β = −0.2 %/hPa, 3 Hz
    return { count: Math.round(expected), exposureS: 3600, pressureHpa: p };
  });
  const estimate = estimateBeta(bins);
  assert.ok(estimate && Math.abs(estimate.betaPctPerHpa + 0.2) < 0.01, JSON.stringify(estimate));
  assert.ok(estimate?.usable);
});

function hourly(now: number, hours: number, fn: (i: number) => number): TimePoint[] {
  return Array.from({ length: hours }, (_, i) => ({ t: now - (hours - i) * 3_600_000, v: fn(i) }));
}

const quietSpace = { kpNow: 2, kpMax24h: 2.3, protons10: 0.3, protons100: 0.2, xrayMax24h: 5e-7, recentEvents: [] };

function bins(now: number, rate: (h: number) => number): DetectorState[] {
  return Array.from({ length: 48 }, (_, i) => {
    const t = now - (48 - i) * 3_600_000; const count = Math.round(rate(i) * 60);
    return { timestamp: t, binMinutes: 60, count, exposureS: 3600, rate: rate(i) };
  });
}

test("interpretation: CASE A atmospheric, CASE B regional, CASE C local, insufficient data", () => {
  const now = Date.UTC(2026, 9, 4, 12);
  const pressureUp = hourly(now, 48, (i) => (i >= 47 ? 975 : 960));
  const flatPressure = hourly(now, 48, () => 962);
  const decrease = bins(now, (i) => (i >= 47 ? 975 : 1000)); // −2.5 % (large-area detector statistics)
  const jungFlat: ReferenceStation = { code: "JUNG", name: "Jungfraujoch", altitudeM: 3475, cutoffGV: 4.5, operator: "", ok: true, series: hourly(now, 48, () => 155) };
  const jungDown: ReferenceStation = { ...jungFlat, series: hourly(now, 48, (i) => (i >= 47 ? 152 : 155)) };
  const run = (b: DetectorState[], p: TimePoint[], jung: ReferenceStation) => {
    const local = compareLocal(b, now, 24 * 3_600_000, p, null, DEFAULT_CORRECTION, true);
    return interpret({ now, local, pressure: pressureContext(p, now, local.windowMs, 24 * 3_600_000), jung: { code: "JUNG", name: "Jungfraujoch", pct: seriesDeviation(jung.series, now, 3_600_000, 24 * 3_600_000)?.pct ?? null, lastTime: now, lagMs: 0, ok: true }, others: [], space: quietSpace, correction: DEFAULT_CORRECTION, signalQuality: { acceptedFraction: 0.8, clipping: false } });
  };
  assert.equal(run(decrease, pressureUp, jungFlat).classification, "ATMOSPHERIC EFFECT");
  assert.equal(run(decrease, flatPressure, jungDown).classification, "REGIONAL COSMIC VARIATION");
  const spike = bins(now, (i) => (i >= 47 ? 1050 : 1000));
  const local = run(spike, flatPressure, jungFlat);
  assert.equal(local.classification, "LOCAL ANOMALY");
  assert.ok(/Inspect detector pulse shape/.test(local.explanation));
  const sparse = bins(now, () => 0.05);
  assert.equal(run(sparse, flatPressure, jungFlat).classification, "INSUFFICIENT DATA");
  for (const result of [run(decrease, pressureUp, jungFlat), local]) {
    assert.ok(!/caused|confirmed|definitely/i.test(result.explanation + result.narrative.join(" ")));
  }
});

test("rolling deviation, temporal overlap and Forbush candidates", () => {
  const now = Date.UTC(2026, 9, 4, 12);
  const s = hourly(now, 30, (i) => (i === 29 ? 110 : 100));
  assert.ok(Math.abs((rollingDeviation(s, 24 * 3_600_000).at(-1)?.v ?? 0) - 10) < 1e-9);
  const overlaps = temporalOverlaps(now, [{ id: "f", timestamp: now - 10 * 60_000, type: "solar-flare", severity: "minor", source: "NOAA SWPC", title: "M1", description: "" }, { id: "g", timestamp: now - 2 * 3_600_000, type: "solar-flare", severity: "minor", source: "NOAA SWPC", title: "M2", description: "" }]);
  assert.equal(overlaps.length, 1);
  const station = (code: string): ReferenceStation => ({ code, name: code, altitudeM: 0, cutoffGV: 1, operator: "", ok: true, series: hourly(now, 96, (i) => (i > 90 ? 95 : 100)) });
  const events = referenceEvents([station("JUNG"), station("OULU")], now);
  assert.equal(events[0]?.type, "forbush-candidate");
});
