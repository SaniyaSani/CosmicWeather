import type { TimePoint } from "./types";

export function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function std(values: number[]) {
  const m = mean(values);
  if (m === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
}

export function inRange(series: TimePoint[], from: number, to: number) {
  return series.filter((point) => point.t >= from && point.t < to);
}

/** Linear interpolation of a series at time t; null outside the series (with a tolerance). */
export function interpolate(series: TimePoint[], t: number, toleranceMs = 2 * 3_600_000) {
  if (!series.length) return null;
  if (t <= series[0].t) return series[0].t - t <= toleranceMs ? series[0].v : null;
  const last = series[series.length - 1];
  if (t >= last.t) return t - last.t <= toleranceMs ? last.v : null;
  let lo = 0; let hi = series.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (series[mid].t <= t) lo = mid; else hi = mid; }
  const a = series[lo]; const b = series[hi];
  if (b.t - a.t > toleranceMs * 2) return null;
  return a.v + (b.v - a.v) * ((t - a.t) / (b.t - a.t));
}

export type Deviation = { pct: number; baseline: number; current: number; z: number | null; n: number; nBaseline: number };

/**
 * Percent deviation of the mean of [now − window, now) from the mean of the
 * baseline period [now − window − baseline, now − window).
 */
export function seriesDeviation(series: TimePoint[], now: number, windowMs: number, baselineMs: number): Deviation | null {
  const recent = inRange(series, now - windowMs, now + 1).map((point) => point.v);
  const base = inRange(series, now - windowMs - baselineMs, now - windowMs).map((point) => point.v);
  if (!recent.length || base.length < 3) return null;
  const current = mean(recent) as number; const baseline = mean(base) as number;
  if (!baseline) return null;
  const sd = std(base);
  return { pct: ((current - baseline) / baseline) * 100, baseline, current, z: sd ? (current - baseline) / (sd / Math.sqrt(Math.max(1, recent.length))) : null, n: recent.length, nBaseline: base.length };
}

/** Rolling percentage deviation for every point using a trailing baseline window. */
export function rollingDeviation(series: TimePoint[], baselineMs: number, minPoints = 3): TimePoint[] {
  const out: TimePoint[] = [];
  let start = 0; let sum = 0;
  for (let index = 0; index < series.length; index += 1) {
    const point = series[index];
    while (start < index && series[start].t < point.t - baselineMs) { sum -= series[start].v; start += 1; }
    const count = index - start;
    if (count >= minPoints) {
      const baseline = sum / count;
      if (baseline) out.push({ t: point.t, v: ((point.v - baseline) / baseline) * 100 });
    }
    sum += point.v;
  }
  return out;
}

/** Weighted least squares y = a + b·x. Returns slope, its standard error and the weighted correlation. */
export function weightedRegression(xs: number[], ys: number[], ws: number[]) {
  const n = xs.length;
  if (n < 3) return null;
  const W = ws.reduce((sum, w) => sum + w, 0);
  if (!W) return null;
  const mx = xs.reduce((sum, x, i) => sum + ws[i] * x, 0) / W;
  const my = ys.reduce((sum, y, i) => sum + ws[i] * y, 0) / W;
  let sxx = 0; let sxy = 0; let syy = 0;
  for (let i = 0; i < n; i += 1) { sxx += ws[i] * (xs[i] - mx) ** 2; sxy += ws[i] * (xs[i] - mx) * (ys[i] - my); syy += ws[i] * (ys[i] - my) ** 2; }
  if (!sxx) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  // With weights = 1/σ² the slope variance is 1/Sxx; inflate by the reduced χ² if the scatter is larger than Poisson.
  let chi2 = 0;
  for (let i = 0; i < n; i += 1) chi2 += ws[i] * (ys[i] - intercept - slope * xs[i]) ** 2;
  const reduced = Math.max(1, chi2 / Math.max(1, n - 2));
  return { slope, intercept, stderr: Math.sqrt(reduced / sxx), r: syy ? sxy / Math.sqrt(sxx * syy) : 0, n, xRange: Math.max(...xs) - Math.min(...xs) };
}
