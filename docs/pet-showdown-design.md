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

## Round 8 — the full Temtem stamina economy (2026-08-10)

The stamina system was half-Temtem (overexertion, Rest, bench regen existed);
this round completes the model with the three missing pieces:

- **The pool is a STAT**: max stamina derives from bulk at seal time
  (`55 + maxHp/16 + defense/6`, clamped 80-125) — a war tortoise casts
  longer than a glass kitsune. HUD stamina bars are now fractions of the
  pet's own pool.
- **Low regen** (Temtem: 5%+1; ours: 7%+2 per round, field or bench):
  passive income sits far below nuke cost, so "spam your best move" is
  arithmetically self-terminating within a few uses and Rest (~22%+2) is a
  real rotation beat. Costs rebalanced for the tighter economy: basic 14,
  light 18, medium 32, heavy 52.
- **Overdraft draws blood**: using a move beyond remaining stamina still
  fires it, but the pet pays 2 HP per point of deficit (it CAN self-KO) on
  top of being winded next round — Temtem's overexertion chip, shown as a
  damage popup on the actor.

Bands re-verified unchanged (pace 8.2, judge 11.1%, elements 46.9-53.1%,
roles 45-56%); 33 showdown tests green.

## Round 9 — traits, equipment, and pure stamina+hold gating (2026-08-10)

**Traits fight now** (stat bonuses were already baked into stored stats; these
are the live-combat identities on top): Aggressive +6% damage, Loyal +20%
meter gain, Guardian blocks at 42% instead of 50%, Swift +8% effective speed,
Lucky shifts the damage roll window up 3%, Battleborn enters with 25 meter;
ultras — Fateweaver +8% damage/+10% meter, Hollowborn drinks 8% of damage
dealt, Boonbringer doubles its ally-synergy bonus.

**Equipment fights now**: equipped PvP gear applies its stat mods to the live
stats before sealing (an earned bonus the species normalization deliberately
does not wash out) and all five combat procs run in the engine — Aegis start
shields, Venomfang on-hit poison, Executioner's execute bonus, Final Bastion
last-stand reduction, Bloodthirster lifesteal. The gear name rides the view
for the HUD.

**Cooldowns are GONE** — stamina and hold are the only gates, exactly the
Temtem model. The removal surfaced two degenerate metas the sim caught and
the round fixed:
- Control spam (stun/freeze chains → 45% judge decisions): control kinds now
  cost like haymakers (44+), carry Hold 1, and a pet that pays a stolen turn
  gains 2 rounds of *steadfast* (control immunity) — the engine's Sleep
  Clause.
- Heal spam (18-stamina heals every round = unbreakable sustain): heals cost
  40+ and carry Hold 1.
Plus two throughput fixes: DAMAGE_SCALE 2.35 → 3.3 (Temtem pairs low regen
with hard-hitting techniques) and the AI no longer rests while a jab is still
affordable. Role multipliers retuned for the no-cooldown meta (defender 1.22,
tracker 0.84). Final bands: roles 42.4-54.1%, elements 42.2-56.9%, pace 8.7
rounds, judge 24%, species outliers 8 (best yet). 35 tests green.

## Round 10 — training made meaningful, ratio formula, logic audit (2026-08-10)

**The damage formula changed shape**: atk²/(atk+def) → Pokémon's pure-ratio
`DAMAGE_SCALE × (power/100) × REF_DEF × atk/def`. Under the old shape an
attack point carried ~3x a defense point's value, making defense TRAINING a
trap buy. Under the ratio shape attack, defense, and hp all carry equal
marginal weight. The new TRAINING RELEVANCE analysis (a pet trained +60% in
one stat vs its untrained twin) proves every focus is now a real choice:
attack 86.7%, hp 86.7%, speed 80%, defense 73.3% (defense was ~55% before).

**The ratio formula's known cost, handled**: it cancels uniform stat
inflation, which ERASED the rarity ladder (mythic lost to legendary 32.5%).
Cross-tier superiority is now granted deliberately via
`RARITY_DAMAGE_TIER` (1 / 1.04 / 1.1 / 1.26, attacker-over-defender ratio so
same-tier fights are untouched) — ladder restored: rare>standard 82.5%,
legendary>rare 70%, mythic>legendary 62.5% (measured with same-element pairs;
the old sampler let the 1.5x wheel swamp the tier gap). Budget weights
repriced for the new elasticities (def 1.3); cross-tier blend eased to 0.3.

