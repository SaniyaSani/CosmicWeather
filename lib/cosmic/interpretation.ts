/**
 * cosmicInterpretationService — deterministic, cautious classification.
 *
 * It never states causation. Its job is to say which explanation the
 * available data are *consistent with*, and how much data supports that.
 */
import { LOCAL_MIN, PROVISIONAL_BETA_PCT_PER_HPA, REFERENCE_MIN } from "./config";
import { correctionActive, expectedPressureEffectPct, type PressureCorrectionConfig } from "./pressure";
import { inRange, interpolate, mean, seriesDeviation } from "./stats";
import type { Classification, Confidence, CosmicEvent, DetectorState, ReferenceStation, TimePoint } from "./types";

export type LocalComparison = {
  live: boolean;
  sufficient: boolean;
  windowMs: number;
  countsWindow: number;
  countsBaseline: number;
  coverage: number;
  ratePerMin: number | null;
  rawPct: number | null;
  correctedPct: number | null;
  /** Corrected if a correction is active, otherwise raw. */
  pct: number | null;
  sigmaPct: number | null;
  z: number | null;
  corrected: boolean;
  status: string;
};

export function compareLocal(bins: DetectorState[], now: number, baselineMs: number, pressure: TimePoint[], referenceHpa: number | null, config: PressureCorrectionConfig, live: boolean): LocalComparison {
  const active = correctionActive(config) && referenceHpa !== null;
  const beta = (config.barometricCoefficient ?? 0) / 100;
  const sum = (from: number, to: number) => bins.filter((bin) => bin.timestamp >= from && bin.timestamp < to).reduce((acc, bin) => {
    const p = interpolate(pressure, bin.timestamp + bin.binMinutes * 30_000);
    const factor = active && p !== null ? Math.exp(-beta * (p - (referenceHpa as number))) : 1;
    return { n: acc.n + bin.count, nCorr: acc.nCorr + bin.count * factor, e: acc.e + bin.exposureS, corrOk: acc.corrOk && (!active || p !== null) };
  }, { n: 0, nCorr: 0, e: 0, corrOk: true });

  const windows = [3_600_000, 3 * 3_600_000, 6 * 3_600_000];
  let windowMs = windows[0];
  for (const candidate of windows) { windowMs = candidate; if (sum(now - candidate, now + 1).n >= LOCAL_MIN.windowCounts) break; }
  const recent = sum(now - windowMs, now + 1);
  const base = sum(now - windowMs - baselineMs, now - windowMs);
  const coverage = base.e / (baselineMs / 1000);
  const last15 = sum(now - 15 * 60_000, now + 1);
  const ratePerMin = last15.e >= 60 ? last15.n / (last15.e / 60) : recent.e >= 60 ? recent.n / (recent.e / 60) : null;
  const sufficient = recent.n >= LOCAL_MIN.windowCounts && base.n >= LOCAL_MIN.baselineCounts && coverage >= LOCAL_MIN.baselineCoverage;
  const rawPct = recent.e && base.e && base.n ? ((recent.n / recent.e) / (base.n / base.e) - 1) * 100 : null;
  const correctedPct = active && recent.corrOk && base.corrOk && recent.e && base.e && base.nCorr ? ((recent.nCorr / recent.e) / (base.nCorr / base.e) - 1) * 100 : null;
  const pct = active ? correctedPct : rawPct;
  const sigmaPct = recent.n && base.n ? Math.sqrt(1 / recent.n + 1 / base.n) * 100 : null;
  const z = pct !== null && sigmaPct ? pct / sigmaPct : null;
  let status = "Collecting baseline…";
  if (!recent.e && !base.e) status = "No local detector data in this period";
  else if (!sufficient) status = `Collecting baseline… ${base.n}/${LOCAL_MIN.baselineCounts} baseline counts · ${Math.round(coverage * 100)}% coverage`;
  else status = `${recent.n} counts in ${Math.round(windowMs / 3_600_000)} h vs ${base.n} in baseline`;
  return { live, sufficient, windowMs, countsWindow: recent.n, countsBaseline: base.n, coverage, ratePerMin, rawPct, correctedPct, pct, sigmaPct, z, corrected: active && correctedPct !== null, status };
}

