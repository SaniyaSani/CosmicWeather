"use client";

import { useEffect, useRef } from "react";

/**
 * Shared hero geometry so the canvas and the SVG annotation overlay agree on
 * where the apex, the cascade and the Earth's limb are.
 */
export function heroGeometry(width: number, height: number) {
  const narrow = width < 760;
  const apex = { x: width * (narrow ? 0.6 : 0.5), y: height * (narrow ? 0.42 : 0.15) };
  const earthTop = height * (narrow ? 0.82 : 0.8);
  const radius = Math.max(width * (narrow ? 1.6 : 1.05), 700);
  const earth = { x: width * 0.5, y: earthTop + radius, r: radius };
  const spread = narrow ? 0.3 : 0.36; // radians, ~1σ of the cascade
  const surfaceY = (x: number) => earth.y - Math.sqrt(Math.max(0, earth.r * earth.r - (x - earth.x) ** 2));
  const coneHalfWidth = (y: number) => Math.tan(spread * 1.25) * Math.max(0, y - apex.y);
  const entry = { x: apex.x + width * 0.045, y: -12 };
  return { narrow, apex, earth, earthTop, spread, surfaceY, coneHalfWidth, entry };
}

type Track = { angle: number; length: number; bend: number; alpha: number; width: number; branchAt: number; branchAngle: number };
type Drop = { track: number; s: number; speed: number; size: number; alpha: number };
type Burst = { born: number; duration: number; rays: { angle: number; length: number; speed: number; alpha: number; bend: number }[] };

