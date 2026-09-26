# Controlled Village/Sector War Event

**Refreshed 2026-09-26.** Village and Sector War change who owns the map, which
moves War Resources, taxes and supply. Run it as a short, staffed event until
one real event has passed this runbook. Issue #9 stays open until real players
have completed that event and its report (the last section) exists. A dry run,
a simulation or browser automation does not count.

## What the event must show (issue #9)

- Only a completed, server-authoritative battle scores a contest, and it scores
  one contest once.
- A wrong player, village, sector or an expired contest scores nothing.
  A replay or retry scores nothing new.
- Territory, rewards and economy change once, even when settlement runs twice.
- A cancellation or correction is audited.
- A low-turnout event leaves nothing permanent behind.

The automated version of every case is `api/village/war-event-dry-run.test.ts`.
It proves the code. Only this event proves the operation.

## How a sector war works

| Topic | Fact | Source |
| --- | --- | --- |
| Switch | The war ships **on**. `DISABLE_VILLAGE_WAR=1` turns it off; `ENABLE_VILLAGE_WAR` does nothing. The 2026-09-25 preflight probe found production **on**. | `api/_release-flags.ts` |
| Declaring | The seated Kage of an attacking war village (or an admin) declares on an enemy-held war sector. It costs 250 War Resources, 175 with mapped intel or 125 with infiltrated intel, less the comeback discount. It is charged once, even on retry. | `api/village/sector-war.ts` (`declare`) |
| Limits | A village may attack at most 2 sectors at once, never while it is in an all-out village war. Village gates cannot be taken. A failed siege leaves a 24-hour cooldown on that sector. | `api/_sector-war.ts` |
| Length | 72 hours from the declaration. | `SECTOR_WAR_DURATION_MS` |
| How it is fought | The **defender** picks each sector's win condition (Combat, Card or Pet) and terrain beforehand. | `war-win-condition`, `war-terrain` |
| Combat | A world PvP battle between the two villages, with both fighters present in that sector. It is bound to the contest on its first move and scored at its end by the server. No browser needs to stay open. | `api/pvp/_sector-war-continuation.ts` |
| Card, Pet | A Chronicle duel (`sector-card`) or a pet duel (`sector-pet`). The attacker opens the pet duel and a defender answers it. | `api/village/sector-card.ts`, `sector-pet.ts` |
| Garrison | After 2 hours with no live battle, the attacker may fight the sector's garrison. It scores at half weight, capped at 150 points (200 while the garrison is fed). A Combat garrison assault must be finished within **1 hour** of starting it: after that its result is refused (404), its points are lost, and the attacker's items and HP from it are never settled. A Card garrison duel lives 2 hours and has no turn clock of its own, so an attacker who leaves one mid-duel keeps other attackers off that garrison until it expires. | `GARRISON_UNLOCK_IDLE_MS`, `GARRISON_POINTS_CAP`, `GARRISON_RUN_TTL`, `sector-card.ts` |
| Mercenaries | Mercenaries can be deployed at defending-village players. A repelled mercenary scores the defender a quarter weight. | `api/village/war-merc.ts`, `api/_merc-auto.ts` |
| Result | At 72 hours the attacker takes the sector only if strictly ahead. A tie or a defender lead is a hold. | `settleSectorWar` |
| When it settles | After the deadline, on the next sector-war declaration anywhere, an explicit `status` call ("Settle now" below), or the **03:00 UTC** daily pass, whichever comes first. The war map's own poll (`GET /api/village/war-map`) does **not** settle. Two settlements racing still settle once. | `api/_sector-war-settle.ts` |
| What a capture changes | The territory owner (`world:territory:<sector>`) becomes the attacker. The defeated clan loses the sector, and a clan must earn 75 scrolls and claim it again. War Resources accrue and taxes follow the new owner from the next daily pass. Both villages' intel on the sector is burned. The World Herald announces the result once. | `captureSectorForVillage`, `api/_war-daily.ts`, `api/_war-tax.ts` |
| Rewards | The fighters get their normal world PvP rewards (claim-rewards). When Legacy is on, war kills and captures also credit Legacy counters and the Era, each through its own receipt. | `api/pvp/_sector-war-continuation.ts` |
| Not covered | The **all-out village war** (declared through `/api/world-state`) is a separate system that this runbook does not exercise. `DISABLE_VILLAGE_WAR` does **not** switch it off: with the switch set it is still declarable and simply costs Honor Seals instead of War Resources. Agree with both Kages that neither village declares one during the event (it would also refuse the sector wars). | `api/world-state.ts` |

