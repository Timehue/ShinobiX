# Pet Showdown — the flagship pet battle mode

*Shipped 2026-08. Replaces the continuous-sim Pet Coliseum as the player-facing
flagship; the legacy engines remain live only for their cross-system consumers
(Hollow Gate seals, clan war, sector war, pet ladder, gauntlet) pending a
separate migration/retirement pass.*

## Why the old modes failed

Two prior architectures (a 30 Hz auto-sim with player "nudges", and a tactical
grid arena) both fought the same losing battle: **continuous-time simulation
destroys readability and agency at once.** The engines' own comments document
stall-breakers, forced-engage timers, and "both pets standing there staring"
freezes. With a handful of animation clips per GLB, real-time creature motion
reads as mush; with outcomes smeared across 30 ticks/second, the player can
never attribute a result to a decision.

## The design

A **turn-based command battle** with **Pokémon-Stadium-style presentation**:
one action at a time, each sold by a camera cut, a windup→strike→recover clip,
projectile/impact VFX, a damage number, and an effectiveness banner. Formats
1v1 / 2v2 (flagship) / 3v3 — same engine, different slot counts, all pets
active (no bench in v1).

Core mechanics:

- **Four-move kits from real pet data.** A pet's existing `jutsus` (23 kinds:
  burn/stun/taunt/mark/…) become its moves, plus a universal cheap
  `Swift Strike`. The kit's `signature` jutsu is reserved as the super.
- **Per-pet stamina (Temtem-style push-your-luck).** Moves cost 30/45/60 by
  power band; +25 regen per round; `Rest` (+45, small heal) and `Guard` (halve
  damage, +meter) are always-legal actions. **Overexertion is allowed**: cast
  without the stamina and the move still fires, but the pet is *winded* and
  skips its next action.
- **Super meter.** Fills from dealing (+10), taking (+18) and guarding (+14)
  hits — the losing side charges faster, which is the comeback valve. At 100 it
  unlocks the signature move at ×1.6 power with a cinematic camera takeover.
- **Element wheel** (existing chart: Fire>Wind>Lightning>Earth>Water>Fire) at
  ×1.3 / ×0.8, always announced ("Super effective!").
- **Timing needle.** Choosing an offensive move runs a ~1.1 s sweep; tapping in
  the center grades Perfect/Good (×1.22/×1.1, server-clamped). Expression, not
  requirement — and the cap bounds what a dishonest client could gain.
- **No draws.** 14-round cap, then a judge decision on remaining HP%; exact
  ties go against the player so stalling is never free.
- **Statuses** map all 23 jutsu kinds onto turn-based effects (stun/freeze skip
  turns, taunt redirects in 2v2+, mark amplifies the next hit, shields soak,
  burn/wound tick at round end, etc.).

Opponents (v1) are AI teams sampled from the live `PET_CATALOG` in three tiers
— Scrapper / Warrior / Champion — scaled to the challenger's own pet levels,
with tier-graded AI (focus fire, element targeting, super discipline, deliberate
overexertion to close kills at Champion).

## Architecture — server-only engine

```
client                              server
  start(format, tier, petIds) ───▶  seal pets from save (+ceilings), build AI
                                    team, mint KV session (45 min TTL)
  ◀─ public state view
  turn(commands[]) ─────────────▶   sanitize commands, pick AI commands,
                                    resolveShowdownRound() → events
  ◀─ turn script (events) + state   client plays the script cinematically
  … final turn ────────────────▶    settle win under save lock (receipt),
  ◀─ events + reward + character    delete session
```

- **The engine exists only in `api/_pet-showdown/engine.ts`.** No client
  mirror, no parity generator, no lockstep, no input-log replay. The client
  (`components/PetShowdownBattle.tsx`) is pure presentation and renders event
  numbers verbatim.
- Deterministic: integer mulberry32 rng carried in the session; no
  `Math.random`/`Date` in combat.
- **Reward integrity** follows the house pattern: magnitude sealed at start
  (`sealedOpponentLevel` from the generated AI team), outcome server-computed,
  payout idempotent via a `sd:<sessionId>` receipt in
  `redeemedPetBattleTokens`, same ryo formula (`max(20, level*2)`) and the same
  shared 100/day `dailyPetWins` cap as the legacy coliseum — an economy-neutral
  swap of faucets. Ryo is client-owned: the client adopts the returned
  character snapshot.
