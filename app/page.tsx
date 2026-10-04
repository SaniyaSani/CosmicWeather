"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, BookOpen, Cable, CircleCheck, Cloud, Cpu, EyeOff, MoonStar, Radio, Rocket, ShieldCheck, Sparkles, TriangleAlert, Volume2, VolumeX, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { CosmicWeather } from "@/components/cosmic-weather/cosmic-weather";
import { SkyCosmic } from "@/components/cosmic-weather/sky-cosmic";
import { temporalOverlaps } from "@/lib/cosmic/interpretation";
import { loadCorrectionConfig } from "@/lib/cosmic/pressure";
import { useCosmicSnapshot } from "@/lib/cosmic/use-cosmic-snapshot";
import { CoincidenceViewer, EventInspector, RecentSignals, SignalGallery, TopSignalsTable, useAnalyzed } from "@/components/iw/archive";
import { BreathingBuildings } from "@/components/iw/breathing-buildings";
import { BuildGuide } from "@/components/iw/build-guide";
import { HeroObservation } from "@/components/iw/hero-observation";
import { CalibrationControl, DetectorStatus, LiveSignal, type SignalPrefs } from "@/components/iw/instrument";
import { NetworkMap, ThresholdSweep } from "@/components/iw/lab-parts";
import { LayerSwitcher, LayerTransition, NAV, type Layer, type View } from "@/components/iw/layer-switcher";
import { PanelHeading, Prov, StatusDot } from "@/components/iw/primitives";
import { WaveformPlot } from "@/components/iw/waveform";
import { DEFAULT_LOCATION, POLL_MS } from "@/lib/cosmic/config";
import { recordExposure, recordPulse } from "@/lib/cosmic/detector-store";
import { amplitudeUnit, analyzePulse, type InputCalibration } from "@/lib/signal/analysis";
import { loadArchive, saveArchive } from "@/lib/signal/archive";
import { findCoincidences, type StationEvents } from "@/lib/signal/coincidence";
import type { PulseMetrics, PulseRecord, RayEvent, Station, ThresholdPoint } from "@/lib/signal/types";

type ModelContext = {
  registerTool(tool: {
    name: string; title: string; description: string; inputSchema: object;
    execute(input: unknown): unknown | Promise<unknown>;
    annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  }, options?: { signal?: AbortSignal }): void | Promise<void>;
};

type SavedCalibration = {
  baseline: number; noise: number; thresholdSigma: number; sampleRate: number;
  inputLabel: string; calibratedAt: number; detectorMode: string; polarity: string; highPass: boolean;
};
type PendingPulse = { startSample: number; need: number; segments: number[][]; clipped: boolean };

const PRE_TRIGGER = 16;

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function robustSigma(values: number[]) {
  if (!values.length) return 0;
  const centre = median(values);
  return 1.4826 * median(values.map((value) => Math.abs(value - centre)));
}

function orientedValue(value: number, polarity: string) {
  if (polarity === "negative") return -value;
  if (polarity === "positive") return value;
  return Math.abs(value);
}

function countCrossings(values: number[], threshold: number, refractorySamples: number, polarity: string) {
  let count = 0; let previousAbove = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    if (orientedValue(values[index], polarity) > threshold) {
      if (count === 0 || index - previousAbove > refractorySamples) count += 1;
      previousAbove = index;
    }
  }
  return count;
}

function chooseAutomaticThreshold(values: number[], sigma: number, sampleRate: number, polarity: string, maxFalseHz: number) {
  const duration = values.length / sampleRate;
  const refractory = Math.round(.003 * sampleRate);
  const table: ThresholdPoint[] = [];
  for (let k = 6; k <= 25; k += .5) {
    table.push({ sigma: k, rate: duration ? countCrossings(values, k * sigma, refractory, polarity) / duration : 0 });
  }
  const plateauRate = table.at(-1)?.rate ?? 0;
  const target = 1.2 * plateauRate + maxFalseHz;
  return { chosen: table.find((point) => point.rate <= target)?.sigma ?? 25, table };
}

/** Clearly labelled sample stations keep the network map legible offline; they are never stored. */
const SAMPLE_STATIONS: Station[] = [
  { id: "zurich", name: "Zürich", latitude: 47.3769, longitude: 8.5417, events: 38, lastSeen: 0, sample: true },
  { id: "basel", name: "Basel", latitude: 47.5596, longitude: 7.5886, events: 24, lastSeen: 0, sample: true },
  { id: "bern", name: "Bern", latitude: 46.948, longitude: 7.4474, events: 17, lastSeen: 0, sample: true },
  { id: "geneva", name: "Geneva", latitude: 46.2044, longitude: 6.1432, events: 31, lastSeen: 0, sample: true },
  { id: "lausanne", name: "Lausanne", latitude: 46.5197, longitude: 6.6323, events: 19, lastSeen: 0, sample: true },
  { id: "st-gallen", name: "St. Gallen", latitude: 47.4245, longitude: 9.3767, events: 12, lastSeen: 0, sample: true },
];

const JOURNEY_STEPS = [
  { title: "From space", kicker: "1 · COSMIC RAY", body: "A high-energy particle races through space and reaches Earth. Most primary cosmic rays are atomic nuclei, especially protons.", icon: Rocket },
  { title: "Air shower", kicker: "2 · ATMOSPHERE", body: "It collides with a molecule high in the atmosphere. The collision creates a shower of new secondary particles.", icon: Cloud },
  { title: "A muon appears", kicker: "3 · MUON", body: "One of those particles can be a muon. Muons move extremely fast, so many survive the trip down to the ground.", icon: Sparkles },
  { title: "Tiny pulse", kicker: "4 · DETECTOR", body: "A passing particle deposits a little energy in the light-tight sensor. The electronics amplify the tiny electrical pulse.", icon: Cpu },
  { title: "Visible event", kicker: "5 · COSMIC RAIN", body: "Cosmic Rain records the time and relative signal size, then turns that real pulse into a luminous trail.", icon: Zap },
];

function readStationId() {
  if (typeof window === "undefined") return "station-preview";
  try {
    const existing = window.localStorage.getItem("iw-station-id") ?? window.localStorage.getItem("muonverse-station-id");
    if (existing) { window.localStorage.setItem("iw-station-id", existing); return existing; }
    const id = `station-${crypto.randomUUID().slice(0, 8)}`;
    window.localStorage.setItem("iw-station-id", id);
    return id;
  } catch { return "station-preview"; }
}

const INPUT_CAL_KEY = "iw-input-calibration-v1";
function readInputCalibration(): InputCalibration {
  if (typeof window === "undefined") return { mvPerFs: null };
  try { return { mvPerFs: null, ...JSON.parse(window.localStorage.getItem(INPUT_CAL_KEY) ?? "{}") as Partial<InputCalibration> }; } catch { return { mvPerFs: null }; }
}

const VIEW_IDS = NAV.map((item) => item.id);
function readHashView(): View | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace("#", "");
  return (VIEW_IDS as string[]).includes(hash) ? hash as View : null;
}

/** DEMO ONLY — synthetic waveform generator; never used for real detector data. */
function makeDemoPulse(id: number, at: number, signal: number): PulseRecord {
  const sampleRate = 48_000; const dt = 1e6 / sampleRate; const noise = .0016; const trigger = 40;
  const roll = Math.random();
  const variant = roll < .72 ? "regular" : roll < .8 ? "broad" : roll < .87 ? "double" : roll < .94 ? "noisy" : "clipped";
  const amplitude = .03 + signal / 650;
  const tauFall = variant === "broad" ? 11 : 2.2 + Math.random() * 1.2; const tauRise = variant === "broad" ? 2.2 : .55;
  const shape = (t: number) => (t <= 0 ? 0 : (Math.exp(-t / tauFall) - Math.exp(-t / tauRise)) / (1 - tauRise / tauFall));
  const second = 6 + Math.random() * 6;
  const samples = Array.from({ length: 192 }, (_, index) => {
    const t = index - trigger + .4;
    let value = -amplitude * shape(t);
    if (variant === "double") value += -amplitude * .7 * shape(t - second);
    if (variant === "noisy") value += Math.sin(index * .9) * amplitude * .25 * Math.exp(-Math.abs(index - 110) / 40);
    if (variant === "clipped") value = Math.max(value * 2.4, -.1);
    return value + (Math.random() - .5) * 2 * noise;
  });
  const analysis = analyzePulse(samples, { polarity: "negative", noiseSigma: noise, samplePeriodUs: dt, clipped: variant === "clipped" });
  const signedArea = samples.reduce((sum, value) => sum + value * (dt / 1000), 0);
  return {
    id, at, source: "demo", samples, samplePeriodUs: dt, noise, threshold: noise * 7, mode: "demo", inputLabel: "Demo stream",
    peak: analysis.peak, area: Math.abs(analysis.area) / 1000, signedArea, widthMs: analysis.fwhmUs / 1000, snr: analysis.snr,
    polarity: "negative", sampleRate, quality: variant === "clipped" ? 0 : Math.min(98, Math.round(55 + analysis.snr)),
    accepted: variant !== "clipped" && variant !== "noisy", reason: variant === "clipped" ? "raw input clipped" : variant === "noisy" ? "continuous noise" : "particle-like pulse",
    clipped: variant === "clipped",
  };
}