**Logic audit fixes**: overdraft self-chips no longer FARM the super meter
(applyDamage grantMeter flag); a winded pet can no longer dodge its stolen
turn by switching to the bench.

Final bands: roles 43.3-53.6%, elements 44.6-55.0%, pace 7.0 rounds, judge
11.3%. Species outliers 18 but shallow (worst ~20% — historically 2-6%);
the added spread is the price of element identity under the stronger wheel.
35 tests green.

## Round 11 — the AAA pass (2026-08-10)

Driven by a 46-agent audit across balance, UI, VFX, engine logic and AAA-gap
research; 25 of 40 findings survived adversarial verification and were built.

**Correctness / exploits**
- **Prototype-key crash + NaN pet.** A pet id/role/trait of `constructor` or
  `__proto__` resolved to an inherited `Object.prototype` member on a bare
  table read — non-nullish and non-numeric — which 500'd the start endpoint
  and, worse, propagated NaN into hp so `hp <= 0` was never true: an
  unkillable pet on a reward path. All identity fields are now allowlisted and
  every tuning-table read goes through an own-property numeric lookup, with
  NaN backstops on damage/heal.
- **Super-priority exploit.** Commands were sanitized twice — once for the
  turn-order sort, once at action time against mutated state. A super
  submitted at meter 82-99 sanitized to `guard` for the sort (buying the 1.5x
  guard slot), topped its meter up from damage taken, then fired early ahead
  of every enemy Guard. Now sanitized exactly once and carried forward.
- **87 of 140 species had lost their authored signature name.** `_catalog.ts`
  authors the signature last, and a `slice(0, 5)` ran before the signature
  lookup — so "Lunar Eclipse: Ninetail Requiem" displayed as "Fire Overdrive".
  Fixed with a power FLOOR (never a nerf, never a buff), so every sealed
  number is byte-identical and only the name changes.

**Balance** — the AI was the biggest lever. Its "already applied" penalty
checked `target.statuses` for the raw kind, but self-buffs land on the ACTOR
under renamed keys (barrier→shield, move→haste, dot→burn, movelock→slow), so
the penalty never fired and **barrier was 24.8% of all AI commands — more than
plain damage**. `storedStatusKind` is now the single source of truth both the
engine and the AI read. The AI also rotates its bench on the half-flip and on
stamina, not only a full element flip (which held in ~2% of rounds).
Result, with the element identity tables retuned for the corrected AI:

| | before | after |
|---|---|---|
| roles | 43.3-53.6% | **48.4-52.7%** |
| elements | 44.6-55.0% | **49.2-52.0%** |
| judge decisions | 11.3% | **0.9%** |
| species outliers | 17 | **7-13** |
| training relevance | def 73.3% | **def 86.7%** (hp 83, atk 80, spd 73) |

**Round cap now scales with bench depth.** A flat 14 could not resolve a team
fed in one at a time: 1v1 with two reserves ended **87.2%** of its games on the
timer. The cap extends per reserve, leaving 2v2/3v3 (which field everyone at
once) exactly as tuned.

**UI / readability**
- Move buttons carry a server-authored **effect line** — a 168-power stun
  landing 84 damage was previously indistinguishable from a 168-power hit.
- The element matchup readout no longer requires multi-target mode, so it
  finally renders in **1v1** — the format whose blurb sells the wheel. Now a
  filled pill reading `▲ STRONG ×1.5`, not a colour-only arrow.
- Status pips show **remaining rounds** and a plain-English tooltip
  (shields include their remaining pool).
- A pet that will lose its next action is **no longer asked for a command**
  (it used to get the full deck and a timing needle for input the engine
  discards). A stunned pet still gets its switch decision.
- Overdraft is pre-warned with the exact HP cost before you commit.
- The **judge** is announced and explained on the result panel — it decided
  fights the player was never told about.
- Trait and gear are shown on the roster picker (where team-building happens)
  and on the player's battle cards.
