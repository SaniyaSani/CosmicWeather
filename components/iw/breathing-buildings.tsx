"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, AudioLines, CircleHelp, Cloud, ExternalLink, EyeOff, Filter, LockKeyhole, Sparkles, TriangleAlert, Waves, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PulseRecord } from "@/lib/signal/types";
import { AirflowVisualization } from "./airflow";

function BreathingParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lowPower = window.matchMedia("(max-width: 700px)").matches;
    let width = 0; let height = 0; let frame = 0; let lastDraw = 0;
    type AirParticle = { x: number; y: number; radius: number; speed: number; drift: number; phase: number; hue: number; alpha: number };
    let particles: AirParticle[] = [];
    const makeParticle = (index: number): AirParticle => ({
      x: (((index * 83) % 997) / 997) * width,
      y: height * (.54 + (((index * 151) % 991) / 991) * .55),
      radius: .55 + ((index * 19) % 17) / 9,
      speed: .17 + ((index * 29) % 13) / 28,
      drift: (((index * 41) % 19) - 9) / 48,
      phase: index * .77,
      hue: [184, 204, 45, 270][index % 4],
      alpha: .25 + ((index * 31) % 45) / 100,
    });
    const resize = () => {
      const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height;
      const ratio = lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 1.25);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      particles = Array.from({ length: lowPower ? 34 : 66 }, (_, index) => makeParticle(index));
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (document.hidden || now - lastDraw < 38) return;
      lastDraw = now; context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        if (!reducedMotion) {
          particle.y -= particle.speed;
          particle.x += particle.drift + Math.sin(now * .0007 + particle.phase) * .09;
          if (particle.y < -15) Object.assign(particle, makeParticle(Math.floor(Math.random() * 1_000)), { y: height + Math.random() * 60 });
        }
        const glow = context.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, particle.radius * 5);
        glow.addColorStop(0, `hsla(${particle.hue},100%,82%,${particle.alpha})`);
        glow.addColorStop(.28, `hsla(${particle.hue},100%,70%,${particle.alpha * .45})`);
        glow.addColorStop(1, `hsla(${particle.hue},100%,60%,0)`);
        context.fillStyle = glow; context.beginPath(); context.arc(particle.x, particle.y, particle.radius * 5, 0, Math.PI * 2); context.fill();
      }
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  return <canvas ref={canvasRef} className="bb-particle-field" aria-hidden="true" />;
}

function BreathingDecayChart() {
  const [minutes, setMinutes] = useState(0);
  const relativeIndex = 18 + 82 * Math.exp(-minutes / 31.5);
  const markerX = 40 + (minutes / 90) * 570;
  const markerY = 205 - (relativeIndex - 18) * 1.83;
  return <div className="bb-decay-tool">
    <div className="bb-decay-copy"><span className="eyebrow">ILLUSTRATIVE DECAY · NOT LIVE DATA</span><h3>Watch a collected signal fade.</h3><p>A filter may collect several short-lived radon descendants. Their combined signal is not one perfect half-life, but it should trend back toward the detector&apos;s ordinary background.</p><div className="bb-time-readout"><span>TIME SINCE COLLECTION</span><strong>{minutes} min</strong></div><label htmlFor="bb-decay-slider">Drag through 90 minutes</label><input id="bb-decay-slider" type="range" min="0" max="90" step="1" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></div>
    <div className="bb-decay-visual"><div className="bb-chart-title"><span>RELATIVE EVENT RATE</span><b>illustration</b></div><svg viewBox="0 0 640 280" role="img" aria-label={`Illustrative relative event index ${Math.round(relativeIndex)} at ${minutes} minutes`}><defs><linearGradient id="bb-curve" x1="0" x2="1"><stop offset="0" stopColor="#ffe993" /><stop offset=".42" stopColor="#77f6ff" /><stop offset="1" stopColor="#947aff" /></linearGradient><linearGradient id="bb-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6ff2ff" stopOpacity=".28" /><stop offset="1" stopColor="#6ff2ff" stopOpacity="0" /></linearGradient></defs><g className="bb-grid-lines"><path d="M40 40H610M40 95H610M40 150H610M40 205H610" /><path d="M40 40V230M230 40V230M420 40V230M610 40V230" /></g><path className="bb-background-line" d="M40 205H610" /><path className="bb-chart-area" d="M40 55 C100 66 135 86 185 108 C250 138 330 166 415 185 C485 198 550 202 610 205 L610 230 L40 230 Z" /><path className="bb-chart-curve" d="M40 55 C100 66 135 86 185 108 C250 138 330 166 415 185 C485 198 550 202 610 205" /><line className="bb-chart-guide" x1={markerX} x2={markerX} y1="38" y2="230" /><circle className="bb-chart-marker" cx={markerX} cy={markerY} r="8" /><g className="bb-axis-copy"><text x="40" y="258">0</text><text x="222" y="258">30</text><text x="412" y="258">60</text><text x="574" y="258">90 MIN</text><text x="487" y="198">BACKGROUND</text></g></svg><div className="bb-event-reading"><span>ILLUSTRATIVE INDEX</span><strong>{Math.round(relativeIndex)}</strong></div></div>
  </div>;
}

