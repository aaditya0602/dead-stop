# jam-game — three concepts (Vite + TS + KAPLAY, single screen, shapes only)

## 1. BULWARK — *the safest option*
A fixed square mid-screen. A short shield arc orbits it, tracking the mouse. Shapes converge from every edge at mixed speeds. Click on contact to parry: the shape reverses at double speed, killing whatever it hits on the way out. Miss and the shield goes dark for half a second.

- **Core verb:** parry (left click)
- **One screen:** one fixed arena, no camera, no scroll
- **Failure state:** any shape touches the core square — one hit, run over
- **Why it's juicy:** hitstop, shake scaled to incoming speed, shield flash, reflected shapes cutting kill-chains through the crowd
- **Scope risk:** the parry window is pure feel and eats tuning days; chain reflections can cascade into an unreadable screen

## 2. DEAD STOP — *the most distinctive*
A dot in a bare arena. Everything else runs on a global time scale equal to how fast you are moving. Stand still and the world nearly freezes; move and it snaps to full speed. Crossing a bullet wall becomes a sequence of small deliberate steps. The first keypress teaches this.

- **Core verb:** move (WASD / arrows)
- **One screen:** one fixed arena, fully visible
- **Failure state:** a bullet touches you — one hit, run over
- **Why it's juicy:** the gear-change between frozen and full speed; near-misses land in slow motion because you stopped
- **Scope risk:** every entity must respect the multiplier — one hardcoded delta leaks and the illusion dies; difficulty needs a spawn director

## 3. EBB
A circle pinned mid-screen while shapes drift inward. Space fires an expanding shockwave that shatters anything it catches. Every pulse costs radius — you shrink. Smaller means a smaller hitbox but a weaker, shorter blast. Late runs turn you into a near-untouchable speck that can barely clear one lane.

- **Core verb:** pulse (space)
- **One screen:** one fixed arena, player never moves
- **Failure state:** any shape touches your circle — one hit, run over
- **Why it's juicy:** the ring expanding, shapes popping outward in sequence, your own body visibly shrinking on every press
- **Scope risk:** the shrink economy *is* the game and only playtesting finds it; a dominant do-nothing strategy would gut it

## PICK: **DEAD STOP**

(a) Buildable — the twist is one clamped float multiplied into every non-player update; no new systems, no state machine, no AI. (b) One mechanic — moving is the only input, and the time scale is a property of moving, not a second system bolted on. (c) Reads without instructions — the strongest of the three: the hiring manager taps a key, the world lurches, releases, the world stops. Self-teaching in under two seconds, and every dodge afterwards is legible. BULWARK is safer but needs the player to guess that clicking does something; EBB needs a played-out shrink economy before it's fun at all. (d) Circles, rects, one text object.

**Phase-1 walking skeleton (core verb only):**
- One player entity: circle with `pos` + `area`, WASD velocity, clamped to arena bounds. Nothing else moves under its own logic yet.
- Global `timeScale = clamp(playerSpeed / maxSpeed, 0.05, 1)`, recomputed once per frame — single source of truth, one variable, read by everything else.
- One hazard type: circle spawned off-edge on a fixed timer with a constant velocity, advancing by `vel * dt() * timeScale`, destroyed off-screen.
- Collision: player `area` vs hazard `area` → freeze the scene, show "DEAD" + seconds survived, `R` restarts.
- Score = seconds survived, ticking on unscaled time so standing still still costs you. That tension is the whole game and needs no text to explain.