- A closed-by-default **rules panel** in the lobby, and the in-game guide's
  wheel numbers were wrong for this mode (it taught the Coliseum's ±25%).

**Feel / accessibility**
- Impact recoil is now **damage-scaled** (`impactPower` was never assigned, so
  every hit used the same restrained flinch).
- The victory pose latches off the end EVENT, not the finished phase — the
  winner used to stand in a plain idle through the entire victory beat.
- Full **`prefers-reduced-motion`** support (the mode was the only one in the
  codebase without it): shake, flash, bloom and overshoot animations drop,
  information-bearing HP transitions and the camera's hard cuts stay.
- The **timing needle is keyboard-reachable** — it bound `pointerdown` only,
  so keyboard players were permanently capped at the base multiplier.
- An **audio toggle** inside the takeover, which hides the global one.
- Mobile portrait gutter regression fixed (a `padding` shorthand inside the
  mobile block was resetting it, overlapping the portrait onto the stat line).

**Deferred, deliberately** — camera shot variety, the draft-aware turn-order
strip, combat-reactive stage light, the post-battle stat recap, and gear-proc
attribution in the battle log. All are additive polish with no correctness or
balance impact; each is scoped in the audit work order.

## Round 12 — the deferred polish (2026-08-10)

The five items round 11 scoped and deliberately postponed, all built.

**Camera shot variety.** Non-super actions now pick from three windup and
three strike framings, seeded off the **queue index** (not a wall clock, which
would pick different shots on replay). Ranged attacks get an off-axis "slot
line" framing that holds both bodies so the throw travels across frame; melee
keeps the behind-the-shoulder traverse. A lethal or heavy blow pushes the lens
in (side 4.8→3.2, height 2.3→1.7). Switches get their own shot tracking the
arriving pet, and the battle ends on a slow **orbit of the survivor** that
keeps turning behind the result panel. All framings are clamped inside the
arena shell, and the portrait pull-back now travels along the look vector
instead of scaling the position (which used to send low shots into the floor
and high ones through the backdrop).

**Draft-aware turn-order strip.** The strip recomputes from the live draft,
mirroring the engine's `speed × chosen-move priority` — so picking Guard or a
signature visibly re-sorts your chip. A drafted **switch removes the pet from
the round entirely** (and does not insert the incoming pet, which spends its
action arriving) — the largest single order change a command can make.
Skipped pets keep their slot, dimmed and struck through. Enemy chips carry a
`?` and stay at neutral priority, and the strip is honestly relabelled
"Est. order" rather than presenting a guess as truth.

**Combat-reactive stage light.** The arena now flinches with the hit: ambient
and the ember point-light punch off the *camera's own shake envelope*, so
light and shake can never drift apart, and the ember tints to the attacking
element for the duration. The key and hemisphere lights are deliberately left
alone — they carry each painted arena's identity.

**Post-battle recap.** Per-pet damage, KOs and supers, best first, with an MVP
crown and the daily-win counter that was already on the wire with zero
consumers. Tallied at **ingest**, not during playback, so fast-forwarding or
leaving early cannot change the numbers.

**Gear/trait proc attribution.** Named effects (`procs[]` on the target
payload) now ride each hit: Execute, Mark, Executioner's Talon, Final Bastion,
Bloodthirster, Hollowborn, Guardian and the damage traits. They used to bend
damage with nothing on screen to attribute it to. Verified balance-neutral —
the sim is byte-identical, because attribution only observes.

## Round 13 — the JRPG command HUD, and targeting by creature (2026-08-10)

Reference-led pass on the battle UI: the console-RPG layout (ornate status
plates in the corners, a vertical command menu, a move inspector) plus the one
interaction change that carries it — **you target by clicking the creature, not
its name card**.

**Click the model.** Every fighter carries an invisible 2.1 × 2.4 × 2.1 hit
volume (sized generously for a thumb, not for the mesh) that is interactive
**only while that pet is a legal pick**, so it can never steal a stray click
during playback. A legal target floats a spinning triangular reticle above it
and lights its own plate on hover; the inspector gains a `→ target` line naming
what the pointer is over. One `pickTarget` entry point now serves all three
picks — enemy for an attack, ally for a heal, reserve for a switch. The plates
stay clickable as a **keyboard/assistive fallback** (a `<button>` only when it
is a legal target), because a 3D hit volume is not reachable by Tab. Reserves
wait in the side wings and can sit outside the standoff shot, so the switch
prompt names the plate as the reliable target rather than pretending otherwise.

**Status plates.** The old stacked cards became gold-rimmed lacquer plaques:
portrait with an element-tinted rim, name / Lv / element mark, then HP and
Stamina each as key + track + **`cur / max` numerals** — the readout the cards
never had — with the slow-draining red chip layer preserved under the HP fill.
The signature meter is a hairline under both bars. Bench plates drop the
element mark and the meter to buy name room, because a reserve you are
choosing between needs its NAME legible above all else.

**Command menu.** A vertical console list — Attack / Skill / Guard / Rest /
Switch — with a ▶ selection arrow, per-row EN costs, and arrow-key navigation
alongside the mouse. **Skill** opens the technique sub-list (kit moves, then
the signature, then Back). Only an unmet **Hold** disables a row; a move you
cannot afford stays selectable, because overdraft is a legal, priced choice and
the inspector says exactly what it costs. Rows are built by a pure builder that
returns **declarative actions** rather than closures — the component dispatches
them — which is what keeps the row data clear of the command handlers (those
reach refs, and the React compiler forbids touching refs during render).

**Move inspector.** Bottom-right: move name in its element tint, an
element · kind tag, the server-authored effect line, and PWR / STA / PACE /
HOLD chips, over an oversized element glyph bled into the corner. Warnings are
computed from the same server-sent fields — overdraft cost in HP, an unmet
hold, an unfilled meter.

**Mobile.** The plate rows stack no more: each team gets one horizontally
scrolling row, so HUD height is fixed regardless of team size (the wrapping
grid ate the whole screen and left no arena visible). Menu and inspector stay
side by side rather than stacking, which used to push the readout off the
bottom edge; the turn-order strip drops clear of the top bar. Verified at
1440×860 and 390×844.

Balance untouched — this round adds no number to the engine and reads none it
was not already sent.

**What the review pass caught.** Nine defects survived adversarial verification
across six lenses, all fixed before commit:

- **Guard's inspector line was affirmatively false.** It claimed guarding makes
  the signature meter "fill faster"; the engine pays a guarded pet
  `SHOWDOWN_METER_ON_GUARDED_HIT` (14), *less* than the 18 for eating the hit —
  guard is only ahead per point of health. Both figures now come from the
  contract, so the sentence cannot drift from the table again, and Guard's
  otherwise-empty PWR chip became a METER chip.
- **The switch line only held in 1v1.** The engine has no slot inheritance: an
  attack aimed at a pet that leaves the field falls through to the first pet
  still standing (or the taunt holder), which in 2v2/3v3 is usually *not* the
  arriving pet. The copy now branches on the field count.
- **Menu rows were natively `disabled`**, which fires no hover and takes no
  focus — so the inspector line explaining *why* a row was unavailable ("Still
  charging — unleashes from round 3") was unreachable by any input. Rows are
  `aria-disabled` now, with activation guarded in the handler.
- **Keyboard focus fell to `<body>` on every menu transition.** The battle is
  portalled to the end of `document.body`, so recovering it meant tabbing
  through the entire background app. Both panels now reclaim focus on mount —
  and only when it was genuinely orphaned, so a mouse player never gets yanked.
- **A hover could latch forever.** r3f deletes a mesh's handlers the moment
  `targetable` goes false and drops the hovered entry before its own eventCount
  guard, so a pet that stopped being a legal target under a stationary pointer
  never fired pointerout. The hover is derived from the targeting state now
  rather than trusted to expire.
- Plus four CSS defects: a reduced-motion `animation: none` that lost on
  specificity (so the one continuous animation the block exists to kill kept
  running), inspector stat values overflowing their pills on a phone, a stale
  `margin-left: auto` right-aligning a whole tag row, and phone-width plate
  names truncated to a few letters.

Two claims were investigated and **rejected as non-defects** worth recording:
the `moveIndex` the server reads addresses the engine's own move list, which
the view mirrors with the signature appended last — so both the old filtered
index and the new real index resolve identically; and the overdraft HP literal
predates this round.

## Follow-ups

- Ghost-team async PvP (snapshot real rosters as opponents, ladder placement).
- Reserve balance levers from the research pass, deliberately unshipped:
  U-turn-style pivot moves, entry-hazard analogues, priority-bracket moves,
  trick-room analogues for slow archetypes.
- Kit-level (kind-value) tuning for the remaining ~25/140 species outliers.
- Per-pet mastery/bond progression and seasonal track.
- Migrating Hollow Gate / clan war / sector war / ladder onto the turn engine,
  then deleting the legacy sim stack (~45k lines client+server).