export function BreathingBuildings({
  detectorConnected, calibrationReady, detectorMessage, thresholdSigma, noiseFloor,
  acceptedCount, rate, latestPulse, onConnect, onOpenAirLab,
}: {
  detectorConnected: boolean; calibrationReady: boolean; detectorMessage: string; thresholdSigma: number;
  noiseFloor: number; acceptedCount: number; rate: number; latestPulse?: PulseRecord;
  onConnect: () => void; onOpenAirLab: () => void;
}) {
  return <section className="bb-shell">
    <section className="bb-hero iw-air-hero" aria-label="Breathing Buildings: airflow through a building section">
      <AirflowVisualization />
      <div className="iw-hero-copy air">
        <span className="iw-dash" aria-hidden="true" />
        <h1 className="iw-display"><span>BREATHING</span><span>BUILDINGS.</span></h1>
        <p className="iw-subtitle">AIR LAYER</p>
        <span className="iw-dash" aria-hidden="true" />
        <p className="iw-serif">The atmosphere<br />lives closer<br />than we think.</p>
      </div>
      <aside className="iw-hero-plaque air">
        <span className="iw-plaque-kicker">SHARED DETECTOR</span>
        <dl>
          <div><dt>STATE</dt><dd className={detectorConnected && calibrationReady ? "is-live" : ""}>{detectorConnected ? calibrationReady ? "CALIBRATED" : "NEEDS CALIBRATION" : "NOT CONNECTED"}</dd></div>
          <div><dt>RATE</dt><dd>{rate} / MIN</dd></div>
          <div><dt>PLACE</dt><dd>ZÜRICH · OPEN HARDWARE</dd></div>
        </dl>
        <button type="button" className="iw-text-link" onClick={detectorConnected ? onOpenAirLab : onConnect}>{detectorConnected ? "PREPARE AIR EXPERIMENT" : "CONNECT DETECTOR"} <span aria-hidden="true">→</span></button>
      </aside>
      <p className="iw-hero-legend"><span>SCHEMATIC</span> AIRFLOW PATHS ARE ILLUSTRATIVE · NOT A MEASUREMENT OF THIS BUILDING</p>
    </section>

    <section className="bb-bridge">
      <div className="bb-section-heading"><span className="eyebrow">ONE DETECTOR · TWO QUESTIONS</span><h2>The same pulse engine listens to sky and air differently.</h2><p>Cosmic Rain and Breathing Buildings share the audio input, raw waveform, calibration, pulse area, timestamps and network. The experiment and scientific interpretation stay separate.</p></div>
      <div className="bb-two-modes"><article><span className="bb-mode-icon"><Sparkles size={24} /></span><small>COSMIC MODE</small><h3>Closed dark detector</h3><p>Record a long quiet session and search for rare particle candidates. A single pulse is not automatically a confirmed muon.</p></article><div className="bb-shared-core"><Activity size={26} /><strong>SHARED SIGNAL ENGINE</strong><span>audio input</span><span>locked calibration</span><span>peak · width · area · SNR</span><span>time · place · metadata</span></div><article><span className="bb-mode-icon air"><Cloud size={24} /></span><small>AIR MODE</small><h3>Fixed filter sample</h3><p>Collect aerosol-bound radon progeny, then compare equal time bins as the excess signal returns toward background.</p></article></div>
    </section>

    <section className="bb-live-bridge">
      <div className="bb-live-copy"><span className="eyebrow"><AudioLines size={14} /> SHARED DETECTOR STATUS</span><h2>One calibration follows the experiment.</h2><p>Use the Detector Lab to select the real AUX or USB sound-card input, measure quiet noise and lock the threshold. Then keep gain, distance, filter geometry and calibration unchanged for every comparison.</p><div className="bb-live-actions"><Button className="bb-primary" onClick={detectorConnected ? onOpenAirLab : onConnect}>{detectorConnected ? "Open detector lab" : "Connect detector"}</Button><span><LockKeyhole size={14} /> Air mode requires its own locked baseline</span></div></div>
      <div className="bb-status-grid"><div><span>INPUT</span><strong>{detectorConnected ? detectorMessage : "offline"}</strong></div><div><span>CALIBRATION</span><strong className={calibrationReady ? "good" : "warn"}>{calibrationReady ? "locked & ready" : "required"}</strong></div><div><span>ROBUST NOISE</span><strong>{detectorConnected ? `${(noiseFloor * 100).toFixed(3)}% FS` : "—"}</strong></div><div><span>THRESHOLD</span><strong>{calibrationReady ? `${thresholdSigma.toFixed(1)}σ` : "—"}</strong></div><div><span>ACCEPTED</span><strong>{acceptedCount}</strong><small>current session</small></div><div><span>LATEST AREA</span><strong>{latestPulse ? latestPulse.area.toFixed(4) : "—"}</strong><small>relative · ms</small></div><div className="wide"><span>CURRENT EVENT RATE</span><strong>{rate}<small> candidates / min</small></strong></div></div>
    </section>

    <section className="bb-air-story">
      <div><span className="eyebrow">01 · THE AIR INSIDE</span><h2>Buildings are not sealed boxes.</h2></div><div><p>Air enters through soil, cracks, windows and ventilation. Along with it comes radon: an invisible gas released naturally from the ground.</p><p>Its short-lived descendants are solids. They attach to aerosols already floating through the room, so a filter can collect a temporary sample of that air.</p></div>
      <div className="bb-chain" role="list" aria-label="Simplified radon decay chain"><article role="listitem"><span>01</span><strong>Rn-222</strong><p>Noble gas moves from soil into buildings.</p><small>3.8 days</small></article><article role="listitem"><span>02</span><strong>Po-218</strong><p>Charged solid attaches to aerosols.</p><small>3.1 min</small></article><article className="beta" role="listitem"><span>03</span><strong>Pb-214</strong><p>Beta decay can create a detector pulse.</p><small>26.8 min</small></article><article className="beta" role="listitem"><span>04</span><strong>Bi-214</strong><p>Another beta emitter continues the signal.</p><small>19.9 min</small></article></div>
    </section>

    <section id="bb-method" className="bb-method">
      <div className="bb-method-copy"><span className="eyebrow">02 · AUTONOMOUS MODULE CONCEPT</span><h2>Collect and count without moving the filter.</h2><p>A fixed cassette keeps geometry repeatable. The blower sits downstream and stops before counting, so its motor noise is not mistaken for particle pulses.</p><div className="bb-concept-warning"><TriangleAlert size={17} /><span><strong>Prototype status:</strong> the module layout is a design proposal. Filter type, airflow, sensor gap and shielding still require bench validation.</span></div></div>
      <div className="bb-module" role="img" aria-label="Autonomous module flow from room air through filter and dark detector to blower and saved data"><div><span>ROOM AIR</span><Cloud size={28} /></div><i /><div className="filter"><span>FIXED FILTER</span><Filter size={28} /></div><i /><div className="sensor"><span>DARK DETECTOR</span><EyeOff size={28} /></div><i /><div><span>5 V BLOWER</span><Waves size={28} /></div><i /><div><span>SAVE / UPLOAD</span><Wifi size={28} /></div></div>
      <ol className="bb-cycle"><li><span>01</span><strong>Blank</strong><p>Count a fresh clean filter for 20–30 minutes. Lock calibration and geometry.</p></li><li><span>02</span><strong>Collect</strong><p>Run fixed airflow for a fixed time. Detector counting pauses while the motor runs.</p></li><li><span>03</span><strong>Settle</strong><p>Stop the blower and wait briefly for electrical and mechanical noise to disappear.</p></li><li><span>04</span><strong>Count</strong><p>Measure equal bins for 60–90 minutes without touching the cassette or gain.</p></li><li><span>05</span><strong>Save</strong><p>Store events, calibration, airflow, duration, conditions and approximate location.</p></li></ol>
    </section>

    <section className="bb-decay-section"><div className="bb-section-heading"><span className="eyebrow">03 · WATCH IT DISAPPEAR</span><h2>The signal tells a story in time.</h2><p>One count proves little. A changing rate after collection is more informative than a single spike.</p></div><BreathingDecayChart /></section>

    <section className="bb-questions"><div className="bb-section-heading"><span className="eyebrow">04 · COMPARE HOW SPACES BREATHE</span><h2>One protocol. Many buildings.</h2><p>Repeat the same controlled sequence and compare relative curves rather than isolated counts.</p></div><div className="bb-question-grid"><article><span>↕</span><h3>Floor</h3><p>Basement versus upper floor in the same building.</p></article><article><span>⌁</span><h3>Ventilation</h3><p>The same room before and after airing.</p></article><article><span>◌</span><h3>Filtration</h3><p>Air purifier off versus on, with identical sampling.</p></article><article><span>☂</span><h3>Weather</h3><p>Pressure, humidity and rain across repeated days.</p></article></div><div className="bb-limit"><CircleHelp size={19} /><p><strong>Scientific boundary:</strong> this experiment measures a relative, short-lived airborne signal. Without a validated calibration and reference instrument, it does not report certified radon concentration in Bq/m³ and cannot declare a room safe or unsafe.</p></div></section>

    <section className="bb-closing"><BreathingParticleCanvas /><span className="eyebrow">OPEN HARDWARE · SHARED PROTOCOL · VISIBLE UNCERTAINTY</span><h2>A building exhales.<br />We learn to listen.</h2><p>Breathing Buildings is now part of the same detector platform: prepare the air experiment here, inspect every pulse in Detector Lab and share comparable metadata through the citizen-science network.</p><div><Button className="bb-primary" onClick={detectorConnected ? onOpenAirLab : onConnect}>{detectorConnected ? "Prepare detector" : "Connect detector"}</Button><a href="https://breathing-buildings.ssagutdinova.chatgpt.site" target="_blank" rel="noreferrer">Open the original story <ExternalLink size={15} /></a></div></section>
  </section>;
}
