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

## Next: step 3 (big) — route the client onto it

Route the client's AI-fight launches (~8 entry points: Arena, WorldMap,
HunterBoard, hunt-encounter, apex-contract, endless-tower) to the server-combat
screen (`MissionArenaFight`-style) instead of the local engine, behind the flag.
This is where care matters most — a half-migration is worse than none.

**Two things step 2 deliberately left for step 3** (both are commented at the top
of `_ai-fight-encounter.ts`):

1. **Opponent level.** The encounter is built at the profile's AUTHORED level.
   The client re-levels built-ins per entry point (`relevelBuiltinAi`: missions
   align the foe to the player, hunts scale by sector, rifts rebase to
   player+15) and that rule lives only on the client. `opponentLevel` from the
   request body is NOT read — a client-chosen level is a client-chosen
   difficulty, which is the authority this migration exists to remove. Each
   entry point's scaling rule has to move server-side as part of the routing.
2. **Terrain.** The floor uses the neutral `central` biome, not the client's
   sector terrain, so no unearned +10% school buff is sealed in.
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