**Records**, for inspection only (never edit them by hand):

| Record | Key |
| --- | --- |
| Contest | `shared:sector-war:<sector>:<attacker>-vs-<defender>` (the contest id; `instance` is `g<generation>.s<startedAt>`) |
| Battle binding | `shared:sector-war-token:<battleId>` (lives about 48 hours) |
| Per-battle result | `shared:sector-war-resolution:<battleId>` (48 hours) |
| Scored-battle evidence | `shared:sector-war-battle:<contestId>:<instance>:<battleId>` |
| Territory | `world:territory:<sector>` |
| Village war state (War Resources, sectors, structures) | `shared:village-war:<village>` |
| Audit | `audit:sector`, read with `GET /api/admin/audit-log?domain=sector` |

## Roles and accounts

| Role | Who | Needs |
| --- | --- | --- |
| Event lead | The owner | Railway access, the final say on every decision in this runbook |
| Operator | One person | Admin password, Railway variables and redeploy, this runbook open |
| Observer | One person | Railway logs, filtering on `[war-event]` |
| Attacking Kage | A real player seated as Kage of village A | Enough War Resources for the declaration |
| Defending Kage | A real player seated as Kage of village B | Chooses the sector's win condition and terrain before the event |
| Fighters | At least two real players per village | Pets and a deck, for a Card or Pet sector |

Staff play on player accounts, never on admin sessions. An admin identity skips
the participant and authority checks that the event exists to exercise.
Announce the eligibility rule, the window and the low-turnout rule to players in
advance.

## Setup (the day before)

1. Confirm Railway runs **one replica**, the deployed commit is recorded, and a
   fresh database backup exists.
2. Pick the event label, for example `war-2026-10-03`. Set `WAR_EVENT_ID` to it
   on Railway. Every `[war-event]` log line then carries it.
3. Pick two contested sectors: one Combat sector, and one Card **or** Pet
   sector. The defending Kage sets their win condition and terrain now.
4. Write the event plan to a local file, `war-event-plan.json`. It stays on the
   operator's machine and is never committed:

   ```json
   {
     "attackerVillage": "Moonshadow Village",
     "defenderVillage": "Frostfang Village",
     "sectors": [27],
     "accounts": {
       "attackerKage": "<attacking Kage>",
       "defenderKage": "<defending Kage>",
       "attackerFighters": ["<fighter>", "<fighter>"],
       "defenderFighters": ["<fighter>", "<fighter>"]
     }
   }
   ```

5. Run the preflight against production. It is read-only, but reading
   production storage needs the production `.env` on the operator's machine:

   ```powershell
   node --import tsx scripts/war-event-preflight.ts --base-url=https://shinobijourney.com --expect-war=on --plan=war-event-plan.json --out=war-preflight-before.json
   ```

   Exit 0 means no blocker. Keep `war-preflight-before.json` as the "before"
   snapshot. It lists contests, points, receipt counts, tokens and the audit
   count. It also checks each planned sector and account, and it reports
   accounts by role ("attacker fighter 2"), never by name. Each blocker means:

   | Blocker | Meaning | Do |
   | --- | --- | --- |
   | `contest-row-unreadable` | A contest row cannot be parsed. Play skips it, but declarations and captures fail closed. | Stop. The owner authorizes a manual data fix. |
   | `wedged-battle` | A battle is bound to a sector it was not fought in. Its fighters cannot finish or claim until the token expires, about 48 hours. | Wait for expiry, or the owner authorizes a manual fix. |
   | `territory-owner-mismatch` | A contested sector is owned by someone other than the defender. | Stop. Find out why before any war runs there. |
   | `two-contests-on-sector`, `village-war-overlap` | An invariant is broken. | Stop. |
   | `kill-switch-mismatch`, `health`, `war-route-unreachable`, `capability-war-hidden` | The live switch is in the wrong position (players would not see the war map), or the site is down. | Fix `DISABLE_VILLAGE_WAR` and redeploy, then run the preflight again. |
   | `gameplay-mutations-paused` | `MAINTENANCE_MODE` or `FREEZE_ECONOMY_REWARDS` is set, so every declaration, battle and claim is refused. | Clear it and redeploy, or move the event. |
   | `plan-kage-not-seated`, `plan-account-missing`, `plan-account-village` | A planned account cannot play its role: the attacking Kage is not seated, the account does not exist, or it is in the other village. | Fix the plan or the accounts before the day. |
   | `plan-sector-invalid`, `plan-sector-owner`, `plan-siege-limit`, `plan-village-invalid`, `plan-village-at-war` | A planned declaration would be refused. | Pick another sector, or finish the other war first. |

   Warnings do not block, but read them: `plan-war-resources` (the attacking
   village may not afford the declaration), `plan-account-in-battle` (a fighter
   still has a battle in flight), `plan-too-few-fighters`,
   `plan-sector-contested`, `plan-sector-unconfigured`, `war-due-unsettled` (a
   war waits for its settlement; see "Settle now") and `capabilities-unreadable`
   (the preflight could not read what clients are told; check it by hand).

