"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { amplitudeUnit, areaUnit, eventCode, formatDuration, formatNumber, toDisplayAmplitude, type InputCalibration } from "@/lib/signal/analysis";
import { samplePeriodOf, type PulseRecord } from "@/lib/signal/types";
import { CornerMarks, PanelHeading, Prov, StatusDot, formatTime } from "./primitives";
import { WaveformPlot, analyzeRecord } from "./waveform";

export type SignalPrefs = {
  polarity: "positive" | "negative" | "either";
  calibration: InputCalibration;
  windows: Record<string, [number, number]>;
  setWindow: (id: number, window: [number, number] | null) => void;
  openEvent: (id: number) => void;
};

// --- Calibration control -----------------------------------------------------------

type CalibrationProps = {
  connected: boolean;
  calibrating: boolean;
  progress: number;
  ready: boolean;
  seconds: number;
  sampleRate: number;
  noise: number;
  thresholdSigma: number;
  locked: boolean;
  calibratedAt: number | null;
  calibration: InputCalibration;
  onCalibrate: () => void;
  onConnect: () => void;
};

export function CalibrationControl({ connected, calibrating, progress, ready, seconds, sampleRate, noise, thresholdSigma, locked, calibratedAt, calibration, onCalibrate, onConnect }: CalibrationProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const justFinished = ready && calibratedAt !== null && now - calibratedAt < 8_000;
  const unit = amplitudeUnit(calibration);
  const pct = Math.round(progress * 100);
  return <div className={`iw-calibrate ${calibrating ? "is-measuring" : ""} ${justFinished ? "is-complete" : ""}`}>
    <button type="button" className="iw-calibrate-button" onClick={connected ? onCalibrate : onConnect} disabled={calibrating} aria-describedby="calibrate-sub">
      <CornerMarks size={12} />
      <span className="cal-plus" aria-hidden="true">+</span>
      <span className="cal-word">{calibrating ? "MEASURING" : justFinished ? "COMPLETE" : ready ? "RECALIBRATE" : "CALIBRATE"}</span>
      <span className="cal-arrow" aria-hidden="true">→</span>
    </button>
    <div className="iw-calibrate-readout" id="calibrate-sub" aria-live="polite">
      {calibrating ? <>
        <div className="cal-progress"><span>MEASURING BASELINE</span><i style={{ "--p": `${pct}%` } as CSSProperties} /><b>{pct}%</b></div>
        <p>SAMPLES {Math.round(progress * seconds * sampleRate).toLocaleString("en-US")} / {(seconds * sampleRate).toLocaleString("en-US")} · KEEP THE CLOSED DETECTOR STILL</p>
        <p>NOISE σ = MEASURING… · THRESHOLD = PENDING</p>
      </> : justFinished ? <>
        <div className="cal-progress done"><span>CALIBRATION COMPLETE</span><i style={{ "--p": "100%" } as CSSProperties} /><b>100%</b></div>
        <p>BASELINE {locked ? "LOCKED" : "ADAPTIVE"} · NOISE σ = {formatNumber(toDisplayAmplitude(noise, calibration))} {unit} · THRESHOLD = {thresholdSigma.toFixed(1)}σ = {formatNumber(toDisplayAmplitude(noise * thresholdSigma, calibration))} {unit}</p>
      </> : ready ? <>
        <p>LAST CALIBRATION {calibratedAt ? formatTime(calibratedAt, false) : "—"} · NOISE σ = {formatNumber(toDisplayAmplitude(noise, calibration))} {unit} · THRESHOLD {thresholdSigma.toFixed(1)}σ · {locked ? "LOCKED" : "ADAPTIVE"}</p>
      </> : <>
        <p>{connected ? `MEASURE BACKGROUND · ${seconds} S ROBUST NOISE BASELINE · FIND OPTIMAL THRESHOLD · LOCK SETTINGS` : "CONNECT THE DETECTOR FIRST · THE DEMO STREAM NEEDS NO CALIBRATION"}</p>
      </>}
    </div>
  </div>;
}

