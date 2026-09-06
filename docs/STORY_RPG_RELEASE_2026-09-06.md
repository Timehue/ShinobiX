# Story and RPG integration

This document records the integrated changes and local validation performed against latest-main base `d5d596b5`.

## Player-facing changes

- Village campaigns now retain immutable choices, resumable scene position, optional reports, and the earned finale epilogue. Story Hall resume and review preserve earned choice history.
- Four companion field stories add server-recorded travel and action routes, abandon/retry support, return scenes, route-specific aftermaths, and read-only journal history. Existing campaign rewards and progression gates are unchanged.
- First Pact remembers the exact companions present at the accepted vow, including their names at that moment. Optional district inspections and return visits reflect only recorded results and currently available companions.
- Echoes of War adds one durable witness record at each Age close. Later Shiranui and Halden scenes acknowledge those sealed answers, while first-clear combat reactions use only server-recorded Chronicle events and fall back neutrally when old saves lack that evidence.

## Integration and authority

The integration preserves current main's combat, save, account, and loading behavior while adding the reviewed narrative state. Choice history, scene cursors, reports, epilogues, field routes, First Pact records, Echoes witness answers, and first-clear beats have explicit ownership, bounded normalization, replay behavior, and old-save fallbacks. Rewards and progression remain server-authoritative.

Several merge-boundary defects were corrected:

- First Pact cleanup now follows the same lock as mutations, so deletion/reset cleanup waits for an in-flight write and removes its final record. Failed completion saves remain retryable, and a scene closes only after its authoritative character snapshot is accepted.
- Echoes blocks global story delivery for the whole campaign screen, preventing a delayed epilogue or rift aftermath from replacing an internal match. Same-account snapshot adoption monotonically preserves cosmetic `echoesStorySeen` flags; those flags never cross account boundaries.
- Chronicle toolbar input stops at the control boundary, so opening the journal cannot also queue world-map movement and carry the player away from a nearby story contact.
- Generated story loaders and contracts include village, epilogue, field, and Echoes payloads without replacing current-main groups or relaxing their size checks.

## Known limits

- Exact field-tile presentation is client-side. The server verifies the ordered action, sector, live presence, travel state, and battle state; it does not attest to a rendered map coordinate.
- A First Pact request authorized before account deletion can still enter its lock after cleanup and recreate the standalone record. This preauthorized/not-yet-locked race remains documented.
- A full admin can manually grant the registered `Pactbound` title before Pact completion. The existing title-based payout marker then treats that character as already paid. Repair needs an explicit migration policy so legitimate historical payouts are not duplicated.
- First Pact state lives in the separate `first-pact:<player>` record. Normal player snapshot/restore covers `save:<player>` and does not independently restore that Pact record; provider/database backup coverage must be verified operationally.
- Authenticated production deep-health and backup-freshness evidence is pending because the live deep-health token is unavailable in this workspace.

## Local validation

- Latest-main base `d5d596b5`: **CLEAN** at integration start
- Handoff parity: **PASS**, clean
- Root and client dependency audits: **PASS**, 0 high or critical npm advisories
- CI-environment production build: **PASS**; initial graph 384,662 B gzip / 385,000 B cap; product JS/CSS 8,153,659 B / 8,200,000 B cap
- Whole-client lint: **PASS**, 0 errors and 10 pre-existing warnings
- Local fresh-account journeys: **PASS**, 90/90
- Local 24-player soak: **PASS**, 176 calls and 0 errors
- Generated-content parity and drift check: **PASS**
- Focused narrative, ownership, retry, and lifecycle tests: **PASS**
- Full unit suite at the integration freeze: **PASS**, 9,385/9,385 tests; 0 failures or skips
- Desktop/mobile narrative journeys: **PASS** across all 24 cases. The affected Field and Echoes specs passed their final 10-case rerun after the display corrections; First Pact and the other 14 cases passed the preceding run.
- Full browser matrix: the local responsive run was stopped during WebKit under measured 100% CPU contention. The strict local matrix finished with 18 passes, 10 intentional skips, and 2 WebKit timing failures. Full responsive and strict-matrix results are supplied by the release commit's CI checks on isolated runners.


## Final display corrections

Opening or advancing a field replay now resets the reader's owned scroll position, so its heading remains visible without disturbing manual scrolling within a page. Echoes resets the witness view only when it opens or discovers a sealed answer. Sage whispers use an explicit responsive card width and reserve room above both mobile navigation and the context Tip button. Desktop/mobile browser assertions cover heading containment, witness reload, whisper width, and separation from both controls.

The Echoes browser helper now accepts a reader that closes on its 24th and final permitted action. Its action cap and all story assertions remain intact.

These isolated reader/notice corrections followed the full unit run and were verified with scoped lint, a fresh production client build, and the affected desktop/mobile browser journeys. The server artifact and narrative payloads are unchanged by them. Production publication and exact-revision health results are recorded separately from this local validation record.
