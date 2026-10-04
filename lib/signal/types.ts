export type PulseMetrics = {
  peak: number; area: number; signedArea: number; widthMs: number; snr: number;
  polarity: "positive" | "negative"; sampleRate: number; quality: number;
};

export type PulseRecord = PulseMetrics & {
  id: number; at: number; accepted: boolean; reason: string;
  source: "demo" | "audio"; samples: number[];
  /** Time between stored samples (µs). Stored waveforms can be decimated. */
  samplePeriodUs?: number;
  clipped?: boolean;
  /** Detector mode at capture time (electron, sky, air, alpha, explore). */
  mode?: string;
  /** Calibrated noise σ (FS) and trigger threshold (FS) at capture time. */
  noise?: number;
  threshold?: number;
  inputLabel?: string;
};

export type RayEvent = { id: number; at: number; signal: number; source: "demo" | "audio"; metrics?: PulseMetrics };

export type Station = { id: string; name: string; latitude: number; longitude: number; events: number; lastSeen: number; sample?: boolean };

export type ThresholdPoint = { sigma: number; rate: number };

export function samplePeriodOf(pulse: PulseRecord) {
  return pulse.samplePeriodUs ?? 1e6 / (pulse.sampleRate || 48_000);
}