- Kill switch: `DISABLE_PET_SHOWDOWN=1` (ships ON). Client headline flag:
  `petShowdown.v1` (default ON; `"0"` restores the legacy Coliseum as lead).

## Client presentation

- Reuses the proven 3D layer untouched: `PetModel3D` (8-clip authored rigs —
  windup/strike/recover map onto the single `attack` clip's three windows),
  `PetModelBoundary` per fighter, `petCombatModel` gate with a full-body card-
  art billboard fallback, `projectileVisual` spec, coliseum floor/backdrop.
- `PetShowdownBattle` plays the turn script beat-by-beat: camera director
  (wide → duel-axis framing → super swoop), melee lunges, ranged projectiles,
  hit flash + stagger, screen shake, damage popups, banners, KO slow-fade,
  victory pose.
- Fullscreen overlay follows the house contract: portal to `document.body`,
  `.pet-combat-takeover`, `.pet-combat-active` scroll lock, and the two
  SEPARATE lifted signals (fullscreen vs unresolved-battle) via the same
  `setPetBattleActive` / `setPetFullscreenActive` App state as PetArena.
- Entry: `petShowdown` screen (App.tsx lazy import + render branch), headline
  CTA on PetArena's Coliseum tab.

## Files

Server: `api/_pet-showdown/engine.ts`, `api/_pet-showdown/ai.ts`,
`api/pet/showdown.ts` (+ `server.ts` route), tests in
`api/_pet-showdown/engine.test.ts`. Shared contract:
`shared/pet-showdown-contract.ts`. Client:
`shinobij.client/src/screens/PetShowdown.tsx` (+ `.css`),
`components/PetShowdownBattle.tsx`, `lib/pet-showdown-api.ts`, flag in
`lib/pet-coliseum-flag.ts`; guards in `lib/screen-guards.ts` +
`lib/notifications-core.ts`.

## Balance model (tuned 2026-08-07)

`scripts/showdown-balance.mjs` pits every wild-spawnable catalog species against
every same-rarity species through the real engine (both sides AI-driven,
seeded, deterministic). The raw catalog produced a broken meta — trackers 72%,
Fire 23%, 12-round judge-heavy attrition — because the catalog statlines were
priced for the continuous sims' behavior levers (kiting ranges, positioning)
that turn-based play removes. Four engine-side mechanisms fix it without
touching the shared pet data:

1. `DAMAGE_SCALE = 2.35` — KO pace lands at ~8.5 rounds, judge ~14%.
2. **Species budget normalization** — each pet's combat stats scale by
   `(rarityMedianBudget / speciesTemplateBudget)^0.6`, computed from the
   CATALOG TEMPLATE so player training gains keep full value. Compresses the
   ~65% same-rarity budget spread while preserving fast/tanky personality.
3. **Role identity pricing** (`ROLE_DAMAGE_MULT` + assassin execute below 40%
   hp + sage heal bonus) — restores the price the old sims charged for the
   tracker statline and the burst assassins lost.
4. **Element identity pricing** (`ELEMENT_DAMAGE_MULT`/`ELEMENT_TAKEN_MULT`,
   wheel softened to 1.16/0.9) — normalizes the Earth/Lightning statline edge;
   the wheel decides ~73% of advantaged matchups (an edge, not a hard counter).

Result: every role and element inside 40–60% overall; `scripts/
showdown-balance.test.ts` ratchets the standard+rare slice in CI (35–65 bands,
pace 5.5–11.5, judge <30%). ~25 of 140 species remain outside 25–75% from kit
composition differences — kit-level (kind-value) tuning is the remaining lever.

## Round 3 — Temtem depth + painted VFX (2026-08-07)

System: signatures now SPLASH every other living foe at 0.72x in team formats;
**ally element synergy** (+10% with a "Synergy!" callout when a living
teammate's element beats the target — team-building matters); a projected
**turn-order strip** (`nextOrder` in the state view, haste/slow applied, rng
tiebreaks excluded); ▲/▼ **matchup hints** on targeting cards.

VFX (`components/PetShowdownVfx.tsx`): the bundled hand-painted FX flipbooks
(`assets/fx/<key>/NNN.png` via lib/jutsu-fx-assets — the same CC0 sets the DOM
renderer used) now play as additive billboards in the 3D scene — per-element
impact detonations, heal/buff/shield bursts, cast-charge gathers; painted
projectile heads (`assets/fx/projectiles/*.webp`) with spin/wobble/flicker from
the projectileVisual spec plus a fading trail; melee afterimage streaks;
signature light pillar + ground shockwave + full-screen flash; and looping
**status auras** (burning pets visibly burn, frozen pets frost, buffed pets
glow). All presentation-only; every number still arrives in a server event.

## Round 4 — the bench, the switch, and the AAA shell (2026-08-07)

**Bench + switching** (the prediction layer that replaces board movement —
grounded in a competitive-design research pass over Pokémon/Smogon/Temtem):
every format now picks up to 3 pets (field size 1/2/3 + reserves). `switch` is
a command that resolves BEFORE all attacks (Pokémon priority) — the incoming
pet eats anything aimed at the slot, and both pets forfeit the action (the
minimum friction floor so switch-spam isn't free). Benched pets regen stamina
and tick cooldowns but their statuses are FROZEN (you can't wait out a burn) —
the Temtem "switching as stamina rotation" identity. KO'd field pets are
auto-replaced from the bench at round end (reinforcements); a side loses only
when the whole TEAM falls; the judge scores team-wide HP%. Warrior/champion AI
makes matchup-driven switches. On screen, pets physically gallop between the
bench row and the front line (lineup state + a live position map; fighters walk
to their assigned slot, the fallen stay where they dropped).

**Research-driven tuning**: damage roll widened to the genre-proven ±8% in 16
discrete steps; species-budget weights corrected for the formula's true
marginal values (atk ≈ 3x def under atk²/(atk+def) — glass cannons no longer
get a normalization subsidy); damage-scaled **hit-stop** (110ms + 0.45ms/dmg,
cap 330ms, ×1.4 for Lightning) freezes skeletal animation at contact via the
PetModelFrame timeline clock. Bands re-verified: roles 43-57%, elements 40-60%,
pace 8.6 rounds, judge ~15%.

**AAA shell**: five painted arenas (coliseum/grove/frost/storm/volcano) picked
per session with stage-tinted lighting + drifting motes; Bloom post-processing
(petBloom flag); VS intro card; portraits on every HUD card; bench cards with
BENCH badges; the Switch action with a bench-pick flow.

## Round 5 — the wheel sharpened, per-element move identity, seen-and-fixed UI (2026-08-08)

**Element wheel 1.16/0.9 → 1.5/0.75** (swing 2.0), grounded in a dedicated
research pass (WoW pet battles' proven 1.5/0.66 flat chart in a switch-centric
format; the fan-Naruto ±25% standard; licensed Naruto games either skip the
wheel or use ~±25%; Pokémon/Temtem's 2x/0.5x only works with dual-type
ambiguity/doubles damping). The switch-economics math: at 1.5/0.75 a
half-flip switch pays back in ~2.7 rounds, a full flip in ~1.3 — switching is
now the central decision the bench was built for. Cycle symmetry keeps
aggregates intact: post-change sim bands are the TIGHTEST yet (roles 45-55%,
elements 43.5-55.1%, pace 8.2 rounds, judge 11%). The 93% advantaged-matchup
rate in the benchless 1v1 sim is intended — live play answers it by switching.
Canon note: the friendlier 0.75 floor (not WoW's 0.66) reflects Naruto's
"power can overcome nature" rule. Reserve option if telemetry shows switching
underused: 1.5/0.66. Wu-Xing "generating cycle" ally-synergy noted as a
future team-mode layer.

**Per-element move identity** (`ELEMENT_TRAVEL` in PetShowdownVfx): Fire = a
straight searing fastball; Water = a low skimming wave; Wind = a FAN of three
crescents that opens mid-flight and converges on the target; Earth = a high
lobbed tumbling boulder; Lightning = NO travel — a tall bolt strikes from the
sky at the impact moment. Signatures additionally detonate their element's
painted flipbook large over the kaboom.

**Seen-and-fixed UI** (first real screenshots via headless Playwright): bench
row moved from the camera foreground to side WINGS (player left, enemy right);
pet cards widened to full names with a two-row layout and a proper BENCH pill;
turn-order chips now show portraits; move buttons carry the commander's
element as a colored edge.

## Round 6 — support VFX complete, kit-power normalization, kind-value tuning (2026-08-08)

**Every buff/debuff/heal family now has its own painted burst AND a lingering
aura on the afflicted pet**: debuff → shadow wisps, slow/movelock/confuse →
vortex, mark/stun → crackling sparks, taunt → power flare, lifesteal → blood
burst; debuffed/slowed/marked/confused/stunned pets carry looping auras just
like burning/frozen ones. Stun/freeze turn-skips flash their effect on the
skipping pet. Synthesized signatures now scale with rarity (72% of the tier's
power cap) instead of a flat 260.

**Kit-power normalization** (the stat budget's sibling): same-rarity kits vary
wildly in authored move power — three mythic assassins carried 92-100-power
kits in a 450-cap bracket and sat at 5-11% win rate. Each pet's move powers
now scale toward its OWN rarity's median kit power (damped ^0.6, clamped
0.8-1.35; deliberately NOT cross-tier blended — that neutralized the fix).
Kind-value tuning from the new per-kind carrier analysis: DoT initial 0.82 +
24%/tick, push/pull 0.85 + 16 stamina drain, shields softened to 0.9x pool.

**Results**: species outliers 25 → 10; elements 45.9-53.9%; roles 44-56%;
pace 8.1 rounds; judge 10.3%. Cross-rarity ladder measured: rare>standard
92.5% (the catalog's steepest cliff — accepted as PROGRESSION, and AI tier
pools are now single-rarity so it never decides fairness inside one fight),
legendary>rare 62.5%, mythic>legendary 75%. Known per-species outliers
needing kit re-authoring in the shared catalog (not engine distortion):
Abyssal Oni Hound, Stormgod Raijin (mythic assassins with under-powered
authored kits).

## Round 7 — the Temtem technique engine, kit surgery, Colosseum cameras (2026-08-10)

**Temtem-style technique mechanics** (the two we lacked):
- **Per-move PRIORITY, multiplicative** (order = pet speed × chosen move's
  priority — Temtem's model, gentler than Pokémon's absolute brackets): Guard
  1.5x, quick jabs (≤80 power) 1.15x, normal 1.0, haymakers (>220) 0.8x,
  signatures 0.75x, Rest 0.9x. The round's order is now a CONSEQUENCE of the
  commands — a guard raises before the fast attacker lands; the nuke swings
  last. Deck buttons show ▲/▼ pace arrows.
- **HOLD**: haymakers are unusable until round 2 in battle, signatures until
  round 3 (readiness ticks everywhere, field or bench — the Temtem rule).
  Kills the alpha-strike opener; deck shows "Charging — round N".

**Kit surgery** (owner-authorized moveset changes, done as SHOWDOWN-SIDE
overrides so the shared catalog and the legacy modes are untouched):
`SHOWDOWN_KIT_OVERRIDES` re-authors the three mythic assassins that shipped
standard-power kits (Worldstorm Dragon, Abyssal Oni Hound, Stormgod Raijin) —
proper mythic burst kits with mark setups and lifesteal sustain. Overridden
kits skip kit-power normalization (they're authored at correct tier power).
Result: worst species now 21.4% (was 5.6%); elements 46.7-53.3%.

**Pokémon Colosseum camera grammar**: non-super actions now CUT instead of
lerp — a low behind-the-shoulder shot frames the windup, then a HARD CUT to a
side-on shot of the victim for the strike; supers keep their continuous
letterboxed swoop. Every action opens with the classic declaration banner
("Red Fox used Flame Bolt!").

## Follow-ups

- Ghost-team async PvP (snapshot real rosters as opponents, ladder placement).
- Reserve balance levers from the research pass, deliberately unshipped:
  U-turn-style pivot moves, entry-hazard analogues, priority-bracket moves,
  trick-room analogues for slow archetypes.
- Kit-level (kind-value) tuning for the remaining ~25/140 species outliers.
- Per-pet mastery/bond progression and seasonal track.
- Migrating Hollow Gate / clan war / sector war / ladder onto the turn engine,
  then deleting the legacy sim stack (~45k lines client+server).
