# Dungeon, Hollow Gate and roaming-boss behavior — 2026-10-19

## Scope and expected flow

Check entry, combat ownership, recovery, settlement and the destination after a
fight. This extends the narrative fight-flow audit to key/free dungeons, Hollow
Gate shinobi and pet encounters, roaming Weekly Bosses and team world-boss raids.

## Findings

- **Matches expected behavior — dungeons:** the saved run determines the seal.
  The Warden uses its server-resolved profile and run token. The dungeon scene
  unmounts during combat, and Escape cannot abandon the run beneath it. A win
  advances only after its proof is saved; reloading reopens the Chronicle seal.
  Leaving or claiming returns key entries to Central and discovered entries to
  the World Map. A failed reward claim retains the completed run across reload;
  a double click grants only one clear reward and closes that run.
- **Matches expected behavior — dungeon failures:** authoritative checks cover
  key-run rematches, free-run loss/forfeit/draw cleanup, stale run tokens, an
  already-abandoned run, all three seal proofs and idempotent reward delivery.
- **Matches expected behavior — Hollow Gate:** the real shrine opens both
  combat modes. Reload recovers the same shinobi run or pet Showdown session,
  including the saved floor, position and chosen augment. A failed shinobi
  settlement exposes Retry and withholds Continue. Confirmed defeat awards no
  win reward, removes the fight and follows the saved survival/admission result.
  The tested ordinary defeat goes to Hospital. A pet forfeit settles as an
  unpaid pet defeat while preserving the correct exploration state.
- **Matches expected behavior — roaming Weekly Boss:** Stand & Fight starts the
  accepted authoritative encounter. Ending it returns the player to its launch
  sector. Payout checks cover a live award, an allocated but pending award after
  event expiry and an already-delivered receipt. Recovery checks verify that
  resume cannot create or charge a second attempt, and settlement replays do
  not debit or bank damage again.
- **Matches expected behavior — team world boss:** entering from the map opens
  the raid; leaving an active view preserves it and returns to its queue. A
  completed raid waits for its contribution receipt before enabling return.
  A positive shared-health receipt says the boss still lives; only zero shared
  health announces world victory. Survivors return to the queue, then the map.
  For a knocked-out raider, the App's hospital navigation guard takes precedence
  once the saved admission arrives. A receipt outage keeps the result retryable.
  Handler integration separately covers shared damage, a wiped team, per-player
  HP, consumed items and settlement after an interrupted final write.
- **Validation gap closed:** added mounted-App dungeon completion/claim checks,
  team-raid result and hospitalization checks, and a real Express Hollow Gate
  shinobi reload/settlement journey. No production game code needed changing.

## Method and limits

Mounted-App tests use the actual screens, combat hosts and navigation. Dungeon
combat uses the actual encounter builder and action engine with a controlled
last hit; its claim uses `mutateDungeonRun`. Team-raid UI checks supply terminal
server projections and controlled receipt failures. These isolate transitions
and rewards; they do not measure combat balance. Independent handler integration
tests cover the actual authoritative settlement rules.

The Hollow Gate and roaming Weekly Boss journeys use a real local Express server
and isolated test characters. They enter through the game UI, reload actual
saved fights and end fights through the authoritative action endpoint. They are
targeted lifecycle checks, not complete dungeon or Hollow Gate playthroughs.

Two initial expectations were corrected in the tests: a rolled Hollow Gate
augment can legitimately disable retreat, so the reload test uses Wait; and a
hospitalized team raider is automatically routed to Hospital instead of needing
a result-screen Hospital button. A single failed request can recover through
automatic retries, so outage tests hold the failure until explicitly released.

## Evidence

- Focused lifecycle/settlement tests: **99 passed, no failures or skips**;
  `.tmp/dungeon-gate-boss-regressions.log`.
- Real Express desktop/phone journeys: **8 passed**;
  `.tmp/dungeon-gate-boss-live-final.log`.
- Mounted-App desktop/phone checks: **28 passed, 2 intentionally skipped**
  (the existing map-tip cases only run at phone widths);
  `.tmp/dungeon-boss-behavior-browser-final.log`.
- Full frontend lint: **passed, 0 errors and 23 existing warnings**;
  `.tmp/dungeon-gate-boss-full-lint.log`. The three changed browser specs also
  passed targeted ESLint without warnings.

Browser specs: `e2e/dungeon-behavior.spec.ts`,
`e2e/dungeon-presentation.spec.ts`, `e2e/gear-weekly-boss-delivery.spec.ts`,
`e2e/world-boss-tip-occlusion.spec.ts`,
`e2e-live/hollow-gate-pet-duel-express.spec.ts`, and the Stand & Fight case in
`e2e-live/mmorpg-behaviors-express.spec.ts`. Screenshots are saved under
`shinobij.client/test-results/dungeon-gate-boss-behavior/` and `live-express/`.
Representative phone dungeon next-seal and Hollow Gate Hospital screens, plus
the team-raid receipt with remaining shared health, were visually inspected.
The final browser runs total **36 passes, 2 intended skips and zero failures**.