// --- Live signal ---------------------------------------------------------------------

type LiveProps = {
  pulse?: PulseRecord;
  stream: number[];
  streamPeriodUs: number;
  connected: boolean;
  demo: boolean;
  calibrated: boolean;
  threshold: number;
  noise: number;
  prefs: SignalPrefs;
  /** Temporal-overlap / coincidence notes for the shown pulse. */
  context?: { kind: "space" | "network"; text: string }[];
};

export function LiveSignal({ pulse, stream, streamPeriodUs, connected, demo, calibrated, threshold, noise, prefs, context = [] }: LiveProps) {
  const [mode, setMode] = useState<"event" | "stream">("event");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 400); return () => window.clearInterval(timer); }, []);
  const showStream = mode === "stream" || !pulse;
  const integrationWindow = pulse ? prefs.windows[String(pulse.id)] : undefined;
  const analysis = useMemo(() => (pulse ? analyzeRecord(pulse, prefs.polarity, integrationWindow) : null), [pulse, prefs.polarity, integrationWindow]);
  const fresh = pulse && now - pulse.at < 1_300;
  const unit = amplitudeUnit(prefs.calibration);
  const conv = (fs: number) => formatNumber(toDisplayAmplitude(fs, prefs.calibration));
  const stateLabel = demo ? "DEMO · SIMULATED" : connected ? calibrated ? "LIVE" : "UNCALIBRATED" : "OFFLINE";
  return <section className="iw-panel iw-live" aria-labelledby="live-signal-title">
    <PanelHeading title={<span id="live-signal-title">LIVE SIGNAL</span>} meta={<><span>{demo ? "SIMULATED DEMO PULSES" : "REAL TIME FROM YOUR DETECTOR"}</span><span className="iw-live-state"><StatusDot state={demo ? "demo" : connected && calibrated ? "live" : "off"} />{stateLabel}</span></>} />
    <div className="iw-live-grid">
      <div className="iw-live-plot">
        <div className="iw-seg" role="group" aria-label="Signal view">
          <button type="button" className={!showStream ? "on" : ""} onClick={() => setMode("event")} disabled={!pulse}>EVENT</button>
          <button type="button" className={showStream ? "on" : ""} onClick={() => setMode("stream")}>STREAM</button>
        </div>
        {showStream
          ? <WaveformPlot samples={connected ? stream : Array(128).fill(0)} samplePeriodUs={streamPeriodUs} calibration={prefs.calibration} threshold={calibrated ? threshold : null} orientation={prefs.polarity === "positive" ? 1 : -1} showArea={false} callouts={false} live height={290} ariaLabel="Raw detector input stream" />
          : pulse && analysis && <WaveformPlot key={pulse.id} samples={pulse.samples} samplePeriodUs={samplePeriodOf(pulse)} analysis={analysis} calibration={prefs.calibration} threshold={pulse.threshold ?? (calibrated ? threshold : null)} orientation={analysis.orientation} editable onWindowChange={(next) => prefs.setWindow(pulse.id, next)} flashKey={pulse.id} eventLabel={fresh ? `EVENT DETECTED ${eventCode(pulse.id)}` : eventCode(pulse.id)} live={Boolean(fresh)} zoom height={290} ariaLabel={`Waveform of event ${eventCode(pulse.id)}`} />}
        {showStream && !connected && <p className="iw-plot-empty">{demo ? "Demo pulses have no raw stream. Connect the detector to see the real audio input." : "Connect the detector to see the real audio input."}</p>}
        {!showStream && pulse && <div className="iw-context" aria-live="polite">
          {context.length ? context.map((item) => <span key={item.text} className={`ctx-${item.kind}`}><i aria-hidden="true" />{item.text}</span>) : <span className="ctx-none"><i aria-hidden="true" />NO SPACE-WEATHER EVENT OR NETWORK COINCIDENCE NEAR THIS PULSE</span>}
        </div>}
        {showStream && connected && <p className="iw-plot-note">RAW INPUT · DECIMATED FOR DISPLAY · {formatDuration(streamPeriodUs * Math.max(1, stream.length - 1))} WINDOW</p>}
      </div>
      <dl className="iw-metrics">
        <div><dt>PEAK AMPLITUDE <Prov kind="MEASURED" /></dt><dd>{analysis && !showStream ? `${conv(analysis.peak)} ${unit}` : "—"}</dd></div>
        <div><dt>PULSE WIDTH (FWHM) <Prov kind="DERIVED" /></dt><dd>{analysis && !showStream ? formatDuration(analysis.fwhmUs) : "—"}</dd></div>
        <div><dt>AREA (INTEGRAL) <Prov kind="DERIVED" /></dt><dd>{analysis && !showStream ? `${conv(analysis.area)} ${areaUnit(prefs.calibration)}` : "—"}</dd></div>
        <div><dt>SNR <Prov kind="DERIVED" /></dt><dd>{analysis && !showStream ? analysis.snr.toFixed(1) : "—"}</dd></div>
        <div><dt>BASELINE (MEAN) <Prov kind="MEASURED" /></dt><dd>{analysis && !showStream ? `${conv(analysis.baseline)} ${unit}` : "—"}</dd></div>
        <div><dt>NOISE σ <Prov kind="MEASURED" /></dt><dd>{connected && calibrated ? `${conv(noise)} ${unit}` : demo ? "DEMO" : "—"}</dd></div>
        <div><dt>TIME WINDOW <Prov kind="SETTING" /></dt><dd>{analysis && !showStream ? `${formatNumber(analysis.startIndex * analysis.samplePeriodUs, 3)} – ${formatNumber(analysis.endIndex * analysis.samplePeriodUs, 3)} µs` : "—"}</dd></div>
        <div className="iw-metric-shape"><dt>SHAPE <Prov kind="DERIVED" /></dt><dd>{analysis && !showStream ? analysis.shapes.join(" · ") : "—"}</dd></div>
        {pulse && !showStream && <div className="iw-metric-actions">
          <button type="button" className="iw-text-link" onClick={() => prefs.openEvent(pulse.id)}>INSPECT EVENT <span aria-hidden="true">→</span></button>
          {integrationWindow && <button type="button" className="iw-text-link muted" onClick={() => prefs.setWindow(pulse.id, null)}>RESET WINDOW</button>}
        </div>}
      </dl>
    </div>
    <p className="iw-panel-foot">{unit === "mFS" ? "UNITS: mFS = 1/1000 OF SOUND-CARD FULL SCALE. ENTER AN INPUT CALIBRATION IN SIGNAL TO SHOW mV." : "mV DERIVED FROM YOUR INPUT CALIBRATION."} DRAG t₀ / t₁ TO CHANGE THE INTEGRATION WINDOW. AREA IS NOT ENERGY.</p>
    <span className="iw-plus" aria-hidden="true">+</span>
  </section>;
}

