# DEAD STOP

**[Play it here](https://aaditya0602.github.io/dead-stop/)** · **[itch.io page](https://aaditya0602.itch.io/dead-stop)**

> The world moves only as fast as you do.

An arcade survival game about the cost of standing still. You are a dot in a bare arena. Hazards converge on you from every edge. The entire world — every hazard, every particle, your own afterimage — advances at the speed *you* are moving. Stop, and it very nearly freezes. Run, and it snaps to full speed.

The catch: the clock never stops. Standing still is safe, but it is never free.

## Controls

Keyboard only. **No touch or mobile support.**

| Key | Action |
| --- | --- |
| **WASD** / **arrow keys** | Move |
| **M** | Mute / unmute (persists) |
| **R** | Restart, from the death screen |
| **ESC** | Back to title, from the death screen |

## The mechanic

```ts
timeScale = clamp(playerSpeed / MAX_SPEED, 0.05, 1)
```

That value is computed **exactly once per frame**, in the player update, and it has exactly one writer. Every non-player entity advances on `dt() * timeScale`. The player alone moves on unscaled `dt()`. That asymmetry is the whole game.

Three things deliberately ignore `timeScale`, and each is commented in the source:

- **The score clock**, so camping costs you.
- **Hazard spawning and the telegraph countdown.** If spawning were scaled, standing still would freeze the world *and* the threat, making camping strictly dominant. Instead hazards keep arriving and pile up at the edges while you are frozen — so eventually you *must* move, and the instant you do the whole accumulated wall snaps to full speed. That is the game. The telegraph lead is real-time for the same reason: at `timeScale` 0.05 a scaled 0.5s warning would take 10 wall-clock seconds to resolve, and a warning you cannot read is not a warning.
- **The death sequence.** You are dead; the world no longer takes its clock from you.

## Difficulty curve

```
level         = floor(elapsed / 10)                  // steps every 10s, unscaled
spawnInterval = max(0.14, 0.60 * 0.86^level)
hazardSpeed   = min(300, 200 + 8 * level)
```

| t | 0s | 20s | 40s | 60s | 90s | 100s+ |
| --- | --- | --- | --- | --- | --- | --- |
| spawn interval | 0.60s | 0.44s | 0.38s | 0.24s | 0.15s | 0.14s (floor) |

The prototype used a flat 0.45s from second zero, which was punishing before a first-timer had learned anything. Starting at 0.60s buys about ten seconds of legible play; the geometric step reaches the old 0.45s at ~20s and 0.24s by 60s; the 0.14s floor guarantees runs end rather than dragging. A first-timer still dies at 10-20s, because panic-moving runs the world at full speed and the ramp does not care how scared you are.

## Juice

Screen shake and a white flash on death, wrapped around the world draws only so the HUD never judders. A ~0.1s hit-stop before the shatter, so the hit lands. The player breaks into 14-20 drag-and-fade fragments. Hazards get a speed-proportional trail, plus a darker core and a rotating rim highlight so a flat orange dot reads as a small solid object rather than a sticker. A pulsing chevron telegraphs every spawn ~0.5s before it arrives, pointing along the vector the hazard will actually travel — the marker never lies. An edge flash and a tick on each difficulty step.

The player's afterimage trail is the visual channel for the core mechanic, and it self-regulates: ghosts are both emitted *and* faded on the scaled clock, so crawling drops one nearly-invisible ghost every twenty frames while full tilt drops one per frame at full alpha. Stop moving and your own wake hangs frozen in the air — your trail obeys the same clock the world does.

**Near misses** get their own feedback, because a graze and nothing happening used to look identical. Any hazard whose center passes within ~1.8x the player's radius without touching it counts as a graze: a bright ring flashes on the player, a high blip plays, and a `GRAZE` counter appears in the HUD (and again on the death screen). Each hazard can trigger this at most once, so a slow-moving hazard lingering nearby doesn't spam the effect.

## Audio

Every sound is synthesized at runtime with the WebAudio API. **There are zero binary assets in this repository.** A movement whoosh whose pitch and filter cutoff track `timeScale`, a filtered-noise-plus-square death crunch, a tick on each difficulty step, a bright blip on a near miss, and a two-note start confirm. Mute persists to `localStorage`, as does your best time.

## Build

```
npm install
npm run dev      # dev server on http://localhost:5173
npm run build    # typecheck + static build into dist/
npm run preview  # serve the built dist/
```

`vite.config.ts` sets `base: "./"`, so `dist/` works both on GitHub Pages and zipped straight to itch.io.

## Source layout

Three files, no engine abstractions, no ECS, no state-machine library.

- `src/main.ts` — the two scenes, all game state, all three update passes.
- `src/fx.ts` — palette, arena chrome, and the three effect types with their step/draw functions.
- `src/audio.ts` — the WebAudio synthesis.

Built with [KAPLAY](https://kaplayjs.com/), Vite, and TypeScript.
