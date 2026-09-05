import kaplay from "kaplay";

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

const W = 960;
const H = 540;
const PLAYER_R = 12;
const MAX_SPEED = 260;
const MIN_TIME_SCALE = 0.05;
const HAZARD_R = 10;
const HAZARD_SPEED = 220;
const SPAWN_EVERY = 0.45;

k.scene("game", () => {
  // SINGLE SOURCE OF TRUTH.
  // Written exactly once per frame, in the player update below. Read by every
  // non-player update. Nothing else in this file may assign to it. Any entity
  // that advances on raw dt() instead of dt() * timeScale breaks the game.
  let timeScale = MIN_TIME_SCALE;
  let elapsed = 0;
  let dead = false;

  const player = k.add([
    k.pos(W / 2, H / 2),
    k.circle(PLAYER_R),
    k.color(230, 230, 240),
    k.area(),
    k.anchor("center"),
    "player",
  ]);

  function spawnHazard() {
    const edge = k.randi(0, 4);
    const m = HAZARD_R * 3;
    let spawnPos = k.vec2(0, 0);
    if (edge === 0) spawnPos = k.vec2(k.rand(0, W), -m);
    else if (edge === 1) spawnPos = k.vec2(k.rand(0, W), H + m);
    else if (edge === 2) spawnPos = k.vec2(-m, k.rand(0, H));
    else spawnPos = k.vec2(W + m, k.rand(0, H));

    const target = k.vec2(k.rand(W * 0.25, W * 0.75), k.rand(H * 0.25, H * 0.75));
    const vel = target.sub(spawnPos).unit().scale(HAZARD_SPEED);

    k.add([
      k.pos(spawnPos),
      k.circle(HAZARD_R),
      k.color(230, 90, 40),
      k.area(),
      k.anchor("center"),
      "hazard",
      { vel },
    ]);
  }

  // Registered first, so timeScale is fresh before anything reads it.
  k.onUpdate(() => {
    if (dead) return;

    let dir = k.vec2(0, 0);
    if (k.isKeyDown("left") || k.isKeyDown("a")) dir.x -= 1;
    if (k.isKeyDown("right") || k.isKeyDown("d")) dir.x += 1;
    if (k.isKeyDown("up") || k.isKeyDown("w")) dir.y -= 1;
    if (k.isKeyDown("down") || k.isKeyDown("s")) dir.y += 1;
    if (dir.len() > 0) dir = dir.unit(); // no free speed on diagonals

    const vel = dir.scale(MAX_SPEED);
    const playerSpeed = vel.len();
    timeScale = k.clamp(playerSpeed / MAX_SPEED, MIN_TIME_SCALE, 1);

    // The player is the one thing timeScale never touches.
    player.pos = player.pos.add(vel.scale(k.dt()));
    player.pos.x = k.clamp(player.pos.x, PLAYER_R, W - PLAYER_R);
    player.pos.y = k.clamp(player.pos.y, PLAYER_R, H - PLAYER_R);

    elapsed += k.dt(); // unscaled: standing still still costs you
  });

  // Spawning runs on UNSCALED time, deliberately. If spawning were scaled,
  // standing still would freeze the world AND stop the threat, making camping
  // strictly dominant. Unscaled spawning means hazards keep arriving and pile
  // up while you are frozen, so eventually you MUST move - and the instant you
  // do, the whole accumulated wall snaps to full speed. That is the game.
  k.loop(SPAWN_EVERY, () => {
    if (dead) return;
    spawnHazard();
  });

  k.onUpdate("hazard", (h) => {
    if (dead) return;
    h.pos = h.pos.add(h.vel.scale(k.dt() * timeScale));
    const m = HAZARD_R * 4;
    if (h.pos.x < -m || h.pos.x > W + m || h.pos.y < -m || h.pos.y > H + m) {
      k.destroy(h);
    }
  });

  player.onCollide("hazard", () => {
    dead = true; // freezes the scene: every update above returns early on this
  });

  k.onDraw(() => {
    k.drawRect({
      pos: k.vec2(0, 0),
      width: W,
      height: H,
      fill: false,
      outline: { color: k.rgb(40, 40, 55), width: 2 },
    });
    k.drawText({ text: `TIME  ${elapsed.toFixed(1)}`, size: 20, pos: k.vec2(14, 12) });
    k.drawText({ text: `SCALE ${timeScale.toFixed(2)}`, size: 20, pos: k.vec2(14, 36) });
    if (dead) {
      k.drawText({
        text: "DEAD",
        size: 64,
        pos: k.vec2(W / 2, H / 2 - 24),
        anchor: "center",
      });
      k.drawText({
        text: `SURVIVED ${elapsed.toFixed(1)}s  —  PRESS R`,
        size: 24,
        pos: k.vec2(W / 2, H / 2 + 36),
        anchor: "center",
      });
    }
  });

  k.onKeyPress("r", () => k.go("game"));
});

k.go("game");
