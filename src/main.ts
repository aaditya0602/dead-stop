import kaplay from "kaplay";
import type { Vec2 } from "kaplay";
import { initAudio, isMuted, toggleMute, sfxMove, sfxDeath, sfxTick, sfxStart } from "./audio";
import {
  W, H, PLAYER_R, HAZARD_R, TELEGRAPH_LEAD, GHOST_LIFE, GHOST_STEP, HIT_STOP, SHAKE_TIME, SHAKE_MAG,
  CO, col, loadBest, saveBest, drawArenaFrame, drawEdgeFlash, drawGhosts, drawTelegraphs, drawFrags,
  burst, stepFrags,
} from "./fx";
import type { Telegraph, Ghost, Frag } from "./fx";

const k = kaplay({
  width: 960,
  height: 540,
  letterbox: true,
  stretch: true,
  background: [10, 10, 16],
  crisp: true,
  global: false,
  canvas: document.getElementById("game") as HTMLCanvasElement,
});

const MAX_SPEED = 260;
const MIN_TIME_SCALE = 0.05;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const muteLabel = () => (isMuted() ? "MUTED" : "SOUND ON");

// ---------------------------------------------------------------------------
// DIFFICULTY RAMP
//
//   level         = floor(elapsed / 10)                  // unscaled clock
//   spawnInterval = max(0.14, 0.60 * 0.86^level)
//   hazardSpeed   = min(300, 200 + 8 * level)
//
// Rationale (the lead's call, recorded here): the old constant 0.45s spawn was
// punishing from second zero - a first-timer got no legible play at all.
// Starting at 0.60s buys roughly 10s of readable play before the geometric
// squeeze bites, and a first-timer STILL dies at 10-20s, because panic-moving
// runs the world at full speed and the ramp does not care how scared you are.
// The 0.86 geometric step reaches the old 0.45s at ~20s and 0.24s by 60s, so a
// competent player who actually modulates speed lands in the 45-90s band. The
// 0.14s floor guarantees runs end instead of dragging.
//
// NOTE: the old k.loop(SPAWN_EVERY, ...) is a fixed-interval loop and cannot
// ramp. It is replaced below by an accumulator on UNSCALED dt() compared
// against the current spawnInterval.
// ---------------------------------------------------------------------------
const levelAt = (elapsed: number) => Math.floor(elapsed / 10);
const spawnIntervalAt = (level: number) => Math.max(0.14, 0.6 * Math.pow(0.86, level));
const hazardSpeedAt = (level: number) => Math.min(300, 200 + 8 * level);

// ---------------------------------------------------------------------------
// TITLE
// ---------------------------------------------------------------------------
k.scene("title", () => {
  const best = loadBest();
  let t = 0;

  // initAudio() on the first keypress: browsers refuse to start an AudioContext
  // before a user gesture. Calling it more than once is safe.
  k.onKeyPress((key) => {
    initAudio();
    if (key === "m") return; // M is mute in every state, never "any key"
    k.go("game");
  });
  k.onKeyPress("m", () => { initAudio(); toggleMute(); });
  k.onUpdate(() => { t += k.dt(); });

  k.onDraw(() => {
    drawArenaFrame(k, 0);
    const mid = (y: number) => k.vec2(W / 2, y);
    k.drawText({ text: "DEAD STOP", size: 92, pos: mid(120), anchor: "center", color: col(k, CO.player) });
    k.drawText({ text: "The world moves only as fast as you do", size: 26, pos: mid(192), anchor: "center", color: col(k, CO.trail) });
    k.drawText({ text: "WASD / ARROWS to move", size: 22, pos: mid(262), anchor: "center", color: col(k, CO.dim) });
    k.drawText({ text: "Keyboard only - no touch or mobile support", size: 18, pos: mid(294), anchor: "center", color: col(k, CO.dim) });
    // NEVER wrap a single word in square brackets in drawText. kaplay parses
    // styled-text tags with /^\[(\/)?(\w+?)\]/ and THROWS on an unclosed tag,
    // which kills the whole onDraw and blanks the screen. "[MUTED]" is all word
    // characters, so it parsed as a tag and blacked out the title for anyone who
    // had mute persisted; "[SOUND ON]" survived only because of the space.
    // Parentheses are not parsed. Keep it that way.
    k.drawText({ text: `M - MUTE   (${muteLabel()})`, size: 20, pos: mid(334), anchor: "center", color: col(k, CO.warn) });
    if (best > 0) {
      k.drawText({ text: `BEST ${best.toFixed(1)}s`, size: 24, pos: mid(378), anchor: "center", color: col(k, CO.hazard) });
    }
    k.drawText({
      text: "ANY KEY TO START", size: 32, pos: mid(460), anchor: "center",
      color: col(k, CO.white), opacity: 0.55 + 0.45 * Math.sin(t * 4),
    });
  });
});

