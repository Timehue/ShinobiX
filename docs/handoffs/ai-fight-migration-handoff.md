# Handoff — Generic AI-Fight Migration (and session state)

Written 2026-08-02, end of a long session. Read this first in a new session.

## Where main is

`main` is green with the full P0-1..P0-6 stabilization track, launch hardening,
and **step 1 of the AI-fight migration** (PR #51 — confirm it merged before
relying on it). The game is live and healthy at shinobijourney.com.

## The task in progress: move generic AI fights server-authoritative

**Why:** generic AI fights are the last combat mode where the CLIENT decides it
won — the battle runs in the 6,652-line local Arena engine and reports the
outcome. The reward is already server-bounded, daily-capped, idempotent, and
by design doesn't touch PvP power (balanced-PvP pillar), so faking a win only
buys bounded leveling speed — but for a shipped, skill-based game that is real
debt worth closing properly, not with a band-aid.

**Key discovery that makes this tractable:** server-authoritative fights already
run on the tower engine (`api/towers/_engine.ts`) and are already PLAYED on the
client through dedicated screens (`shinobij.client/src/screens/MissionArenaFight.tsx`,
`BattleTowerFight.tsx`) — completely separate from the local Arena engine. So
this is ROUTING AI fights onto proven machinery, not reconciling two engines.

Full plan: `docs/runbooks/combat-mode-migration.md`.

## Done (step 1, on main via PR #51)

`aiOpponentEnemyTemplate(profile, resolvedJutsu?)` in `api/_authoritative-pve.ts`
— a defeatable `EnemyTemplate` built faithfully from an AI profile (finite HP,
whole stat sheet, armor, pools, real jutsu loadout). Pure, 9 tests in
`api/_ai-opponent-template.test.ts`.

## Done (step 2)

`ai-fight-start` now seals a real encounter behind `ENABLE_SERVER_AI_COMBAT`
(default OFF) and returns its `runId` alongside the existing token fields.

**The step-2 note above was wrong about one thing, and it mattered:** the server
had NO source of AI profiles. `builtinAis` is derived at import time on the
CLIENT (`shinobij.client/src/lib/combat-ai.ts` — `makeBuiltinAi` runs the level
curves), and `shared:ai-profiles` is a read-only key nothing has ever written.
So step 2 had to start by mirroring the catalog:

- **`api/_ai-profile-catalog.ts`** — GENERATED mirror of the 71 built-in AI
  profiles, via `scripts/ai-profile-catalog-gen.mjs`, drift-guarded by
  `scripts/ai-profile-catalog.test.mjs`. Same cross-build-root pattern as
  `api/pvp/_jutsu-catalog.ts`. **Regenerate after any change to `builtinAis`:**
  `node --import tsx scripts/ai-profile-catalog-gen.mjs`. `rules` is deliberately
  not mirrored (random ids each import; the tower engine runs its own AI).
- **`api/_ai-opponent-loadout.ts`** — `resolveAiProfileJutsu(jutsuIds, admin)`:
  `JUTSU_CATALOG` ∪ admin content, built-ins winning collisions (same precedence
  as `resolveEquippedLoadout`), run through `sanitizeJutsuList`.
- **`api/towers/_enemy-templates.ts`** — `EnemyTemplate['jutsu']` widened with
  `target` / `tags`. Type-only: the encounter builder already spreads jutsu
  through, but the narrow type would have silently disarmed every tag the AI
  casts. Watch for this if you add more fields.
- **`api/missions/_ai-fight-encounter.ts`** — `loadAiFightProfile` (mirror, then
  `shared:ai-profiles`) + `buildAiFightEncounter`. Seals the active pet, same as
  `combat-start`.
- The token record now carries `runId` — one token = one battle lifecycle, so
  step 4 has no second binding key to invent.

Flag OFF is a byte-identical no-op, and sealing is best-effort: any failure
returns no `runId` and the fight runs the existing path.

## Done (step 3a) — server-side AI level curves

**Step 3 is not "route 8 entry points."** Surveying the client turned up two
layers that live ONLY on the client and that the server applies none of. Route
the client without porting them and the fight it plays is not the fight it was
shown — in opposite directions:

- **Opponent re-leveling** → the server fight would be systematically WEAKER.
- **PvE difficulty bands** → the server fight would be systematically HARDER,
  worst for brand-new players.

3a closes the first one:

- **`api/_ai-level-curves.ts`** — hand port of `lib/ai-stats.ts` + the
  `makeBuiltinAi` → `normalizeAiProfile` → `relevelBuiltinAi` chain. Formulas,
  not data, so no generated mirror is possible. Shared constants and player
  curves are reused from `api/_xp-engine.ts`.
