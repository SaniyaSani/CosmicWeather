# Invisible Weather

An open particle-sensing and citizen-science instrument with two layers of one system:
**Cosmic Rain** (SKY, dark) and **Breathing Buildings** (AIR, light). Built for **OpSciHack 2026 — Making the Invisible Visible**.

```
YOUR DETECTOR ↔ ATMOSPHERE ↔ JUNGFRAUJOCH ↔ SUN
```

## Navigation

| View | Content |
|---|---|
| `#sky` | Hero air-shower observation, CALIBRATE control, live signal with integration area, detector status, recent / top signals |
| `#buildings` | Breathing Buildings (light layer): airflow section, decay protocol |
| `#signal` | Calibration lab, filter stack, input calibration (mV/FS), signal archive, shape taxonomy, coincidence view |
| `#build` | V1.2 detector build guide |
| `#data` | **Cosmic Weather** observatory + citizen network map |
| `#about` | Particle journey, measured / derived / estimated legend, credits |

`CHANGE LAYER` switches SKY ↔ AIR (black ↔ white over ~0.9 s).

## Cosmic Weather — data sources

| Source | Endpoint (server-side) | Key | Cache |
|---|---|---|---|
| Surface pressure, T, RH | Open-Meteo `surface_pressure` (not sea-level) | none | 10 min |
| Planetary Kp | NOAA SWPC `products/noaa-planetary-k-index.json` | none | 2 min |
| GOES X-rays, protons, flares, alerts | NOAA SWPC `json/goes/primary/*` | none | 2 min |
| CME / FLR / SEP / IPS / GST | NASA CCMC DONKI `https://ccmc.gsfc.nasa.gov/DONKI-API/get/*` (moved there on 2026-09-30) | none | 30 min |
| Jungfraujoch + LMKS, KIEL2, OULU, ROME | NMDB NEST ascii, `corr_for_efficiency`, hourly | none | 10 min |

All upstream calls go through `app/api/cosmic/*` (Cloudflare Worker). Each route caches in memory and in the
Workers Cache API, serves stale data with `stale: true` for hours if an upstream fails, and never blocks the
other feeds. The browser keeps the last good payloads in `localStorage` and labels them **STALE / OFFLINE**.

### Code map

```
lib/cosmic/
  config.ts             intervals, staleness thresholds, NMDB stations, provisional β
  types.ts              CosmicEvent, EnvironmentalState, DetectorState, ReferenceDetectorState …
  parsers.ts            pure upstream → model parsers (unit-tested with real samples)
  server/services.ts    weatherService, noaaService, nasaDonkiService, nmdbService
  server/http.ts        bounded fetch + two-level cache + stale fallback
  detector-store.ts     detectorService: per-minute counts + live exposure (localStorage)
  pressure.ts           barometric correction + β estimation from your own data
  interpretation.ts     cosmicInterpretationService, confidence, temporal overlap, Forbush/GLE candidates
  use-cosmic-weather.ts client polling, offline cache, source status
  dev-fixtures.ts       DEVELOPMENT ONLY synthetic data (?cw-fixtures=1, ?cw-fail=space,reference)
lib/signal/              pulse analysis (baseline, FWHM, integration area, shape classes), archive, coincidence
components/cosmic-weather/   DATA page UI and shared timeline
components/iw/               visual system: hero, annotations, waveform, inspector, airflow …
```

### Pressure correction

`N_corr = N · exp(−β · (P − P_ref))`, β in %/hPa. Defaults: `UNCALIBRATED`, correction off — raw data only.
Configure in DATA → PRESSURE CORRECTION (`referencePressure`, `barometricCoefficient`,
`pressureCorrectionEnabled`, `correctionCalibrationStatus`). A literature-typical β = −0.15 %/hPa is available
only as a **PROVISIONAL** preset. **CALIBRATED** requires the built-in weighted fit of ln(rate) vs pressure on your
own Ambient-sky data (≥ 48 h, ≥ 2000 counts, ≥ 8 hPa range, |β| ≥ 3σ).

### Plugging in a local barometer (BMP390 / BME280)

1. Apply migration `drizzle/0001_environment_readings.sql`.
2. Set the Worker secret `SENSOR_INGEST_TOKEN` (never exposed to the browser).
3. POST readings (e.g. every minute from an ESP32 / Raspberry Pi):

```http
POST /api/cosmic/environment
Authorization: Bearer <SENSOR_INGEST_TOKEN>
Content-Type: application/json

{ "stationId": "station-xxxx", "sensorId": "bmp390-1", "pressureHpa": 964.7,
  "temperatureC": 21.3, "humidityPct": 41, "measuredAt": 1791100000000 }
```

`stationId` is the browser's detector id (shown after *Join the network*). While the newest reading is < 20 min
old, `GET /api/cosmic/environment?station=…` returns `source: "sensor"` and the sensor series replaces Open-Meteo in
the timeline, correction and interpretation (tagged MEASURED instead of MODEL).

## Scientific wording

Every number is tagged **M** measured, **D** derived, **E** estimated, **S** setting, or **—** unavailable.
Amplitudes are in mFS (1/1000 of sound-card full scale) unless an input calibration (mV per FS) is entered.
Pulse area is never called energy. Space-weather events are shown as *temporal overlap*, never as causes.

## Tests

```bash
npx tsx --test tests/*.test.ts     # parsers, analysis, interpretation, adapters with mocked upstream
```

## Local development

```bash
pnpm install
pnpm dev            # add ?cw-fixtures=1 to the URL for synthetic Cosmic Weather data (dev builds only)
```

## Network API

- `GET /api/network` — active stations seen in the last 15 minutes
- `GET /api/network?events=1` — real (audio) event timestamps per station, last 10 minutes (coincidence view)
- `POST /api/network` — submit an opted-in detector event

Data: NMDB (www.nmdb.eu, EU FP7 contract 213007) and the PIs of the neutron monitors, including IGY Jungfraujoch
(Physikalisches Institut, University of Bern); NOAA SWPC; NASA CCMC DONKI; Open-Meteo.com (CC BY 4.0).
Detector design: Oliver Keller, DIY Particle Detector V1.2 (CERN OHL).
