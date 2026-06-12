# Pet Combat Redesign — make it read as *two elemental creatures actually fighting*

> Status: **PLAN, not started.** Written 2026-06-12. Mandate from the owner:
> *"We can change the current pet battle system — nothing is locked in besides
> the 3D models (like Oni Hound). If we need to change the combat system to make
> the fights more thrilling, let's do it."* So this plan is allowed to **replace
> the combat engine itself**, not just its presentation. It is the companion to
> the renderer plan in `docs/autobattler-visual-plan.md` (the look) and
> `docs/anime-fight-plan.md` (the juice) — this one is the **simulation**.

---

## 0. The two things that are actually locked (and why)

The owner says "nothing is locked but the models." True for the *design*, but two
things are load-bearing for the live game and a rewrite must respect them or it
breaks players. These are not creative constraints — they're correctness ones:

1. **Determinism — because pet battles are RANKED.** Pet battles feed a live
   **ranked Elo ladder**: `api/pvp/pet-ranked-queue.ts` matchmakes, `api/pet/
   ranked-start.ts` mints a single-use token sealing both players' ratings, and
   `api/pet/battle-result.ts` settles the Elo swing server-side from that sealed
   snapshot. The **battle itself is simulated on the client**, and the engine
   header says it outright: *"Determinism is load-bearing for ranked pet PvP —
   both clients run an identical canonical simulation from the same seed."* Any
   new engine MUST be **bit-reproducible from a seed + the two pets**, with no
   `Math.random`, no wall-clock, and no cross-machine float drift — or ranked
   desyncs and the ladder is cheatable/broken. (This also unlocks a *security
   upgrade*: a deterministic engine lets the **server re-run the sim** to validate
   reported outcomes — closing today's client-trust gap. See §6.)

2. **The pet data model — because it lives in player saves.** A Pet
   (`shinobij.client/src/types/pet.ts`) persists `hp, attack, defense, speed,
   element, trait, jutsus[], rarity, level, moveRange, loadout`. Thousands of
   player pets already exist with these stats. The new engine must keep
   **consuming the same fields** (it can *interpret* them differently, but it
   can't require new persisted data) so no save migration and no progression
   reset. Good news: these fields map *naturally* onto a real-time sim (§4) — the
   rewrite is a **resolution change, not a data change.**

Everything else — the round loop, the tile grid, the 6-phase resolver, the AI,
the pacing — is on the table.

> What stays as a safety net during the migration: the **current engine +
> classic DOM renderer remain behind the flag as a kill-switch** until the new
> system is balance-proven on ranked. Retiring them is a later, explicit call.

---

## 1. Why the current model caps the feel (diagnosis)

The engine (`pet-battle-sim.ts`, ~2,780 lines) is a **discrete round resolver**:
each of up to 30 rounds runs six phases (intent → move N tiles via BFS → windup →
impact → reaction → cleanup) for each pet, on a 14×7 tile grid, then emits **one
`PetArenaFrame` per action**. The renderer lerps between those sparse frames.

This is a fine *autobattler resolver*, but it structurally can't feel like a
fight, for three reasons:

1. **It's turn-based underneath.** Pets resolve one-at-a-time in rounds; they
   never act *simultaneously*. Real fighting is two bodies reacting to each other
   continuously — circling, spacing, trading, interrupting. A round resolver can
   only *narrate* that after the fact.
2. **Movement is teleport-then-lerp.** A pet "moves 2 tiles" as a discrete jump
   the renderer smooths. There's no momentum, no chasing, no kiting, no whiff —
   the spacing that *is* fighting.
3. **The frame stream is too coarse to choreograph.** One frame per action means
   the renderer is inventing the motion between hits (which is why we've been
   piling procedural juice on top). The sim isn't *giving* the renderer a fight
   to show — it's giving it a list of outcomes.

We've spent weeks making the *presentation* dramatize a turn-based resolver. The
owner's repeated note ("it slowly heads over and bonks with weak abilities") is
the resolver leaking through the paint. **The fix is to make the simulation
itself be the fight.**

---

## 2. The target: a continuous-feel, lockstep-deterministic elemental duel

The architecture that gives "two elemental pets actually fighting" **and** keeps
ranked-grade determinism is the one RTS netcode has used for decades:

> **A fixed-timestep, quantized, deterministic simulation (~20–30 Hz) that both
> clients (and the server) run identically from a seed — and a renderer that
> *interpolates* between sim ticks for buttery continuous visuals.**

The sim ticks in discrete, reproducible steps with **quantized state** (positions
stored as fixed-point / integers, not raw floats — see §6); the **renderer**
reads tick snapshots and smoothly interpolates position, facing, and pose, so it
*looks* fully continuous and fluid while the authoritative state stays bit-exact
across machines. This is the single key decision that makes everything else
possible: **fluid fights without sacrificing ranked integrity.**

### The new loop (per sim tick, ~33ms of sim-time)

For each pet, in a fixed deterministic order:
1. **Sense** — distance/angle to foe, own/foe HP, cooldowns, stamina, active
   statuses, incoming telegraphs.
2. **Decide** — a continuous behavior policy (state machine / utility AI):
   approach, strafe/kite, dash-in, attack, cast, dodge, block, retreat, recover.
   Driven by the pet's **element + trait + archetype** (§4) so a fire pet plays
   aggressive and a water pet plays evasive.
3. **Act** — apply velocity, start/continue an ability (with cast time), spawn
   projectiles, resolve melee hitboxes, tick DoTs/cooldowns/stamina.
4. **Resolve** — overlapping hitboxes/projectiles deal damage *this tick* with
   element matchup + reactions; knockback, hitstun, interrupts apply.

Output: a **tick stream** = per-tick snapshots (each pet's quantized pos, facing,
pose-state, hp, stamina, status set) + a typed **event list** (cast-started,
projectile-spawned, hit-landed{dmg,element,crit}, dodged, blocked, interrupted,
status-applied, KO, ultimate). The renderer consumes this directly.

### Keeping the renderer contract

The coliseum renderer already wants exactly this (positions + events). We add a
new continuous **battle-replay** format and:
- **Coliseum** consumes it natively (smooth interpolation → the fights we want).
- A thin **adapter** down-samples it to legacy `PetArenaFrame[]` so the classic
  DOM renderer + any frame consumers keep working through the migration.

---

## 3. What makes it *thrilling* — the combat design

The simulation in §2 is the skeleton; this is the part that makes it read as a
*fight* and specifically a **two-elemental-creatures** fight. Each element gets a
distinct fighting STYLE, and the moment-to-moment has real back-and-forth.

### 3.1 Spacing & movement is the core verb
- Continuous positions, momentum, facing. Pets **approach, circle, strafe, dash,
  whiff, and recover.** Melee pets close the gap; ranged/caster pets kite to hold
  it. The neutral game — managing distance — is what "fighting" *is*.
- **Dash / lunge** as an explosive committed move (the anime-speed we already
  prototyped, now sim-driven), gated by **stamina** (below) so it's a decision.

### 3.2 A stamina/energy rhythm
- A small **stamina** bar regenerates over time and gates dashes, dodges, and
  heavy abilities. This creates the engage → spend → recover → re-engage **rhythm**
  that makes fights breathe instead of mash. (Derived from `speed`; not persisted
  → no save change.)

### 3.3 Telegraphed abilities → reactions
- Abilities have a **wind-up / cast time** with a readable telegraph (charge
  glow, element tell). The opponent can **dodge, block/guard, interrupt, or eat
  it.** Anticipation → payoff is the heartbeat of a watchable fight.
- **Interrupts**: hitting a pet mid-cast staggers it and cancels the ability →
  momentum swings.

### 3.4 Elements that actually matter and *read*
This is the soul of "two **elemental** pets fighting." Use the existing type
chart (Fire▸Wind▸Lightning▸Earth▸Water▸Fire) for matchup damage, **plus reactions**:
- **Fire** — aggressive pressure; applies **burn** DoT; close-range bias.
- **Water** — flowing evasion + **douses burn**, heals/sustains, zoning.
- **Lightning** — fast burst, **chains/arcs**, brief stuns, high tempo.
- **Earth** — tanky; **shields/guard**, ground-slam knockback, slow but heavy.
- **Wind** — mobile; **knockback/push-pull**, slashing pokes, repositioning.
- **Reactions** (drama + strategy, all from existing `kind` tags): water-on-burn
  douses, lightning-on-wet chains harder, earth shield vs ranged, wind blows away
  projectiles, etc. Elements create *visible* rock-paper-scissors mid-fight.

### 3.5 Status & momentum (already in the data model)
The Pet jutsu `kind` taxonomy already includes burn/freeze/confuse/stun/wound/
mark/slow/haste/taunt/push/pull/shield/heal/lifesteal/barrier/absorb. In a
real-time sim these become **live CC and DoTs with visible auras** — freeze locks
a pet, stun opens a punish window, shields pop, slow changes spacing. Momentum
(stagger, combos, knockback-into-wall) makes leads feel earned.

### 3.6 Ultimates / signature moves
- The existing `signature` jutsu flag becomes a **telegraphed ultimate**: a big
  wind-up, a brief cinematic (cut-in from the pet's portrait art, slow-mo, screen
  wash), a high-impact payoff. Rationed → it stays special. The fight's peaks.

### 3.7 Reads as a fight, not a board
Net effect: a watcher sees two elemental creatures **close distance, trade,
dodge, get interrupted, swing momentum, and finish with an ultimate** — in
continuous motion, with each element fighting in its own style. That's the
"thrilling" the owner is asking for.

---

## 4. Mapping the existing pet data onto the new sim (saves stay intact)

No persisted field changes; we *reinterpret* them for real-time:

| Persisted field | New-sim role |
|---|---|
| `hp` | health pool (unchanged) |
| `attack` | base damage scalar |
| `defense` | damage mitigation + stagger resistance |
| `speed` | move speed, attack speed, stamina regen, dodge frequency |
| `element` | matchup multipliers + reaction triggers + fighting style + VFX identity |
| `trait` (Aggressive/Guardian/Swift/Lucky/Battleborn) | AI personality weights + small modifiers (as today) |
| `jutsus[]` (name/power/cooldown/**kind**/rounds/**signature**/aoe) | the pet's **ability kit**: each becomes a real-time ability — `kind`→effect, `power`→magnitude, `cooldown`→sim-tick CD, `signature`→ultimate, `aoe`→radius |
| `rarity`, `level`, `xp` | stat scaling (already baked into stats) |
| `moveRange` | attack/engage range band |
| `loadout` (collar/gear/consumable) | passive gear bonuses + real-time consumable procs (dodge/mitigate/endure/thorns/lifeline/cleanse already exist) |

Because the kit and stats already exist, **the rewrite consumes the same pets** —
a level-20 Water pet with its jutsus just *fights* instead of *resolving rounds*.

---

## 5. Migration plan — phased, flagged, reversible, balance-gated

The hard part isn't the engine; it's shipping a new ranked-and-saves-coupled
combat model without breaking the live game. So: build in parallel, prove on PvE,
balance-test exhaustively, then flip ranked atomically with a kill-switch.

**Phase A — Deterministic continuous core (PvE-only, new flag).**
New `pet-duel-sim.ts` beside the old engine. Fixed-timestep quantized sim, seeded
LCG (reuse the existing RNG), no wall-clock/transcendental hazards (§6), two pets
in → tick stream out. Behavior AI: approach/strafe/dash/attack/dodge. Just melee
+ movement + stamina first. New flag `petDuel.v1` (default OFF). The old engine
stays default. *Determinism test from day one.*

**Phase B — Abilities, elements, statuses.**
Port the jutsu kit → real-time abilities (cast times, cooldowns, projectiles),
the element matchup + reactions, the status/CC system, signatures→ultimates,
loadout/gear/consumables. Now it's a full fight.

**Phase C — Coliseum renderer consumes the tick stream.**
Wire `PetColiseum` to the new battle-replay format (smooth interpolation), layer
on the visual plan (`autobattler-visual-plan.md`: bloom, lighting, element VFX,
status auras, ultimate cut-ins). Adapter emits legacy frames for the DOM
fallback. **First real look** — iterate on feel with the owner.

**Phase D — Balance (the gating risk).**
Build a **pet Monte-Carlo balance harness** in `scripts/` (the project already
has `scripts/pvp-formula-sim.ts` as a template): run thousands of seeded duels
across the real roster + level bands, report win-rates, match length, element
balance, ability usage, dominant/dead strategies. **Tune the sim's interpretation
of the existing stats** until outcomes are sane and no pet/element is broken.
This is where the rewrite earns the right to touch ranked. Add regression
fixtures.

**Phase E — Server-side validation (security upgrade).**
Run the same deterministic sim **server-side** in `api/pet/battle-result.ts`
(and/or `ranked-start`) to **validate the reported outcome** from seed + both
pets, instead of trusting the client's win/loss. This is strictly better than
today's bounded-trust model and is *only possible because the engine is
deterministic*. Keep the rate-limit/cap bounds as defense-in-depth.

**Phase F — Flip ranked, atomically, with a kill-switch.**
Once balance + server-validation are proven: switch ranked matchmaking to seed +
resolve with the new engine on **both clients and the server**. Deploy atomically
(client dist + server together — both clients must run the same engine version;
mismatched versions = desync). Keep the old engine behind a server kill-switch
flag for instant rollback. Watch ladder health + complaints. *Pause-on-incident
discipline applies.*

**Phase G — Retire the old path (optional, later).**
After the new system is stable on ranked, decide with the owner whether to remove
the old engine + DOM renderer or keep them as a permanent low-end fallback.

---

## 6. The #1 technical risk: cross-machine determinism

A continuous physics-y sim is harder to keep bit-identical than a round resolver.
Two clients (and the server) must compute the exact same result, or ranked
desyncs. Specific hazards + mitigations:

- **Floating-point drift.** Raw `float` accumulation can diverge across JS
  engines/CPUs in the last ULP. **Mitigation:** store authoritative sim state
  (positions, velocities, hp) as **fixed-point integers** (e.g. units × 1024), do
  integer math in the core, and only convert to float in the *renderer* (which
  needn't be deterministic). The current engine gets away with float because it's
  coarse; a fine-grained sim should go fixed-point.
- **Transcendentals** (`Math.sin/cos/sqrt/atan2`) are not guaranteed identical
  across engines. **Mitigation:** avoid them in the authoritative core — use
  integer/lookup-table trig, squared-distance comparisons (no `sqrt`), and
  precomputed angle tables; keep transcendentals to the renderer only.
- **Iteration order** must be fixed and explicit (no `Object.keys`/`Set` order
  reliance, no `Date.now()` seeding inside the sim — seed comes from the match).
- **Tick rate is part of the protocol** — both sides run the same Hz and same
  step count; the result is a function of (seed, pets, engine version).
- **Guardrails:** a determinism test that runs N seeds twice and asserts
  byte-identical tick streams (mirror the existing `pet-battle-sim.test.ts`
  fixture lock), plus a same-input/different-order fuzz test.

This is well-trodden (lockstep RTS, rollback fighters) — the discipline is known,
but it must be designed in from Phase A, not retrofitted.

---

## 7. Presentation: this redesign *feeds* the visual plan

The combat redesign and the visual overhaul are complementary, not competing:
- The new sim **gives the renderer a real fight** (continuous positions, casts,
  dodges, interrupts, KOs) instead of outcomes to dramatize — so the juice in
  `anime-fight-plan.md` and the stage in `autobattler-visual-plan.md` finally
  have real motion to attach to.
- Element styles + status + ultimates map 1:1 onto the element VFX, status auras,
  bloom, and cut-ins from the visual plan.
- Recommended order once the core works: **sim feel first** (does it read as
  fighting?), **then** the glow-up (does it look gorgeous?). They interleave by
  Phase C.

---

## 8. Risks, costs, and honest tradeoffs

- **Biggest risk: balance.** Changing the resolution changes every win-rate and
  match length on a *live ranked ladder*. Phase D (the Monte-Carlo harness) is
  non-negotiable and is the long pole. Plan for real tuning iteration.
- **Determinism is exacting** (§6) — fixed-point + no transcendentals in the core
  is real engineering rigor, designed in from the start.
- **Scope is large** — this is a multi-week build (a new ~engine + AI + balance +
  server validation + renderer wiring), not a weekend. It should be staged so
  every phase is shippable/visible and the old system is always the fallback.
- **Atomic ranked deploy** — client+server must run the same engine version; a
  staged flag + kill-switch is mandatory.
- **No save risk** if §4 holds (consume existing fields only). **No reward/anti-
  cheat rework** — that layer is already server-bounded and we only *add*
  server-side validation.

**Lighter alternative (if the scope feels too big):** keep the round engine and
do only `autobattler-visual-plan.md` + `anime-fight-plan.md`. It will look much
better but will still, underneath, be a turn resolver — which is the thing the
owner has twice said isn't landing. My recommendation is the redesign, staged.

---

## 9. Sequencing at a glance

| Phase | Deliverable | Risk | Gate to next |
|---|---|---|---|
| **A** | Deterministic continuous core (PvE, melee+move+stamina), `petDuel.v1` flag OFF | med | determinism test green |
| **B** | Abilities + elements + statuses + ultimates | med | full fight playable in PvE |
| **C** | Coliseum consumes tick stream + visual layer; DOM adapter | low | **owner look** — feel approved |
| **D** | Pet Monte-Carlo balance harness + tuning + regression fixtures | **high** | win-rates/lengths sane, no broken element |
| **E** | Server-side sim validation of outcomes | med | server/client agree on N seeds |
| **F** | Flip ranked atomically + kill-switch | **high** | ladder healthy, no desync |
| **G** | (optional) retire old engine/DOM renderer | low | owner decision |

## 10. Open decisions for the owner

1. **Green-light the full redesign**, or do the lighter presentation-only path
   first and revisit?
2. **Determinism approach:** fixed-point integer core (recommended, robust) vs.
   disciplined-float (simpler, riskier for ranked)?
3. **Tick rate:** 20 Hz (cheaper, snappier) vs. 30 Hz (smoother sim) — renderer
   interpolates either way.
4. **Ranked during migration:** keep ranked on the *old* engine until Phase F
   (recommended), or pause ranked pet battles while we build?
5. **Old engine/DOM renderer:** permanent fallback, or retire after Phase F?

## Sources & companions

Combat-feel + autobattler craft and the HD-2D/juice references are catalogued in
`docs/autobattler-visual-plan.md` and `docs/anime-fight-plan.md`. Determinism
model + integration facts: this plan's §0–§1 are grounded in
`shinobij.client/src/lib/pet-battle-sim.ts`, `shinobij.client/src/types/pet.ts`,
`api/pet/ranked-start.ts`, and `api/pet/battle-result.ts`.
