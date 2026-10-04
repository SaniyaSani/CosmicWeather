"use client";

import { useState } from "react";
import { kpLabel, protonLabel, solarActivityLabel } from "@/lib/cosmic/parsers";
import { rollingDeviation } from "@/lib/cosmic/stats";
import type { CosmicEvent, SourceState } from "@/lib/cosmic/types";
import { fmtPct, type useCosmicSnapshot } from "@/lib/cosmic/use-cosmic-snapshot";
import { PanelHeading, Prov, StatusDot } from "@/components/iw/primitives";
import { CosmicTimeline, eventGlyph, relevanceText, type TimelineToggles } from "./timeline";

type Snapshot = ReturnType<typeof useCosmicSnapshot>;

const dot = (state: SourceState | undefined) => (state === "live" || state === "updated" ? "live" : state === "stale" || state === "offline" ? "warn" : "off");

/**
 * Compact Cosmic Weather layer for the SKY page: the five-layer conditions
 * strip, a 24 h shared timeline with event markers and every local pulse, and
 * a one-line interpretation. Full analysis stays in DATA.
 */
export function SkyCosmic({ snapshot, pulses, onOpenData }: { snapshot: Snapshot; pulses: number[]; onOpenData: () => void }) {
  const { now, from, env, pressure, derived, statusOf } = snapshot;
  const { local, jung, spaceCtx, pctx, interpretation, events, jungStation, kpSeries, localRaw } = derived;
  const [selected, setSelected] = useState<CosmicEvent | null>(null);
  const [toggles, setToggles] = useState<TimelineToggles>({ local: true, corrected: false, pressure: true, jung: true, solar: true, geomagnetic: true });
  const solar = solarActivityLabel(derived.xrayMax24h);
  const protons = protonLabel(spaceCtx.protons10);
  const currentPressure = env?.current?.pressureHpa ?? pressure.at(-1)?.v ?? null;

  const items = [
    { k: "DETECTOR", v: local.ratePerMin !== null ? `${local.ratePerMin.toFixed(2)}/min` : "—", s: local.sufficient ? fmtPct(local.pct) : "collecting baseline", st: statusOf("detector")?.state, prov: "MEASURED" as const },
    { k: "PRESSURE", v: currentPressure !== null ? `${currentPressure.toFixed(1)} hPa` : "—", s: pctx.trend3h !== null ? `${pctx.trend3h > 0.2 ? "↑" : pctx.trend3h < -0.2 ? "↓" : "→"} ${Math.abs(pctx.trend3h).toFixed(1)} hPa / 3 h` : "—", st: statusOf("pressure")?.state, prov: env?.source === "sensor" ? "MEASURED" as const : "MODEL" as const },
    { k: "JUNGFRAUJOCH", v: fmtPct(jung?.pct, 2), s: "neutron monitor · 3475 m", st: statusOf("nmdb")?.state, prov: "MEASURED" as const },
    { k: "GEOMAGNETIC Kp", v: spaceCtx.kpNow !== null ? spaceCtx.kpNow.toFixed(spaceCtx.kpNow % 1 ? 2 : 0) : "—", s: kpLabel(spaceCtx.kpNow).toLowerCase(), st: statusOf("noaa-kp")?.state, prov: "MEASURED" as const },
    { k: "SUN", v: solar.label, s: `protons ${protons.label.toLowerCase()}`, st: statusOf("noaa-xray")?.state, prov: "MEASURED" as const },
  ];

  return <section className="iw-panel sky-cosmic" aria-labelledby="sky-cosmic-title">
    <PanelHeading title={<span id="sky-cosmic-title">COSMIC WEATHER · NOW</span>} meta={<button type="button" className="iw-text-link" onClick={onOpenData}>FULL OBSERVATORY <span aria-hidden="true">→</span></button>} />
    <ol className="sky-strip">
      {items.map((item) => <li key={item.k}>
        <span className="iw-kicker"><span className="cw-anchor-mini" aria-hidden="true" />{item.k} <Prov kind={item.prov} /></span>
        <strong>{item.v}</strong>
        <small><StatusDot state={dot(item.st)} />{item.s}</small>
      </li>)}
    </ol>

    <div className={`sky-verdict cls-${interpretation.classification.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <b>{interpretation.classification}</b>
      <span>CONFIDENCE {interpretation.confidence}</span>
      <p>{interpretation.narrative.slice(0, 2).join(" ")}</p>
    </div>

    <div className="cw-toggles sky-toggles" role="group" aria-label="Timeline layers">
      {([["local", "YOUR DETECTOR", "raw"], ["jung", "JUNGFRAUJOCH", "jung"], ["pressure", "PRESSURE", "pressure"], ["solar", "SOLAR", "solar"], ["geomagnetic", "GEOMAGNETIC", "geo"]] as [keyof TimelineToggles, string, string][]).map(([key, label, swatch]) =>
        <label key={key}><input type="checkbox" checked={toggles[key]} onChange={() => setToggles((current) => ({ ...current, [key]: !current[key] }))} /><i className={`sw sw-${swatch}`} />{label}</label>)}
      <label className="static"><i className="sw sw-pulse" />EACH TICK = ONE ACCEPTED PULSE</label>
    </div>
    <CosmicTimeline series={{ localRaw, localCorrected: [], jung: rollingDeviation(jungStation?.series ?? [], 24 * 3_600_000), pressure, kp: kpSeries }} events={events} from={Math.max(from, now - 24 * 3_600_000)} to={now + 2 * 3_600_000} toggles={toggles} correctionActive={false} now={now} onSelectEvent={setSelected} selectedEventId={selected?.id ?? null} height={250} pulses={pulses} />
    {selected && <div className="cw-event-card sky-event" role="dialog" aria-label={selected.title}>
      <button type="button" className="cw-close" onClick={() => setSelected(null)} aria-label="Close event details">×</button>
      <span className="iw-kicker">{eventGlyph(selected.type)} {selected.type.replace(/-/g, " ").toUpperCase()} · {selected.source}</span>
      <h3>{selected.title}</h3>
      <p className="cw-event-time">{new Date(selected.timestamp).toLocaleString("en-GB")}</p>
      <p className="cw-relevance"><b>COULD IT RELATE TO OUR DATA?</b> {relevanceText(selected)}</p>
    </div>}
    <p className="cw-note">Last 24 h. Each line is the % change from its own rolling baseline; the local rate uses Ambient-sky logging only. Markers are temporal context, never causes.</p>
    <span className="iw-plus" aria-hidden="true">+</span>
  </section>;
}
