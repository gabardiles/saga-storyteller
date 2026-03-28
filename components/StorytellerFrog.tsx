"use client";

import { useEffect, useRef, useCallback } from "react";

// ── Color palette ──────────────────────────────────────────────
const COLORS = {
  skyTop: "#1a1a2e",
  skyMid: "#2d1b4e",
  skyBottom: "#e8856c",
  skyHorizon: "#f4a261",
  waterDeep: "#0a1628",
  waterMid: "#122240",
  waterSurface: "#1a3355",
  waterHighlight: "rgba(244,162,97,0.15)",
  mist: "rgba(200,180,160,0.06)",
  padDark: "#3a5a4a",
  padMid: "#4a6a58",
  padLight: "#5a7a68",
  frogDark: "#2a5a2a",
  frogMid: "#3d7a3d",
  frogLight: "#5a9a5a",
  frogBelly: "#8ab87a",
  frogSpots: "rgba(20,40,20,0.3)",
  eyeWhite: "#e8e8d0",
  iris: "#8b6914",
  pupil: "#1a1a0a",
  eyeHighlight: "rgba(255,255,240,0.9)",
  mouthLine: "#1a3a1a",
  mouthInside: "#6b2a2a",
  tongue: "#c45a5a",
  firefly: "#f4e27a",
};

const ZOOM = 1.75;
const TAU = Math.PI * 2;