- **`scripts/ai-level-curve-parity.test.ts`** — sweeps the whole legal input
  space (~38.6k exact comparisons: all 71 built-ins × 17 levels × 8 rank
  bonuses × 4 HP floors, plus every level × toughness × loadout shape).
  Mutation-verified: changing the HP curve 1.12 → 1.13 fails three cases.
- `buildAiFightEncounter` now takes `scaling {level, statBonus, hpFloor}` and
  REBUILDS the profile through those curves. (Step 2's `levelOverride` stamped
  a bare level without rescaling — a "level 60" foe kept level-18 stats.)

Two client quirks are reproduced on purpose, because the client's behavior is
the contract: `relevelBuiltinAi` **drops `hpFloorExempt`** (see the hazard note
in `lib/apex-contract.ts`), and `distributeStatBudget`'s rounding-stall branch
is **`STAT_KEYS`-order dependent** (the server list is asserted identical).

## OWNER RULINGS (2026-08-02)

1. **Guard first, then mastery everywhere.** Finish the guard, extend it to all
   server PvE modes, and only then turn on enemy jutsu mastery across the board.
2. **Extend the guard + band layer to every server PvE mode, default ON with a
   kill switch** (matches the ship-on-not-gated-off preference).
3. Arena practice spar keeps its player-chosen level slider; the server seals
   whatever level was chosen.

### Next two commits, in this order

- **Extend the guard to the other PvE modes.** Seal `pveGuard` + apply the band
  HP/stat multipliers in `missions/combat-start.ts`, `story/boss-start.ts`,
  `towers/start.ts`, `clan-boss/assault-start.ts`,
  `village/anbu-infiltration.ts`, `weekly-boss.ts`. Default ON, kill switch
  `DISABLE_PVE_DIFFICULTY_GUARD=1`. The engine half already works — presence of
  a sealed `pveGuard` is the only gate. ⚠ Weekly boss has its OWN guard cycle
  (`weeklyBossGuardedHit`, not ported); do not double-clamp it.
- **Then enemy jutsu mastery everywhere**, default ON, kill switch
  `DISABLE_PVE_AI_MASTERY=1`. Must come second — those modes currently have no
  mercy caps, so tripling enemy jutsu damage first would wreck onboarding.

## Done: step 3b — the PvE difficulty band layer

Port landed (`api/_pve-difficulty.ts` + `scripts/pve-difficulty-parity.test.ts`,
mutation-verified twice). Wiring landed for three of four pieces:

- ✅ **AI jutsu mastery.** ⚠ **Found while wiring: NO server enemy template has
  ever carried `character.jutsuMastery`,** which `api/pvp/move.ts` `applyJutsu`
  reads off the caster — so every server-sealed AI casts at mastery 0, i.e.
  `masteryDamageFrac(0) = 0.3`, **30% of the jutsu damage** the client's PvE AI
  deals (it passes `pveAiMasteryForLevel` explicitly). `buildAiFightEncounter`
  now seals it. **This gap still exists for combat missions, story bosses,
  hollow gate and the towers** — their templates were hand-tuned with mastery 0
  in place, so correcting them is a real balance change and needs its own pass.
  Worth doing; it is very likely why some server PvE reads as limp.
- ✅ **Band HP + stat multipliers** at seal time (mirrors `Arena.tsx:691/:695`).
  Order matters and is tested: the re-level applies the HP floor, THEN the band
  multiplies — same as the client.
- ✅ **`session.pveGuard` sealed** (`api/towers/_tower-session.ts`). Presence is
  the gate; no existing mode seals it, so all of them stay byte-identical.
- ❌ **The engine clamp itself is NOT wired yet.** `pveGuard` is armed but
  nothing reads it.

### The remaining piece, and why it is not a five-minute job

⚠ **The client guards PRE-shield and PRE-absorb** (`Arena.tsx:4677`:
`enemyDamage = guardEnemyHit(enemyDamage)` THEN
`blocked = min(playerShield, enemyDamage)`), it guards before Wound/Siphon
derive from the number (`:4203`), and **player DoT ticks count against the same
turn budget** (`:4964`).

A post-hoc HP-delta clamp in `_engine.ts` is therefore WRONG — a shielded player
would get a larger real allowance, and bleed/lifesteal would come off an
unclamped figure. Two candidate seams were checked and both fail to give the
raw number: `res.opponent.hp` is post-shield, and `fx.amount`
(`CombatFxEvent`) is post-shield/post-absorb as well.