6. Record the rest of the "before" state that the preflight does not: each
   village's treasury and War Resources (`GET /api/admin/economy`, which also
   shows war economy telemetry) and each sector owner (the war map).
7. Confirm the operator can sign in to the admin panel and read
   `GET /api/admin/audit-log?domain=sector`.

## The staffed window (T+0 to about T+2 hours)

The observer follows `[war-event]` lines filtered by the event label. The
operator ticks each case and records its evidence: the log line, the battle id
and a screenshot where the case says so.

| # | Case | Do | Expected evidence |
| --- | --- | --- | --- |
| 1 | Declare | The attacking Kage declares on the Combat sector, then does it again. | One `contest-declared` line. The War Resources drop once. One Herald post. |
| 2 | Victory | An attacker beats a defender in world PvP in that sector. | One `battle-registered` line and one `battle-scored` line with `attackerWon: true`. The map shows the attacker's points. |
| 3 | Defeat | A defender wins a battle there. | A `battle-scored` line with `attackerWon: false`. The defender's points rise. |
| 4 | Draw | Two fighters end in a draw, if one can be arranged. | No `battle-scored` line, and no points for either side. |
| 5 | Reconnect | Mid-battle, one fighter closes the browser, reopens the game and finishes. Then both fighters open the result again. | One `battle-scored` line. Every later look is a replay (`battle-replayed` or no line). No points are added. |
| 6 | Walk-away | Mid-battle, one fighter closes the browser and stays away; the other keeps the battle open. The server passes the absent fighter's turns, and the fighter who stayed claims the forfeit win when it is offered. | One `battle-scored` line, written by the server's terminal step; the absent fighter's side settles without their browser. (If **both** walk away, the 10-minute lapse sweep records a draw: nothing scores, and both are free to fight again.) |
| 7 | Card or Pet | The same villages fight on the second sector's win condition. If the event runs long enough without a defender, the attacker also fights the garrison, and finishes it within the hour (see Garrison above). | `battle-scored` lines for that contest, with `garrison: true` for the garrison. |
| 8 | Double-tap | A fighter double-taps a Card or Pet action, or a garrison duel. | One score. The second answer is a replay, or "busy — try again" (503). |
| 9 | Cancel drill (optional) | Declare a third, throwaway contest and have the operator abandon it (below). | A `contest-abandoned` line with `actor: admin`. One `sector-war.abandon` audit entry. |
| 10 | Kill-switch drill (optional, last) | Set `DISABLE_VILLAGE_WAR=1`, redeploy, finish one bound battle, then unset the switch and redeploy. | War routes answer 404. A `pvp-resolution` line with `reason: war-disabled`. No points. The preflight with `--expect-war=off` passes, then with `--expect-war=on` passes again. |

Run the preflight again at the end of the window, without `--out`. The contest
points it reports must match the map.

## Settlement (T+72 hours)

The war settles on its own at the 03:00 UTC daily pass. Staff it anyway:

1. **Settle now.** Just after the deadline, settle every due war with one
   request from the operator's machine. Any staff account's own session works,
   or the admin header with any `playerName`:

   ```powershell
   Invoke-RestMethod -Method Post -Uri https://shinobijourney.com/api/village/sector-war -ContentType 'application/json' -Headers @{ 'x-admin-password' = $env:ADMIN_PASSWORD } -Body '{"action":"status","playerName":"ops"}'
   ```

   Opening the war map does **not** settle it. Neither does waiting, until a
   declaration somewhere or the 03:00 UTC pass.
2. Expected evidence: one `settled` line (`outcome: captured` or `defended`),
   one Herald post, and the territory owner matching the outcome. A failed pass
   logs `settlement-deferred`: `contended` is ordinary, and anything else goes to
   the lead. A war whose verdict landed but whose Herald or intel tail failed
   logs `reason: after-verdict` and is **not** retried. It is settled.