export default function Home() {
  const [view, setView] = useState<View>("sky");
  const [layer, setLayer] = useState<Layer>("sky");
  const [transition, setTransition] = useState<{ token: number; to: Layer }>({ token: 0, to: "sky" });
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [archive, setArchive] = useState<PulseRecord[]>([]);
  const [inspectId, setInspectId] = useState<number | null>(null);
  const [windows, setWindows] = useState<Record<string, [number, number]>>({});
  const [inputCalibration, setInputCalibration] = useState<InputCalibration>({ mvPerFs: null });
  const [timeFilter, setTimeFilter] = useState<{ from: number; to: number } | null>(null);
  const [peerEvents, setPeerEvents] = useState<StationEvents[]>([]);
  const [place, setPlace] = useState({ ...DEFAULT_LOCATION });

  const changeLayer = useCallback((next: Layer) => {
    if (next === layer) return;
    setTransition({ token: Date.now(), to: next });
    setLayer(next);
  }, [layer]);

  const goTo = useCallback((next: View, anchor?: string) => {
    setView(next);
    if (next === "sky") changeLayer("sky");
    if (next === "buildings") changeLayer("air");
    try { window.history.replaceState(null, "", `#${next}`); } catch { /* sandboxed */ }
    window.setTimeout(() => {
      if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    }, 30);
  }, [changeLayer]);

  useEffect(() => {
    // Browser-only state is read after hydration so server and client markup match.
    const frame = window.requestAnimationFrame(() => {
      const initial = readHashView();
      if (initial) { setView(initial); if (initial === "buildings") setLayer("air"); }
      setArchive(loadArchive());
      setInputCalibration(readInputCalibration());
    });
    const onHash = () => { const next = readHashView(); if (next) { setView(next); if (next === "sky") setLayer("sky"); if (next === "buildings") setLayer("air"); } };
    window.addEventListener("hashchange", onHash);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("hashchange", onHash); };
  }, []);

  const [lessonStep, setLessonStep] = useState(0);
  const [detectorMode, setDetectorMode] = useState("electron");
  const [pulsePolarity, setPulsePolarity] = useState("negative");
  const [thresholdSigma, setThresholdSigma] = useState(7);
  const [highPassEnabled, setHighPassEnabled] = useState(true);
  const [noiseFloor, setNoiseFloor] = useState(0.01);
  const [baselineOffset, setBaselineOffset] = useState(0);
  const [rawPeak, setRawPeak] = useState(0);
  const [clipFraction, setClipFraction] = useState(0);
  const [inputPeak, setInputPeak] = useState(0);
  const [scopeSamples, setScopeSamples] = useState<number[]>(Array(256).fill(0));
  const [pulseLog, setPulseLog] = useState<PulseRecord[]>([]);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationSeconds, setCalibrationSeconds] = useState(10);
  const [calibrationLocked, setCalibrationLocked] = useState(true);
  const [thresholdTable, setThresholdTable] = useState<ThresholdPoint[]>([]);
  const [calibratedAt, setCalibratedAt] = useState<number | null>(null);
  const [savedCalibration, setSavedCalibration] = useState<SavedCalibration | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = window.localStorage.getItem("iw-calibration-v2") ?? window.localStorage.getItem("muonverse-calibration-v2");
      return saved ? JSON.parse(saved) as SavedCalibration : null;
    } catch { return null; }
  });
  const [calibrationReady, setCalibrationReady] = useState(false);
  const [sampleRate, setSampleRate] = useState(48_000);
  const [paused, setPaused] = useState(false);
  const [sound, setSound] = useState(false);
  const [detectorConnected, setDetectorConnected] = useState(false);
  const [detectorMessage, setDetectorMessage] = useState("Demo stream");
  const [connectionGuideOpen, setConnectionGuideOpen] = useState(false);
  const [inputLoading, setInputLoading] = useState(false);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState("");
  const [lastEvent, setLastEvent] = useState<RayEvent | null>(null);
  const [events, setEvents] = useState<RayEvent[]>([]);
  const [minuteBins, setMinuteBins] = useState([2, 3, 1, 4, 2, 3, 5, 4, 3, 4, 6, 3]);
  const [stations, setStations] = useState<Station[]>(SAMPLE_STATIONS);
  const [networkJoined, setNetworkJoined] = useState(false);
  const [networkBusy, setNetworkBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(0);
  const stationId = useMemo(() => readStationId(), []);
  const stationLocation = useRef({ latitude: 47.3769, longitude: 8.5417, name: "My detector" });
  const inputStream = useRef<MediaStream | null>(null);
  const inputAudioContext = useRef<AudioContext | null>(null);
  const inputHighPass = useRef<BiquadFilterNode | null>(null);
  const inputWorklet = useRef<AudioWorkletNode | null>(null);
  const inputFrame = useRef<number | null>(null);
  const lastInputPulse = useRef(0);
  const recentTriggerTimes = useRef<number[]>([]);
  const lastScopeUpdate = useRef(0);
  const noiseFloorRef = useRef(0.01);
  const baselineRef = useRef(0);
  const clipFractionRef = useRef(0);
  const thresholdSigmaRef = useRef(7);
  const detectorModeRef = useRef("electron");
  const pulsePolarityRef = useRef("negative");
  const calibrationSamples = useRef<number[]>([]);
  const calibrationTargetSamples = useRef(0);
  const calibratingRef = useRef(false);
  const calibrationReadyRef = useRef(false);
  const calibrationLockedRef = useRef(true);
  const streamPosition = useRef(0);
  const deadUntilSample = useRef(0);
  const preTriggerHistory = useRef<number[]>(Array(PRE_TRIGGER).fill(0));
  const pendingPulse = useRef<PendingPulse | null>(null);
  const audioContext = useRef<AudioContext | null>(null);

  useEffect(() => { thresholdSigmaRef.current = thresholdSigma; }, [thresholdSigma]);
  useEffect(() => { calibrationLockedRef.current = calibrationLocked; }, [calibrationLocked]);
  useEffect(() => { detectorModeRef.current = detectorMode; }, [detectorMode]);
  useEffect(() => { pulsePolarityRef.current = pulsePolarity; }, [pulsePolarity]);
  useEffect(() => {
    if (inputHighPass.current) inputHighPass.current.frequency.value = highPassEnabled ? 300 : 10;
  }, [highPassEnabled]);
  useEffect(() => {
    const first = window.setTimeout(() => setClockNow(Date.now()), 0);
    const timer = window.setInterval(() => setClockNow(Date.now()), 10_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);

  const playSound = useCallback((signal: number) => {
    if (!sound) return;
    const audio = audioContext.current ?? new AudioContext(); audioContext.current = audio;
    const oscillator = audio.createOscillator(); const gain = audio.createGain(); oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(480 + signal * 4, audio.currentTime); oscillator.frequency.exponentialRampToValueAtTime(150, audio.currentTime + .13);
    gain.gain.setValueAtTime(.0001, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.09, audio.currentTime + .008); gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .18);
    oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .2);
  }, [sound]);

  const shareEvent = useCallback(async (event: RayEvent) => {
    if (!networkJoined) return;
    try {
      await fetch("/api/network", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        stationId, stationName: stationLocation.current.name, latitude: stationLocation.current.latitude,
        longitude: stationLocation.current.longitude, signal: event.signal, source: event.source, occurredAt: event.at,
      }) });
    } catch { setNotice("The network is temporarily unreachable. Your detector view is still running."); }
  }, [networkJoined, stationId]);

  const registerHit = useCallback((signal: number, source: "demo" | "audio", metrics?: PulseMetrics) => {
    const id = Date.now() + Math.random();
    const at = Date.now();
    let eventMetrics = metrics;
    if (source === "demo" && !metrics) {
      // DEMO ONLY: synthetic pulses with a plausible detector shape (fast rise,
      // exponential decay) and occasional broad / double / noisy / clipped
      // variants so the shape taxonomy can be explored without hardware.
      const record = makeDemoPulse(id, at, signal);
      eventMetrics = record;
      setPulseLog((current) => [record, ...current].slice(0, 80));
    }
    const event = { id, at, signal: Math.round(signal), source, metrics: eventMetrics };
    setLastEvent(event); setEvents((current) => [event, ...current].slice(0, 40));
    // The demo sparkline is illustrative; real detector rates come only from counted pulses.
    if (source === "demo") setMinuteBins((current) => [...current.slice(1), Math.max(1, Math.round(1 + signal / 22 + Math.random() * 2))]);
    if (source === "audio") recordPulse(detectorModeRef.current, at);
    playSound(event.signal); void shareEvent(event);
  }, [playSound, shareEvent]);

  useEffect(() => {
    if (paused || detectorConnected) return;
    let timeout = 0;
    const schedule = () => { timeout = window.setTimeout(() => { registerHit(24 + Math.random() * 70, "demo"); schedule(); }, 1_150 + Math.random() * 2_900); };
    schedule(); return () => window.clearTimeout(timeout);
  }, [paused, detectorConnected, registerHit]);

  useEffect(() => {
    const loadStations = async () => {
      try {
        const response = await fetch("/api/network", { cache: "no-store" }); if (!response.ok) return;
        const data = await response.json() as { stations?: Station[] };
        if (data.stations?.length) { const ids = new Set(data.stations.map((station) => station.id)); setStations([...data.stations, ...SAMPLE_STATIONS.filter((station) => !ids.has(station.id))]); }
      } catch { /* Labeled sample stations keep the prototype useful offline. */ }
    };
    void loadStations(); const interval = window.setInterval(loadStations, 12_000); return () => window.clearInterval(interval);
  }, []);

  const rate = useMemo(() => detectorConnected
    ? events.filter((event) => event.source === "audio" && clockNow - event.at < 60_000).length
    : Math.max(events.filter((event) => !clockNow || clockNow - event.at < 60_000).length, Math.round(minuteBins.slice(-4).reduce((sum, value) => sum + value, 0) / 4)), [clockNow, events, minuteBins, detectorConnected]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const report = () => undefined;
    try {
      void Promise.resolve(context.registerTool({
        name: "trigger_demo_detection",
        title: "Trigger demo detection",
        description: "Create one simulated cosmic-ray detector event in the visible Cosmic Rain sky.",
        inputSchema: {
          type: "object", properties: { signal: { type: "number", minimum: 10, maximum: 100 } },
          required: ["signal"], additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          const signal = Number((input as { signal?: unknown })?.signal);
          if (!Number.isFinite(signal) || signal < 10 || signal > 100) throw new Error("signal must be between 10 and 100");
          registerHit(signal, "demo");
          return { created: true, signal: Math.round(signal), source: "demo" };
        },
      }, { signal: lifecycle.signal })).catch(report);
      void Promise.resolve(context.registerTool({
        name: "read_detector_status",
        title: "Read detector status",
        description: "Read the current Invisible Weather detector mode, rate and network status without changing anything.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute() { return { mode: detectorConnected ? "audio input" : "demo", paused, eventsPerMinute: rate, networkJoined }; },
      }, { signal: lifecycle.signal })).catch(report);
    } catch { report(); }
    return () => lifecycle.abort();
  }, [networkJoined, paused, rate, registerHit, detectorConnected]);

  const findAudioInputs = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice("Audio input is not available in this browser. Demo mode stays fully available.");
      return;
    }
    setInputLoading(true);
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      permissionStream.getTracks().forEach((track) => track.stop());
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
      setAudioInputs(devices);
      const preferred = devices.find((device) => /usb|pnp|cm108|headset|external|line.?in/i.test(device.label))
        ?? devices.find((device) => !/macbook|internal|built.?in/i.test(device.label))
        ?? devices[0];
      setSelectedAudioInput(preferred?.deviceId ?? "");
      if (!devices.length) setNotice("No microphone or USB sound-card input was found.");
    } catch {
      setNotice("Invisible Weather needs microphone permission to read the detector's audio pulses.");
    } finally { setInputLoading(false); }
  };

  const finishCalibration = (values: number[], inputLabel: string, contextSampleRate: number) => {
    const base = median(values);
    const centred = values.map((value) => value - base);
    const sigma = Math.max(robustSigma(centred), 1e-6);
    const { chosen, table } = chooseAutomaticThreshold(
      centred,
      sigma,
      contextSampleRate,
      pulsePolarityRef.current,
      detectorModeRef.current === "sky" ? .02 : detectorModeRef.current === "air" ? .05 : .1,
    );
    baselineRef.current = base; noiseFloorRef.current = sigma; thresholdSigmaRef.current = chosen;
    calibrationReadyRef.current = true; calibrationLockedRef.current = true;
    setBaselineOffset(base); setNoiseFloor(sigma); setThresholdSigma(chosen); setThresholdTable(table);
    setCalibrationReady(true); setCalibrationLocked(true); setIsCalibrating(false); setCalibrationProgress(1);
    const time = Date.now(); setCalibratedAt(time);
    const profile: SavedCalibration = {
      baseline: base, noise: sigma, thresholdSigma: chosen, sampleRate: contextSampleRate,
      inputLabel, calibratedAt: time, detectorMode: detectorModeRef.current, polarity: pulsePolarityRef.current, highPass: highPassEnabled,
    };
    setSavedCalibration(profile);
    try { window.localStorage.setItem("iw-calibration-v2", JSON.stringify(profile)); } catch { /* Optional persistence. */ }
    const warning = clipFractionRef.current > .01 ? " Input clipping was detected—lower the input gain and recalibrate." : "";
    setNotice(`Automatic threshold found: ${chosen.toFixed(1)}σ above robust noise.${warning}`);
  };

  const restoreSavedCalibration = () => {
    if (!savedCalibration || !detectorConnected) return;
    if (savedCalibration.inputLabel !== detectorMessage || Math.abs(savedCalibration.sampleRate - sampleRate) > 1) {
      setNotice(`That calibration belongs to “${savedCalibration.inputLabel}”. Select the same input or make a new calibration.`);
      return;
    }
    baselineRef.current = savedCalibration.baseline; noiseFloorRef.current = savedCalibration.noise;
    thresholdSigmaRef.current = savedCalibration.thresholdSigma; calibrationReadyRef.current = true;
    calibrationLockedRef.current = true;
    setBaselineOffset(savedCalibration.baseline); setNoiseFloor(savedCalibration.noise);
    setThresholdSigma(savedCalibration.thresholdSigma); setCalibrationReady(true); setCalibrationLocked(true);
    setDetectorMode(savedCalibration.detectorMode); detectorModeRef.current = savedCalibration.detectorMode;
    setPulsePolarity(savedCalibration.polarity); pulsePolarityRef.current = savedCalibration.polarity;
    setHighPassEnabled(savedCalibration.highPass ?? true);
    if (inputHighPass.current) inputHighPass.current.frequency.value = savedCalibration.highPass === false ? 10 : 300;
    setCalibratedAt(savedCalibration.calibratedAt); setThresholdTable([]);
    setNotice("Saved calibration loaded and locked. Keep the same hardware gain for a fair comparison.");
  };

  const disconnectDetector = async () => {
    if (inputFrame.current !== null) cancelAnimationFrame(inputFrame.current);
    inputFrame.current = null;
    inputStream.current?.getTracks().forEach((track) => track.stop());
    inputStream.current = null;
    try { await inputAudioContext.current?.close(); } catch { /* The audio device may already be gone. */ }
    if (inputWorklet.current) inputWorklet.current.port.onmessage = null;
    inputAudioContext.current = null; inputHighPass.current = null; inputWorklet.current = null;
    recentTriggerTimes.current = []; lastInputPulse.current = 0;
    streamPosition.current = 0; deadUntilSample.current = 0; pendingPulse.current = null;
    preTriggerHistory.current = Array(PRE_TRIGGER).fill(0);
    calibratingRef.current = false; setIsCalibrating(false);
    calibrationReadyRef.current = false; setCalibrationReady(false);
    setCalibrationProgress(0); setDetectorConnected(false); setDetectorMessage("Demo stream"); setConnectedAt(null);
    setScopeSamples(Array(256).fill(0)); setRawPeak(0); setInputPeak(0); setClipFraction(0);
  };

  const connectDetector = async () => {
    if (!selectedAudioInput) { setNotice("Choose a microphone or USB sound-card input first."); return; }
    setInputLoading(true);
    try {
      await disconnectDetector();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: selectedAudioInput }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        video: false,
      });
      const context = new AudioContext({ sampleRate: 48_000 });
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const highPass = context.createBiquadFilter();
      highPass.type = "highpass"; highPass.frequency.value = highPassEnabled ? 300 : 10; highPass.Q.value = .7;
      const rawAnalyser = context.createAnalyser();
      rawAnalyser.fftSize = 2048; rawAnalyser.smoothingTimeConstant = 0; source.connect(rawAnalyser);
      await context.audioWorklet.addModule("/audio-detector-processor.js");
      const worklet = new AudioWorkletNode(context, "iw-stream-tap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const silentOutput = context.createGain(); silentOutput.gain.value = 0;
      source.connect(highPass).connect(worklet).connect(silentOutput).connect(context.destination);
      const rawSamples = new Float32Array(rawAnalyser.fftSize);
      const selected = audioInputs.find((device) => device.deviceId === selectedAudioInput);
      inputStream.current = stream; inputAudioContext.current = context; inputHighPass.current = highPass; inputWorklet.current = worklet;
      setDetectorConnected(true); setDetectorMessage(selected?.label || "Audio detector live"); setPaused(false); setConnectedAt(Date.now());
      setSampleRate(context.sampleRate); setEvents([]); setPulseLog([]); setMinuteBins(Array(12).fill(0)); setLastEvent(null); setConnectionGuideOpen(false);
      recentTriggerTimes.current = []; lastInputPulse.current = 0;
      streamPosition.current = 0; deadUntilSample.current = 0; pendingPulse.current = null;
      preTriggerHistory.current = Array(PRE_TRIGGER).fill(0);
      calibrationReadyRef.current = false; setCalibrationReady(false); goTo("sky");

      let lastBlockUi = 0;
      const emitPulse = (wave: number[], clipped: boolean) => {
        const polaritySetting = pulsePolarityRef.current;
        let peak = 0; let peakIndex = 0;
        for (let index = 0; index < wave.length; index += 1) {
          const value = orientedValue(wave[index], polaritySetting);
          if (value > peak) { peak = value; peakIndex = index; }
        }
        const signedPeak = wave[peakIndex];
        const polarity: "positive" | "negative" = signedPeak >= 0 ? "positive" : "negative";
        const halfPeak = peak * .5;
        let left = peakIndex; let right = peakIndex;
        while (left > 0 && orientedValue(wave[left], polaritySetting) > halfPeak) left -= 1;
        while (right < wave.length - 1 && orientedValue(wave[right], polaritySetting) > halfPeak) right += 1;
        const widthMs = ((right - left) / context.sampleRate) * 1000;
        let area = 0; let signedArea = 0;
        for (const value of wave) { area += Math.abs(value) * (1000 / context.sampleRate); signedArea += value * (1000 / context.sampleRate); }
        const snr = peak / Math.max(noiseFloorRef.current, 1e-6);
        const threshold = noiseFloorRef.current * thresholdSigmaRef.current;
        const occupancy = wave.reduce((count, value) => count + (orientedValue(value, polaritySetting) > threshold * .55 ? 1 : 0), 0) / wave.length;
        const limits = detectorModeRef.current === "alpha" ? { min: .15, max: 5 } : detectorModeRef.current === "explore" ? { min: .015, max: 8 } : { min: .015, max: 1.5 };
        const now = performance.now();
        recentTriggerTimes.current = [...recentTriggerTimes.current.filter((time) => now - time < 2_000), now];
        let reason = "particle-like pulse";
        if (clipped) reason = "raw input clipped";
        else if (detectorModeRef.current === "sky" && recentTriggerTimes.current.length > 3) reason = "burst / movement";
        else if (occupancy > .22) reason = "continuous noise";
        else if (widthMs < limits.min) reason = "too narrow";
        else if (widthMs > limits.max) reason = "too broad";
        else if (snr < thresholdSigmaRef.current) reason = "below SNR threshold";
        const widthScore = widthMs >= limits.min && widthMs <= limits.max ? 30 : 5;
        const snrScore = Math.min(55, Math.max(0, (snr / Math.max(thresholdSigmaRef.current, 1)) * 38));
        const isolationScore = recentTriggerTimes.current.length <= 3 ? 15 : 0;
        const quality = clipped ? 0 : Math.round(Math.min(100, snrScore + widthScore + isolationScore));
        const accepted = reason === "particle-like pulse" && quality >= 55;
        const metrics: PulseMetrics = { peak, area, signedArea, widthMs, snr, polarity, sampleRate: context.sampleRate, quality };
        const storedSamples = wave.length <= 512 ? wave : Array.from({ length: 512 }, (_, index) => wave[Math.min(wave.length - 1, Math.round((index / 511) * (wave.length - 1)))]);
        const record: PulseRecord = {
          ...metrics, id: Date.now() + Math.random(), at: Date.now(), accepted, reason, source: "audio", samples: storedSamples,
          samplePeriodUs: (wave.length / storedSamples.length) * (1e6 / context.sampleRate), clipped, mode: detectorModeRef.current,
          noise: noiseFloorRef.current, threshold, inputLabel: selected?.label || "Audio detector",
        };
        setPulseLog((current) => [record, ...current].slice(0, 80));
        if (accepted) registerHit(Math.max(10, Math.min(100, quality)), "audio", metrics);
      };

      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const rawBlock = Array.from(event.data);
        const blockStart = streamPosition.current;
        streamPosition.current += rawBlock.length;
        if (calibratingRef.current) {
          calibrationSamples.current.push(...rawBlock);
          const progress = Math.min(1, calibrationSamples.current.length / Math.max(1, calibrationTargetSamples.current));
          setCalibrationProgress(progress);
          if (calibrationSamples.current.length >= calibrationTargetSamples.current) {
            calibratingRef.current = false;
            const finished = calibrationSamples.current.slice(0, calibrationTargetSamples.current);
            finishCalibration(finished, selected?.label || "Audio detector live", context.sampleRate);
          }
          return;
        }

        const blockMedian = median(rawBlock);
        const centred = rawBlock.map((value) => value - baselineRef.current);
        const threshold = Math.max(1e-6, noiseFloorRef.current * thresholdSigmaRef.current);
        const orientedPeak = centred.reduce((maximum, value) => Math.max(maximum, orientedValue(value, pulsePolarityRef.current)), 0);
        if (performance.now() - lastBlockUi > 120) { lastBlockUi = performance.now(); setInputPeak(orientedPeak); }
        if (calibrationReadyRef.current && !calibrationLockedRef.current && !pendingPulse.current && blockStart >= deadUntilSample.current && orientedPeak <= threshold) {
          const updatedBaseline = .99 * baselineRef.current + .01 * blockMedian;
          const updatedNoise = .995 * noiseFloorRef.current + .005 * Math.max(robustSigma(centred), 1e-6);
          baselineRef.current = updatedBaseline; noiseFloorRef.current = updatedNoise;
          if (performance.now() - lastBlockUi < 15) { setBaselineOffset(updatedBaseline); setNoiseFloor(updatedNoise); }
        }
        if (!calibrationReadyRef.current) return;

        let position = 0;
        while (position < centred.length) {
          const pending = pendingPulse.current;
          if (pending) {
            const take = Math.min(pending.need, centred.length - position);
            pending.segments.push(centred.slice(position, position + take));
            pending.need -= take; position += take;
            if (pending.need === 0) {
              pendingPulse.current = null;
              const wave = pending.segments.flat();
              deadUntilSample.current = pending.startSample + (wave.length - PRE_TRIGGER) + Math.round(.003 * context.sampleRate);
              emitPulse(wave, pending.clipped);
            }
            continue;
          }
          const searchStart = Math.max(position, deadUntilSample.current - blockStart);
          if (searchStart >= centred.length) break;
          let triggerIndex = -1;
          for (let index = searchStart; index < centred.length; index += 1) {
            if (orientedValue(centred[index], pulsePolarityRef.current) > threshold) { triggerIndex = index; break; }
          }
          if (triggerIndex < 0) break;
          const pre = [...preTriggerHistory.current, ...centred.slice(0, triggerIndex)].slice(-PRE_TRIGGER);
          const win = detectorModeRef.current === "alpha" || detectorModeRef.current === "explore" ? 2048 : 256;
          pendingPulse.current = { startSample: blockStart + triggerIndex, need: win, segments: [pre], clipped: clipFractionRef.current > .01 };
          position = triggerIndex;
        }
        preTriggerHistory.current = [...preTriggerHistory.current, ...centred].slice(-PRE_TRIGGER);
      };

      const scan = () => {
        rawAnalyser.getFloatTimeDomainData(rawSamples);
        const mean = rawSamples.reduce((sum, value) => sum + value, 0) / rawSamples.length;
        const peak = rawSamples.reduce((maximum, value) => Math.max(maximum, Math.abs(value - mean)), 0);
        const rawClipFraction = rawSamples.reduce((count, value) => count + (Math.abs(value) >= .995 ? 1 : 0), 0) / rawSamples.length;
        clipFractionRef.current = rawClipFraction;
        const now = performance.now();
        if (now - lastScopeUpdate.current > 110) {
          lastScopeUpdate.current = now;
          const stride = Math.max(1, Math.floor(rawSamples.length / 256));
          setScopeSamples(Array.from({ length: 256 }, (_, index) => rawSamples[Math.min(rawSamples.length - 1, index * stride)] - mean));
          setRawPeak(peak); setClipFraction(rawClipFraction);
        }
        inputFrame.current = requestAnimationFrame(scan);
      };
      inputFrame.current = requestAnimationFrame(scan);
    } catch {
      setNotice("I could not read that audio input. Check the sound card, cable and browser permission.");
      setDetectorConnected(false); setDetectorMessage("Demo stream");
    } finally { setInputLoading(false); }
  };

  const calibrateNoise = () => {
    if (!detectorConnected) { setNotice("Connect the detector first, then calibrate with the enclosure closed."); return; }
    calibrationSamples.current = []; calibratingRef.current = true; calibrationReadyRef.current = false;
    calibrationTargetSamples.current = Math.round(calibrationSeconds * sampleRate);
    recentTriggerTimes.current = []; lastInputPulse.current = 0;
    streamPosition.current = 0; deadUntilSample.current = 0; pendingPulse.current = null;
    preTriggerHistory.current = Array(PRE_TRIGGER).fill(0);
    setCalibrationProgress(0); setIsCalibrating(true); setCalibrationReady(false); setPulseLog([]); setEvents([]); setLastEvent(null);
    setNotice(`Measuring ${calibrationSeconds} seconds of quiet baseline. Keep the closed detector completely still.`);
  };

  useEffect(() => () => {
    if (inputFrame.current !== null) cancelAnimationFrame(inputFrame.current);
    inputStream.current?.getTracks().forEach((track) => track.stop());
    void inputAudioContext.current?.close();
  }, []);

  const joinNetwork = () => {
    setNetworkBusy(true);
    const join = (latitude: number, longitude: number) => {
      stationLocation.current = { latitude: Math.round(latitude * 100) / 100, longitude: Math.round(longitude * 100) / 100, name: "My detector" };
      setPlace({ latitude: stationLocation.current.latitude, longitude: stationLocation.current.longitude, name: "My detector" });
      setNetworkJoined(true); setNetworkBusy(false);
      setStations((current) => [{ id: stationId, name: "My detector", latitude: stationLocation.current.latitude, longitude: stationLocation.current.longitude, events: 0, lastSeen: Date.now() }, ...current.filter((station) => station.id !== stationId)]);
      setNotice("You joined the network. Location is rounded to roughly 1 km for privacy.");
    };
    if (!navigator.geolocation) { join(47.3769, 8.5417); return; }
    navigator.geolocation.getCurrentPosition((position) => join(position.coords.latitude, position.coords.longitude), () => join(47.3769, 8.5417), { enableHighAccuracy: false, timeout: 6_000 });
  };

  const changeDetectorMode = (mode: string) => {
    setDetectorMode(mode); detectorModeRef.current = mode;
    setEvents([]); setPulseLog([]); setMinuteBins(Array(12).fill(0)); setLastEvent(null);
    recentTriggerTimes.current = []; lastInputPulse.current = 0;
    if (calibrationReadyRef.current) {
      calibrationReadyRef.current = false; setCalibrationReady(false); setThresholdTable([]);
      setNotice("Detector mode changed. Run automatic calibration for this measurement mode.");
    }
  };
  const changePulsePolarity = (polarity: string) => {
    setPulsePolarity(polarity); pulsePolarityRef.current = polarity;
    if (calibrationReadyRef.current) {
      calibrationReadyRef.current = false; setCalibrationReady(false); setThresholdTable([]);
      setNotice("Pulse polarity changed. Recalibrate so the automatic threshold uses the correct direction.");
    }
  };
  const changeThreshold = (value: number) => { setThresholdSigma(value); thresholdSigmaRef.current = value; };
  const changeCalibrationLock = (locked: boolean) => { setCalibrationLocked(locked); calibrationLockedRef.current = locked; };
  const changeHighPass = (enabled: boolean) => {
    setHighPassEnabled(enabled);
    if (inputHighPass.current) inputHighPass.current.frequency.value = enabled ? 300 : 10;
    if (calibrationReadyRef.current) {
      calibrationReadyRef.current = false; setCalibrationReady(false); setThresholdTable([]);
      setNotice("The filter changed, so the old noise calibration was cleared. Please recalibrate.");
    }
  };
  const absoluteThreshold = Math.max(1e-6, noiseFloor * thresholdSigma);
  const acceptedPulses = pulseLog.filter((pulse) => pulse.accepted);
  const rejectedPulses = pulseLog.length - acceptedPulses.length;
  const latestPulse = pulseLog[0];
  const suspiciousInput = detectorConnected && /macbook microphone|internal microphone/i.test(detectorMessage);
  const signalHealth = !detectorConnected
    ? { tone: "offline", title: "No detector input", body: "Connect the AUX input or USB sound card to inspect the signal." }
    : suspiciousInput
      ? { tone: "warning", title: "Probably the wrong input", body: "This looks like the built-in microphone. Choose the external AUX or USB sound-card input." }
      : clipFraction > .01 || rawPeak >= .98
        ? { tone: "danger", title: "Input is clipping", body: "Lower the system input gain, then recalibrate. Clipped peaks cannot be measured reliably." }
        : rawPeak < .00005
          ? { tone: "warning", title: "Flat or silent signal", body: "Check the cable and battery. A light-saturated detector can also look flat, so close the metal lid." }
          : noiseFloor > .08
            ? { tone: "warning", title: "Noise is very high", body: "Keep the board still, close the box and move the cable away from chargers before calibrating." }
            : calibrationReady
              ? { tone: "good", title: "Signal ready", body: calibrationLocked ? "Calibration is locked for comparable measurements." : "Noise and baseline are adapting slowly on quiet blocks." }
              : { tone: "listening", title: "Input detected", body: "The waveform is live. Measure a quiet baseline before accepting events." };
  const openAirLab = () => {
    if (detectorModeRef.current !== "air") changeDetectorMode("air");
    goTo("signal", "calibration");
  };

  // --- Persisted archive, exposure logging, network coincidences ---------------------------------

  useEffect(() => {
    const audio = pulseLog.filter((pulse) => pulse.source === "audio");
    if (!audio.length) return;
    setArchive((current) => {
      const known = new Set(current.map((pulse) => pulse.id));
      const fresh = audio.filter((pulse) => !known.has(pulse.id));
      if (!fresh.length) return current;
      const next = [...fresh, ...current].sort((a, b) => b.at - a.at).slice(0, 300);
      saveArchive(next);
      return next;
    });
  }, [pulseLog]);

  // Live exposure: seconds during which a calibrated detector was listening.
  useEffect(() => {
    if (!detectorConnected || !calibrationReady) return;
    const timer = window.setInterval(() => recordExposure(detectorModeRef.current, POLL_MS.detectorTick / 1000), POLL_MS.detectorTick);
    return () => window.clearInterval(timer);
  }, [detectorConnected, calibrationReady]);

  useEffect(() => {
    if (view !== "signal" && view !== "sky") return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/network?events=1", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { stations?: StationEvents[] };
        if (!cancelled) setPeerEvents((data.stations ?? []).filter((station) => station.stationId !== stationId));
      } catch { /* network view stays local-only */ }
    };
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [view, stationId]);

  const allRecords = useMemo(() => {
    const ids = new Set(pulseLog.map((pulse) => pulse.id));
    return [...pulseLog, ...archive.filter((pulse) => !ids.has(pulse.id))].sort((a, b) => b.at - a.at);
  }, [pulseLog, archive]);

  const setIntegrationWindow = useCallback((id: number, next: [number, number] | null) => {
    setWindows((current) => { const copy = { ...current }; if (next) copy[String(id)] = next; else delete copy[String(id)]; return copy; });
  }, []);
  const prefs: SignalPrefs = useMemo(() => ({
    polarity: pulsePolarity as SignalPrefs["polarity"], calibration: inputCalibration, windows,
    setWindow: setIntegrationWindow, openEvent: (id: number) => setInspectId(id),
  }), [pulsePolarity, inputCalibration, windows, setIntegrationWindow]);

  const analyzed = useAnalyzed(allRecords, prefs);
  const todayStart = useMemo(() => { const day = new Date(clockNow || 0); day.setHours(0, 0, 0, 0); return day.getTime(); }, [clockNow]);
  const acceptedToday = analyzed.filter((item) => item.pulse.accepted && (item.pulse.source === "demo" || item.pulse.at >= todayStart));
  const coincidenceStations = useMemo<StationEvents[]>(() => [
    { stationId, name: "This detector", local: true, times: allRecords.filter((pulse) => pulse.source === "audio" && pulse.accepted).map((pulse) => pulse.at) },
    ...peerEvents,
  ], [stationId, allRecords, peerEvents]);
  const clusters = useMemo(() => findCoincidences(coincidenceStations, 500), [coincidenceStations]);
  const coincidentIds = useMemo(() => {
    const ids = new Set<number>();
    for (const cluster of clusters) {
      const time = cluster.times[stationId];
      if (time === undefined) continue;
      const match = allRecords.find((pulse) => pulse.at === time);
      if (match) ids.add(match.id);
    }
    return ids;
  }, [clusters, allRecords, stationId]);
  const inspectIndex = analyzed.findIndex((item) => item.pulse.id === inspectId);
  const inspected = inspectIndex >= 0 ? analyzed[inspectIndex] : null;
  const inspectedCluster = inspected ? clusters.find((cluster) => cluster.times[stationId] === inspected.pulse.at) ?? null : null;
  const recentAudio = allRecords.filter((pulse) => pulse.source === "audio" && clockNow - pulse.at < 2 * 3_600_000);
  const acceptedFraction = recentAudio.length >= 10 ? recentAudio.filter((pulse) => pulse.accepted).length / recentAudio.length : null;
  // --- Cosmic Weather on SKY: same snapshot as DATA, polled only while SKY is open.
  const detectorContext = useMemo(() => ({ connected: detectorConnected, calibrated: calibrationReady, demo: !detectorConnected, mode: detectorMode, lastPulseAt: allRecords.find((pulse) => pulse.source === "audio")?.at ?? null, clipping: clipFraction > .01, acceptedFraction }), [detectorConnected, calibrationReady, detectorMode, allRecords, clipFraction, acceptedFraction]);
  const [skyCorrection] = useState(() => loadCorrectionConfig());
  const skySnapshot = useCosmicSnapshot({ location: place, stationId: networkJoined ? stationId : undefined, detector: detectorContext, rangeMs: 24 * 3_600_000, baselineMs: 24 * 3_600_000, correction: skyCorrection, logMode: "sky", enabled: view === "sky" });
  const skyEvents = skySnapshot.derived.events;
  const relDelta = (ms: number) => { const minutes = Math.round(ms / 60_000); return Math.abs(minutes) < 120 ? `${minutes > 0 ? "+" : "−"}${Math.abs(minutes)} MIN` : `${ms > 0 ? "+" : "−"}${Math.round(Math.abs(ms) / 3_600_000)} H`; };
  const spaceNotesFor = useCallback((at: number) => temporalOverlaps(at, skyEvents.filter((event) => event.type !== "local-anomaly"))
    .slice(0, 3).map(({ event, offsetMs }) => `${event.title.toUpperCase()} ${relDelta(offsetMs)} · ${event.source}`), [skyEvents]);
  const latestLivePulse = pulseLog[0];
  const liveContext = useMemo(() => {
    if (!latestLivePulse) return [];
    const notes: { kind: "space" | "network"; text: string }[] = spaceNotesFor(latestLivePulse.at).map((text) => ({ kind: "space" as const, text: `TEMPORAL OVERLAP · ${text}` }));
    const cluster = latestLivePulse.source === "audio" ? clusters.find((item) => item.times[stationId] === latestLivePulse.at) : undefined;
    if (cluster) notes.unshift({ kind: "network", text: `NETWORK COINCIDENCE CANDIDATE · ${cluster.stations.length} STATIONS · Δt ${cluster.spanMs} MS` });
    return notes;
  }, [latestLivePulse, spaceNotesFor, clusters, stationId]);
  const skyPulseTimes = useMemo(() => allRecords.filter((pulse) => pulse.accepted && pulse.source === "audio").map((pulse) => pulse.at), [allRecords]);
  const unit = amplitudeUnit(inputCalibration);
  const streamPeriodUs = (Math.max(1, Math.floor(2048 / 256)) * 1e6) / sampleRate;
  const subtitle = layer === "air" ? "BREATHING BUILDINGS" : "COSMIC RAIN";
  const updateInputCalibration = (value: number | null) => {
    const next = { mvPerFs: value && value > 0 ? value : null, calibratedAt: value ? Date.now() : undefined };
    setInputCalibration(next);
    try { window.localStorage.setItem(INPUT_CAL_KEY, JSON.stringify(next)); } catch { /* optional */ }
  };
  const ActiveLessonIcon = JOURNEY_STEPS[lessonStep].icon;

  return <div className={`iw-shell layer-${layer}`} data-view={view}>
    <LayerTransition token={transition.token} to={transition.to} />
    <header className="iw-topbar">
      <a className="iw-brand" href="#sky" onClick={(event) => { event.preventDefault(); goTo(layer === "air" ? "buildings" : "sky"); }} aria-label="Invisible Weather home">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" /><path d="M12 1v6M12 17v6M1 12h6M17 12h6" /><rect x="10.5" y="10.5" width="3" height="3" /></svg>
        <span><b>INVISIBLE WEATHER</b><small>{subtitle}</small></span>
      </a>
      <nav className="iw-nav" aria-label="Main navigation">
        {NAV.map((item) => <button type="button" key={item.id} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => goTo(item.id)}>{item.label}</button>)}
      </nav>
      <LayerSwitcher layer={layer} onChange={(next) => goTo(next === "air" ? "buildings" : "sky")} />
      <div className="iw-top-actions">
        <span className={`iw-pill ${detectorConnected && calibrationReady ? "on" : ""}`}><StatusDot state={detectorConnected ? calibrationReady ? "live" : "warn" : "demo"} />{detectorConnected ? calibrationReady ? "DETECTOR LIVE" : "CALIBRATION NEEDED" : "DEMO STREAM"}</span>
        <button type="button" className="iw-connect" onClick={detectorConnected ? disconnectDetector : () => setConnectionGuideOpen(true)}><Cable size={14} aria-hidden="true" /><span>{detectorConnected ? "DISCONNECT" : "CONNECT"}</span></button>
      </div>
    </header>
    {notice && <div className="iw-notice" role="status"><span>■</span><p>{notice}</p><button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button></div>}

    <main className="iw-main" key={view}>
      {view === "sky" && <>
        <HeroObservation pulseKey={lastEvent?.id ?? null} rate={rate} detectorLabel={detectorConnected ? detectorMessage.toUpperCase() : "DEMO STREAM"} detectorState={detectorConnected ? calibrationReady ? "live" : "calibrate" : "demo"} stationCount={stations.length} onConnect={() => setConnectionGuideOpen(true)} onNavigate={(next) => goTo(next as View)} />
        <div className="iw-wrap">
          <CalibrationControl connected={detectorConnected} calibrating={isCalibrating} progress={calibrationProgress} ready={calibrationReady} seconds={calibrationSeconds} sampleRate={sampleRate} noise={noiseFloor} thresholdSigma={thresholdSigma} locked={calibrationLocked} calibratedAt={calibratedAt} calibration={inputCalibration} onCalibrate={calibrateNoise} onConnect={() => setConnectionGuideOpen(true)} />
          <div className="iw-grid iw-grid-live">
            <LiveSignal pulse={pulseLog[0]} stream={scopeSamples} streamPeriodUs={streamPeriodUs} connected={detectorConnected} demo={!detectorConnected} calibrated={calibrationReady} threshold={absoluteThreshold} noise={noiseFloor} prefs={prefs} context={liveContext} />
            <DetectorStatus demo={!detectorConnected} connected={detectorConnected} calibrated={calibrationReady} locked={calibrationLocked} inputLabel={detectorMessage} mode={detectorMode} thresholdSigma={thresholdSigma} noise={noiseFloor} sampleRate={sampleRate} clipFraction={clipFraction} networkJoined={networkJoined} connectedAt={connectedAt} calibration={inputCalibration} peerCount={peerEvents.length} />
          </div>
          <SkyCosmic snapshot={skySnapshot} pulses={skyPulseTimes} onOpenData={() => goTo("data")} />
          <div className="iw-grid iw-grid-archive">
            <RecentSignals records={allRecords} prefs={prefs} onViewAll={() => goTo("signal", "archive")} selectedId={inspectId} />
            <TopSignalsTable items={acceptedToday} prefs={prefs} subtitle={detectorConnected ? "TODAY" : "TODAY · INCLUDES DEMO"} />
          </div>
          <div className="iw-grid iw-grid-cosmic"><CoincidenceViewer stations={coincidenceStations} now={clockNow} /></div>
          <div className="iw-sound"><span>{sound ? <Volume2 size={15} /> : <VolumeX size={15} />} SONIFY DETECTIONS</span><Switch checked={sound} onCheckedChange={setSound} aria-label="Sonify detections" /><span className="iw-sep" /><button type="button" className="iw-text-link muted" onClick={() => setPaused((current) => !current)}>{paused ? "RESUME DEMO" : "PAUSE DEMO"}</button></div>
        </div>
      </>}

      {view === "signal" && <div className="iw-wrap iw-page">
        <header className="iw-page-head">
          <div><span className="iw-dash" aria-hidden="true" /><h1 className="iw-display"><span>SIGNAL.</span></h1><p className="iw-subtitle">CALIBRATION LAB · ARCHIVE</p></div>
          <p className="iw-lede">SEE THE SIGNAL<br />BEFORE YOU TRUST IT.<br /><span>MEASURE THE QUIET BASELINE, INSPECT EVERY PULSE, KEEP ONLY WHAT RISES CLEARLY ABOVE THE NOISE.</span></p>
        </header>

        <section id="calibration" className="iw-lab">
          <div className={`iw-health tone-${signalHealth.tone}`}><StatusDot state={signalHealth.tone === "good" ? "live" : signalHealth.tone === "offline" ? "off" : "warn"} /><div><b>{signalHealth.title.toUpperCase()}</b><p>{signalHealth.body}</p></div><em>{detectorConnected ? `${detectorMessage} · RAW PEAK ${(rawPeak * 100).toFixed(2)}% FS` : "WAITING FOR INPUT"}</em></div>
          {suspiciousInput && <div className="iw-health tone-warning"><TriangleAlert size={16} /><div><b>THIS MAY BE THE WRONG INPUT</b><p>“{detectorMessage}” looks like a built-in microphone. Choose the external headset input or USB sound card.</p></div><button type="button" className="iw-text-link" onClick={() => setConnectionGuideOpen(true)}>CHANGE INPUT →</button></div>}
          <ol className="iw-steps" aria-label="Calibration workflow">
            <li className={detectorConnected ? "done" : ""}><b>01</b><span>INPUT</span><strong>{detectorConnected ? "SELECTED" : "CONNECT"}</strong></li>
            <li className={detectorConnected && signalHealth.tone !== "danger" ? "done" : ""}><b>02</b><span>SIGNAL HEALTH</span><strong>{signalHealth.tone.toUpperCase()}</strong></li>
            <li className={calibrationReady ? "done" : isCalibrating ? "active" : ""}><b>03</b><span>ROBUST BASELINE</span><strong>{isCalibrating ? `${Math.round(calibrationProgress * 100)}%` : calibrationReady ? "MEASURED" : "NEEDED"}</strong></li>
            <li className={calibrationReady ? "done" : ""}><b>04</b><span>AUTO THRESHOLD</span><strong>{calibrationReady ? `${thresholdSigma.toFixed(1)}σ` : "PENDING"}</strong></li>
            <li className={calibrationReady && calibrationLocked ? "done" : ""}><b>05</b><span>CALIBRATION</span><strong>{calibrationReady ? calibrationLocked ? "LOCKED" : "ADAPTIVE" : "PENDING"}</strong></li>
          </ol>
          <CalibrationControl connected={detectorConnected} calibrating={isCalibrating} progress={calibrationProgress} ready={calibrationReady} seconds={calibrationSeconds} sampleRate={sampleRate} noise={noiseFloor} thresholdSigma={thresholdSigma} locked={calibrationLocked} calibratedAt={calibratedAt} calibration={inputCalibration} onCalibrate={calibrateNoise} onConnect={() => setConnectionGuideOpen(true)} />
          <div className="iw-grid iw-grid-lab">
            <section className="iw-panel" aria-labelledby="raw-title">
              <PanelHeading title={<span id="raw-title">RAW INPUT</span>} meta={<span>{detectorConnected ? detectorMessage.toUpperCase() : "NO AUDIO INPUT"}</span>} />
              <WaveformPlot samples={detectorConnected ? scopeSamples : Array(128).fill(0)} samplePeriodUs={streamPeriodUs} calibration={inputCalibration} threshold={calibrationReady ? absoluteThreshold : null} orientation={pulsePolarity === "positive" ? 1 : -1} showArea={false} callouts={false} live height={260} ariaLabel="Live audio input waveform and trigger threshold" />
              <dl className="iw-readouts">
                <div><dt>RAW PEAK <Prov kind="MEASURED" /></dt><dd>{(rawPeak * 100).toFixed(2)} % FS</dd></div>
                <div><dt>DETECTOR PEAK <Prov kind="MEASURED" /></dt><dd>{(inputPeak * 100).toFixed(2)} % FS</dd></div>
                <div><dt>ROBUST NOISE σ <Prov kind="MEASURED" /></dt><dd>{calibrationReady ? `${(noiseFloor * 100).toFixed(3)} % FS` : "—"}</dd></div>
                <div><dt>AUTO THRESHOLD <Prov kind="SETTING" /></dt><dd>{calibrationReady ? `${(absoluteThreshold * 100).toFixed(2)} % FS` : "—"}</dd></div>
                <div><dt>RAW CLIPPED <Prov kind="MEASURED" /></dt><dd>{(clipFraction * 100).toFixed(1)} %</dd></div>
                <div><dt>BASELINE <Prov kind="MEASURED" /></dt><dd>{baselineOffset.toFixed(5)} FS</dd></div>
              </dl>
              <span className="iw-plus" aria-hidden="true">+</span>
            </section>
            <aside className="iw-panel iw-filter-stack" aria-labelledby="filter-title">
              <PanelHeading title={<span id="filter-title">FILTER STACK</span>} meta={<span>WHAT COUNTS AS A PULSE?</span>} />
              <div className="iw-control"><label>DETECTOR MODE</label><Select value={detectorMode} onValueChange={changeDetectorMode}><SelectTrigger className="iw-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="electron">Electron detector · source nearby</SelectItem><SelectItem value="sky">Ambient sky · long count</SelectItem><SelectItem value="air">Air filter · decay time series</SelectItem><SelectItem value="alpha">Alpha spectrometer · broad</SelectItem><SelectItem value="explore">Explore · permissive</SelectItem></SelectContent></Select><small>{detectorMode === "sky" ? "Ambient sky lowers the threshold carefully and rejects rapid bursts. Cosmic Weather logs this mode." : detectorMode === "air" ? "Air mode keeps filtering strict for equal time-bin comparisons after collection." : "Switch to Ambient sky to log rates for Cosmic Weather."}</small></div>
              <div className="iw-control"><div className="iw-control-row"><label>AUTOMATIC THRESHOLD</label><b>{thresholdSigma.toFixed(1)}σ</b></div><Slider min={6} max={25} step={.5} value={[thresholdSigma]} onValueChange={([value]) => changeThreshold(value)} /><ThresholdSweep points={thresholdTable} chosen={thresholdSigma} /><small>Sweeps 6–25σ and picks the knee where noise triggers collapse into a plateau.</small></div>
              <div className="iw-control"><label>EXPECTED POLARITY</label><Select value={pulsePolarity} onValueChange={changePulsePolarity}><SelectTrigger className="iw-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="either">Either direction</SelectItem><SelectItem value="negative">Negative pulses</SelectItem><SelectItem value="positive">Positive pulses</SelectItem></SelectContent></Select></div>
              <div className="iw-switch"><div><b>300 HZ HIGH-PASS</b><small>Reduces mains hum and slow movement. Changing it requires recalibration.</small></div><Switch checked={highPassEnabled} onCheckedChange={changeHighPass} aria-label="Enable high-pass filter" /></div>
              <div className="iw-switch"><div><b>{calibrationLocked ? "CALIBRATION LOCKED" : "ADAPTIVE TRACKING"}</b><small>{calibrationLocked ? "Same baseline and threshold for sky / sample / control." : "Baseline and noise adapt slowly during quiet blocks."}</small></div><Switch checked={calibrationLocked} onCheckedChange={changeCalibrationLock} disabled={!calibrationReady} aria-label="Lock calibration" /></div>
              <div className="iw-control"><label>CALIBRATION DURATION</label><div className="iw-seg">{[10, 20, 30].map((value) => <button type="button" key={value} className={calibrationSeconds === value ? "on" : ""} onClick={() => setCalibrationSeconds(value)} disabled={isCalibrating}>{value} S</button>)}</div>{savedCalibration && !calibrationReady && detectorConnected && <button type="button" className="iw-text-link" onClick={restoreSavedCalibration}>USE SAVED CALIBRATION →</button>}</div>
              <div className="iw-control"><label>INPUT CALIBRATION (mV PER FULL SCALE) <Prov kind="SETTING" /></label><input className="iw-input" type="number" min="0" step="1" placeholder="not calibrated · showing mFS" value={inputCalibration.mvPerFs ?? ""} onChange={(event) => updateInputCalibration(event.target.value === "" ? null : Number(event.target.value))} /><small>Measure a known test signal with an oscilloscope at the detector output and enter how many millivolts equal 1.0 FS on this sound card and gain. Until then amplitudes are shown in {unit} — never as energy.</small></div>
              <span className="iw-plus" aria-hidden="true">+</span>
            </aside>
          </div>
        </section>

        <section id="archive" className="iw-archive">
          <SignalGallery items={analyzed} prefs={prefs} coincidentIds={coincidentIds} timeFilter={timeFilter} onClearTimeFilter={() => setTimeFilter(null)} />
          <div className="iw-grid iw-grid-archive">
            <TopSignalsTable items={analyzed.filter((item) => item.pulse.accepted)} prefs={prefs} title="TOP SIGNALS" subtitle="ALL STORED · THIS BROWSER" limit={10} />
            <CoincidenceViewer stations={coincidenceStations} now={clockNow} />
          </div>
          <p className="iw-footnote">Pulse area is the integral between waveform and baseline inside t₀–t₁. Repeated clusters can suggest different pulse populations but do not identify direction, position or isotope. Real pulses are stored only in this browser (last 300); demo pulses are never stored. Events: {acceptedPulses.length} accepted · {rejectedPulses} rejected this session.</p>
        </section>
      </div>}

      {view === "data" && <div className="iw-wrap iw-page">
        <CosmicWeather location={place} stationId={networkJoined ? stationId : undefined}
          detector={{ connected: detectorConnected, calibrated: calibrationReady, demo: !detectorConnected, mode: detectorMode, lastPulseAt: allRecords.find((pulse) => pulse.source === "audio")?.at ?? null, clipping: clipFraction > .01, acceptedFraction }}
          onInspectSignals={(from, to) => { setTimeFilter({ from, to }); goTo("signal", "archive"); }} onOpenSignal={() => goTo("signal", "archive")} />
        <section id="network" className="iw-network">
          <div className="iw-network-copy">
            <span className="iw-kicker">CITIZEN SCIENCE NETWORK</span>
            <h2 className="iw-display-m">ONE RAY IS A SPARK.<br />TOGETHER, A SKY.</h2>
            <p>Connect detectors in schools, libraries and homes. Time-stamped events can reveal local rates — and later, possible coincidences between stations.</p>
            <dl><div><dt>VISIBLE STATIONS</dt><dd>{stations.length}</dd></div><div><dt>EVENTS IN VIEW</dt><dd>{stations.reduce((sum, station) => sum + station.events, 0)}</dd></div></dl>
            <button type="button" className="iw-text-link" onClick={joinNetwork} disabled={networkJoined || networkBusy}>{networkJoined ? "CONNECTED TO NETWORK" : networkBusy ? "FINDING YOUR STATION…" : "JOIN THE NETWORK →"}</button>
            <small>Shared locations are rounded to ~1 km; sample stations are labelled “sample”.</small>
          </div>
          <NetworkMap stations={stations} localStationId={stationId} />
        </section>
      </div>}

      {view === "buildings" && <BreathingBuildings detectorConnected={detectorConnected} calibrationReady={calibrationReady} detectorMessage={detectorMessage} thresholdSigma={thresholdSigma} noiseFloor={noiseFloor} acceptedCount={acceptedPulses.length} rate={rate} latestPulse={latestPulse} onConnect={() => setConnectionGuideOpen(true)} onOpenAirLab={openAirLab} />}

      {view === "build" && <BuildGuide openDetectorLab={() => goTo("signal", "calibration")} />}

      {view === "about" && <div className="iw-wrap iw-page iw-about">
        <header className="iw-page-head">
          <div><span className="iw-dash" aria-hidden="true" /><h1 className="iw-display"><span>ABOUT.</span></h1><p className="iw-subtitle">FOLLOW ONE INVISIBLE VISITOR</p></div>
          <p className="iw-lede">INVISIBLE WEATHER IS AN OPEN PARTICLE-SENSING<br />AND CITIZEN-SCIENCE INSTRUMENT.<br /><span>TWO LAYERS OF ONE SYSTEM: COSMIC RAIN (SKY) AND BREATHING BUILDINGS (AIR).</span></p>
        </header>
        <section className="iw-journey" aria-labelledby="journey-title">
          <h2 id="journey-title" className="sr-only">A cosmic ray&apos;s journey to the detector</h2>
          <ol className="iw-journey-track">
            {JOURNEY_STEPS.map((step, index) => <li key={step.title}><button type="button" className={`${lessonStep === index ? "active" : ""} ${lessonStep > index ? "complete" : ""}`} onClick={() => setLessonStep(index)} aria-pressed={lessonStep === index}><span className="iw-square" aria-hidden="true" /><b>{String(index + 1).padStart(2, "0")}</b>{step.title.toUpperCase()}</button></li>)}
          </ol>
          <div className="iw-journey-detail">
            <span className="iw-journey-icon"><ActiveLessonIcon size={30} strokeWidth={1.2} /></span>
            <div><span className="iw-kicker">{JOURNEY_STEPS[lessonStep].kicker}</span><h3>{JOURNEY_STEPS[lessonStep].title}</h3><p>{JOURNEY_STEPS[lessonStep].body}</p></div>
            <button type="button" className="iw-text-link" onClick={() => setLessonStep((lessonStep + 1) % JOURNEY_STEPS.length)}>{lessonStep === JOURNEY_STEPS.length - 1 ? "START AGAIN ↺" : "NEXT STOP →"}</button>
          </div>
        </section>
        <section className="iw-honesty" aria-label="How to read the numbers">
          <h2 className="iw-kicker">HOW TO READ EVERY NUMBER</h2>
          <dl>
            <div><dt><Prov kind="MEASURED" /> MEASURED</dt><dd>Time of a pulse, peak amplitude, baseline, noise σ, clipping. Read directly from the waveform.</dd></div>
            <div><dt><Prov kind="DERIVED" /> DERIVED</dt><dd>Pulse area, FWHM, rise/fall, SNR, shape class — calculated from measured samples.</dd></div>
            <div><dt><Prov kind="ESTIMATED" /> ESTIMATED</dt><dd>The barometric coefficient β fitted from your own data, with its uncertainty.</dd></div>
            <div><dt><Prov kind="UNAVAILABLE" /> UNAVAILABLE</dt><dd>Particle energy (needs energy calibration) and particle identity (one small diode detector cannot tell a muon from other particles).</dd></div>
          </dl>
          <div className="iw-honesty-grid">
            <article><Activity size={18} strokeWidth={1.3} /><h3>PULSE IN. LIGHT OUT.</h3><p>The detector gives a time and a relative pulse size. Cosmic Rain turns that measurement into light; colour, curve and direction are artistic.</p></article>
            <article><EyeOff size={18} strokeWidth={1.3} /><h3>COMPLETE DARKNESS.</h3><p>The photodiodes are extremely light-sensitive. Close the metal box; a tiny light leak can look much larger than a particle signal.</p><small><MoonStar size={13} /> Battery power reduces noise.</small></article>
            <article><ShieldCheck size={18} strokeWidth={1.3} /><h3>BUILD IT YOURSELF.</h3><p>Exact component values, board maps, polarity checks and a first-signal test are in the build guide.</p><button type="button" className="iw-text-link" onClick={() => goTo("build")}>OPEN THE BUILD GUIDE →</button></article>
            <article><BookOpen size={18} strokeWidth={1.3} /><h3>DATA &amp; CREDITS.</h3><p>NMDB (Jungfraujoch: Physikalisches Institut, University of Bern), NOAA SWPC, NASA CCMC DONKI, Open-Meteo. Detector design: Oliver Keller, DIY Particle Detector V1.2 (CERN OHL).</p></article>
          </div>
        </section>
      </div>}
    </main>

    {inspected && <EventInspector item={inspected} prefs={prefs} detectorLabel={detectorMessage} coincidence={inspectedCluster} spaceContext={inspected ? spaceNotesFor(inspected.pulse.at) : []} onClose={() => setInspectId(null)} onPrev={inspectIndex > 0 ? () => setInspectId(analyzed[inspectIndex - 1].pulse.id) : undefined} onNext={inspectIndex < analyzed.length - 1 ? () => setInspectId(analyzed[inspectIndex + 1].pulse.id) : undefined} />}

    <Dialog open={connectionGuideOpen} onOpenChange={setConnectionGuideOpen}>
      <DialogContent className="iw-dialog">
        <DialogHeader><DialogTitle>CONNECT THE AUDIO DETECTOR</DialogTitle><DialogDescription>This DIY detector sends microphone-like pulses. Invisible Weather uses an audio input, not a serial port.</DialogDescription></DialogHeader>
        <div className="iw-route"><span><Activity size={16} /> DETECTOR</span><i /><span><Cable size={16} /> AUDIO CABLE</span><i /><span><Radio size={16} /> MIC / USB SOUND CARD</span></div>
        <ol className="iw-connect-steps"><li>Power the detector before plugging it into a Mac or iPhone.</li><li>Keep the detector closed inside its light-tight metal box.</li><li>Choose the external microphone or <strong>USB PnP Sound Device</strong>, not the built-in microphone.</li></ol>
        {!audioInputs.length ? <Button className="iw-dialog-primary" onClick={findAudioInputs} disabled={inputLoading}>{inputLoading ? "ASKING FOR PERMISSION…" : "FIND AUDIO INPUTS"}</Button> : <div className="iw-input-picker"><label>AUDIO INPUT</label><Select value={selectedAudioInput} onValueChange={setSelectedAudioInput}><SelectTrigger className="iw-select"><SelectValue placeholder="Choose an input" /></SelectTrigger><SelectContent>{audioInputs.map((device, index) => <SelectItem key={device.deviceId} value={device.deviceId}>{device.label || `Audio input ${index + 1}`}</SelectItem>)}</SelectContent></Select><Button className="iw-dialog-primary" onClick={connectDetector} disabled={inputLoading}>{inputLoading ? "CONNECTING…" : "START LISTENING →"}</Button></div>}
        <p className="iw-dialog-note"><CircleCheck size={14} /> If only the MacBook microphone appears, check the sound-card cable and macOS Sound input settings.</p>
      </DialogContent>
    </Dialog>

    <footer className="iw-footer"><span><i className="iw-dash" aria-hidden="true" />TURNING PULSES INTO PATTERNS.</span><span>OPEN CITIZEN SCIENCE · OPSCIHACK 2026 · ZÜRICH <b aria-hidden="true">+</b></span></footer>
  </div>;
}
