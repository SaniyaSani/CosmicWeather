/** Central configuration for Cosmic Weather. Nothing here is secret. */

export const DEFAULT_LOCATION = { latitude: 47.3769, longitude: 8.5417, name: "Zürich" };

/** Client polling intervals (ms). Server routes cache for at least as long. */
export const POLL_MS = {
  detectorTick: 10_000,
  environment: 10 * 60_000,
  space: 2 * 60_000,
  reference: 10 * 60_000,
  events: 30 * 60_000,
} as const;

/** Server-side cache lifetimes (ms) and how long stale data may still be served after an upstream failure. */
export const CACHE_MS = {
  environment: { ttl: 10 * 60_000, staleMax: 6 * 3_600_000 },
  space: { ttl: 2 * 60_000, staleMax: 6 * 3_600_000 },
  reference: { ttl: 10 * 60_000, staleMax: 24 * 3_600_000 },
  events: { ttl: 30 * 60_000, staleMax: 48 * 3_600_000 },
} as const;

/**
 * Age of the newest *data point* after which a source is shown as STALE.
 * These reflect each feed's natural cadence plus a margin.
 */
export const STALE_AFTER_MS = {
  detector: 2 * 60_000,
  pressure: 2.5 * 3_600_000, // Open-Meteo "current" is model-based, updated every 15 min; hourly series lag ~1 h.
  "noaa-xray": 20 * 60_000,
  "noaa-protons": 30 * 60_000,
  "noaa-kp": 6 * 3_600_000, // planetary Kp is a 3-hour index
  "noaa-alerts": 7 * 24 * 3_600_000,
  nmdb: 3 * 3_600_000,
  donki: 26 * 3_600_000,
} as const;

export const REFERENCE_STATIONS = [
  { code: "JUNG", name: "Jungfraujoch", altitudeM: 3475, cutoffGV: 4.5, operator: "Physikalisches Institut, University of Bern", primary: true },
  { code: "LMKS", name: "Lomnický štít", altitudeM: 2634, cutoffGV: 3.8, operator: "IEP SAS Košice" },
  { code: "KIEL2", name: "Kiel", altitudeM: 54, cutoffGV: 2.4, operator: "University of Kiel" },
  { code: "OULU", name: "Oulu", altitudeM: 15, cutoffGV: 0.8, operator: "University of Oulu" },
  { code: "ROME", name: "Rome", altitudeM: 0, cutoffGV: 6.3, operator: "INAF / Roma Tre" },
] as const;

export const BASELINE_OPTIONS = [
  { id: "1h", label: "1 H", ms: 3_600_000 },
  { id: "6h", label: "6 H", ms: 6 * 3_600_000 },
  { id: "24h", label: "24 H", ms: 24 * 3_600_000 },
  { id: "7d", label: "7 D", ms: 7 * 24 * 3_600_000 },
] as const;
export type BaselineId = (typeof BASELINE_OPTIONS)[number]["id"];

/** Minimum statistics before the local detector is used in any conclusion. */
export const LOCAL_MIN = { windowCounts: 30, baselineCounts: 120, baselineCoverage: 0.5, significanceZ: 3 } as const;

/** Thresholds for neutron-monitor variations (pressure-corrected NMDB data). */
export const REFERENCE_MIN = { changePct: 1.0, strongChangePct: 3.0 } as const;

/**
 * A literature-typical barometric coefficient for ground-level muons. It is
 * ONLY used for the plausibility check "could pressure explain this?" and as
 * an explicit, labelled PROVISIONAL preset. It is not a calibration of this detector.
 */
export const PROVISIONAL_BETA_PCT_PER_HPA = -0.15;

export const SOURCE_LINKS = {
  pressure: { href: "https://open-meteo.com/", attribution: "Open-Meteo (CC BY 4.0)" },
  noaa: { href: "https://www.swpc.noaa.gov/", attribution: "NOAA SWPC" },
  donki: { href: "https://ccmc.gsfc.nasa.gov/tools/DONKI/", attribution: "NASA CCMC DONKI" },
  nmdb: { href: "https://www.nmdb.eu/", attribution: "NMDB · IGY Jungfraujoch (University of Bern)" },
} as const;

export const NMDB_ACKNOWLEDGEMENT =
  "We acknowledge the NMDB database (www.nmdb.eu), founded under the European Union's FP7 programme (contract no. 213007), for providing data, and the PIs of the individual neutron monitors, including IGY Jungfraujoch (Physikalisches Institut, University of Bern, Switzerland).";
