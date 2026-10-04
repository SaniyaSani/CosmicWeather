/**
 * Waveform analysis for detector pulses.
 *
 * Everything here works on the *relative* audio-input scale (full scale, FS),
 * because the detector reaches the browser through a sound card. Values are
 * only shown in millivolts when the user has entered an input calibration
 * (see `InputCalibration`), and are then labelled DERIVED.
 */

export type Polarity = "positive" | "negative" | "either";

export type ShapeClass = "SHARP" | "BROAD" | "DOUBLE" | "ASYMMETRIC" | "SATURATED" | "NOISY" | "REGULAR";

export const SHAPE_DESCRIPTIONS: Record<ShapeClass, string> = {
  SHARP: "Narrow single peak — FWHM at most ~3 samples / 120 µs.",
  BROAD: "Wide pulse — FWHM of at least ~10 samples / 300 µs.",
  DOUBLE: "Two separated maxima above half height with a clear dip between them.",
  ASYMMETRIC: "Fall time more than 6× the rise time (or the reverse).",
  SATURATED: "Flat or clipped top: the input range was exceeded.",
  NOISY: "Large excursions outside the pulse window; the baseline is not quiet.",
  REGULAR: "Single peak between the sharp and broad limits.",
};

/** Shape classes are morphology only. They do not identify a particle type. */
export const SHAPE_ORDER: ShapeClass[] = ["SHARP", "REGULAR", "BROAD", "DOUBLE", "ASYMMETRIC", "SATURATED", "NOISY"];

export type PulseAnalysis = {
  /** Residual baseline from the pre-trigger samples (FS). MEASURED. */
  baseline: number;
  /** Robust spread of the pre-trigger samples (FS). MEASURED. */
  baselineSigma: number;
  /** Peak height above baseline in the expected polarity (FS). MEASURED. */
  peak: number;
  peakIndex: number;
  /** Signed value at the peak (FS), useful for drawing. */
  signedPeak: number;
  /** Full width at half maximum in µs. DERIVED from samples (linear interpolation). */
  fwhmUs: number;
  fwhmStart: number;
  fwhmEnd: number;
  riseUs: number;
  fallUs: number;
  /** Integration window (sample indices, inclusive). */
  startIndex: number;
  endIndex: number;
  /** Area between waveform and baseline inside the window (FS·µs). DERIVED. */
  area: number;
  /** Peak / noise σ. DERIVED. */
  snr: number;
  samplePeriodUs: number;
  shapes: ShapeClass[];
  primaryShape: ShapeClass;
  orientation: 1 | -1;
};

export type AnalyzeOptions = {
  polarity: Polarity;
  /** Noise σ from calibration (FS). Falls back to the pre-trigger spread. */
  noiseSigma?: number;
  preTrigger?: number;
  clipped?: boolean;
  samplePeriodUs: number;
  /** Optional user-chosen integration window [start, end] in sample indices. */
  window?: [number, number];
};

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mad(values: number[]) {
  if (values.length < 2) return 0;
  const centre = median(values);
  return 1.4826 * median(values.map((value) => Math.abs(value - centre)));
}

/** Area between the waveform and the baseline over [start, end] using the trapezoid rule (FS·µs). */
export function integrate(samples: number[], baseline: number, orientation: 1 | -1, start: number, end: number, samplePeriodUs: number) {
  const a = Math.max(0, Math.min(samples.length - 1, Math.round(Math.min(start, end))));
  const b = Math.max(0, Math.min(samples.length - 1, Math.round(Math.max(start, end))));
  let area = 0;
  for (let index = a; index < b; index += 1) {
    const left = orientation * (samples[index] - baseline);
    const right = orientation * (samples[index + 1] - baseline);
    area += ((left + right) / 2) * samplePeriodUs;
  }
  return area;
}