3. After the next 03:00 UTC pass, check that the new owner's War Resources
   accrual and the tax tier moved once, not twice (`GET /api/admin/economy`).

## Log lines (`[war-event]`)

One JSON object per line, filtered by `WAR_EVENT_ID` (`event`), `contestId`
or `battleId`. No line names a player.

| `kind` | When | Level |
| --- | --- | --- |
| `contest-declared` | A declaration was charged. | info |
| `battle-registered` | A battle was bound to a contest. | info |
| `battle-scored` | A battle scored, with its points and both totals. | info |
| `battle-replayed` | A replay of an already-scored battle. It counts the duplicate attempts for the report. | info |
| `battle-skipped` | A battle reached a contest that had ended (`superseded`, `terminal`). | info |
| `pvp-resolution` | A bound battle scored nothing (`superseded`), including `war-disabled`. | info or warn |
| `contest-abandoned` | A war was called off (`actor`: `admin` or `kage`). | info |
| `settled` | A war was settled. | info |
| `settlement-deferred` | A settlement pass failed (`contended`, `error`, `after-verdict`, `scan-failed`). | warn or error |
| `contest-row-unreadable` | A scan skipped an unreadable contest row. | error |

## Rollback, correction and player unblock

Use only the supported controls below. **Never** delete receipts, tokens or
contest rows, and never run SQL against production during the event.

| Situation | Supported action | What it does, and what it does not |
| --- | --- | --- |
| War scoring must stop now | Set `DISABLE_VILLAGE_WAR=1` and redeploy. | Every sector-war route answers 404, and mercenaries, the daily war pass, taxes and seeding stop. World PvP no longer binds or scores (fixed 2026-09-25). Settlement pauses too: the `status` action and the daily pass are both off. Recorded scores stay, and due wars settle after the switch is removed. The **abandon** below also answers 404 while the switch is set, so cancel a contest before switching the war off. The all-out village war is not stopped by this switch. |
| An economy exploit | Set `FREEZE_ECONOMY_REWARDS=1` and redeploy. | Rejects **every** player POST, war routes included, so it also blocks the admin abandon below. Abandon first, then freeze. `/api/admin/*` stays reachable. |
| A live contest went wrong (bad scores, a dispute) | Cancel it: `POST /api/village/sector-war` with `{"action":"abandon","playerName":"ops","sector":<n>}` and the `x-admin-password` header. | The defender holds and the attacker gets the 24-hour cooldown. The War Resources are **not** refunded. It is logged and audited (`sector-war.abandon`). No tool reverses a single battle. |
| A settled capture was wrong | Restore the owner recorded in `war-preflight-before.json`: `POST /api/world-state` with `{"kind":"territory","territory":{...}}` as admin. | It is audited (`territory.admin-write`, with the owner before and after). It is refused while a contest still binds the sector. It does not restore the clan that lost the sector, which must claim it again. |
| A player cannot start PvP ("already in a battle") | Have them reload the game. The client reconnects to the server's battle, which they can finish or let time out. The 10-minute lapse sweep ends a battle nobody returns to. | This covers ordinary disconnects. If the same battle id keeps failing in the logs, run the preflight. A `wedged-battle` clears only when its token expires (about 48 hours), and no admin endpoint clears it sooner. Tell the player, and escalate to the lead for a manual fix. |
| An application bug | Roll back the Railway deployment. | Only if the previous build reads the same data. Otherwise switch the war off and fix forward. |

Restoring data from the backup needs the owner's explicit authorization and the
backup and restore runbook.

## Low-turnout rule

Announce the threshold before the event, for example at least three fighters
per village. If turnout falls below it, the operator cancels the contests before
they settle. If one already settled, the operator restores the pre-event owners
with the audited territory write. One thin test must never leave a village
permanently ahead on taxes, supply or access.

## Cleanup

1. Decide whether the war stays on. Issue #9 recommends `DISABLE_VILLAGE_WAR=1`
   outside staffed windows. If it goes off, set it, redeploy and run the
   preflight with `--expect-war=off`.
2. Unset `WAR_EVENT_ID`.
3. Save `war-preflight-after.json` with `--out`, and export the event's
   `[war-event]` lines and `audit:sector` entries.

## Post-event report (closes issue #9)

Attach the before and after preflight files, the case table with its evidence,
and:

- participants per village, and the contests declared, settled and cancelled;
- battles scored and duplicate attempts (the count of `battle-replayed` lines);
- War Resources and treasury before and after, and the ownership changes;
- disputes, corrections (from `audit:sector`) and incidents;
- a go or no-go for the next event.
