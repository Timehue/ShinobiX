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
`api/_ai-opponent-template.test.ts`. **Nothing calls it yet** — it's the verified
foundation.

## Next: step 2 — `ai-fight-start` builds a real sealed encounter

Template to copy: **`api/missions/combat-start.ts`** (91 lines). It:
1. reads the save (`augmentSaveWithForgedDefs(kv.get(save:...))`),
2. `buildAuthoritativeSoloEncounter({ save, floor, bossTemplate, runId, seed, now, towerId, admin: await loadAdminCombatContent(), hostLoadout })`,
3. `writeSession(session)` and returns the runId.

For AI fights, `ai-fight-start.ts` should do the same but:
- build `bossTemplate` from `aiOpponentEnemyTemplate(profile, resolvedJutsu)`,
  where `profile` comes from the AI profiles the fight already uses (built-in
  catalog and/or `shared:ai-profiles`), and `resolvedJutsu` is the profile's
  `jutsuIds` resolved against `JUTSU_CATALOG` ∪ admin content (see how
  `resolveEquippedLoadout` / the client resolves them),
- use a `dynamicBossFloor(...)` (see `_authoritative-pve.ts`) with a normal
  `objective: 'defeat-boss'` and a sensible `roundBudget`,
- do it **behind a flag** (add `ENABLE_SERVER_AI_COMBAT` or a `.v1` client flag,
  default OFF for now) so the existing token path stays the default until the
  client half (step 3) is ready. Keep the current token-minting behavior as the
  fallback when the flag is off.
- Return the `runId` alongside the existing token fields so a flagged client can
  pick the server path.

Step 2 is fully server-side and unit/​source-testable — no client risk. Land it
before touching the client.

## Then (later sessions, do NOT rush these)

- **Step 3 (big):** route the client's AI-fight launches (~8 entry points:
  Arena, WorldMap, HunterBoard, hunt-encounter, apex-contract, endless-tower)
  to the server-combat screen (`MissionArenaFight`-style) instead of the local
  engine, behind the flag. This is where care matters most — a half-migration
  is worse than none.
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
