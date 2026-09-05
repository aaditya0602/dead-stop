# DEAD STOP

A dot in a bare arena where the whole world runs at the speed you are moving — stand still and it nearly freezes, move and it snaps to full speed. The score clock never slows down.

## Run

```
npm install
npm run dev      # dev server on http://localhost:5173
npm run build    # typecheck + static build into dist/
npm run preview  # serve the built dist/
```

The build is fully static and `vite.config.ts` sets `base: "./"`, so `dist/` can be zipped straight to itch.io or dropped on Netlify.

## Controls

- **WASD / arrow keys** — move
- **R** — restart

## How it works

`timeScale = clamp(playerSpeed / MAX_SPEED, 0.05, 1)` is computed exactly once per frame in the player update, and every non-player entity advances by `dt() * timeScale`. The player itself is the one thing that moves on unscaled time — that asymmetry is the entire mechanic. The score also ticks on unscaled time, so standing still is safe but never free.

Hazards spawn on unscaled time too, deliberately: if spawning were scaled, standing still would freeze the world *and* stop the threat, making camping strictly dominant. Instead hazards keep arriving and pile up at the edges while you are frozen, so eventually you have to move — and the instant you do, the whole accumulated wall snaps to full speed.

## Current state

Phase 1 walking skeleton. Placeholder circles only: one player, one hazard type, `area()`-based collision, a two-line HUD, and a death state. No audio, no menus, no particles, no levels, no difficulty curve.

## Phase 2 adds

- Spawn director and a real difficulty curve
- More hazard types and telegraphed patterns
- Player acceleration/damping, so `playerSpeed` becomes continuous and `timeScale` ramps smoothly instead of snapping between 0.05 and 1
- Juice: hitstop, screen shake, trails, particles
- Audio, pitched to the time scale
- Title and game-over screens, best-score persistence
- itch.io / Netlify deploy
