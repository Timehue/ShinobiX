# Pet battles, tournaments and village war behavior — 2026-10-19

## Findings and changes

- **Pet battle recovery discarded unconfirmed sessions.** A failed state read
  looked like expiry; a lost terminal receipt could also remove the recovery
  pointer before the result was adopted. Recovery now distinguishes confirmed
  expiry from an outage, retains the pointer during failures, offers retry, and
  recovers both victory and defeat receipts. Versioned character updates protect
  newer saves. Resumed bouts restore their format and use the appropriate paid
  or practice door. Road challenges return to the world map.
- **Concessions closed the client before server confirmation.** Ordinary pet
  bouts now wait for acknowledgment, retain their battle and pointer on failure,
  and let the player retry. A stale concession cannot delete an already-won
  session. Recovery claims that win instead of discarding it.
  Screenshot review also caught the mobile command deck covering the concession
  dialog. The deck now closes while that dialog is open and reappears when the
  player chooses “Keep fighting.” A real pointer hit check guards the buttons.
- **Some defenders watched their opponent's perspective.** Casual challenges,
  pet tournaments, sector war, village campaign and clan war now project the
  sealed replay from the participant's own seat. Their own roster, HP, actions,
  bench and victory/defeat are aligned. The canonical simulation, scored winner
  and awards are unchanged. Ranked already mirrored correctly; it now shares
  the same exhaustive projection helper.
- **Gauntlet completion could remain on “Tallying the result…” indefinitely.**
  Terminal reports now survive navigation/re-entry and expose retry. Opening a
  pending result does not start or charge another run. The server keeps the
  existing unpaid seal when leaderboard delivery fails, and delivers that score
  before payout retires the seal. Retries use the existing save receipt to avoid
  another payout. A lost completed reply recovers the
  original reward amounts and current versioned character. Historical receipts
  have no score/rank, so recovery explicitly says “Saved reward receipt
  recovered” instead of inventing those values. Confirmed expired reports can
  be dismissed. Offline practice completion identifies itself as unrewarded.
  A save conflict keeps its retry pointer and cannot masquerade as expiry.
  Admission retries also keep one request ID: the existing run seal publishes
  atomically with the entry counter, fee and currency ledger, so repeated or
  interrupted requests recover the same seed without charging another entry.
  This uses the existing save/seal rows and does not change database layout.
- **Replay return controls now name their destinations.** Tournament replays
  say “Back to tournament.” War replays name the appropriate result or war
  return, matching their actual callback.

## Routes and authority reviewed

| Mode | Fight/result authority | Return behavior |
| --- | --- | --- |
| Training / paid pet Colosseum | Server Showdown session and terminal receipt | Same lobby; road beasts return to world map |
| Casual pet challenge / ranked pets | Sealed duel or live server tactical session, mode-owned settlement | Pet Arena / ranked queue |
| Gauntlet | Server replays the decision transcript; existing save receipt pays once | Gauntlet result in Pet Arena; another run waits for confirmation |
| Human tournaments | Tournament-owned match lease and private settlement | Bracket board in Arena District |
| Pet tournaments | Server-scored sealed replay | Bracket board |
| Village combat strongholds | Sealed Solo PvE / live PvP and campaign-owned resolution | War objective panel and refreshed state |
| Village card strongholds | Campaign-owned card session and result | War objective panel |
| Village pet strongholds | Server-decided sealed pet replay | War objective panel |
| Sector garrison / pet / card war tables | Mode-owned sessions, recorded contest generation and receipts | War map; open-world pet challenges return to world map |
| Shrine conflicts | Physical room/presence and server-scored bouts | Shrine/war room and world location |

The shared fight renderers do not award Tower floors or Tower rewards for these
operations. Human tournaments deliberately use the shared PvP combat engine;
their admissions, settlement and return remain tournament-owned.

## Verification

- Final built-game recovery/admission journeys: **14 passed** across desktop
  and phone; `.tmp/pet-tournament-war-recovery-complete.log`. These include a
  persistent state outage, failed concession, restored command controls,
  victory/defeat receipt recovery, road return, paid/practice door correction,
  3v3 rematch, pending Gauntlet report and paid entry recovery with an empty wallet.
- Real tournament journeys: **7 passed**; `.tmp/pet-tournament-war-tournament-confirmed.log`.
  Both pet participants' verdicts agree with the scored champion, and the exit
  returns each to a usable bracket. Standard, ranked and paired formats also
  exercise admission, reconnect and terminal return.
- Real clan/sector war journeys: **6 passed, 4 intentional viewport skips**;
  `.tmp/pet-tournament-war-live-final.log`. A final sector-war run on the final
  server/client also passed: **3 passed, 3 intentional viewport skips**;
  `.tmp/pet-tournament-war-release-live.log`.
- Focused entry, payout, shared atomic writer and client recovery regressions:
  **30 passed**; `.tmp/pet-tournament-war-entry-final-unit.log`. The positive
  payout case uses five real simulated battles and confirms a saved **500 Ryo**
  reward is recovered without paying again.
- The village campaign/field/shrine source-browser cases passed across desktop
  and phone during the initial audit. Their fixtures exercise physical entry,
  specialty objectives, defenses, timers, scoring caps and physical return.
- Final server/client builds, distribution verification and size checks passed.
  Product JS/CSS is **9,575,636 bytes**. The aggregate ceiling increased by
  10 KB for the intentional recovery UI/code; startup, per-chunk and asset gates
  remain unchanged.
- Full frontend lint passed: **0 errors**, with 23 existing preview/fixture
  fast-refresh warnings; `.tmp/pet-tournament-war-lint-confirmed.log`.
- Screenshots visually reviewed: both tournament pet verdicts, mobile concession
  failure and its unobstructed controls, recovered Gauntlet rewards, and the
  restored paid-entry draft screen with its wallet at zero. The screenshots are
  under `shinobij.client/test-results/pet-tournament-war-recovery-complete/` and
  `shinobij.client/test-results/pet-tournament-war-tournament-confirmed/`.

- Full auto-discovered Node suite on the final implementation: **16,220 passed,
  28 expected skips, 0 failures**; `.tmp/pet-tournament-war-full-node-final.log`.
  The original unrestricted run hit local Windows worker-launch failures.
  The final run used the same discovery/runner with concurrency limited to four.

- Strict combat layout on the final build: **20 passed, 10 intentional skips**
  across Chromium/DPR, Firefox and WebKit; `.tmp/pet-tournament-war-release-layout.log`.

- Full built-browser smoke completed all **3,744 configured cases** across seven
  desktop, phone and tablet projects: **2,741 passed, 1,002 skipped, 1 failed**;
  `.tmp/pet-tournament-war-release-smoke.log`. The sole failure was a Firefox
  browser-context teardown timeout after an Academy-layering case's intentional
  project skip, with Firefox SWGL/cleanup errors. No game assertion failed.
  Its isolated rerun against the same frozen build returned **1 expected skip**;
  `.tmp/pet-tournament-war-firefox-retry.log`. The full run itself is recorded
  as having that infrastructure failure, rather than relabeled as a clean run.

The immutable test preview and temporary runner/configuration files were removed
after the checks; logs and screenshots remain available locally.

These are local isolated checks. Real-handler tests exercise admission, sealed
teams, scoring and idempotency. Browser checks exercise the production hosts and
controls; selected terminal presentations use shortened authoritative scripts
or controlled completed-state fixtures to test recovery and navigation without
playing every combat turn manually. This is not a production-account playthrough.
