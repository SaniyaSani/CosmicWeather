/**
 * Barometric correction for the local detector.
 *
 * Model: N(P) = N₀ · exp(β · (P − P_ref)), with β in %/hPa (negative for
 * secondary cosmic rays: more air above the detector → fewer particles).
 * Corrected rate: N_corr = N · exp(−β · (P − P_ref)).
 *
 * β depends on the particle species, energy threshold, altitude and detector.
 * It must be measured for THIS detector before the correction is called
 * calibrated. Until then the UI shows raw data and labels any correction
 * PROVISIONAL.
 */
import { weightedRegression } from "./stats";

export type CorrectionStatus = "UNCALIBRATED" | "PROVISIONAL" | "CALIBRATED";

export type PressureCorrectionConfig = {
  /** hPa. null → use the mean surface pressure of the loaded data. */
  referencePressure: number | null;
  /** %/hPa. null → no coefficient available. */
  barometricCoefficient: number | null;
  pressureCorrectionEnabled: boolean;
  correctionCalibrationStatus: CorrectionStatus;
  /** Uncertainty of β (%/hPa) if it was estimated from data. */
  coefficientUncertainty?: number | null;
  calibratedAt?: number | null;
  note?: string;
};

export const DEFAULT_CORRECTION: PressureCorrectionConfig = {
  referencePressure: null,
  barometricCoefficient: null,
  pressureCorrectionEnabled: false,
  correctionCalibrationStatus: "UNCALIBRATED",
  coefficientUncertainty: null,
  calibratedAt: null,
};

const KEY = "iw-pressure-correction-v1";

export function loadCorrectionConfig(): PressureCorrectionConfig {
  if (typeof window === "undefined") return DEFAULT_CORRECTION;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_CORRECTION, ...JSON.parse(raw) as Partial<PressureCorrectionConfig> } : DEFAULT_CORRECTION;
  } catch { return DEFAULT_CORRECTION; }
}

export function saveCorrectionConfig(config: PressureCorrectionConfig) {
  try { window.localStorage.setItem(KEY, JSON.stringify(config)); } catch { /* optional persistence */ }
}

export function correctionActive(config: PressureCorrectionConfig) {
  return config.pressureCorrectionEnabled && config.barometricCoefficient !== null && config.correctionCalibrationStatus !== "UNCALIBRATED";
}

export function correctRate(rate: number | null, pressureHpa: number | null | undefined, referenceHpa: number | null, config: PressureCorrectionConfig) {
  if (rate === null || pressureHpa === null || pressureHpa === undefined || referenceHpa === null || !correctionActive(config)) return null;
  const beta = (config.barometricCoefficient as number) / 100;
  return rate * Math.exp(-beta * (pressureHpa - referenceHpa));
}

/** Expected relative change (%) for a pressure change, used only for plausibility checks. */
export function expectedPressureEffectPct(deltaHpa: number, betaPctPerHpa: number) {
  return (Math.exp((betaPctPerHpa / 100) * deltaHpa) - 1) * 100;
}

export type BetaEstimate = {
  betaPctPerHpa: number;
  stderr: number;
  n: number;
  totalCounts: number;
  pressureRangeHpa: number;
  r: number;
  /** |β| / σβ ≥ 3, enough bins, enough counts and enough pressure range. */
  usable: boolean;
  reason: string;
};

/**
 * Estimate β from the detector's own hourly bins: weighted regression of
 * ln(rate) on pressure. For Poisson counts Var(ln N) ≈ 1/N, so weight = N.
 */
export function estimateBeta(bins: { count: number; exposureS: number; pressureHpa: number | null | undefined }[]): BetaEstimate | null {
  const usableBins = bins.filter((bin) => bin.count > 0 && bin.exposureS >= 600 && typeof bin.pressureHpa === "number");
  if (usableBins.length < 3) return null;
  const xs = usableBins.map((bin) => bin.pressureHpa as number);
  const ys = usableBins.map((bin) => Math.log(bin.count / bin.exposureS));
  const ws = usableBins.map((bin) => bin.count);
  const fit = weightedRegression(xs, ys, ws);
  if (!fit) return null;
  const totalCounts = usableBins.reduce((sum, bin) => sum + bin.count, 0);
  const beta = fit.slope * 100; const err = fit.stderr * 100;
  const reasons: string[] = [];
  if (fit.n < 48) reasons.push(`${fit.n}/48 hourly bins`);
  if (totalCounts < 2000) reasons.push(`${totalCounts}/2000 counts`);
  if (fit.xRange < 8) reasons.push(`pressure range ${fit.xRange.toFixed(1)}/8 hPa`);
  if (Math.abs(beta) < 3 * err) reasons.push("β not yet 3σ from zero");
  return {
    betaPctPerHpa: beta, stderr: err, n: fit.n, totalCounts, pressureRangeHpa: fit.xRange, r: fit.r,
    usable: reasons.length === 0,
    reason: reasons.length ? `Needs more data: ${reasons.join(" · ")}` : "Statistically usable estimate",
  };
}
