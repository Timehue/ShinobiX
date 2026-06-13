# Tactical Pet Arena Mode — build plan

A new pet game mode: **Deathmatch + Capture-Objective**, first team to **10 points**,
2v2 or 4v4, built on the existing continuous-duel tech (30 Hz deterministic sim,
walkability mask, diorama stage renderer).

## Layers

1. **`shinobij.client/src/lib/pet-arena-sim.ts`** — the deterministic match sim
   (new, self-contained; reuses the walkmask but not the duel sim, so the duel's
   15 tests stay untouched). Produces a snapshot stream + events for the renderer.
2. **`pet-arena-sim.test.ts`** — determinism, scoring, lives, objective lifecycle,
   role behaviour.
3. **Renderer** — a new `PetArenaMatch` reusing the diorama stage + standees +
   FX, plus arena UI: scoreboard (to 10), the scroll object, team bases, per-pet
   lives + role badge, carrier glow, respawn timers.
4. **Harness** — `?arena=1` (+`?arena4=1` for 4v4) in `petvfx.tsx`.

## Roles (every pet is assigned one)

| Role | Stats | Identity | Objective job |
|---|---|---|---|
| **Defender** | ↑HP ↑DEF ↑CC, ↓DMG ↓mobility | frontline / peel | protect carrier, hold chokes |
| **Tracker** | sustained DMG, chase, ↑objective | pressure / secure | escort + pressure |
| **Assassin** | ↑burst ↑mobility, ↓durability | pick squishies/carrier | intercept + kill carrier |
| **Sage** | heal/buff/utility, ↓DMG ↓durability | support | sustain carrier + team |

Roles drive: stat weighting, ability pool, target priority, positioning, objective behaviour.

## Match rules (from the handoff)

- **Win:** first to 10 points (also: enemy team fully eliminated; else time cap → higher score).
- **Score:** defeat enemy = +1; capture+return scroll = +2.
- **Lives:** 3 per pet. Death → enemy +1, −1 life, respawn at base after 5 s, full HP/energy. 0 lives → eliminated.
- **Scroll:** spawns center (fixed) at 0:45; respawns 60 s after capture/reset; 2 s channel to pick up;
  carry to **own base** to score +2; carrier −15% speed, no dash/mobility; drops on death;
  dropped 10 s then resets to center.

## AI context machine (per pet, each tick)

```
carrier = whoever holds the scroll
if I carry        → carryHome  (move to my base, avoid, attack only if blocked)
elif ally carries → escort     (stay near carrier, fight its attackers; Sage heals it)
elif enemy carries→ intercept  (chase carrier; Assassin flanks; Sage/Defender CC; Ranged pokes)
elif scroll open  → contest    (go for scroll, role-weighted; channel to pick up)
else              → fight      (role positioning + role target priority; don't clump)
```

Movement is on the **walkability mask** (paths only, BFS routing, slide along edges),
so you get the chases / escorts / flanks / interceptions the design wants.

## Determinism

Same invariants as the duel sim: seeded LCG (no Math.random/Date), IEEE-safe math
(sqrt/round only — no sin/cos/pow in state), positions quantized to 1/256/tick.
Preview-only behind a flag; ranked unaffected.

## Status

- [x] Plan
- [x] Sim core + tests (`pet-arena-sim.ts`, 7 tests — determinism, scoring, lives, scroll, roles)
- [x] Renderer + arena UI (`PetArenaMatch` — scoreboard, bases, scroll, role badges, lives, carrier glow)
- [x] Harness (`?arena=1` / `?arena4=1`)
- [ ] AI feel tuning — lane-diverse approaches (teams spread now but still converge to the center band),
      finer role priorities, objective-fight pacing. Iterate from watching matches.
