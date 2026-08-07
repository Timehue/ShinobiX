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

## Follow-ups (not in v1)

- Ghost-team async PvP (snapshot real rosters as opponents, ladder placement).
- Bench + switching for 3v3 (the prediction layer).
- Per-pet mastery/bond progression and seasonal track.
- SFX pass; hit-stop; per-element impact set pieces.
- Migrating Hollow Gate / clan war / sector war / ladder onto the turn engine,
  then deleting the legacy sim stack (~45k lines client+server).
