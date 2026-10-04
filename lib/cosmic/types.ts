/** Normalised internal data model for the Cosmic Weather system. */

export type SourceId = "detector" | "pressure" | "noaa-xray" | "noaa-kp" | "noaa-protons" | "noaa-alerts" | "nmdb" | "donki";

export type SourceState = "live" | "updated" | "stale" | "unavailable" | "loading" | "offline" | "not-connected";

export type SourceStatus = {
  id: SourceId;
  label: string;
  state: SourceState;
  /** Timestamp of the newest data point (ms, UTC). */
  dataTime: number | null;
  /** When we last received a response (ms, UTC). */
  fetchedAt: number | null;
  message?: string;
  href: string;
  attribution: string;
};

export type EnvironmentalState = {
  timestamp: number;
  pressureHpa: number | null;
  temperatureC?: number | null;
  humidityPct?: number | null;
  source: "open-meteo" | "sensor";
  sensorId?: string;
};

export type DetectorState = {
  timestamp: number;
  binMinutes: number;
  count: number;
  exposureS: number;
  /** Events per minute (count / exposure). */
  rate: number | null;
  pressureHpa?: number | null;
  correctedRate?: number | null;
  baselineDeviation?: number | null;
};

export type ReferenceDetectorState = {
  timestamp: number;
  station: string;
  value: number;
  normalizedRate?: number;
  baselineDeviation?: number | null;
};

export type CosmicEventType =
  | "solar-flare" | "cme" | "cme-arrival" | "sep" | "ips" | "geomagnetic-storm" | "kp"
  | "alert" | "forbush-candidate" | "gle-candidate" | "reference-variation" | "local-anomaly";

export type Severity = "info" | "minor" | "moderate" | "strong" | "extreme";

export type CosmicEvent = {
  id: string;
  timestamp: number;
  endTime?: number | null;
  type: CosmicEventType;
  severity: Severity;
  source: "NOAA SWPC" | "NASA DONKI" | "NMDB" | "Local detector";
  title: string;
  description: string;
  estimatedArrival?: number | null;
  link?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type TimePoint = { t: number; v: number };

export type ReferenceStation = {
  code: string;
  name: string;
  altitudeM: number;
  cutoffGV: number;
  operator: string;
  series: TimePoint[];
  ok: boolean;
  error?: string;
};

export type EnvironmentPayload = {
  fetchedAt: number;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  series: EnvironmentalState[];
  current: EnvironmentalState | null;
  sensor: EnvironmentalState | null;
  sensorSeries: EnvironmentalState[];
  source: "open-meteo" | "sensor";
  stale?: boolean;
  error?: string;
};

export type FeedStatus = { ok: boolean; stale?: boolean; error?: string; fetchedAt: number | null };

export type SpacePayload = {
  fetchedAt: number;
  kp: { series: TimePoint[]; status: FeedStatus };
  xray: { series: TimePoint[]; status: FeedStatus };
  protons: { series10: TimePoint[]; series100: TimePoint[]; status: FeedStatus };
  flares: { events: CosmicEvent[]; status: FeedStatus };
  alerts: { events: CosmicEvent[]; status: FeedStatus };
};

export type ReferencePayload = { fetchedAt: number; stations: ReferenceStation[]; stale?: boolean };

export type EventsPayload = { fetchedAt: number; events: CosmicEvent[]; status: FeedStatus };

export type Classification =
  | "NORMAL" | "ATMOSPHERIC EFFECT" | "LOCAL ANOMALY" | "REGIONAL COSMIC VARIATION"
  | "POSSIBLE SPACE-WEATHER EVENT" | "INSUFFICIENT DATA";

export type Confidence = "LOW" | "MEDIUM" | "HIGH";