**So the clamp has to go inside the resolver:** add an OPTIONAL `damageCap`
parameter to `applyJutsu` (`api/pvp/move.ts`), defaulting to `Infinity` so every
existing PvP and PvE caller is byte-identical, applied at the exact point the
client applies it. That is a change to live PvP code, so it wants its own
commit, a careful read of the damage pipeline, and a PvP-unchanged regression
test alongside the new PvE one.

Then: reset the turn state in `refreshAp` (runs at every turn start), and route
squad DoT damage in `applyRoundStatusTicks` through the same budget.

Still to wire after that: `pveAiCompetence` and the easy-band pacing helpers
(`pveEasyBandHoldsBurst`, `pveEasyBandAllowsLethal`) into the engine's
`bestAffordableJutsu` / `pickAiAction`.

## Reference: what 3b's port covers

`shinobij.client/src/lib/pve-difficulty.ts` has **no server counterpart at all**
(`grep pveDifficulty api/` is empty). It supplies:

- `pveDifficultyHpMultiplier` / `pveDifficultyStatMultiplier` — enemy scaling
  applied on top of the profile (`Arena.tsx:691`).
- `pveEnemyHitCap` / `pveGuardedEnemyHit` — per-hit mercy caps that make the
  early-game bands effectively unloseable. **This is the load-bearing one:**
  without it a new player's first server fight is far harsher than today's.
- `pveAiCompetence`, `pveEasyBandHoldsBurst`, `pveEasyBandAllowsLethal` — which
  tactics the AI is allowed to use per band.

Port it the same way (parity test in `scripts/`), then wire it into the sealed
encounter and the engine's damage path. This slice touches `_engine.ts`, so it
is the riskiest one — keep it its own commit.

## Then step 3c / 3d

- **3c** — derive `scaling` per entry point from SERVER state: combat mission →
  `missionAiLevelAndBonus(mission, save.character.level)`; hunt → the hunt def;
  apex → `APEX_ROSTER`; rift → the shrine picker; endless → the wave.
- **3d** — route the client screens to `MissionArenaFight`, behind the flag.

**Open ruling needed before 3c/3d (Arena practice spar).** `Arena.tsx:5359` is a
free 1–`MAX_LEVEL` opponent-level input, and it drives a fight that pays the
normal AI-fight reward. The reward is flat (100 XP / 75 ryo, `computeAiFightBaseReward`)
and daily-soft-capped regardless of opponent level, so a player picking level 1
gains only throughput, bounded by that cap — no worse than today's fake-a-win.
Still, "the client picks the difficulty" is the authority being removed, so pick
one: (a) keep the slider and let the server seal whatever level was chosen,
(b) clamp it server-side to a band around the player's level, or (c) make the
practice spar pay nothing (there is precedent — the player-vs-player Spar
already grants zero). Everything else in 3c is mechanical once this is settled.
- **Step 4:** derive the reward from the settled session (retire the
  client-claimed win in `report-ai-fight`); keep the `redeemedAiFightRewards`
  receipt for idempotency.
- **Step 5:** retire the local Arena AI-fight path + the flag once proven.

## Working rules that held this session (keep them)

- **Gate on the AUTHORITATIVE CI signal, not `gh run watch --exit-status`** —
  it returned exit 0 for FAILED runs twice today. Always cross-check
  `gh pr checks <PR>` and only merge when every row is `pass`.
- Full local gates before push: `npm test`, `npm run build`,
  `npm run certify:release` (28 checks). All must be exit 0.
- Verify, don't infer — after today's mistakes, confirm each claim (a passing
  test count is not proof a specific new test ran; grep the log / run it directly).
- Small, reversible commits; each leaves main releasable.

## Loose ends unrelated to this task

- **Optional, likely unnecessary:** the live-data scanner (`npm run scan:data`)
  and its cutovers (`STRICT_RAW_SAVE_LEDGER`, content slot freeze, currency read
  cutover) are moot if a full pre-launch WIPE happens — the wipe does their job.
  Only run the scanner if you decide NOT to wipe. See
  `docs/runbooks/currency-ledger-cutover.md` and `shared-content-cutover.md`.
- Capacity: one container carries ~500 concurrent comfortably, ~700–800 ceiling,
  bound by single-core whole-save-write cost. `numReplicas` is pinned to 1 by
  design (in-process presence). Run `npm run soak -- --url=<staging>` before
  launch for the real Postgres number. `docs/runbooks/launch-capacity.md`.
