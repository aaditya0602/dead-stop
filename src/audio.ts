let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted: boolean | null = null;
let lastMoveT = -1;
const MUTE_KEY = "deadstop.muted";

function loadMuted(): boolean {
  if (muted === null) { try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch { muted = false; } }
  return muted;
}

export function initAudio(): void {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.8; master.connect(ctx.destination);
    } else if (ctx.state === "suspended") { void ctx.resume(); }
  } catch { ctx = null; master = null; }
}

export function isMuted(): boolean { return loadMuted(); }

export function toggleMute(): boolean {
  const next = !loadMuted(); muted = next;
  try { localStorage.setItem(MUTE_KEY, next ? "1" : "0"); } catch { /* privacy mode */ }
  return next;
}

function noiseBurst(c: AudioContext, m: GainNode, t0: number, dur: number, peak: number): void {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(); src.buffer = buf;
  const filt = c.createBiquadFilter(); filt.type = "lowpass";
  filt.frequency.setValueAtTime(2500, t0); filt.frequency.exponentialRampToValueAtTime(100, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(peak, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filt).connect(g).connect(m);
  src.start(t0); src.stop(t0 + dur);
}

export function sfxMove(timeScale: number): void {
  const c = ctx, m = master;
  if (loadMuted() || !c || !m || timeScale < 0.15) return;
  const t0 = c.currentTime;
  if (t0 - lastMoveT < 0.09) return;
  lastMoveT = t0;
  const osc = c.createOscillator(), filt = c.createBiquadFilter(), g = c.createGain();
  osc.type = "sawtooth"; osc.frequency.value = 80 + timeScale * 260;
  filt.type = "lowpass"; filt.frequency.value = 300 + timeScale * 1800;
  const peak = 0.02 + timeScale * 0.04;
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + 0.015); g.gain.linearRampToValueAtTime(0, t0 + 0.07);
  osc.connect(filt).connect(g).connect(m); osc.start(t0); osc.stop(t0 + 0.08);
}

export function sfxDeath(): void {
  const c = ctx, m = master;
  if (loadMuted() || !c || !m) return;
  const t0 = c.currentTime;
  noiseBurst(c, m, t0, 0.4, 0.3);
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = "square"; osc.frequency.setValueAtTime(180, t0); osc.frequency.exponentialRampToValueAtTime(30, t0 + 0.4);
  g.gain.setValueAtTime(0.25, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
  osc.connect(g).connect(m); osc.start(t0); osc.stop(t0 + 0.42);
}

// A short bright blip for a near miss - higher and thinner than sfxTick's
// 1800hz square so the two never get mistaken for one another.
export function sfxNearMiss(): void {
  const c = ctx, m = master;
  if (loadMuted() || !c || !m) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(2600, t0);
  osc.frequency.exponentialRampToValueAtTime(1900, t0 + 0.08);
  g.gain.setValueAtTime(0.001, t0);
  g.gain.linearRampToValueAtTime(0.1, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
  osc.connect(g).connect(m); osc.start(t0); osc.stop(t0 + 0.11);
}

export function sfxTick(): void {
  const c = ctx, m = master;
  if (loadMuted() || !c || !m) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = "square"; osc.frequency.value = 1800;
  g.gain.setValueAtTime(0.05, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
  osc.connect(g).connect(m); osc.start(t0); osc.stop(t0 + 0.06);
}

export function sfxStart(): void {
  const c = ctx, m = master;
  if (loadMuted() || !c || !m) return;
  const t0 = c.currentTime;
  [440, 660].forEach((f, i) => {
    const t = t0 + i * 0.07;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = "triangle"; osc.frequency.value = f;
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g).connect(m); osc.start(t); osc.stop(t + 0.09);
  });
}
