// Arena geometry, the juice palette, and the three pure effect systems
// (afterimages, spawn telegraphs, death fragments).
//
// Split out of main.ts only because main.ts crossed ~400 lines. There is no
// abstraction here on purpose: no base classes, no registry, no engine wrapper.
// Every function below is a plain function that takes the kaplay handle as its
// first argument, exactly the way `global: false` intends. main.ts still owns
// all game state and every update; this file only holds data shapes and pixels.

import type { KAPLAYCtx, Vec2 } from "kaplay";

export const W = 960;
export const H = 540;
export const PLAYER_R = 12;
export const HAZARD_R = 10;

// Telegraph lead is measured in REAL (unscaled) seconds on purpose. A warning
// you cannot read is not a warning: at timeScale 0.05 a *scaled* 0.5s lead
// would take 10 wall-clock seconds to resolve, while at timeScale 1.0 the same
// marker would flash past in 0.5s. Real time keeps the promise legible at every
// speed, and it matches the existing rule that SPAWNING itself is unscaled.
export const TELEGRAPH_LEAD = 0.5;

export const GHOST_LIFE = 0.35;
export const GHOST_STEP = 0.016; // afterimage spacing, on the SCALED clock
export const HIT_STOP = 0.1; // dead-still freeze at the moment of impact
export const SHAKE_TIME = 0.35;
export const SHAKE_MAG = 15;

type RGB = readonly [number, number, number];
export const CO = {
  player: [232, 236, 245],
  trail: [110, 175, 255],
  hazard: [235, 92, 44],
  warn: [255, 176, 60],
  frame: [40, 40, 55],
  dim: [118, 122, 142],
  white: [255, 255, 255],
  shade: [6, 6, 12],
} as const;

export function col(k: KAPLAYCtx, c: RGB) {
  return k.rgb(c[0], c[1], c[2]);
}

export interface Telegraph {
  pos: Vec2; // clamped to the arena edge so the marker is actually on screen
  from: Vec2; // true off-screen spawn point the hazard will arrive from
  dir: Vec2;
  speed: number;
  t: number;
}

export interface Ghost {
  pos: Vec2;
  t: number;
  born: number; // timeScale at emit - this is what makes speed READ
}

export interface Frag {
  pos: Vec2;
  vel: Vec2;
  t: number;
  life: number;
  size: number;
}

// localStorage throws outright in some privacy modes rather than returning
// null, so every touch is guarded. A lost best time is survivable; a crash on
// boot is not.
const BEST_KEY = "deadstop.best";

export function loadBest(): number {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (raw === null) return 0;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

// Stored rounded to the same 1 decimal the HUD prints. Storing the raw float
// wrote values like "14.999999999999998", and let a run claim NEW BEST by a
// margin too small to show up on screen - which just reads as a bug.
export function saveBest(v: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(Math.round(v * 10) / 10));
  } catch {
    // storage disabled; nothing to do
  }
}

export function drawArenaFrame(k: KAPLAYCtx, glow: number): void {
  k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, fill: false, outline: { color: col(k, CO.frame), width: 2 } });
  if (glow > 0) {
    k.drawRect({
      pos: k.vec2(3, 3), width: W - 6, height: H - 6, fill: false,
      outline: { color: col(k, CO.warn), width: 2 }, opacity: glow * 0.6,
    });
  }
}

// Screen-edge flash on the difficulty tick. Three stacked bands per edge fake a
// soft inward falloff without a shader. Only drawn while the flash is alive.
export function drawEdgeFlash(k: KAPLAYCtx, a: number): void {
  const c = col(k, CO.warn);
  for (let j = 0; j < 3; j++) {
    const b = 10, o = a * a * 0.22 * (1 - j / 3), d = j * b;
    k.drawRect({ pos: k.vec2(0, d), width: W, height: b, color: c, opacity: o });
    k.drawRect({ pos: k.vec2(0, H - d - b), width: W, height: b, color: c, opacity: o });
    k.drawRect({ pos: k.vec2(d, 0), width: b, height: H, color: c, opacity: o });
    k.drawRect({ pos: k.vec2(W - d - b, 0), width: b, height: H, color: c, opacity: o });
  }
}

// Afterimages. Alpha is squared against the timeScale the ghost was born at, so
// a crawling player leaves nothing visible and a sprinting one leaves a streak.
export function drawGhosts(k: KAPLAYCtx, ghosts: Ghost[]): void {
  const c = col(k, CO.trail);
  for (const g of ghosts) {
    const f = g.t / GHOST_LIFE;
    k.drawCircle({ pos: g.pos, radius: PLAYER_R * (0.45 + 0.55 * f), color: c, opacity: 0.55 * f * g.born * g.born });
  }
}

// A chevron pointing along the incoming vector, growing and brightening as its
// real-time countdown runs out, with a pulsing ring so it reads as "incoming".
export function drawTelegraphs(k: KAPLAYCtx, tgs: Telegraph[]): void {
  const c = col(k, CO.warn);
  for (const tg of tgs) {
    const p = 1 - tg.t / TELEGRAPH_LEAD; // 0 -> 1 as the hazard closes in
    const len = 9 + 16 * p;
    const n = k.vec2(-tg.dir.y, tg.dir.x);
    const tip = tg.pos.add(tg.dir.scale(len));
    const back = tg.pos.sub(tg.dir.scale(len * 0.45));
    const o = 0.3 + 0.7 * p, wd = 2 + 2 * p;
    k.drawLine({ p1: back.add(n.scale(len * 0.75)), p2: tip, width: wd, color: c, opacity: o });
    k.drawLine({ p1: back.sub(n.scale(len * 0.75)), p2: tip, width: wd, color: c, opacity: o });
    k.drawCircle({
      pos: tg.pos, radius: 3 + 9 * p * (0.75 + 0.25 * Math.sin(p * 26)),
      color: c, fill: false, outline: { color: c, width: 2 }, opacity: o * 0.8,
    });
  }
}

export function burst(k: KAPLAYCtx, at: Vec2): Frag[] {
  const out: Frag[] = [];
  const n = k.randi(14, 21);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + k.rand(-0.25, 0.25);
    const u = k.vec2(Math.cos(a), Math.sin(a));
    const t = k.rand(0.45, 0.95);
    out.push({ pos: at.add(u.scale(k.rand(0, PLAYER_R))), vel: u.scale(k.rand(90, 320)), t, life: t, size: k.rand(2, 5) });
  }
  return out;
}

// UNSCALED on purpose - see the death-sequence note in main.ts.
export function stepFrags(frags: Frag[], dt: number): void {
  for (let i = frags.length - 1; i >= 0; i--) {
    const f = frags[i];
    f.vel = f.vel.scale(Math.max(0, 1 - 3.4 * dt)); // drag
    f.pos = f.pos.add(f.vel.scale(dt));
    f.t -= dt;
    if (f.t <= 0) frags.splice(i, 1);
  }
}

export function drawFrags(k: KAPLAYCtx, frags: Frag[]): void {
  const c = col(k, CO.player);
  for (const f of frags) {
    const fr = f.t / f.life;
    k.drawCircle({ pos: f.pos, radius: f.size * fr, color: c, opacity: fr });
  }
}
