"use client";

import { useState } from "react";
import { Activity, BookOpen, Cable, CircleCheck, Cpu, ExternalLink, EyeOff, Radio, ScanLine, ShieldCheck, Sparkles, TriangleAlert, Waves, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

type BoardPart = {
  id: string; side: "top" | "bottom"; x: number; y: number; width: number; height: number;
  label: string; title: string; value: string; instruction: string; check: string; image: string;
};

const BOARD_PARTS: BoardPart[] = [
  { id: "diodes", side: "top", x: 1, y: 23, width: 14, height: 54, label: "D1–D4", title: "Four BPW34 photodiodes", value: "The light-sensitive particle sensors", instruction: "Place all four black diodes on the top side. The pin beside the small notch is the cathode; every notch must point inward toward the printed K.", check: "Before soldering, trace each notch with a finger and confirm all four face the centre K.", image: "/guide/diode-polarity.webp" },
  { id: "c5", side: "top", x: 30, y: 29, width: 8, height: 20, label: "C5", title: "C5 small capacitor", value: "100 nF · marking 104", instruction: "Keep C5 low and clip its leads very short. The amplifier sits close to it on the opposite side.", check: "No C5 lead can touch an amplifier pin.", image: "/guide/capacitor-examples.webp" },
  { id: "c8", side: "top", x: 85, y: 0, width: 15, height: 43, label: "C8", title: "C8 electrolytic capacitor", value: "47 µF · polarised", instruction: "Choose the side that fits the case. The long lead is plus; the short lead and stripe mark minus.", check: "Polarity matches +9 V and the closed lid does not press on C8.", image: "/guide/capacitor-examples.webp" },
  { id: "power", side: "top", x: 81, y: 29, width: 13, height: 26, label: "+9 V", title: "Battery power pads", value: "+9 V and ground (−)", instruction: "Battery black goes to minus. Battery red goes through the switch, then returns to +9 V.", check: "With no battery connected, resistance between +9 V and − is roughly 9–10 kΩ.", image: "/guide/electron-detector-top.png" },
  { id: "signal", side: "top", x: 81, y: 61, width: 14, height: 25, label: "SIGNAL", title: "Signal output pads", value: "Signal and ground", instruction: "Connect signal to the BNC centre contact and ground (−) to the BNC shell.", check: "Only the signal reaches the sound card—never route 9 V into an audio input.", image: "/guide/electron-detector-top.png" },
  { id: "r8", side: "bottom", x: 18, y: 32, width: 23, height: 20, label: "R8", title: "R8 wire bridge", value: "0 Ω · plain wire", instruction: "R8 is not a resistor in this version. Bridge the two R8 holes with one short, bare piece of wire.", check: "The bridge lies flat and cannot touch nearby pads.", image: "/guide/resistor-colors.webp" },
  { id: "r9", side: "bottom", x: 18, y: 56, width: 23, height: 24, label: "R9", title: "R9 resistor", value: "2.2 kΩ · red red black brown", instruction: "Match the colour bands to the official photograph and place R9 flat against the board.", check: "The body is in R9—not R8—and both leads are clipped short.", image: "/guide/resistor-colors.webp" },
  { id: "r6r7", side: "bottom", x: 34, y: 38, width: 15, height: 43, label: "R6/R7", title: "R6 and R7 resistors", value: "10 kΩ each · brown black black red", instruction: "Place both matching resistors upright in their labelled outlines.", check: "R6 and R7 have the same colour bands and do not lean into neighbouring parts.", image: "/guide/resistor-colors.webp" },
  { id: "u1", side: "bottom", x: 63, y: 17, width: 15, height: 59, label: "U1", title: "TLE2072 amplifier", value: "Dual operational amplifier", instruction: "Straighten the pins gently. Match the chip's pin-1 dot/notch to the small circle printed beside U1.", check: "Pin 1 and the PCB circle meet; all eight pins enter the correct holes.", image: "/guide/amplifier-pin-one.webp" },
  { id: "r1r2", side: "bottom", x: 64, y: 0, width: 23, height: 32, label: "R1/R2", title: "R1 and R2 resistors", value: "R1 4.7 kΩ · R2 15 kΩ", instruction: "Use the official colour photographs—these neighbours have different values and are easy to swap.", check: "R1 is horizontal at the top; R2 is vertical at the right.", image: "/guide/resistor-colors.webp" },
];

const BUILD_STEPS = [
  {
    title: "Plan the board and metal case",
    task: "Choose where the PCB, 9 V battery, switch and BNC connector will sit before soldering. Mark the 3 mm board holes, 6 mm switch hole and 10 mm BNC hole.",
    check: "Everything fits without the PCB touching the lid, and the photodiodes can face the source or radiation window.",
  },
  {
    title: "Solder the resistors",
    task: "Match every colour band to the parts map. R3 stands upright, the other resistors lie flat, and R8 is only a short wire bridge.",
    check: "Every label R1–R9 is filled correctly and the clipped leads are short and tidy.",
  },
  {
    title: "Add the small capacitors",
    task: "Solder C1–C7 and C10 in their marked places. Leave C9 empty for the electron-detector version and keep C5 especially low.",
    check: "C9 is empty, C5 cannot touch the amplifier pins, and no cut lead is loose on the board.",
  },
  {
    title: "Orient the four photodiodes",
    task: "Place D1–D4 BPW34F/BPW34FA so the cathode pin marked by the notch points toward the central K on the PCB.",
    check: "All four notches face inward toward K. Ask a second person to check before soldering.",
  },
  {
    title: "Place the amplifier",
    task: "Straighten U1's pins gently, then match pin 1 on the TLE2072 to the little circle printed on the PCB.",
    check: "The chip sits flat, points the correct way and none of its pins touch the clipped C5 leads.",
  },
  {
    title: "Add the large C8 capacitor",
    task: "Solder the 47 µF capacitor on the side that fits your case. Its long pin is plus and its short pin is minus.",
    check: "C8 polarity matches the board and the closed lid will not press on it.",
  },
  {
    title: "Inspect every solder joint",
    task: "Use bright light or a phone camera. Look for dull joints, solder bridges, crossed leads and metal fragments.",
    check: "Every joint is smooth, isolated from its neighbour and clipped close to the board.",
  },
  {
    title: "Do the resistance test",
    task: "With no battery connected, measure between +9 V and −. The electron-detector board should read roughly 9–10 kΩ.",
    check: "The value is far above zero and near 9–10 kΩ. If not, stop and find the short before power-up.",
  },
  {
    title: "Wire power, switch and signal",
    task: "Black battery wire goes to −. Red battery wire goes to the switch middle pin; a short wire returns from an outer switch pin to +9 V. Signal goes to the BNC centre and − to its shell.",
    check: "The switch changes the resistance measured at the battery clip and no wire can touch the lid accidentally.",
  },
  {
    title: "Mount and seal the detector",
    task: "Fix the PCB on metal M3 standoffs, place the battery inside and cover every hole or slit from the inside. Close the metal lid fully.",
    check: "The closed-box signal does not change when you shine room light or a phone torch on the outside.",
  },
  {
    title: "Find the first real pulse",
    task: "Connect the BNC/audio cable to a microphone-compatible USB sound card, open Electron Detector mode and place the trigger just above the quiet noise band.",
    check: "A real candidate is an isolated narrow pulse. Repeating waves, movement bursts or light-sensitive changes are rejected as noise.",
  },
];

function InteractiveBoard() {
  const [side, setSide] = useState<"top" | "bottom">("top");
  const [selectedId, setSelectedId] = useState("diodes");
  const shownParts = BOARD_PARTS.filter((part) => part.side === side);
  const selected = BOARD_PARTS.find((part) => part.id === selectedId) ?? shownParts[0];
  const chooseSide = (next: "top" | "bottom") => {
    setSide(next);
    const first = BOARD_PARTS.find((part) => part.side === next);
    if (first) setSelectedId(first.id);
  };
  return <div className="interactive-board">
    <div className="board-explorer">
      <div className="board-toolbar"><div><span className="eyebrow">CLICK THE REAL PART</span><strong>{side === "top" ? "Sensor side" : "Amplifier side"}</strong></div><div role="group" aria-label="Choose board side"><button className={side === "top" ? "active" : ""} onClick={() => chooseSide("top")}>Top side</button><button className={side === "bottom" ? "active" : ""} onClick={() => chooseSide("bottom")}>Bottom side</button></div></div>
      <div className="board-stage">
        <img src={side === "top" ? "/guide/electron-detector-top.png" : "/guide/electron-detector-bottom.png"} alt={`Official ${side} side of the V1.2 electron detector board`} />
        {shownParts.map((part) => <button key={part.id} className={`board-hotspot ${selected.id === part.id ? "active" : ""}`} style={{ left: `${part.x}%`, top: `${part.y}%`, width: `${part.width}%`, height: `${part.height}%` }} onClick={() => setSelectedId(part.id)} aria-label={`Inspect ${part.title}`} aria-pressed={selected.id === part.id}><span>{part.label}</span></button>)}
      </div>
      <p className="board-tap-hint"><ScanLine size={15} /> Tap a glowing outline on the board. The exact part and its safety check appear beside it.</p>
    </div>
    <aside className="part-detail">
      <div className="part-photo"><img src={selected.image} alt={`Official guide image for ${selected.title}`} /></div>
      <span className="part-kicker">{selected.label} · OFFICIAL GUIDE PHOTO</span>
      <h3>{selected.title}</h3><strong>{selected.value}</strong><p>{selected.instruction}</p>
      <div><CircleCheck size={17} /><span><b>Ready when:</b> {selected.check}</span></div>
    </aside>
  </div>;
}

export function BuildGuide({ openDetectorLab }: { openDetectorLab: () => void }) {
  return <section className="builder-shell">
    <section className="builder-hero">
      <div className="builder-intro">
        <span className="eyebrow"><Cpu size={14} /> OPEN HARDWARE · V1.2 ELECTRON DETECTOR</span>
        <h1>Build the little box<br />that <em>hears particles.</em></h1>
        <p>This classroom route follows Oliver Keller&apos;s open DIY Particle Detector: four low-cost silicon photodiodes turn ionising-radiation interactions into tiny electrical pulses that Invisible Weather can read as audio.</p>
        <div className="builder-badges"><span>4 × BPW34F</span><span>9 V battery</span><span>audio output</span><span>supervised build</span></div>
        <div className="builder-links">
          <a className="guide-primary-link" href="/guide/electron-detector-v1-2-guide.pdf" target="_blank" rel="noreferrer"><BookOpen size={17} /> Open the illustrated 2-page guide</a>
          <a className="guide-secondary-link" href="https://github.com/ozel/DIY_particle_detector/wiki/Assembly-Instructions" target="_blank" rel="noreferrer">Official assembly wiki <ExternalLink size={15} /></a>
        </div>
      </div>
      <aside className="builder-safety">
        <span className="card-icon warning"><ShieldCheck size={22} /></span>
        <span className="eyebrow">WORKSHOP SAFETY</span>
        <h2>Build with an adult.</h2>
        <ul>
          <li>Wear eye protection and use solder-fume extraction.</li>
          <li>An adult handles drilling, deburring and first power-up.</li>
          <li>Disconnect the battery before changing any wire or component.</li>
          <li>Wash hands after soldering. Never test unknown radioactive objects.</li>
        </ul>
        <p>This is a low-voltage educational instrument, but hot tools, sharp metal and solder still need careful supervision.</p>
      </aside>
    </section>

    <nav className="guide-jumps" aria-label="Build guide sections">
      <a href="#build-parts"><span>01</span> Parts</a>
      <a href="#build-board"><span>02</span> Board map</a>
      <a href="#build-missions"><span>03</span> 11 build steps</a>
      <a href="#build-test"><span>04</span> First test</a>
    </nav>

    <section id="build-parts" className="guide-section">
      <div className="guide-section-heading"><div><span className="eyebrow">MISSION 01 · PREPARE</span><h2>Collect everything before the solder gets hot.</h2></div><p>Use the exact V1.2 electron-detector values. The alpha-spectrometer uses a different diode and several different component values.</p></div>
      <div className="parts-grid">
        <article className="parts-card"><span className="parts-icon"><Cpu size={22} /></span><h3>Detector electronics</h3><ul><li>V1.2 detector PCB</li><li>4 × BPW34F or BPW34FA photodiodes</li><li>1 × TLE2072 dual operational amplifier</li><li>9 V battery clip and fresh 9 V battery</li></ul></article>
        <article className="parts-card dense"><span className="parts-icon"><Activity size={22} /></span><h3>Resistors</h3><ul><li>R1 4.7 kΩ · R2 15 kΩ</li><li>R3 10 MΩ · R4 1 kΩ</li><li>R5 100 kΩ · R6/R7 10 kΩ</li><li>R8 wire bridge · R9 2.2 kΩ</li></ul></article>
        <article className="parts-card dense"><span className="parts-icon"><Zap size={22} /></span><h3>Capacitors</h3><ul><li>C1/C2/C6: 10 pF</li><li>C3/C4/C5/C7/C10: 100 nF</li><li>C8: 47 µF, polarised</li><li>C9: leave empty</li></ul></article>
        <article className="parts-card"><span className="parts-icon"><EyeOff size={22} /></span><h3>Case and connection</h3><ul><li>Light-tight metal enclosure</li><li>On/off switch and BNC socket</li><li>3 short insulated wires and M3 metal standoffs</li><li>Shielded cable and microphone-compatible USB sound card</li></ul></article>
        <article className="parts-card tools-card"><span className="parts-icon"><Cable size={22} /></span><h3>Workshop tools</h3><ul><li>Soldering iron, solder and fume extractor</li><li>Side cutters, screwdriver and tweezers</li><li>Multimeter</li><li>Drill or hole punches: 3, 6 and 10 mm</li></ul></article>
      </div>
      <div className="parts-photo-strip" aria-label="Official component photographs from the V1.2 guide">
        <figure><img src="/guide/resistor-colors.webp" alt="Official guide photographs showing every resistor and its colour bands" /><figcaption><b>Resistors</b><span>Match the value and all colour bands.</span></figcaption></figure>
        <figure><img src="/guide/capacitor-examples.webp" alt="Official guide photographs of the detector capacitors" /><figcaption><b>Capacitors</b><span>100, 104 and polarised C8.</span></figcaption></figure>
        <figure><img src="/guide/diode-polarity.webp" alt="Official guide photograph showing the BPW34 cathode notch" /><figcaption><b>Photodiodes</b><span>The notch identifies the cathode.</span></figcaption></figure>
        <figure><img src="/guide/amplifier-pin-one.webp" alt="Official guide photograph showing pin one of the TLE2072 amplifier" /><figcaption><b>Amplifier U1</b><span>The dot marks pin 1.</span></figcaption></figure>
      </div>
      <div className="case-note"><EyeOff size={20} /><div><strong>Smallest practical metal case</strong><span>About 8 × 4.5 × 3 cm with the battery upright, or 8 × 5.5 × 2 cm with it lying flat. Tin is easy to modify; thicker aluminium is quieter and less sensitive to vibration.</span></div></div>
    </section>

    <section id="build-board" className="guide-section">
      <div className="guide-section-heading"><div><span className="eyebrow">MISSION 02 · READ THE BOARD</span><h2>Two sides, three polarity traps.</h2></div><p>Only C8, D1–D4 and U1 have a required orientation. Check them twice before soldering.</p></div>
      <InteractiveBoard />
      <div className="polarity-grid"><div><b>K</b><span><strong>Photodiodes</strong>Notched cathode pin toward the centre K.</span></div><div><b>1</b><span><strong>Amplifier U1</strong>Chip dot and PCB circle must meet.</span></div><div><b>+</b><span><strong>Capacitor C8</strong>Long lead plus; short lead minus.</span></div></div>
    </section>

    <section id="build-missions" className="guide-section">
      <div className="guide-section-heading"><div><span className="eyebrow">MISSION 03 · ASSEMBLE</span><h2>Eleven small wins make one working detector.</h2></div><p>Read each card fully before doing it. Do not connect the battery until steps 1–10 have passed their checks.</p></div>
      <ol className="mission-list">
        {BUILD_STEPS.map((step, index) => <li key={step.title}>
          <span className="mission-number">{String(index + 1).padStart(2, "0")}</span>
          <div className="mission-copy"><h3>{step.title}</h3><p>{step.task}</p><div><CircleCheck size={15} /><span><strong>Ready when:</strong> {step.check}</span></div></div>
        </li>)}
      </ol>
    </section>

    <section className="wiring-section" aria-labelledby="wiring-title">
      <div><span className="eyebrow">THE SAFE SIGNAL ROUTE</span><h2 id="wiring-title">Power stays in the detector. Only the signal reaches the computer.</h2><p>Never feed 9 V into a laptop or phone audio socket. A headset input or USB sound card receives only the small signal and shared ground.</p></div>
      <div className="wiring-route" role="img" aria-label="Battery to switch to detector board, then detector signal to BNC and USB sound card">
        <span><b>01</b><Zap size={21} /><strong>9 V battery</strong><small>inside the box</small></span>
        <span><b>02</b><ShieldCheck size={21} /><strong>Switch + PCB</strong><small>photodiodes + amplifier</small></span>
        <span><b>03</b><Cable size={21} /><strong>BNC signal</strong><small>centre = signal · shell = −</small></span>
        <span><b>04</b><Radio size={21} /><strong>USB sound card</strong><small>microphone input</small></span>
        <span><b>05</b><Waves size={21} /><strong>Invisible Weather</strong><small>raw waveform + calibration</small></span>
      </div>
    </section>

    <section id="build-test" className="guide-section first-test-section">
      <div className="guide-section-heading"><div><span className="eyebrow">MISSION 04 · VERIFY</span><h2>Do not trust a pulse until the box passes these tests.</h2></div><p>Start with the original oscilloscope, then move to Invisible Weather without changing the detector, cable or system input gain.</p></div>
      <div className="test-grid">
        <article className="test-checklist"><h3>First power-up</h3><ol><li><span>1</span>Close the lid and keep the detector still.</li><li><span>2</span>Connect BNC to the external mic input or CM108-type USB sound card.</li><li><span>3</span>Select Electron Detector mode and 48 kHz when available.</li><li><span>4</span>Set the trigger just outside the quiet noise band.</li><li><span>5</span>Record control → known safe sample → control with one locked calibration.</li></ol><a href="https://ozel.github.io/DIY_particle_detector/data_recording_software/webGui/" target="_blank" rel="noreferrer">Open the original web oscilloscope <ExternalLink size={15} /></a></article>
        <article className="signal-diagnosis"><h3>What the waveform is telling you</h3><div><span className="diagnosis-good"><CircleCheck size={17} /> GOOD</span><p>Mostly quiet baseline with occasional isolated, narrow pulses. A typical detector pulse can be only about 50–75 µs wide.</p></div><div><span className="diagnosis-warn"><TriangleAlert size={17} /> LIGHT LEAK</span><p>The baseline or event rate changes when room lighting changes or when a torch shines on the closed case.</p></div><div><span className="diagnosis-warn"><TriangleAlert size={17} /> ELECTRICAL NOISE</span><p>Regular waves, dense repeated spikes or bursts when the cable moves. Keep chargers and Wi-Fi electronics away.</p></div><div><span className="diagnosis-bad"><X size={17} /> CLIPPING</span><p>Flat-topped peaks hit the top or bottom of the display. Lower input gain and recalibrate.</p></div></article>
      </div>
      <div className="ready-card"><span className="ready-orb"><Sparkles size={24} /></span><div><span className="eyebrow">READY FOR COSMIC RAIN</span><h2>Dark. Quiet. Connected. Calibrated.</h2><p>Invisible Weather can measure peak, width, area and SNR for each accepted pulse. Call it a <strong>particle candidate</strong>: this single small detector cannot prove that an individual event was a muon or reconstruct its direction.</p></div><Button className="calibrate-button" onClick={openDetectorLab}><ScanLine size={17} /> Open detector lab</Button></div>
    </section>

    <section className="guide-sources"><span>Open design and board images: Oliver Keller · DIY Particle Detector V1.2 · CERN Open Hardware Licence</span><a href="https://github.com/ozel/DIY_particle_detector" target="_blank" rel="noreferrer">View source repository <ExternalLink size={14} /></a></section>
  </section>;
}
