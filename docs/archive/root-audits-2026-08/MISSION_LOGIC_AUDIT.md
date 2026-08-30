# Mission Logic Audit

Scope: mission/objective creation, assignment, progress, claim, and reward paths.

| Source | Mission Type | Generated How | Eligibility Exists? | Claim Check Exists? | Risk |
| --- | --- | --- | --- | --- | --- |
| `api/missions/_mission-catalog.ts` | Built-in combat, field, hunt | Static server catalog mirrored from client data | Yes. `min` and `levelReq` normalize through `api/missions/_eligibility.ts` | Yes. `claim-mission.ts`, `queue-combat-claim.ts`, and `record-progress.ts` use the helper | Low. Mirror drift remains possible, now covered by `scripts/check-mission-eligibility.mjs` |
| `api/missions/_pool.ts` | Profession daily missions | Deterministic daily pick by profession/player/date | Yes. Every profession template has explicit `eligibility` | Yes. Progress goes through `_progress.ts`, which re-checks eligibility before advancing | Low. Pet training still depends on client-reported event proof until pet training is fully server-side |
| `api/missions/_progress.ts` | Stored profession daily state | Load or issue daily state from profession pool | Yes. Existing stored missions are validated and repaired on load | Auto-grant on progress completion only after eligibility re-check | Low. Completed/claimed missions are preserved to avoid duplicate rewards |
| `api/missions/daily.ts` | Daily profession/newbie API | GET wrapper around `_progress.ts` | Yes for profession dailies; newbie dailies are safe low-level onboarding tasks | Profession rewards are settled by `_progress.ts`; newbie rewards are server-awarded | Low |
| `api/missions/_weekly-board.ts` | Weekly board catalog | Global weekly catalog plus per-player fallback pool | Yes. Weekly missions require `eligibility`; Warden is `minLevel: 100` plus Hollow Gate access | Shared by `weekly-board.ts` | Low. Global raw board can include locked missions, but player response filters/replaces them |
| `api/missions/weekly-board.ts` | Weekly board API | Returns player-filtered weekly board | Yes. Uses `pickWeeklyBoardForPlayer` and Hollow Gate unlock context from village state | Yes. POST rebuilds the player board and rejects ineligible manual IDs | Low |
| `api/missions/claim-mission.ts` | Combat/field/hunt/onboarding claim | Server resolves mission id from trusted catalog | Yes. Combat/field/hunt call `canPlayerClaimMission` | Yes. Unknown creator/custom ids return `unknown-mission` and no payout | Low |
| `api/missions/queue-combat-claim.ts` | Combat claim queue | Server queues won combat mission ids | Yes. Uses `canPlayerReceiveMission` before queueing | Claim is settled by `claim-mission.ts` | Medium-low. The fight result is still reported by the client, but payout requires a queued trusted catalog mission |
| `api/missions/record-progress.ts` | Field/hunt progress receipt | Server writes a progress receipt for built-in field/hunt missions | Yes. Uses `canPlayerReceiveMission` before recording | `claim-mission.ts` requires the receipt before payout | Low |
| `api/missions/report-pvp-win.ts` | Vanguard daily mission progress | Validated PvP session report | Yes indirectly. Calls `_progress.reportMissionEvent`, which re-checks stored mission eligibility | Auto-grant only through `_progress.ts` | Low |
| `api/missions/report-raid.ts` | Vanguard raid mission progress | PvP session or server raid token report | Yes indirectly. Calls `_progress.reportMissionEvent` | Auto-grant only through `_progress.ts` | Low |
| `api/missions/report-pet-event.ts` | Pet Tamer mission progress | Expedition token for expeditions; client event for pet training | Yes indirectly. Calls `_progress.reportMissionEvent` | Auto-grant only through `_progress.ts` | Medium. Pet training event proof is still client-reported and rate-limited |
| `api/missions/report-ai-fight.ts` | AI fight reward report | Single-use AI fight token | Not a mission picker; token validates fight reward bounds | No mission payout here | Low |
| `api/hollow-gate/*` | Hollow Gate run rewards | Server-sealed run token, augment choice, settle ceiling | Not a mission picker. Hollow Gate mission objectives now normalize to `minLevel: 100` and require Hollow Gate access | Run reward settle is token-bound; weekly Warden claim is gated separately | Medium-low. The client increments `hollowGateWardenKills`; save sanitizer clamps gains |
| `api/clan-boss/*` | Clan Boss assault scoring | Clan assault start/settle APIs | Not currently a mission picker. Future missions must use `requiredSystem: 'clanBoss'`, clan, and level gates | Clan boss rewards settle through clan boss storage | Medium-low for future mission content |
| `shinobij.client/src/screens/Missions.tsx` | Mission Hall UI | Displays combat, field, profession, weekly, wandering objectives | UI still hides/locks by local level where applicable; server is authoritative | Client no longer pays unknown field mission ids locally | Low |
| `shinobij.client/src/components/WeeklyBoard.tsx` | Weekly UI | Fetches player-filtered board | Locked/ineligible missions are not returned as available slots | Claim errors now show player-facing unlock messages | Low |
| `shinobij.client/src/screens/HunterBoard.tsx` | Hunt UI | Displays built-in hunt contracts | Local level/hunter rank checks plus server claim authority | Client no longer pays unknown hunt ids locally | Low |
| `shinobij.client/src/screens/Logbook.tsx` | Accepted mission UI | Displays accepted field missions and progression objectives | Local level checks for accept/start | Client no longer pays unknown field mission ids locally | Low |
| `shinobij.client/src/screens/DailyProfessionMissions.tsx` | Profession daily UI | Reads server daily state | Server filters and repairs assignments | Progress/claim handled by server profession endpoints | Low |
| `shinobij.client/src/lib/creator-mission-eligibility.ts` and `AdminPanel.tsx` | Creator/admin missions | Admin-authored mission form | Admin publish validates endgame/system text and stores normalized eligibility | Unknown creator mission ids are not paid by `claim-mission.ts` | Medium. There is no dedicated server publish API; server payout remains disabled for unknown creator ids |

Exact Hollow Gate Warden source found:

- `shinobij.client/src/lib/combat-ai.ts`: built-in boss AI `boss-hollow-gate-warden`.
- `shinobij.client/src/App.tsx`: Hollow Gate boss battle reward path increments `hollowGateWardenKills`.
- `api/missions/_weekly-board.ts`: new weekly regression catalog entry `wk-hollow-warden`, gated to level 100 plus Hollow Gate unlock.