// ---------------------------------------------------------------------------
// GAME
// ---------------------------------------------------------------------------
k.scene("game", () => {
  // SINGLE SOURCE OF TRUTH.
  // Written exactly once per frame, in the player update below. Read by every
  // non-player update and by every draw. Nothing else in this file may assign
  // to it. Any entity that advances on raw dt() instead of dt() * timeScale
  // breaks the game. The only sanctioned exceptions are (a) the spawn and
  // telegraph pipeline, documented at its constants, and (b) the death
  // sequence, which is unscaled because you are dead and the world no longer
  // obeys you.
  let timeScale = MIN_TIME_SCALE;
  let elapsed = 0;
  let level = 0;
  let dead = false;

  const best = loadBest();
  let newBest = false;

  let spawnAcc = 0;
  let ghostAcc = 0;
  let tickFlash = 0;

  // death-sequence state, all advanced on UNSCALED dt()
  let hitStop = 0;
  let deathT = 0;
  let shake = 0;
  let flash = 0;

  const telegraphs: Telegraph[] = [];
  const ghosts: Ghost[] = [];
  const frags: Frag[] = [];

  // circle() + opacity(0) keeps the EXACT area() collider the working skeleton
  // had, while every visible pixel is drawn by hand in onDraw below. Drawing by
  // hand is what buys layering (trails under bodies, particles over everything)
  // and a shake that offsets the world without dragging the HUD along with it.
  const makeBody = (p: Vec2, r: number, tag: string) =>
    k.add([k.pos(p), k.circle(r), k.opacity(0), k.area(), k.anchor("center"), tag]);
  type Body = ReturnType<typeof makeBody>;

  const hazards: { o: Body; vel: Vec2 }[] = [];
  const player = makeBody(k.vec2(W / 2, H / 2), PLAYER_R, "player");

  // Spawn geometry is computed HERE, at telegraph time, and carried untouched
  // to the hazard. The telegraph is a promise: the thing must arrive from where
  // the marker was, travelling along the vector the marker pointed.
  function queueHazard(): void {
    const edge = k.randi(0, 4);
    const m = HAZARD_R * 3;
    let from = k.vec2(0, 0);
    if (edge === 0) from = k.vec2(k.rand(0, W), -m);
    else if (edge === 1) from = k.vec2(k.rand(0, W), H + m);
    else if (edge === 2) from = k.vec2(-m, k.rand(0, H));
    else from = k.vec2(W + m, k.rand(0, H));

    const target = k.vec2(k.rand(W * 0.25, W * 0.75), k.rand(H * 0.25, H * 0.75));
    telegraphs.push({
      pos: k.vec2(k.clamp(from.x, 18, W - 18), k.clamp(from.y, 18, H - 18)),
      from,
      dir: target.sub(from).unit(),
      speed: hazardSpeedAt(level),
      t: TELEGRAPH_LEAD,
    });
  }

  sfxStart();

  // --- UPDATE 1: the player. Registered FIRST so timeScale is fresh before
  // anything else reads it this frame. This is the only writer of timeScale.
  k.onUpdate(() => {
    if (dead) return;

    let dir = k.vec2(0, 0);
    if (k.isKeyDown("left") || k.isKeyDown("a")) dir.x -= 1;
    if (k.isKeyDown("right") || k.isKeyDown("d")) dir.x += 1;
    if (k.isKeyDown("up") || k.isKeyDown("w")) dir.y -= 1;
    if (k.isKeyDown("down") || k.isKeyDown("s")) dir.y += 1;
    if (dir.len() > 0) dir = dir.unit(); // no free speed on diagonals

    const vel = dir.scale(MAX_SPEED);
    timeScale = k.clamp(vel.len() / MAX_SPEED, MIN_TIME_SCALE, 1);

    // The player is the one thing timeScale never touches.
    player.pos = player.pos.add(vel.scale(k.dt()));
    player.pos.x = k.clamp(player.pos.x, PLAYER_R, W - PLAYER_R);
    player.pos.y = k.clamp(player.pos.y, PLAYER_R, H - PLAYER_R);

    elapsed += k.dt(); // unscaled: standing still still costs you

    const lv = levelAt(elapsed);
    if (lv > level) {
      level = lv;
      sfxTick(); // exactly once per step
      tickFlash = 1;
    }

    // Every frame. The audio module rate-limits internally; that is its job.
    sfxMove(timeScale);
  });

  // --- UPDATE 2: the world.
  k.onUpdate(() => {
    if (dead) return;
    const dts = k.dt() * timeScale; // scaled clock - the world
    const dtr = k.dt(); // real clock - spawn pipeline and tick flash only

    if (tickFlash > 0) tickFlash = Math.max(0, tickFlash - dtr / 0.45);

    // SPAWNING RUNS ON UNSCALED TIME, deliberately. If spawning were scaled,
    // standing still would freeze the world AND stop the threat, making camping
    // strictly dominant. Unscaled spawning means hazards keep arriving and pile
    // up while you are frozen, so eventually you MUST move - and the instant you
    // do, the whole accumulated wall snaps to full speed. That is the game.
    spawnAcc += dtr;
    const interval = spawnIntervalAt(level);
    while (spawnAcc >= interval) {
      spawnAcc -= interval;
      queueHazard();
    }

    // Telegraph countdown: unscaled, see TELEGRAPH_LEAD in fx.ts.
    for (let i = telegraphs.length - 1; i >= 0; i--) {
      const tg = telegraphs[i];
      tg.t -= dtr;
      if (tg.t <= 0) {
        hazards.push({ o: makeBody(tg.from, HAZARD_R, "hazard"), vel: tg.dir.scale(tg.speed) });
        telegraphs.splice(i, 1);
      }
    }

    // Hazards: SCALED.
    const m = HAZARD_R * 4;
    for (let i = hazards.length - 1; i >= 0; i--) {
      const h = hazards[i];
      h.o.pos = h.o.pos.add(h.vel.scale(dts));
      const p = h.o.pos;
      if (p.x < -m || p.x > W + m || p.y < -m || p.y > H + m) {
        k.destroy(h.o);
        hazards.splice(i, 1);
      }
    }

    // Player afterimages: emitted on the SCALED clock and faded on it too, so
    // the emitter self-regulates. Crawling at timeScale 0.05 drops one ghost
    // every ~20 frames at ~1% alpha (invisible); at full tilt it drops one per
    // frame at full alpha and the player streaks. This is the visual channel
    // for the core mechanic. Ghosts also hang frozen in the air when you stop,
    // which is exactly right: your own wake obeys the clock the world does.
    // One ghost per frame at most: the player only HAS one position per frame,
    // so a while-loop here would stack identical ghosts on top of each other
    // whenever a frame ran long (background tabs, hitches) for no visual gain.
    ghostAcc += dts;
    if (ghostAcc >= GHOST_STEP) {
      ghostAcc = 0;
      ghosts.push({ pos: player.pos.clone(), t: GHOST_LIFE, born: timeScale });
    }
    for (let i = ghosts.length - 1; i >= 0; i--) {
      ghosts[i].t -= dts;
      if (ghosts[i].t <= 0) ghosts.splice(i, 1);
    }
  });

  player.onCollide("hazard", () => {
    if (dead) return;
    dead = true; // freezes the scene: both updates above return early on this
    // Hazards alive right now are deliberately NOT destroyed: the frozen wall of
    // them IS the death screen. They are reclaimed by k.go()'s scene teardown,
    // which removes every root object that has no stay() tag - and this game uses
    // no stay() tags anywhere. If that ever changes, free them here explicitly.
    sfxDeath(); // at the moment of collision, under the hit-stop
    hitStop = HIT_STOP;
    if (elapsed > best) {
      newBest = true;
      saveBest(elapsed);
    }
  });

  // --- UPDATE 3: the death sequence. UNSCALED, on purpose. You are dead; the
  // world no longer obeys you, so it stops taking its clock from your speed.
  k.onUpdate(() => {
    if (!dead) return;
    const dtr = k.dt();

    if (hitStop > 0) {
      hitStop -= dtr;
      if (hitStop <= 0) {
        hitStop = 0;
        shake = 1;
        flash = 1;
        frags.push(...burst(k, player.pos)); // shatter fires only after the freeze
      }
      return; // absolute freeze: nothing moves, nothing decays
    }

    deathT += dtr;
    if (shake > 0) shake = Math.max(0, shake - dtr / SHAKE_TIME);
    if (flash > 0) flash = Math.max(0, flash - dtr / 0.18);
    stepFrags(frags, dtr);
  });

  k.onDraw(() => {
    const shattered = dead && hitStop <= 0;

    // Screen shake by offsetting our own world draws. k.setCamPos/getCamPos and
    // k.shake() all exist in kaplay 3001 (verified in dist/doc.d.ts, and the
    // cam shake decay is visible in the frame loop of dist/kaplay.mjs), but a
    // manual push/pop keeps the HUD rock-steady and draw order under our
    // control, so that is what this uses.
    const amp = shake * shake * SHAKE_MAG;
    k.pushTransform();
    k.pushTranslate(amp === 0 ? 0 : k.rand(-amp, amp), amp === 0 ? 0 : k.rand(-amp, amp));

    drawArenaFrame(k, tickFlash);
    drawGhosts(k, ghosts);
    drawTelegraphs(k, telegraphs);

    const cHaz = col(k, CO.hazard);
    for (const h of hazards) {
      // Trail length is a pure function of timeScale: it stretches when you run
      // and collapses to a dot when you crawl. No extra state, no extra writer.
      const tail = h.o.pos.sub(h.vel.scale(0.07 * timeScale));
      k.drawLine({ p1: tail, p2: h.o.pos, width: HAZARD_R * 1.1, color: cHaz, opacity: 0.28 });
      k.drawCircle({ pos: h.o.pos, radius: HAZARD_R + 4, color: cHaz, opacity: 0.18 });
      k.drawCircle({ pos: h.o.pos, radius: HAZARD_R, color: cHaz });
    }

    if (!shattered) {
      k.drawCircle({
        pos: player.pos, radius: PLAYER_R + 5 + 10 * timeScale,
        color: col(k, CO.trail), opacity: 0.1 + 0.22 * timeScale,
      });
      k.drawCircle({ pos: player.pos, radius: PLAYER_R, color: col(k, CO.player) });
    }

    drawFrags(k, frags);
    k.popTransform();

    if (tickFlash > 0) drawEdgeFlash(k, tickFlash);
    if (flash > 0) {
      k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: col(k, CO.white), opacity: flash * 0.3 });
    }

    // --- HUD, drawn outside the shake on purpose: readouts a tester scripts
    // against should not judder. The literal `SCALE 0.42` form is load-bearing.
    k.drawText({ text: `TIME  ${elapsed.toFixed(1)}`, size: 20, pos: k.vec2(14, 12) });
    k.drawText({ text: `SCALE ${timeScale.toFixed(2)}`, size: 20, pos: k.vec2(14, 36) });
    k.drawRect({ pos: k.vec2(14, 62), width: 168, height: 8, fill: false, outline: { color: col(k, CO.dim), width: 1 }, opacity: 0.7 });
    k.drawRect({
      pos: k.vec2(15, 63), width: 166 * timeScale, height: 6,
      color: k.rgb(mix(110, 255, timeScale), mix(175, 176, timeScale), mix(255, 60, timeScale)),
    });
    k.drawText({ text: `LV ${level}`, size: 18, pos: k.vec2(14, 80), color: col(k, CO.dim) });
    if (best > 0) {
      k.drawText({ text: `BEST ${best.toFixed(1)}`, size: 20, pos: k.vec2(W - 14, 12), anchor: "topright", color: col(k, CO.dim) });
    }
    k.drawText({ text: `M ${muteLabel()}`, size: 16, pos: k.vec2(14, H - 24), color: col(k, CO.dim), opacity: 0.8 });

    // --- DEATH OVERLAY, drawn on top of the frozen arena. The corpse of the
    // run stays visible; we only fade text in over it.
    if (shattered) {
      const o = k.clamp(deathT / 0.3, 0, 1);
      const mid = (y: number) => k.vec2(W / 2, H / 2 + y);
      k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: col(k, CO.shade), opacity: o * 0.55 });
      k.drawText({ text: "DEAD", size: 76, pos: mid(-54), anchor: "center", color: col(k, CO.hazard), opacity: o });
      k.drawText({ text: `SURVIVED ${elapsed.toFixed(1)}s`, size: 30, pos: mid(10), anchor: "center", color: col(k, CO.player), opacity: o });
      k.drawText({
        text: newBest ? "NEW BEST" : `BEST ${best.toFixed(1)}s`, size: 24, pos: mid(52), anchor: "center",
        color: col(k, newBest ? CO.warn : CO.dim),
        opacity: newBest ? o * (0.6 + 0.4 * Math.sin(deathT * 7)) : o,
      });
      k.drawText({ text: "R to restart   -   ESC for title", size: 20, pos: mid(104), anchor: "center", color: col(k, CO.dim), opacity: o });
    }
  });

  k.onKeyPress("m", () => { initAudio(); toggleMute(); });
  k.onKeyPress("r", () => { if (dead) k.go("game"); });
  k.onKeyPress("escape", () => { if (dead) k.go("title"); });
});

k.go("title");
