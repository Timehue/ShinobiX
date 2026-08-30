# Mission Eligibility Fix Report

## Root Cause

Mission eligibility was scattered across UI checks, catalog-specific level fields, and claim endpoints. Profession dailies had no explicit template eligibility. Weekly boards were global with no per-player replacement path. Unknown creator/custom mission ids could also fall back to client-side reward payout in Mission Hall, Logbook, and Hunter Board.

In the audited repo state, `Hollow Gate Warden` was not present in the old server daily or weekly mission catalogs. The exact Warden source was Hollow Gate gameplay:

- `shinobij.client/src/lib/combat-ai.ts`: boss AI `boss-hollow-gate-warden`.
- `shinobij.client/src/App.tsx`: Hollow Gate boss win increments `hollowGateWardenKills`.

The unsafe class was still real: any Warden/endgame objective entering weekly/custom/generated mission paths lacked a central server gate. This fix adds the Warden as a weekly regression fixture and proves low-level players cannot receive it.

## Eligibility System Added

Added `api/missions/_eligibility.ts` with:

- `MissionEligibility`
- `MissionEligibilityContext`
- `canPlayerReceiveMission`
- `canPlayerClaimMission`
- `normalizeMissionEligibility`
- `missionEligibilityFailureBody`
- `validateCreatorMissionEligibility`

It normalizes existing `min` and `levelReq` fields and hard-gates text/system references for Hollow Gate, Warden/Keeper, Legacy, Clan Boss, Village War, PvP, and ranked objectives.

## Generators Fixed

- Profession daily templates in `api/missions/_pool.ts` now declare eligibility.
- Added `pickDailyMissionsForPlayer`, which filters before deterministic selection.
- Weekly board generation now filters per player and fills ineligible global slots with safe fallback missions.
- Creator/admin mission authoring now validates endgame/system text and stores normalized eligibility metadata.

## Claim And Progress Fixed

- `api/missions/claim-mission.ts` rejects ineligible combat/field/hunt missions and no longer signals client fallback for unknown ids.
- `api/missions/queue-combat-claim.ts` rejects ineligible combat missions before queueing.
- `api/missions/record-progress.ts` rejects ineligible field/hunt progress before writing receipts.
- `api/missions/weekly-board.ts` rebuilds the player-filtered board at claim time and rejects ineligible manual posts.
- Client screens no longer pay unknown field/hunt mission ids locally.

## Stored Mission Repair

`api/missions/_progress.ts` validates stored daily missions on load. Impossible incomplete missions are replaced with deterministic eligible missions. Completed or claimed missions are preserved so progress is not erased and rewards do not become claimable again. `/api/missions/daily` returns replacement notes in `replacements`.

## Systems Gated

- Hollow Gate Warden/deep shrine: level 100 plus Hollow Gate access.
- Legacy/mythic: level 100 plus Legacy access.
- Clan Boss: clan plus clan boss access.
- Village War: village plus war access.
- PvP/ranked: PvP/ranked unlock and level floor.
- Pet/expedition: pet or expedition access as required.

## Tests Added

- `api/missions/_eligibility.test.ts`
- `api/missions/_progress.test.ts`
- New eligibility cases in `api/missions/_pool.test.ts`
- New weekly Warden replacement cases in `api/missions/_weekly-board.test.ts`
- `scripts/check-mission-eligibility.mjs`

Key regression: `test('low-level players are never assigned Hollow Gate Warden missions', ...)`.

## Commands Run

- `node --import tsx --test api/missions/_eligibility.test.ts api/missions/_pool.test.ts api/missions/_progress.test.ts api/missions/_weekly-board.test.ts`
- `node scripts/check-mission-eligibility.mjs`
- `npm run build:server`
- `git diff --check`
- `cd shinobij.client && npm ci`
- `cd shinobij.client && npm audit --audit-level=high`
- `cd shinobij.client && npm run lint`
- `cd shinobij.client && npm run build`
- `npm ci`
- `npm audit --audit-level=high`
- `npm test`
- `npm run build`

Final validation passed: 41 focused mission tests passed, the mission eligibility linter passed, client lint/build passed, full `npm test` passed with 2442 tests, and full `npm run build` passed with `verify:dist OK` and `sizecheck PASS`.

Intermediate failures fixed before commit:

- The first focused eligibility run exposed that creator validation normalized a low-level Warden mission instead of rejecting it. The validator now rejects it and the suite passes.
- The first eligibility linter run flagged a safe newbie fallback template as a false positive. The linter was tightened and passes.
- The first client build caught a TypeScript literal inference issue in `AdminPanel.tsx`. The mission form type is now preserved with `as const` and the client build passes.

No final validation command was skipped or left failing. `git diff --check` reported line-ending conversion warnings only, with no whitespace errors.

## Remaining Risks

- Pet training mission progress is still client-reported and rate-limited; expedition rewards use server tokens.
- Hollow Gate Warden kills are still incremented client-side and protected by save-sanitizer clamps; the weekly mission itself is now eligibility-gated.
- Creator/custom missions do not have server-authoritative payout unless added to trusted server catalogs. That is intentional for safety.

## Endgame Assignment Status

Low-level players cannot receive the weekly Hollow Gate Warden mission through `pickWeeklyBoardForPlayer`, cannot claim it by manually posting the id, and cannot receive synthetic Warden objectives through the eligibility helper without level 100 plus Hollow Gate access.