// ── Lily pad polygon points ────────────────────────────────────
function makePadPoints(rx: number, ry: number): [number, number][] {
  const pts: [number, number][] = [];
  const notchStart = -0.25;
  const notchEnd = 0.25;
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const a = notchEnd + (i / steps) * (TAU - (notchEnd - notchStart));
    if (a > TAU + notchStart && i > 0) break;
    pts.push([Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  return pts;
}

// ── Types ──────────────────────────────────────────────────────
interface Props {
  isSpeaking?: boolean;
  width?: number;
  height?: number;
  fullscreen?: boolean;
}

interface Firefly {
  x: number;
  y: number;
  phase: number;
  speed: number;
  size: number;
  drift: number;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

interface AnimState {
  time: number;
  mouthOpen: number;
  mouthTarget: number;
  mouthCycle: number;
  blinkTimer: number;
  blinkState: number;
  breathPhase: number;
  fireflies: Firefly[];
  ripples: Ripple[];
  isSpeaking: boolean;
}

// ── Component ──────────────────────────────────────────────────
export default function StorytellerFrog({
  isSpeaking = false,
  width = 700,
  height = 500,
  fullscreen = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef<AnimState>({
    time: 0,
    mouthOpen: 0,
    mouthTarget: 0,
    mouthCycle: 0,
    blinkTimer: 0,
    blinkState: 0,
    breathPhase: 0,
    fireflies: [],
    ripples: [],
    isSpeaking: false,
  });

  const FOCUS_X = width * 0.42;
  const FOCUS_Y = height * 0.54;

  // Init particles
  useEffect(() => {
    const s = stateRef.current;
    s.fireflies = [];
    s.ripples = [];
    for (let i = 0; i < 12; i++) {
      s.fireflies.push({
        x: Math.random() * width,
        y: Math.random() * height * 0.6,
        phase: Math.random() * TAU,
        speed: 0.3 + Math.random() * 0.5,
        size: 1.5 + Math.random() * 2,
        drift: Math.random() * 0.4 + 0.1,
      });
    }
    for (let i = 0; i < 3; i++) {
      s.ripples.push({
        x: Math.random() * width,
        y: height * 0.55 + Math.random() * height * 0.35,
        radius: Math.random() * 30,
        maxRadius: 30 + Math.random() * 40,
        alpha: 0.3 + Math.random() * 0.3,
      });
    }
  }, [width, height]);

  // Sync speaking prop
  useEffect(() => {
    stateRef.current.isSpeaking = isSpeaking;
  }, [isSpeaking]);

  // ── Drawing ─────────────────────────────────────────────────
  const drawSky = useCallback(
    (ctx: CanvasRenderingContext2D, t: number) => {
      const g = ctx.createLinearGradient(0, 0, 0, height * 0.47);
      g.addColorStop(0, COLORS.skyTop);
      g.addColorStop(0.4, COLORS.skyMid);
      g.addColorStop(0.75, COLORS.skyBottom);
      g.addColorStop(1, COLORS.skyHorizon);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height * 0.47);

      const sg = ctx.createRadialGradient(width * 0.7, height * 0.5, 0, width * 0.7, height * 0.5, 180);
      sg.addColorStop(0, "rgba(255,200,100,0.35)");
      sg.addColorStop(0.4, "rgba(244,162,97,0.15)");
      sg.addColorStop(1, "rgba(244,162,97,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, width, height * 0.6);

      const stars: [number, number][] = [[80, 40], [200, 70], [350, 30], [500, 90], [620, 50], [150, 120], [450, 60], [560, 110]];
      stars.forEach(([sx, sy]) => {
        const tw = 0.5 + Math.sin(t * 2 + sx) * 0.5;
        ctx.globalAlpha = (0.3 + Math.sin(t * 0.5) * 0.1) * tw;
        ctx.fillStyle = "rgba(255,255,220,1)";
        ctx.beginPath();
        ctx.arc(sx, sy, 1 + tw * 0.5, 0, TAU);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    },
    [width, height]
  );

  const drawMist = useCallback(
    (ctx: CanvasRenderingContext2D, t: number) => {
      for (let i = 0; i < 5; i++) {
        const y = height * 0.37 + i * 15;
        const xO = Math.sin(t * 0.3 + i * 1.5) * 30;
        ctx.fillStyle = COLORS.mist;
        ctx.beginPath();
        ctx.ellipse(width * 0.5 + xO, y, width * 0.6, 12 + Math.sin(t * 0.5 + i) * 4, 0, 0, TAU);
        ctx.fill();
      }
    },
    [width, height]
  );

  const drawVegetation = useCallback(
    (ctx: CanvasRenderingContext2D, t: number) => {
      for (let i = 0; i < 5; i++) {
        const bx = 30 + i * 12;
        const sw = Math.sin(t * 0.5 + i * 0.8) * 3;
        ctx.beginPath();
        ctx.moveTo(bx, height * 0.55);
        ctx.quadraticCurveTo(bx + sw, height * 0.35, bx + sw * 1.5, height * 0.2 + i * 15);
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(10,30,15,${0.4 + i * 0.05})`;
        ctx.stroke();
      }
      for (let i = 0; i < 4; i++) {
        const bx = width - 50 + i * 14;
        const sw = Math.sin(t * 0.4 + i * 1.1) * 4;
        ctx.beginPath();
        ctx.moveTo(bx, height * 0.55);
        ctx.quadraticCurveTo(bx + sw, height * 0.3, bx + sw * 1.2, height * 0.15 + i * 20);
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(10,30,15,${0.3 + i * 0.06})`;
        ctx.stroke();
      }
    },
    [width, height]
  );

  const drawWater = useCallback(
    (ctx: CanvasRenderingContext2D, t: number, state: AnimState) => {
      const wy = height * 0.43;
      const wg = ctx.createLinearGradient(0, wy, 0, height);
      wg.addColorStop(0, COLORS.waterSurface);
      wg.addColorStop(0.3, COLORS.waterMid);
      wg.addColorStop(1, COLORS.waterDeep);
      ctx.fillStyle = wg;
      ctx.fillRect(0, wy, width, height - wy);

      ctx.beginPath();
      ctx.moveTo(0, wy);
      for (let i = 0; i <= width; i += 4) {
        ctx.lineTo(i, wy + Math.sin(i * 0.02 + t * 0.8) * 3 + Math.sin(i * 0.05 + t * 1.2) * 1.5);
      }
      ctx.lineTo(width, wy - 10);
      ctx.lineTo(0, wy - 10);
      ctx.closePath();
      ctx.fillStyle = COLORS.waterHighlight;
      ctx.fill();

      const rg = ctx.createLinearGradient(0, wy, 0, wy + 80);
      rg.addColorStop(0, "rgba(244,162,97,0.12)");
      rg.addColorStop(1, "rgba(244,162,97,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(width * 0.4, wy, width * 0.5, 80);

      state.ripples.forEach((r) => {
        r.radius += 0.15;
        r.alpha -= 0.001;
        if (r.radius > r.maxRadius || r.alpha <= 0) {
          r.x = Math.random() * width;
          r.y = height * 0.55 + Math.random() * height * 0.35;
          r.radius = 0;
          r.maxRadius = 30 + Math.random() * 40;
          r.alpha = 0.2 + Math.random() * 0.2;
        }
        ctx.strokeStyle = `rgba(200,220,255,${r.alpha})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, r.radius, r.radius * 0.3, 0, 0, TAU);
        ctx.stroke();
      });
    },
    [width, height]
  );

  const drawLilyPad = useCallback(
    (ctx: CanvasRenderingContext2D, t: number) => {
      const cx = width * 0.42;
      const cy = height * 0.58;
      const rx = 85;
      const ry = 30;
      const bob = Math.sin(t * 0.6) * 2;
      const pts = makePadPoints(rx, ry);

      ctx.save();
      ctx.translate(cx, cy + bob);
      ctx.rotate(Math.sin(t * 0.3) * 0.02);

      // Shadow
      ctx.save();
      ctx.translate(3, 3);
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      pts.forEach(([px, py]) => ctx.lineTo(px, py));
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Base fill
      ctx.beginPath();
      ctx.moveTo(0, 0);
      pts.forEach(([px, py]) => ctx.lineTo(px, py));
      ctx.closePath();
      ctx.fillStyle = COLORS.padDark;
      ctx.fill();

      // Gradient overlay
      const pg = ctx.createRadialGradient(-10, -5, 5, 0, 0, rx);
      pg.addColorStop(0, COLORS.padLight);
      pg.addColorStop(0.5, COLORS.padMid);
      pg.addColorStop(1, COLORS.padDark);
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      pts.forEach(([px, py]) => ctx.lineTo(px * 0.97, py * 0.97));
      ctx.closePath();
      ctx.fill();

      // Veins
      ctx.strokeStyle = "rgba(0,0,0,0.08)";
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI + (i / 7) * Math.PI * 1.7;
        const ex = Math.cos(a) * rx * 0.88;
        const ey = Math.sin(a) * ry * 0.88;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(ex * 0.5 + Math.sin(i * 2) * 4, ey * 0.5, ex, ey);
        ctx.stroke();
      }

      // Water droplet
      const dg = ctx.createRadialGradient(-28, -4, 0, -28, -4, 3.5);
      dg.addColorStop(0, "rgba(255,255,255,0.35)");
      dg.addColorStop(1, "rgba(200,230,220,0)");
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.arc(-28, -4, 3.5, 0, TAU);
      ctx.fill();

      ctx.restore();
      return { cx, cy: cy + bob };
    },
    [width, height]
  );

  const drawFrog = useCallback(
    (ctx: CanvasRenderingContext2D, _t: number, state: AnimState, padPos: { cx: number; cy: number }) => {
      const fx = padPos.cx - 5;
      const fy = padPos.cy - 28;
      const br = Math.sin(state.breathPhase) * 2;

      ctx.save();
      ctx.translate(fx, fy);

      // Back legs
      ctx.fillStyle = COLORS.frogDark;
      ctx.beginPath(); ctx.ellipse(-32, 10 + br * 0.3, 18, 8, -0.3, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-48, 14, 10, 4, -0.2, 0, TAU); ctx.fill();
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(-54 - i * 3, 13 + i * 2, 5, 2, -0.4 + i * 0.2, 0, TAU); ctx.fill(); }
      ctx.beginPath(); ctx.ellipse(28, 10 + br * 0.3, 18, 8, 0.3, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(44, 14, 10, 4, 0.2, 0, TAU); ctx.fill();
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(50 + i * 3, 13 + i * 2, 5, 2, 0.4 - i * 0.2, 0, TAU); ctx.fill(); }

      // Body shadow
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.beginPath(); ctx.ellipse(2, 5 + br * 0.5, 38, 20, 0, 0, TAU); ctx.fill();

      // Body
      const bg = ctx.createRadialGradient(-8, -8, 3, 0, 0, 40);
      bg.addColorStop(0, COLORS.frogLight);
      bg.addColorStop(0.5, COLORS.frogMid);
      bg.addColorStop(1, COLORS.frogDark);
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.ellipse(0, br * 0.5, 36, 18 + br * 0.5, 0, 0, TAU); ctx.fill();

      // Belly
      ctx.fillStyle = COLORS.frogBelly;
      ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.ellipse(0, 6 + br * 0.3, 22, 10, 0, 0, Math.PI); ctx.fill();
      ctx.globalAlpha = 1;

      // Spots
      const spots: [number, number, number][] = [[-12, -6, 5], [-20, 2, 4], [8, -8, 3], [15, -2, 4], [5, 4, 3], [-8, -12, 3]];
      ctx.fillStyle = COLORS.frogSpots;
      spots.forEach(([sx, sy, sr]) => { ctx.beginPath(); ctx.arc(sx, sy + br * 0.2, sr, 0, TAU); ctx.fill(); });

      // Front legs
      ctx.fillStyle = COLORS.frogMid;
      ctx.beginPath(); ctx.ellipse(-26, 8 + br * 0.3, 8, 5, -0.4, 0, TAU); ctx.fill();
      ctx.fillStyle = COLORS.frogDark;
      ctx.beginPath(); ctx.ellipse(-32, 12, 7, 3, -0.2, 0, TAU); ctx.fill();
      ctx.fillStyle = COLORS.frogMid;
      ctx.beginPath(); ctx.ellipse(22, 8 + br * 0.3, 8, 5, 0.4, 0, TAU); ctx.fill();
      ctx.fillStyle = COLORS.frogDark;
      ctx.beginPath(); ctx.ellipse(28, 12, 7, 3, 0.2, 0, TAU); ctx.fill();

      // Head
      const hg = ctx.createRadialGradient(-5, -22, 3, 0, -18, 28);
      hg.addColorStop(0, COLORS.frogLight);
      hg.addColorStop(0.6, COLORS.frogMid);
      hg.addColorStop(1, COLORS.frogDark);
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.ellipse(0, -18 + br * 0.3, 26, 16, 0, 0, TAU); ctx.fill();

      // Eyes
      const eyeY = -28 + br * 0.2;
      const bk = state.blinkState === 0 ? 1 : state.blinkState === 1 ? Math.max(0.05, 1 - state.blinkTimer * 8) : Math.min(1, state.blinkTimer * 5);

      ([-15, 15] as number[]).forEach((ex) => {
        ctx.fillStyle = COLORS.frogMid;
        ctx.beginPath(); ctx.ellipse(ex, eyeY - 2, 12, 10 * bk, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = COLORS.eyeWhite;
        ctx.beginPath(); ctx.ellipse(ex, eyeY, 9, 8 * bk, 0, 0, TAU); ctx.fill();
        if (bk > 0.3) {
          ctx.fillStyle = COLORS.iris;
          ctx.beginPath(); ctx.ellipse(ex + 1, eyeY + 1, 5, 5 * bk, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = COLORS.pupil;
          ctx.beginPath(); ctx.ellipse(ex + 1, eyeY + 1, 2.5, 3.5 * bk, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = COLORS.eyeHighlight;
          ctx.beginPath(); ctx.arc(ex - 2, eyeY - 2, 2, 0, TAU); ctx.fill();
        }
        if (bk < 0.9) {
          ctx.fillStyle = COLORS.frogMid;
          ctx.beginPath(); ctx.ellipse(ex, eyeY - 4, 10, 8 * (1 - bk), 0, 0, Math.PI); ctx.fill();
        }
      });

      // Nostrils
      ctx.fillStyle = "rgba(20,40,20,0.5)";
      ctx.beginPath(); ctx.ellipse(-5, -20 + br * 0.2, 1.5, 1, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(5, -20 + br * 0.2, 1.5, 1, 0, 0, TAU); ctx.fill();

      // Mouth
      const mY = -10 + br * 0.3;
      const mW = 18;
      const mo = state.mouthOpen;

      if (mo > 0.05) {
        ctx.fillStyle = COLORS.mouthInside;
        ctx.beginPath(); ctx.ellipse(0, mY + mo * 3, mW * 0.7, mo * 5, 0, 0, TAU); ctx.fill();
        if (mo > 0.4) {
          ctx.fillStyle = COLORS.tongue;
          ctx.beginPath(); ctx.ellipse(2, mY + mo * 4 + 1, 6 * mo, 2 * mo, 0.1, 0, TAU); ctx.fill();
        }
        ctx.strokeStyle = COLORS.mouthLine;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-mW, mY); ctx.quadraticCurveTo(0, mY - mo * 2, mW, mY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-mW, mY); ctx.quadraticCurveTo(0, mY + mo * 8, mW, mY); ctx.stroke();
      } else {
        ctx.strokeStyle = COLORS.mouthLine;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-mW, mY);
        ctx.quadraticCurveTo(-5, mY + 4, 0, mY + 3);
        ctx.quadraticCurveTo(5, mY + 4, mW, mY);
        ctx.stroke();
      }

      // Cheek blush
      ctx.fillStyle = "rgba(180,100,80,0.08)";
      ctx.beginPath(); ctx.ellipse(-20, -12, 8, 5, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(20, -12, 8, 5, 0, 0, TAU); ctx.fill();

      ctx.restore();
    },
    []
  );

  const drawFireflies = useCallback(
    (ctx: CanvasRenderingContext2D, t: number, state: AnimState) => {
      state.fireflies.forEach((ff) => {
        ff.x += Math.sin(t * ff.speed + ff.phase) * ff.drift;
        ff.y += Math.cos(t * ff.speed * 0.7 + ff.phase) * ff.drift * 0.5;
        if (ff.x < -10) ff.x = width + 10;
        if (ff.x > width + 10) ff.x = -10;
        if (ff.y < -10) ff.y = height * 0.5;

        const gl = 0.3 + Math.sin(t * 2 + ff.phase) * 0.3;
        const gg = ctx.createRadialGradient(ff.x, ff.y, 0, ff.x, ff.y, ff.size * 4);
        gg.addColorStop(0, `rgba(244,226,122,${gl})`);
        gg.addColorStop(0.5, `rgba(244,226,122,${gl * 0.3})`);
        gg.addColorStop(1, "rgba(244,226,122,0)");
        ctx.fillStyle = gg;
        ctx.fillRect(ff.x - ff.size * 4, ff.y - ff.size * 4, ff.size * 8, ff.size * 8);
        ctx.fillStyle = COLORS.firefly;
        ctx.globalAlpha = gl + 0.3;
        ctx.beginPath(); ctx.arc(ff.x, ff.y, ff.size * 0.5, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      });
    },
    [width, height]
  );

  const drawVignette = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const g = ctx.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, height * 0.85);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    },
    [width, height]
  );

  // ── Animation loop ──────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    let lastTime = performance.now();

    const animate = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const state = stateRef.current;
      state.time += dt;
      state.breathPhase += dt * 1.2;
      const t = state.time;

      // Blink
      if (state.blinkState === 0) {
        state.blinkTimer += dt;
        if (state.blinkTimer > 2.5 + Math.random() * 3) { state.blinkState = 1; state.blinkTimer = 0; }
      } else if (state.blinkState === 1) {
        state.blinkTimer += dt;
        if (state.blinkTimer > 0.1) { state.blinkState = 2; state.blinkTimer = 0; }
      } else {
        state.blinkTimer += dt;
        if (state.blinkTimer > 0.15) { state.blinkState = 0; state.blinkTimer = 0; }
      }

      // Mouth
      if (state.isSpeaking) {
        state.mouthCycle += dt * 8;
        state.mouthTarget = 0.3 + Math.sin(state.mouthCycle) * 0.25 + Math.sin(state.mouthCycle * 2.7) * 0.15;
        state.mouthTarget = Math.max(0.05, Math.min(0.85, state.mouthTarget));
      } else {
        state.mouthTarget = 0;
        state.mouthCycle = 0;
      }
      state.mouthOpen += (state.mouthTarget - state.mouthOpen) * Math.min(1, dt * 15);

      // Draw
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2 - FOCUS_X * ZOOM, height / 2 - FOCUS_Y * ZOOM);
      ctx.scale(ZOOM, ZOOM);

      drawSky(ctx, t);
      drawMist(ctx, t);

      // Vegetation
      for (let i = 0; i < 5; i++) {
        const bx = 30 + i * 12;
        const sw = Math.sin(t * 0.5 + i * 0.8) * 3;
        ctx.beginPath(); ctx.moveTo(bx, height * 0.47);
        ctx.quadraticCurveTo(bx + sw, height * 0.3, bx + sw * 1.5, height * 0.15 + i * 15);
        ctx.lineWidth = 2; ctx.strokeStyle = `rgba(10,30,15,${0.4 + i * 0.05})`; ctx.stroke();
      }
      for (let i = 0; i < 4; i++) {
        const bx = width - 50 + i * 14;
        const sw = Math.sin(t * 0.4 + i * 1.1) * 4;
        ctx.beginPath(); ctx.moveTo(bx, height * 0.47);
        ctx.quadraticCurveTo(bx + sw, height * 0.25, bx + sw * 1.2, height * 0.1 + i * 20);
        ctx.lineWidth = 2; ctx.strokeStyle = `rgba(10,30,15,${0.3 + i * 0.06})`; ctx.stroke();
      }

      drawWater(ctx, t, state);
      const padPos = drawLilyPad(ctx, t);
      drawFrog(ctx, t, state, padPos);
      drawFireflies(ctx, t, state);
      drawVignette(ctx);

      ctx.restore();
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, FOCUS_X, FOCUS_Y, drawSky, drawMist, drawWater, drawLilyPad, drawFrog, drawFireflies, drawVignette]);

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        borderRadius: fullscreen ? 0 : 16,
        overflow: "hidden",
        boxShadow: fullscreen ? "none" : "0 8px 32px rgba(0,0,0,0.5)",
      }}
    >
      <canvas ref={canvasRef} style={{ width, height, display: "block" }} />
      {isSpeaking && (
        <div
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(8px)",
            padding: "4px 14px",
            borderRadius: 20,
            color: "rgba(255,255,240,0.8)",
            fontSize: 12,
            fontFamily: "monospace",
            letterSpacing: 1,
          }}
        >
          ● storytelling...
        </div>
      )}
    </div>
  );
}
