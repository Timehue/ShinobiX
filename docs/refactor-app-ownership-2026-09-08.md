# App ownership refactor — 2026-09-08

App now delegates boot snapshot application and save coordination through explicit module interfaces. Screen composition remains in App. From the original clean-build baseline, it falls from 6,939 to 6,573 physical lines; its ratchet is 6,578.

`use-player-save-state` owns 21 native saved-state fields and the original ordered hydration sequence. `boot-battle-recovery` classifies restore paths in their original priority order, retaining lazy reads, session epochs and battle-resume decisions. The earlier boot request and account-scope extractions remain the entry boundaries.

`player-save-coordinator` owns the existing per-mount version, flight and persistence objects. It keeps one active write coordinator, the original dirty/captured-write checks, immediate flush and debounce behavior, retries, and account-switch fences. The lifecycle hooks retain effect registration order and guarded clocks. Five moved coordinator function bodies match the baseline. Thirty-six focused behavior cases cover snapshot application, recovery, coordination and the separately fixed starter-response race.

The starter grant fix is isolated in `c81c2a30c`: a valid older response can complete the committed starter grant without installing a stale character. Both normal and delayed-response Academy journeys pass against built Express, including refresh and logout/login. The browser fixture observes saves through the read-only admin path so polling does not advance the player's save version.

The final import cleanup (`496bcc4bd`) moves shared level and discipline projections, save serialization, and mutable Hollow Gate price bindings into dedicated modules. All ten declarations and the retained App function body match the prior source. Price setters and values share one module lifetime and keep live ES module bindings. No formula, default, authorization, or storage contract changes.

Consumers now import shared values from their canonical owners. App retains its compatibility exports, including the narrative-normalizing `normalizeCharacter` alias. The architecture gate now covers screens, components and features as well as lib, data, constants and types. Import rewiring preserves every consumer's non-import statements. Four new behavior tests cover retired XP, exam holds, injured vitals, discipline fallbacks and nested image serialization.

Pet ID and element keys also have a pure owner (`96d1df116`). Pet move and gauntlet logic no longer reach through the art-resolution module for these keys; the previous exports remain compatible. Existing art, move and gauntlet coverage passes all 101 focused cases.

The complete unit and contract suite passes 9,700 tests. Lint passes with zero errors and ten existing warnings. The completion audit records the final build, startup measurements and browser gates.

Local evidence: `.tmp/refactor-screens/app-import-parity.json`, `app-final-consumer-parity.json`, `app-final-export-parity.json`, `app-shared-values-tests.log`, `final-ratchets.log`, `roadmap-final-unit.log` and `roadmap-final-lint.log`.