// --- Detector status --------------------------------------------------------------------

function DetectorWireframe({ live }: { live: boolean }) {
  // Isometric sketch of the V1.2 board in its metal case: lid, PCB, four photodiodes.
  const iso = (x: number, y: number, z: number) => `${100 + (x - y) * 0.87},${40 + (x + y) * 0.5 - z}`;
  const box = (x0: number, y0: number, x1: number, y1: number, z: number) => `M${iso(x0, y0, z)} L${iso(x1, y0, z)} L${iso(x1, y1, z)} L${iso(x0, y1, z)} Z`;
  return <svg className={`iw-detector-wire ${live ? "live" : ""}`} viewBox="0 0 200 120" aria-hidden="true">
    <path d={box(0, 0, 80, 45, 46)} className="w-lid" />
    {[[0, 0], [80, 0], [80, 45], [0, 45]].map(([x, y]) => <line key={`${x}${y}`} x1={iso(x, y, 46).split(",")[0]} y1={iso(x, y, 46).split(",")[1]} x2={iso(x, y, 0).split(",")[0]} y2={iso(x, y, 0).split(",")[1]} className="w-edge" />)}
    <path d={box(0, 0, 80, 45, 0)} className="w-case" />
    <path d={box(8, 6, 72, 39, 18)} className="w-pcb" />
    {[0, 1, 2, 3].map((index) => <path key={index} d={box(14 + index * 9, 14, 20 + index * 9, 30, 21)} className="w-diode" />)}
    <path d={box(52, 16, 64, 28, 21)} className="w-chip" />
    <line x1={iso(80, 22, 10).split(",")[0]} y1={iso(80, 22, 10).split(",")[1]} x2="196" y2="112" className="w-cable" />
  </svg>;
}

