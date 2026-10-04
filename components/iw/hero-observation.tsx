"use client";

import { AnnotationLayer, type AnnotationSpec, useSize, usePrefersReducedMotion } from "./primitives";
import { ParticleShower, heroGeometry } from "./particle-shower";
import { GlobeIcon } from "./layer-switcher";

type HeroProps = {
  pulseKey: number | null;
  rate: number;
  detectorLabel: string;
  detectorState: "demo" | "live" | "calibrate";
  stationCount: number;
  onConnect: () => void;
  onNavigate: (view: string) => void;
};

const ALTITUDES = [{ km: 100, f: 0 }, { km: 50, f: 0.27 }, { km: 20, f: 0.52 }, { km: 10, f: 0.72 }, { km: 0, f: 1 }];

export function HeroObservation({ pulseKey, rate, detectorLabel, detectorState, stationCount, onConnect, onNavigate }: HeroProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const reducedMotion = usePrefersReducedMotion();
  const geo = heroGeometry(size.width || 1, size.height || 1);
  const at = (fraction: number, side: number) => {
    const y = geo.apex.y + (geo.earthTop - geo.apex.y) * fraction;
    return { x: geo.apex.x + side * geo.coneHalfWidth(y) * 0.42, y };
  };
  const cascade = at(0.42, -1);
  const secondary = at(0.8, 1);
  const detectorX = geo.apex.x + (geo.narrow ? -size.width * 0.18 : size.width * 0.12);
  const detector = { x: detectorX, y: geo.surfaceY(detectorX) + 3 };

  const items: AnnotationSpec[] = size.width ? [
    { id: "primary", x: geo.apex.x, y: geo.apex.y, lx: geo.apex.x + (geo.narrow ? -34 : 70), ly: geo.apex.y - (geo.narrow ? 30 : 50), title: "PRIMARY PARTICLE", lines: geo.narrow ? ["FROM DEEP SPACE"] : ["FROM DEEP SPACE", "(MOSTLY PROTONS, HELIUM NUCLEI)", "ENERGY ~10⁹ – 10²⁰ eV"], align: geo.narrow ? "right" : "left", delay: 200 },
    ...(geo.narrow ? [] : [{ id: "cascade", x: cascade.x, y: cascade.y, lx: cascade.x - 70, ly: cascade.y - 36, title: "ATMOSPHERIC CASCADE", lines: ["FIRST COLLISION ~15–20 KM", "PIONS → MUONS, ELECTRONS,", "PHOTONS, NEUTRONS"], align: "right" as const, delay: 450 }]),
    ...(geo.narrow ? [] : [{ id: "secondary", x: secondary.x, y: secondary.y, lx: secondary.x + 80, ly: secondary.y - 40, title: "SECONDARY PARTICLES", lines: ["MUONS DOMINATE AT GROUND LEVEL", "≈ 1 PER CM² PER MINUTE"], delay: 700 }]),
    { id: "detector", x: detector.x, y: detector.y, lx: detector.x + (geo.narrow ? 30 : -60), ly: detector.y + (geo.narrow ? 48 : 62), title: "DETECTOR", lines: detectorState === "demo" ? ["DEMO STREAM · SIMULATED PULSES"] : [detectorLabel, `${rate} CANDIDATES / MIN`], align: geo.narrow ? "left" : "right", delay: 950, emphasis: true },
  ] : [];

  const scaleTop = geo.earthTop - Math.max(150, size.height * 0.2);
  return <section className="iw-hero" aria-label="Cosmic Rain observation: a cosmic-ray air shower above the Earth">
    <div className="iw-hero-stage" ref={ref}>
      <ParticleShower pulseKey={pulseKey} reducedMotion={reducedMotion} />
      <AnnotationLayer width={size.width} height={size.height} items={items} />
      {size.width > 0 && <div className="iw-altitude" style={{ top: scaleTop, height: Math.max(80, geo.earthTop - scaleTop) }} aria-hidden="true">
        {ALTITUDES.map((mark) => <span key={mark.km} style={{ top: `${mark.f * 100}%` }}>{mark.km} km</span>)}
        <small>ATMOSPHERE<br />TO EARTH · SCHEMATIC</small>
      </div>}
    </div>

    <div className="iw-hero-copy">
      <span className="iw-dash" aria-hidden="true" />
      <h1 className="iw-display"><span>INVISIBLE</span><span>WEATHER.</span></h1>
      <p className="iw-subtitle">COSMIC RAIN</p>
      <span className="iw-dash" aria-hidden="true" />
      <p className="iw-lede">HIGH-ENERGY PARTICLES<br />FROM SPACE.<br />REAL-TIME DETECTION<br />ON EARTH.</p>
    </div>

    <aside className="iw-hero-globe">
      <span className="iw-plus" aria-hidden="true">+</span>
      <GlobeIcon className="iw-globe-large" animated={!reducedMotion} />
      <div>
        <p>SAME PARTICLES.<br />EVERY SKY.</p>
        <ul>
          <li><button type="button" onClick={() => onNavigate("data")}>/ ATMOSPHERE</button></li>
          <li><button type="button" onClick={() => onNavigate("about")}>/ PARTICLE CASCADE</button></li>
          <li><button type="button" onClick={() => onNavigate("signal")}>/ GROUND DETECTION</button></li>
          <li><button type="button" onClick={() => onNavigate("data")}>/ GLOBAL NETWORK · {stationCount}</button></li>
        </ul>
      </div>
    </aside>

    <aside className="iw-hero-plaque">
      <span className="iw-plaque-kicker">DETECTOR 01</span>
      <dl>
        <div><dt>INPUT</dt><dd>{detectorLabel}</dd></div>
        <div><dt>STATE</dt><dd className={detectorState === "live" ? "is-live" : ""}>{detectorState === "demo" ? "DEMO · SIMULATED" : detectorState === "live" ? "LISTENING" : "CALIBRATION NEEDED"}</dd></div>
        <div><dt>RATE</dt><dd>{rate} / MIN</dd></div>
      </dl>
      {detectorState === "demo" && <button type="button" className="iw-text-link" onClick={onConnect}>CONNECT DETECTOR <span aria-hidden="true">→</span></button>}
    </aside>

    <p className="iw-hero-note">A NETWORK OF CITIZEN<br />DETECTORS MEASURING<br />THE UNSEEN.<br /><br />REAL PARTICLES.<br />REAL PEOPLE.<br />HONEST MEASUREMENTS.<span className="iw-dash" aria-hidden="true" /></p>
    <p className="iw-hero-legend"><span>ILLUSTRATION</span> TRAJECTORIES ARE ARTISTIC · PULSE TIMES ARE MEASURED</p>
  </section>;
}