/** Deterministic pseudo-random generator so the shower is stable between resizes. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}
function gaussian(random: () => number) {
  const u = Math.max(1e-9, random()); const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function ParticleShower({ pulseKey, reducedMotion, className = "" }: { pulseKey: number | null; reducedMotion: boolean; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const burstRef = useRef<Burst[]>([]);
  const primaryRef = useRef<{ born: number } | null>(null);
  const triggerRef = useRef<(() => void) | null>(null);

  // Real detector pulses (or demo pulses) trigger a primary + cascade. The
  // geometry is artistic; only the moment of the pulse is measured.
  useEffect(() => { if (pulseKey !== null) triggerRef.current?.(); }, [pulseKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const lowPower = window.matchMedia("(max-width: 700px)").matches;
    let width = 0; let height = 0; let ratio = 1;
    let earthLayer: HTMLCanvasElement | null = null;
    let showerLayer: HTMLCanvasElement | null = null;
    let tracks: Track[] = [];
    let drops: Drop[] = [];
    let geo = heroGeometry(1, 1);
    let frame = 0; let last = performance.now(); let visible = true;
    const pointer = { x: 0, y: 0, sx: 0, sy: 0 };

    const makeLayer = () => { const layer = document.createElement("canvas"); layer.width = Math.round((width + 40) * ratio); layer.height = Math.round((height + 40) * ratio); const ctx = layer.getContext("2d") as CanvasRenderingContext2D; ctx.setTransform(ratio, 0, 0, ratio, 20 * ratio, 20 * ratio); return { layer, ctx }; };

    const trackPoint = (track: Track, s: number) => {
      const length = track.length * s;
      const angle = track.angle + track.bend * s * s;
      return { x: geo.apex.x + Math.sin(angle) * length, y: geo.apex.y + Math.cos(angle) * length };
    };

    const build = () => {
      const random = rng(20261004);
      geo = heroGeometry(width, height);
      const count = lowPower ? 220 : 460;
      tracks = Array.from({ length: count }, () => {
        const angle = gaussian(random) * geo.spread * 0.55;
        const targetX = geo.apex.x + Math.tan(angle) * (geo.earthTop - geo.apex.y);
        const toGround = (geo.surfaceY(targetX) - geo.apex.y) / Math.max(0.2, Math.cos(angle));
        const reach = random() < 0.7 ? 1 : 0.35 + random() * 0.6;
        return { angle, length: toGround * reach, bend: gaussian(random) * 0.05, alpha: 0.04 + Math.pow(random(), 2.2) * 0.32 * (1 - Math.min(1, Math.abs(angle) / geo.spread) * 0.5), width: 0.35 + random() * 0.75, branchAt: 0.25 + random() * 0.6, branchAngle: gaussian(random) * 0.22 };
      });

      // Earth (bottom layer)
      const e = makeLayer(); earthLayer = e.layer; const ec = e.ctx;
      const { x, y, r } = geo.earth;
      const haze = ec.createRadialGradient(x, y, r * 0.96, x, y, r * 1.06);
      haze.addColorStop(0, "rgba(120,170,255,0.28)"); haze.addColorStop(0.45, "rgba(90,140,230,0.10)"); haze.addColorStop(1, "rgba(60,110,220,0)");
      ec.fillStyle = haze; ec.beginPath(); ec.arc(x, y, r * 1.06, 0, Math.PI * 2); ec.fill();
      const body = ec.createRadialGradient(x, y - r * 0.9, r * 0.05, x, y, r);
      body.addColorStop(0, "#1a2a3f"); body.addColorStop(0.55, "#0b1522"); body.addColorStop(1, "#070c13");
      ec.fillStyle = body; ec.beginPath(); ec.arc(x, y, r, 0, Math.PI * 2); ec.fill();
      ec.save(); ec.beginPath(); ec.arc(x, y, r, 0, Math.PI * 2); ec.clip();
      // Cloud bands and night lights: restrained texture, procedurally placed.
      for (let index = 0; index < (lowPower ? 140 : 320); index += 1) {
        const px = random() * width; const py = geo.surfaceY(px) + Math.pow(random(), 1.6) * (height - geo.earthTop + 20);
        const size = 6 + random() * 38;
        const cloud = ec.createRadialGradient(px, py, 0, px, py, size);
        cloud.addColorStop(0, `rgba(200,215,235,${0.03 + random() * 0.06})`); cloud.addColorStop(1, "rgba(200,215,235,0)");
        ec.fillStyle = cloud; ec.fillRect(px - size, py - size, size * 2, size * 2);
      }
      for (let index = 0; index < (lowPower ? 90 : 220); index += 1) {
        const cx = width * (0.35 + gaussian(random) * 0.18); const cy = geo.surfaceY(cx) + 18 + Math.abs(gaussian(random)) * 70;
        ec.fillStyle = `rgba(255,${185 + random() * 40},${120 + random() * 40},${0.18 + random() * 0.4})`;
        ec.fillRect(cx, cy, 0.8 + random() * 1.1, 0.8 + random() * 1.1);
      }
      ec.restore();
      // Thin bright limb
      ec.save(); ec.shadowColor = "rgba(150,200,255,0.9)"; ec.shadowBlur = 18; ec.strokeStyle = "rgba(205,228,255,0.85)"; ec.lineWidth = 1.4;
      ec.beginPath(); ec.arc(x, y, r, Math.PI * 1.02, Math.PI * 1.98); ec.stroke(); ec.restore();

      // Static long-exposure shower
      const s = makeLayer(); showerLayer = s.layer; const sc = s.ctx;
      sc.globalCompositeOperation = "lighter";
      for (const track of tracks) {
        sc.strokeStyle = `rgba(185,212,255,${track.alpha})`; sc.lineWidth = track.width;
        sc.beginPath();
        for (let step = 0; step <= 18; step += 1) { const p = trackPoint(track, step / 18); if (step) sc.lineTo(p.x, p.y); else sc.moveTo(p.x, p.y); }
        sc.stroke();
        if (track.alpha > 0.12) {
          const from = trackPoint(track, track.branchAt);
          const branchLength = track.length * (1 - track.branchAt) * (0.3 + random() * 0.5);
          sc.strokeStyle = `rgba(185,212,255,${track.alpha * 0.55})`; sc.lineWidth = track.width * 0.7;
          sc.beginPath(); sc.moveTo(from.x, from.y); sc.lineTo(from.x + Math.sin(track.angle + track.branchAngle) * branchLength, from.y + Math.cos(track.angle + track.branchAngle) * branchLength); sc.stroke();
        }
      }
      for (let index = 0; index < (lowPower ? 900 : 2400); index += 1) {
        const track = tracks[Math.floor(random() * tracks.length)];
        const p = trackPoint(track, Math.pow(random(), 0.8));
        const bright = random() < 0.06;
        sc.fillStyle = bright ? `rgba(235,244,255,${0.5 + random() * 0.5})` : `rgba(170,205,255,${0.12 + random() * 0.35})`;
        const size = bright ? 1.3 + random() * 1.4 : 0.5 + random() * 0.9;
        sc.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      }
      const axis = sc.createLinearGradient(geo.apex.x, geo.apex.y, geo.apex.x, geo.earthTop);
      axis.addColorStop(0, "rgba(235,245,255,0.55)"); axis.addColorStop(0.5, "rgba(170,205,255,0.16)"); axis.addColorStop(1, "rgba(170,205,255,0)");
      sc.strokeStyle = axis; sc.lineWidth = 1.2; sc.beginPath(); sc.moveTo(geo.apex.x, geo.apex.y); sc.lineTo(geo.apex.x + 6, geo.earthTop); sc.stroke();
      // Incoming primary track
      const inGrad = sc.createLinearGradient(geo.entry.x, geo.entry.y, geo.apex.x, geo.apex.y);
      inGrad.addColorStop(0, "rgba(200,225,255,0.05)"); inGrad.addColorStop(1, "rgba(235,245,255,0.85)");
      sc.strokeStyle = inGrad; sc.lineWidth = 1.1; sc.beginPath(); sc.moveTo(geo.entry.x, geo.entry.y); sc.lineTo(geo.apex.x, geo.apex.y); sc.stroke();
      const glow = sc.createRadialGradient(geo.apex.x, geo.apex.y, 0, geo.apex.x, geo.apex.y, 46);
      glow.addColorStop(0, "rgba(255,255,255,0.95)"); glow.addColorStop(0.12, "rgba(210,232,255,0.55)"); glow.addColorStop(1, "rgba(120,170,255,0)");
      sc.fillStyle = glow; sc.beginPath(); sc.arc(geo.apex.x, geo.apex.y, 46, 0, Math.PI * 2); sc.fill();

      drops = Array.from({ length: lowPower ? 70 : 170 }, () => ({ track: Math.floor(random() * tracks.length), s: random(), speed: 0.06 + random() * 0.22, size: 0.6 + random() * 1.2, alpha: 0.25 + random() * 0.6 }));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height;
      ratio = lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      build();
      if (reducedMotion) draw(performance.now(), true);
    };

    const spawnBurst = (now: number) => {
      const random = Math.random;
      const rays = Array.from({ length: 30 + Math.floor(random() * 50) }, () => ({ angle: gaussian(random) * geo.spread * 0.5, length: (geo.earthTop - geo.apex.y) * (0.45 + random() * 0.6), speed: 0.7 + random() * 0.6, alpha: 0.35 + random() * 0.55, bend: gaussian(random) * 0.04 }));
      burstRef.current = [...burstRef.current.slice(-2), { born: now, duration: 800 + random() * 1000, rays }];
    };
    triggerRef.current = () => { if (!reducedMotion) primaryRef.current = { born: performance.now() }; };

    let nextAmbient = performance.now() + 4_000;
    const draw = (now: number, still = false) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      pointer.sx += (pointer.x - pointer.sx) * 0.06; pointer.sy += (pointer.y - pointer.sy) * 0.06;
      context.clearRect(0, 0, width, height);
      const offset = (amount: number) => ({ x: pointer.sx * amount, y: pointer.sy * amount * 0.6 });
      const o1 = offset(3); const o2 = offset(6); const o3 = offset(10);
      if (earthLayer) context.drawImage(earthLayer, -20 + o1.x, -20 + o1.y, width + 40, height + 40);
      if (showerLayer) context.drawImage(showerLayer, -20 + o2.x, -20 + o2.y, width + 40, height + 40);
      if (still) return;

      context.save(); context.translate(o3.x, o3.y); context.globalCompositeOperation = "lighter";
      for (const drop of drops) {
        drop.s += drop.speed * dt * (0.6 + drop.s * 0.8);
        if (drop.s > 1) { drop.s = 0; drop.track = Math.floor(Math.random() * tracks.length); }
        const track = tracks[drop.track];
        const head = trackPoint(track, drop.s); const tail = trackPoint(track, Math.max(0, drop.s - 0.03 - drop.speed * 0.08));
        const fade = Math.min(1, drop.s * 6) * Math.min(1, (1 - drop.s) * 5);
        context.strokeStyle = `rgba(215,232,255,${drop.alpha * fade * 0.8})`; context.lineWidth = drop.size * 0.7;
        context.beginPath(); context.moveTo(tail.x, tail.y); context.lineTo(head.x, head.y); context.stroke();
      }
      // Ambient primaries keep the object alive between real pulses.
      if (now > nextAmbient && !primaryRef.current) { primaryRef.current = { born: now }; nextAmbient = now + 7_000 + Math.random() * 7_000; }
      const primary = primaryRef.current;
      if (primary) {
        const t = (now - primary.born) / 650;
        if (t < 1) {
          const k = t * t;
          const px = geo.entry.x + (geo.apex.x - geo.entry.x) * k; const py = geo.entry.y + (geo.apex.y - geo.entry.y) * k;
          context.strokeStyle = "rgba(240,248,255,0.9)"; context.lineWidth = 1.2;
          context.beginPath(); context.moveTo(geo.entry.x + (geo.apex.x - geo.entry.x) * Math.max(0, k - 0.18), geo.entry.y + (geo.apex.y - geo.entry.y) * Math.max(0, k - 0.18)); context.lineTo(px, py); context.stroke();
          context.fillStyle = "rgba(255,255,255,1)"; context.fillRect(px - 1.5, py - 1.5, 3, 3);
        } else { primaryRef.current = null; spawnBurst(now); }
      }
      burstRef.current = burstRef.current.filter((burst) => now - burst.born < burst.duration + 400);
      for (const burst of burstRef.current) {
        const age = (now - burst.born) / burst.duration;
        const flash = Math.max(0, 1 - (now - burst.born) / 260);
        if (flash > 0) {
          const bloom = context.createRadialGradient(geo.apex.x, geo.apex.y, 0, geo.apex.x, geo.apex.y, 70);
          bloom.addColorStop(0, `rgba(255,255,255,${0.85 * flash})`); bloom.addColorStop(0.3, `rgba(170,215,255,${0.35 * flash})`); bloom.addColorStop(1, "rgba(120,170,255,0)");
          context.fillStyle = bloom; context.beginPath(); context.arc(geo.apex.x, geo.apex.y, 70, 0, Math.PI * 2); context.fill();
        }
        for (const ray of burst.rays) {
          const grow = Math.min(1, age * ray.speed * 1.4);
          const fade = Math.max(0, 1 - Math.max(0, age - 0.35) / 0.9) * ray.alpha;
          if (fade <= 0) continue;
          const angle = ray.angle + ray.bend * grow;
          const hx = geo.apex.x + Math.sin(angle) * ray.length * grow; const hy = geo.apex.y + Math.cos(angle) * ray.length * grow;
          const tailK = Math.max(0, grow - 0.35);
          const tx = geo.apex.x + Math.sin(angle) * ray.length * tailK; const ty = geo.apex.y + Math.cos(angle) * ray.length * tailK;
          context.strokeStyle = `rgba(200,230,255,${fade * 0.75})`; context.lineWidth = 0.7;
          context.beginPath(); context.moveTo(tx, ty); context.lineTo(hx, hy); context.stroke();
          context.fillStyle = `rgba(245,250,255,${fade})`; context.fillRect(hx - 0.9, hy - 0.9, 1.8, 1.8);
        }
      }
      context.restore();
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (!visible || document.hidden) { last = now; return; }
      draw(now);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }); intersection.observe(canvas);
    const move = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
      pointer.y = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
    };
    if (!reducedMotion) { window.addEventListener("pointermove", move, { passive: true }); frame = requestAnimationFrame(loop); }
    else draw(performance.now(), true);
    return () => { cancelAnimationFrame(frame); resizeObserver.disconnect(); intersection.disconnect(); window.removeEventListener("pointermove", move); triggerRef.current = null; };
  }, [reducedMotion]);

  return <canvas ref={canvasRef} className={`iw-shower-canvas ${className}`} aria-hidden="true" />;
}