type StatusProps = {
  demo: boolean; connected: boolean; calibrated: boolean; locked: boolean; inputLabel: string; mode: string;
  thresholdSigma: number; noise: number; sampleRate: number; clipFraction: number; networkJoined: boolean;
  connectedAt: number | null; calibration: InputCalibration; peerCount: number;
};

export function DetectorStatus(props: StatusProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const uptime = props.connectedAt ? Math.floor((now - props.connectedAt) / 1000) : 0;
  const hhmmss = `${String(Math.floor(uptime / 3600)).padStart(2, "0")}:${String(Math.floor(uptime / 60) % 60).padStart(2, "0")}:${String(uptime % 60).padStart(2, "0")}`;
  const state = props.demo ? "DEMO" : props.connected ? props.calibrated ? "ONLINE" : "CALIBRATE" : "OFFLINE";
  const unit = amplitudeUnit(props.calibration);
  const rows: [string, string, "ok" | "warn" | "off"][] = [
    ["INPUT", props.connected ? props.inputLabel : "—", props.connected ? "ok" : "off"],
    ["MODE", props.mode.toUpperCase(), "ok"],
    ["CALIBRATION", props.calibrated ? props.locked ? "LOCKED" : "ADAPTIVE" : props.connected ? "REQUIRED" : "—", props.calibrated ? "ok" : props.connected ? "warn" : "off"],
    ["CLIPPING", props.connected ? `${(props.clipFraction * 100).toFixed(1)} %` : "—", props.clipFraction > 0.01 ? "warn" : props.connected ? "ok" : "off"],
    ["NETWORK", props.networkJoined ? "SHARING" : "PRIVATE", props.networkJoined ? "ok" : "off"],
  ];
  return <section className="iw-panel iw-status" aria-labelledby="detector-status-title">
    <PanelHeading title={<span id="detector-status-title">DETECTOR STATUS</span>} meta={<span className="iw-live-state"><StatusDot state={props.demo ? "demo" : props.connected && props.calibrated ? "live" : props.connected ? "warn" : "off"} />{state}</span>} />
    <DetectorWireframe live={props.connected && props.calibrated} />
    <ul className="iw-status-rows">
      {rows.map(([label, value, tone]) => <li key={label}><StatusDot state={tone === "ok" ? "ok" : tone === "warn" ? "warn" : "off"} /><span>{label}</span><b title={value}>{value}</b></li>)}
    </ul>
    <dl className="iw-status-foot">
      <div><dt>THRESHOLD</dt><dd>{props.calibrated ? `${props.thresholdSigma.toFixed(1)}σ · ${formatNumber(toDisplayAmplitude(props.noise * props.thresholdSigma, props.calibration))} ${unit}` : "—"}</dd></div>
      <div><dt>SAMPLE RATE</dt><dd>{props.connected ? `${(props.sampleRate / 1000).toFixed(1)} kHz` : "—"}</dd></div>
      <div><dt>COINCIDENCE WINDOW</dt><dd>{props.peerCount > 0 ? `±500 ms · ${props.peerCount + 1} STATIONS` : "SINGLE DETECTOR"}</dd></div>
      <div><dt>UPTIME</dt><dd>{props.connected ? hhmmss : "—"}</dd></div>
    </dl>
    <span className="iw-plus" aria-hidden="true">+</span>
  </section>;
}