export type ReferenceComparison = { code: string; name: string; pct: number | null; lastTime: number | null; lagMs: number | null; ok: boolean };

export function compareReference(station: ReferenceStation, now: number, windowMs: number, baselineMs: number): ReferenceComparison {
  const lastTime = station.series.length ? station.series[station.series.length - 1].t : null;
  // Neutron-monitor data arrive with a delay; compare the newest available window.
  const anchor = lastTime !== null ? Math.min(now, lastTime + 1) : now;
  const deviation = station.ok && lastTime !== null ? seriesDeviation(station.series, anchor, Math.max(windowMs, 3_600_000), baselineMs) : null;
  return { code: station.code, name: station.name, pct: deviation?.pct ?? null, lastTime, lagMs: lastTime !== null ? now - lastTime : null, ok: station.ok && deviation !== null };
}

export type SpaceContext = {
  kpNow: number | null;
  kpMax24h: number | null;
  protons10: number | null;
  protons100: number | null;
  xrayMax24h: number | null;
  recentEvents: CosmicEvent[];
};

export function spaceWeatherActive(space: SpaceContext) {
  const reasons: string[] = [];
  if ((space.kpMax24h ?? 0) >= 5) reasons.push(`Kp reached ${space.kpMax24h?.toFixed(1)} in the last 24 h`);
  if ((space.protons10 ?? 0) >= 10) reasons.push(`≥10 MeV proton flux ${space.protons10?.toFixed(1)} pfu (S1+)`);
  if ((space.xrayMax24h ?? 0) >= 5e-5) reasons.push("strong flare activity in the last 24 h");
  for (const event of space.recentEvents) {
    if (["cme-arrival", "ips", "geomagnetic-storm", "sep", "gle-candidate", "forbush-candidate"].includes(event.type)) reasons.push(`${event.title} (${event.source})`);
  }
  return { active: reasons.length > 0, reasons: [...new Set(reasons)].slice(0, 4) };
}

export type InterpretationInput = {
  now: number;
  local: LocalComparison;
  pressure: { available: boolean; current: number | null; deltaWindow: number | null; trend3h: number | null };
  jung: ReferenceComparison | null;
  others: ReferenceComparison[];
  space: SpaceContext;
  correction: PressureCorrectionConfig;
  signalQuality: { acceptedFraction: number | null; clipping: boolean };
};

export type Interpretation = {
  classification: Classification;
  confidence: Confidence;
  title: string;
  explanation: string;
  reasons: string[];
  caveats: string[];
  narrative: string[];
};

