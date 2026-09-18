# Visual-novel wiring follow-up — 2026-09-18

This follows the [reader/layout pass](vn-reader-layout-pass.md), which covered 341 event/replay variants, 1,225 shipped pages and 2,522 browser layout cases. This follow-up checks navigation, avatar propagation, dungeon identity recovery and battle-result timing. It does not repeat the full layout sweep; no production layout or art changed during this follow-up.

## Fixed

- **Repeated Back and resume:** Back previously removed a history entry, then a second state update restored the old history. The reader now updates the cursor and shortened history together, including the saved progress callback. This applies to cinematic and Classic readers.
- **Chronicle and Rare Beast results:** authoritative proof adoption could advance the parent dungeon before its battle result finished. The active battle host now remains mounted for its captured run token until the player exits it. Chronicle Continue opens the next seal at line one; Rare Beast exit exposes the proof-backed reward claim.
- **Replay avatars:** App now forwards the current shared image store through Story Hall/StoryJourney and Echoes of War to the reader. These routes previously could use an older character avatar. Archive page art is not overlaid by compacted page index, which would attach artwork to the wrong replay page.
- **Dungeon identity across refresh:** new key-start runs record a validated cosmetic presentation ID. The API route, lazy client adapter, start request, active-run type, recovery effect and event resolver all carry it. All five crafted themes recover their own event; published edits retain precedence. Starting through another dungeon button cannot retheme an existing run or consume another key. Warden, Chronicle and Rare Beast settlements preserve that identity. Free discoveries retain the hidden-dungeon identity; proof, key and reward requirements are unchanged.
- **Deferred Warden launch:** after portrait verification, the launcher checks the current character, run token and screen before starting the fight. Leaving the dungeon while art loads cannot reopen that stale encounter.

## Verified

- **43 regression tests passed:** dungeon start/settlement authority, identity persistence through all three proofs, all five crafted-theme recovery paths, invalid/legacy fallbacks, request serialization, pet authority, combat-art identity, reader routing, shared-avatar propagation, action gating and World Map system-event handoffs.
- **Five browser behavior scenarios passed:** repeated Back with serialized resume; Back across page boundaries; real Chronicle component proof/result/Continue sequence; Rare Beast proof/result/exit sequence; Classic/cinematic cursor parity. The Rare Beast check replaces only its 3D renderer with a controllable fixture while retaining the real dungeon host, authority adapter and result callbacks. All API responses are intercepted locally; no production account is modified.
- **Nine dungeon interaction checks passed again**, covering the explicit seal actions, dialogue navigation and art/avatar inputs from the prior layout pass.
- The complete client TypeScript build passed using its pinned compiler. Focused ESLint and scoped whitespace checks passed.
- The routing regression still finds only one legacy VN renderer: the deliberately selectable Classic preference. Every shipped catalog page defaults to cinematic presentation.

Browser evidence: `tmp/vn-wiring-pass/report.json`, `card-result-before-continue.png`, `next-seal-first-line.png`, and `pet-result-before-exit.png`. Reproduction script: `shinobij.client/scripts/vn-wiring-qa.mts` (requires the local VN QA server and the inventory from the prior layout pass).

## Cleanup and limits

The prior pass removed the duplicate dungeon reader markup and its unused `relic-dungeons.css`. The shared Classic preference remains intentional. No additional obsolete default reader was found.

Older saved runs never recorded a presentation ID. Their current in-memory selection is preserved when available; after a fresh load without that selection they use the hidden-dungeon fallback. The original theme cannot be reconstructed from absent metadata. Newly started runs retain it across refresh.

Private/unpublished creator content is outside the shipped catalog; its shared reader route is covered. These fixes are local and have not been deployed. Production image cleanup candidates were not purged as part of this follow-up.