export function analyzePulse(samples: number[], options: AnalyzeOptions): PulseAnalysis {
  const dt = options.samplePeriodUs;
  const pre = Math.max(4, Math.min(options.preTrigger ?? 16, Math.floor(samples.length / 4)));
  const preSamples = samples.slice(0, pre);
  const baseline = median(preSamples);
  const baselineSigma = mad(preSamples);
  const centred = samples.map((value) => value - baseline);

  let orientation: 1 | -1 = options.polarity === "negative" ? -1 : 1;
  if (options.polarity === "either") {
    const extreme = centred.reduce((best, value) => (Math.abs(value) > Math.abs(best) ? value : best), 0);
    orientation = extreme < 0 ? -1 : 1;
  }
  const oriented = centred.map((value) => value * orientation);

  let peakIndex = 0;
  for (let index = 1; index < oriented.length; index += 1) if (oriented[index] > oriented[peakIndex]) peakIndex = index;
  const peak = Math.max(0, oriented[peakIndex] ?? 0);
  const noise = Math.max(options.noiseSigma ?? 0, baselineSigma, 1e-7);

  // FWHM with linear interpolation of the half-height crossings.
  const half = peak / 2;
  let left = peakIndex;
  while (left > 0 && oriented[left] > half) left -= 1;
  let right = peakIndex;
  while (right < oriented.length - 1 && oriented[right] > half) right += 1;
  const interp = (i0: number, i1: number) => {
    const v0 = oriented[i0]; const v1 = oriented[i1];
    if (v1 === v0) return i0;
    return i0 + (half - v0) / (v1 - v0) * (i1 - i0);
  };
  const fwhmStart = left === peakIndex ? peakIndex - 0.5 : interp(left, left + 1);
  const fwhmEnd = right === peakIndex ? peakIndex + 0.5 : interp(right - 1, right);
  const fwhmUs = Math.max(0, (fwhmEnd - fwhmStart) * dt);

  // Rise (10 → 90 %) and fall (90 → 10 %) times.
  const level = (fraction: number, direction: -1 | 1) => {
    let index = peakIndex;
    while (index > 0 && index < oriented.length - 1 && oriented[index] > peak * fraction) index += direction;
    return index;
  };
  const riseUs = Math.max(dt * 0.5, (peakIndex - level(0.1, -1)) * dt);
  const fallUs = Math.max(dt * 0.5, (level(0.1, 1) - peakIndex) * dt);

  // Automatic integration window: walk out from the peak until the signal has
  // returned to the baseline (below max(5 % of peak, 1σ) for 2 samples).
  const floor = Math.max(peak * 0.05, noise);
  let autoStart = peakIndex;
  while (autoStart > 0 && !(oriented[autoStart] <= floor && oriented[autoStart - 1] <= floor)) autoStart -= 1;
  let autoEnd = peakIndex;
  while (autoEnd < oriented.length - 1 && !(oriented[autoEnd] <= floor && oriented[autoEnd + 1] <= floor)) autoEnd += 1;
  const startIndex = options.window ? Math.max(0, Math.min(options.window[0], options.window[1])) : autoStart;
  const endIndex = options.window ? Math.min(samples.length - 1, Math.max(options.window[0], options.window[1])) : autoEnd;
  const area = integrate(samples, baseline, orientation, startIndex, endIndex, dt);

  // --- Morphology -----------------------------------------------------------
  const shapes: ShapeClass[] = [];
  let flatTop = 0;
  for (let index = Math.max(0, peakIndex - 6); index <= Math.min(oriented.length - 1, peakIndex + 6); index += 1) {
    if (oriented[index] >= peak * 0.985) flatTop += 1;
  }
  if (options.clipped || (peak > 0 && flatTop >= 4)) shapes.push("SATURATED");

  const outside = oriented.filter((_, index) => index < autoStart - 2 || index > autoEnd + 2);
  const outsideMax = outside.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const outsideRms = outside.length ? Math.sqrt(outside.reduce((sum, value) => sum + value * value, 0) / outside.length) : 0;
  if (peak > 0 && (outsideRms > peak * 0.18 || outsideMax > peak * 0.6)) shapes.push("NOISY");

  // Double: two maxima ≥ 50 % of peak, ≥ 2 samples apart, separated by a dip.
  const smooth = oriented.map((value, index) => ((oriented[index - 1] ?? value) + value * 2 + (oriented[index + 1] ?? value)) / 4);
  const maxima: number[] = [];
  for (let index = 1; index < smooth.length - 1; index += 1) {
    if (smooth[index] >= peak * 0.45 && smooth[index] >= smooth[index - 1] && smooth[index] > smooth[index + 1]) maxima.push(index);
  }
  for (let a = 0; a < maxima.length && !shapes.includes("DOUBLE"); a += 1) {
    for (let b = a + 1; b < maxima.length; b += 1) {
      if (maxima[b] - maxima[a] < 3) continue;
      const dip = Math.min(...smooth.slice(maxima[a], maxima[b] + 1));
      if (dip < Math.min(smooth[maxima[a]], smooth[maxima[b]]) * 0.6) { shapes.push("DOUBLE"); break; }
    }
  }

  const sharpLimit = Math.max(120, 3 * dt);
  const broadLimit = Math.max(300, 10 * dt);
  if (fwhmUs >= broadLimit) shapes.push("BROAD");
  else if (fwhmUs <= sharpLimit) shapes.push("SHARP");
  const ratio = fallUs / Math.max(riseUs, 1e-9);
  if ((ratio > 6 || ratio < 1 / 6) && fwhmUs > 2 * dt) shapes.push("ASYMMETRIC");

  const priority: ShapeClass[] = ["SATURATED", "NOISY", "DOUBLE", "BROAD", "ASYMMETRIC", "SHARP"];
  const primaryShape = priority.find((shape) => shapes.includes(shape)) ?? "REGULAR";
  if (!shapes.length) shapes.push("REGULAR");

  return {
    baseline, baselineSigma, peak, peakIndex, signedPeak: centred[peakIndex] ?? 0,
    fwhmUs, fwhmStart, fwhmEnd, riseUs, fallUs,
    startIndex, endIndex, area, snr: peak / noise, samplePeriodUs: dt,
    shapes, primaryShape, orientation,
  };
}

// --- Units -------------------------------------------------------------------

/** Optional conversion from audio full scale to millivolts at the detector output. */
export type InputCalibration = { mvPerFs: number | null; note?: string; calibratedAt?: number };

export function amplitudeUnit(cal: InputCalibration) { return cal.mvPerFs ? "mV" : "mFS"; }
export function toDisplayAmplitude(fs: number, cal: InputCalibration) { return cal.mvPerFs ? fs * cal.mvPerFs : fs * 1000; }
export function areaUnit(cal: InputCalibration) { return `${amplitudeUnit(cal)}·µs`; }

export function formatNumber(value: number, digits = 3) {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 100) return value.toFixed(Math.max(0, digits - 3));
  if (abs >= 10) return value.toFixed(Math.max(0, digits - 2));
  if (abs >= 1) return value.toFixed(Math.max(0, digits - 1));
  return value.toPrecision(Math.max(1, digits));
}

export function formatDuration(us: number) {
  if (!Number.isFinite(us)) return "—";
  if (us >= 2000) return `${(us / 1000).toFixed(2)} ms`;
  return `${us.toFixed(us >= 100 ? 0 : 1)} µs`;
}

export function eventCode(id: number) {
  return `#IW-${String(Math.floor(id)).slice(-8).padStart(8, "0")}`;
}