const fmt = (value: number | null | undefined, digits = 1) => (value === null || value === undefined ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`);

export function pressureContext(series: TimePoint[], now: number, windowMs: number, baselineMs: number) {
  const current = series.length ? series[series.length - 1].v : null;
  const recent = mean(inRange(series, now - windowMs, now + 1).map((point) => point.v));
  const base = mean(inRange(series, now - windowMs - baselineMs, now - windowMs).map((point) => point.v));
  const then = interpolate(series, now - 3 * 3_600_000);
  const nowP = interpolate(series, now) ?? current;
  return {
    available: current !== null,
    current,
    deltaWindow: recent !== null && base !== null ? recent - base : null,
    trend3h: then !== null && nowP !== null ? nowP - then : null,
  };
}

export function interpret(input: InterpretationInput): Interpretation {
  const { local, pressure, jung, others, space } = input;
  const active = spaceWeatherActive(space);
  const beta = input.correction.barometricCoefficient ?? PROVISIONAL_BETA_PCT_PER_HPA;
  const expectedAtm = pressure.deltaWindow !== null ? expectedPressureEffectPct(pressure.deltaWindow, beta) : null;
  const jungChange = jung?.ok && jung.pct !== null && Math.abs(jung.pct) >= REFERENCE_MIN.changePct ? Math.sign(jung.pct) : 0;
  const othersAgree = (sign: number, min: number = REFERENCE_MIN.changePct) => others.filter((station) => station.ok && station.pct !== null && Math.sign(station.pct) === sign && Math.abs(station.pct) >= min).length;
  const widespreadSign = (() => {
    for (const sign of [-1, 1]) {
      const count = (jung?.ok && jung.pct !== null && Math.sign(jung.pct) === sign && Math.abs(jung.pct) >= REFERENCE_MIN.strongChangePct ? 1 : 0) + othersAgree(sign, REFERENCE_MIN.strongChangePct);
      if (count >= 3) return sign;
    }
    return 0;
  })();

  const reasons: string[] = [];
  const caveats: string[] = [
    "Our detector and the Jungfraujoch neutron monitor measure different secondary particles at different altitudes; only relative changes are compared.",
  ];
  if (!correctionActive(input.correction)) caveats.push("Pressure correction not yet calibrated — local values are raw.");
  else if (input.correction.correctionCalibrationStatus === "PROVISIONAL") caveats.push("Pressure correction is provisional (β not measured for this detector).");

  let score = 0;
  if (pressure.available) { score += 1; reasons.push("Pressure data available"); }
  if (jung?.ok) { score += 1; reasons.push(`Jungfraujoch reference available (${fmt(jung.pct)})`); }
  if (local.sufficient && local.z !== null && Math.abs(local.z) >= 5) { score += 1; reasons.push(`Local change is ${Math.abs(local.z).toFixed(1)}σ above Poisson noise`); }
  if (input.signalQuality.clipping) caveats.push("Input clipping was detected; the local rate may be biased.");
  else if (input.signalQuality.acceptedFraction !== null && input.signalQuality.acceptedFraction >= 0.5) { score += 1; reasons.push("Pulse quality good (most triggers accepted)"); }

  const confidenceOf = (s: number): Confidence => (s >= 5 ? "HIGH" : s >= 3 ? "MEDIUM" : "LOW");
  const narrative: string[] = [];
  const localSig = local.sufficient && local.z !== null && Math.abs(local.z) >= LOCAL_MIN.significanceZ && local.pct !== null;
  const localSign = localSig ? Math.sign(local.pct as number) : 0;

  // Narrative lines (deterministic "What are we seeing?").
  if (!local.live && !local.countsWindow && !local.countsBaseline) narrative.push("No calibrated local detector data has been recorded in this period.");
  else if (!local.sufficient) narrative.push(`The local detector is still collecting a baseline (${local.countsBaseline}/${LOCAL_MIN.baselineCounts} counts) — no percentage is shown yet.`);
  else narrative.push(`Your detector rate is ${fmt(local.pct)} relative to its baseline${local.corrected ? " (pressure-corrected)" : " (raw)"}, ${local.sigmaPct !== null ? `with a statistical uncertainty of ±${local.sigmaPct.toFixed(1)}%` : ""}.`);
  if (pressure.trend3h !== null) narrative.push(Math.abs(pressure.trend3h) < 1 ? "Atmospheric pressure is stable." : `Atmospheric pressure ${pressure.trend3h > 0 ? "rose" : "fell"} by ${Math.abs(pressure.trend3h).toFixed(1)} hPa in 3 h.`);
  if (jung?.ok && jung.pct !== null) narrative.push(Math.abs(jung.pct) < REFERENCE_MIN.changePct ? `Jungfraujoch is close to its baseline (${fmt(jung.pct)}).` : `Jungfraujoch is ${jung.pct > 0 ? "elevated" : "reduced"} (${fmt(jung.pct)}).`);
  else narrative.push("The Jungfraujoch reference is currently unavailable.");
  narrative.push(active.active ? `Space weather is active: ${active.reasons[0]}.` : "No major solar particle event or geomagnetic storm is currently reported.");

  let classification: Classification = "NORMAL";
  let title = "Normal conditions";
  let explanation = "No significant variation is visible in the available data.";

  if (widespreadSign !== 0) {
    classification = "POSSIBLE SPACE-WEATHER EVENT";
    title = widespreadSign < 0 ? "Possible widespread cosmic-ray decrease" : "Possible widespread cosmic-ray increase";
    explanation = `Several independent neutron monitors show a similar ${widespreadSign < 0 ? "decrease" : "increase"} of ≥${REFERENCE_MIN.strongChangePct}%${active.active ? " during active space-weather conditions" : ""}. ${widespreadSign < 0 ? "This pattern is consistent with a Forbush-decrease candidate" : "This pattern is consistent with a Ground Level Enhancement candidate"}, but timing alone does not establish causation.`;
    score += 1 + (active.active ? 1 : 0);
    if (localSign === widespreadSign) { score += 1; reasons.push("Local detector changed in the same direction"); }
    else if (!local.sufficient) caveats.push("The local detector does not have enough statistics to take part in this comparison.");
    reasons.push(...active.reasons);
  } else if (!local.sufficient) {
    classification = "INSUFFICIENT DATA";
    title = "Collecting baseline…";
    explanation = "The local detector needs more counts before a change can be judged. External conditions are shown for context.";
    score = Math.min(score, 2);
  } else if (!localSig) {
    classification = "NORMAL";
    title = "Within normal statistical variation";
    explanation = `The local rate (${fmt(local.pct)}) is within ${LOCAL_MIN.significanceZ}σ of its baseline.`;
    score += 1;
  } else {
    const atmospheric = expectedAtm !== null && pressure.deltaWindow !== null && Math.abs(pressure.deltaWindow) >= 1.5
      && Math.sign(expectedAtm) === localSign && Math.abs(expectedAtm) >= 0.5 * Math.abs(local.pct as number) && jungChange !== localSign;
    if (atmospheric && !local.corrected) {
      classification = "ATMOSPHERIC EFFECT";
      title = "Likely atmospheric effect";
      explanation = `The local detector rate ${localSign < 0 ? "decreased" : "increased"} while atmospheric pressure ${(pressure.deltaWindow as number) > 0 ? "increased" : "decreased"} by ${Math.abs(pressure.deltaWindow as number).toFixed(1)} hPa. No similar regional variation is visible at Jungfraujoch.`;
      reasons.push(`A pressure change of this size could plausibly change the rate by ~${fmt(expectedAtm)} (β ≈ ${beta.toFixed(2)} %/hPa${input.correction.barometricCoefficient === null ? ", typical literature value" : ""})`);
      score += 1;
    } else if (jungChange === localSign) {
      const agreeing = othersAgree(localSign);
      if (agreeing >= 2 && active.active) {
        classification = "POSSIBLE SPACE-WEATHER EVENT";
        title = "Possible widespread cosmic-ray event";
        explanation = "The local detector and independent reference stations show a similar variation during active space-weather conditions. This is a temporal overlap, not confirmed causality.";
        score += 2; reasons.push(`${agreeing} further NMDB stations agree`, ...active.reasons);
      } else {
        classification = "REGIONAL COSMIC VARIATION";
        title = "Possible regional cosmic-ray variation";
        explanation = "A similar change is visible in an independent cosmic-ray monitor (Jungfraujoch).";
        score += 1 + (agreeing >= 1 ? 1 : 0);
        if (agreeing) reasons.push(`${agreeing} further NMDB station${agreeing > 1 ? "s" : ""} agree`);
        if (!active.active) reasons.push("No matching solar event was detected");
      }
    } else {
      classification = "LOCAL ANOMALY";
      title = "Local anomaly";
      explanation = "No matching regional cosmic-ray variation was detected. Inspect detector pulse shape, electronics, or local environmental conditions.";
      if (jung?.ok) score += 1;
    }
  }

  const confidence = classification === "INSUFFICIENT DATA" ? "LOW" : confidenceOf(score);
  if (classification !== "NORMAL" && classification !== "INSUFFICIENT DATA") narrative.push(`This may represent ${title.toLowerCase().replace(/^possible |^likely /, "a ")}, but more data is needed to be sure.`);
  return { classification, confidence, title, explanation, reasons, caveats, narrative };
}

// --- Temporal correlation --------------------------------------------------------

/** Search windows per event type: how far apart in time an overlap is still worth showing. */
export const CORRELATION_WINDOWS_MS: Partial<Record<CosmicEvent["type"], number>> = {
  "solar-flare": 15 * 60_000,
  sep: 60 * 60_000,
  "gle-candidate": 60 * 60_000,
  kp: 3 * 3_600_000,
  alert: 3 * 3_600_000,
  "geomagnetic-storm": 6 * 3_600_000,
  ips: 6 * 3_600_000,
  "cme-arrival": 6 * 3_600_000,
  "forbush-candidate": 6 * 3_600_000,
  "reference-variation": 3 * 3_600_000,
};

export function temporalOverlaps(at: number, events: CosmicEvent[], scale = 1) {
  return events.filter((event) => {
    const window = (CORRELATION_WINDOWS_MS[event.type] ?? 0) * scale;
    return window > 0 && Math.abs(event.timestamp - at) <= window;
  }).map((event) => ({ event, offsetMs: event.timestamp - at }));
}

/** Forbush/GLE candidates and notable variations derived from NMDB series. */
export function referenceEvents(stations: ReferenceStation[], now: number): CosmicEvent[] {
  const out: CosmicEvent[] = [];
  const hourly = stations.filter((station) => station.ok && station.series.length > 48).map((station) => {
    const points = station.series;
    const last = points[points.length - 1];
    const dev = seriesDeviation(points, last.t + 1, 3 * 3_600_000, 3 * 24 * 3_600_000);
    return { station, dev, last };
  });
  const drops = hourly.filter((item) => item.dev && item.dev.pct <= -REFERENCE_MIN.strongChangePct);
  const rises = hourly.filter((item) => item.dev && item.dev.pct >= REFERENCE_MIN.strongChangePct);
  if (drops.length >= 2) out.push({ id: `nmdb-fd-${Math.floor(now / 3_600_000)}`, timestamp: Math.max(...drops.map((item) => item.last.t)), type: "forbush-candidate", severity: "moderate", source: "NMDB", title: "Forbush decrease candidate", description: `${drops.map((item) => `${item.station.name} ${fmt(item.dev?.pct)}`).join(" · ")} vs 3-day baseline. A temporary reduction in galactic cosmic rays following a disturbance in the solar wind.`, link: "https://www.nmdb.eu/" });
  if (rises.length >= 2) out.push({ id: `nmdb-gle-${Math.floor(now / 3_600_000)}`, timestamp: Math.max(...rises.map((item) => item.last.t)), type: "gle-candidate", severity: "strong", source: "NMDB", title: "Ground-level enhancement candidate", description: `${rises.map((item) => `${item.station.name} ${fmt(item.dev?.pct)}`).join(" · ")}. GLEs are rare; confirm with the official GLE database.`, link: "https://gle.oulu.fi/" });
  const jung = hourly.find((item) => item.station.code === "JUNG" || item.station.code === "JUNG1");
  if (jung?.dev && Math.abs(jung.dev.pct) >= 1.5 && !drops.length && !rises.length) {
    out.push({ id: `nmdb-jung-${Math.floor(jung.last.t / 3_600_000)}`, timestamp: jung.last.t, type: "reference-variation", severity: "info", source: "NMDB", title: `Jungfraujoch cosmic-ray rate ${fmt(jung.dev.pct)}`, description: "Relative to its 3-day baseline (pressure- and efficiency-corrected NMDB data).", link: "https://www.nmdb.eu/" });
  }
  return out;
}
