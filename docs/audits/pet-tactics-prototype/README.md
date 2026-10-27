# Pet Arena local acceptance evidence

This directory contains automated local evidence, not human playtesting or
production telemetry. The QA server uses signed local Alice/Bob accounts and
isolated memory storage with the production command/queue/settlement handlers.

## Current interface (real companions on the Coliseum engine, 2026-10-26)

`shinobij.client/scripts/verify-pet-tactics.mjs` drives Alice (desktop) and Bob
(phone width) through a whole match. Each seat brings four of its own carried
companions, and orders go through the Coliseum battle's own console. The two
runs recorded on 2026-10-26 were:

- **Sparring** (no `ranked-` prefix; `browser-report.json`): the room used the
  `showdown-v1` engine, and both seats brought four of their own companions.
  - Enemy leads stayed private until both seats locked.
  - After one seat locked its orders and reloaded, its locked orders survived.
  - The match ran 17 committed two-player rounds and ended in a knockout win.
- **Ranked** (`ranked-` prefix; `ranked-browser-report.json`): the same checks,
  plus three more.
  - Ranked search could be cancelled and rejoined.
  - Rating settled exactly once per player: Alice/Bob ended at 1012/988 Elo
    with one receipt each.
  - Both saves kept their 500 ryo and all five pets.
- No browser errors or failed assets were reported in either run.

The captures from these runs:

- `*squad-builder-*.png`: the companion picker. It shows each carried pet with
  its real level.
- `*preview-*.png`: the opposing squad and the opening-pair choice.
- `*battle-*.png`: round-one planning in the Coliseum console.
- `*result-desktop.png`: the recorded result.

## Earlier Pet Tactics checks (history)

The level-50 Pet Tactics deck that the captures below describe was retired on
2026-10-26. Its own screenshots have been replaced or removed.

- `balance-report.json`: 960 deterministic heuristic policy comparisons and
  480 unprepared damage-signature probes. No unprepared full-health signature KO
  was observed; earliest signature was round four. The repeating squads and
  correlated seeds do not certify species balance or a competitive meta.
- `matchup-report.json`: 12,528 broader randomized, paired-seat, mirror and
  controlled lead-substitution matches; 24,192 signature probes across legal
  allocation extremes and setup/Guard states. Source hashes and limitations are
  included. Interpretation and remaining watch items are in
  [the integration/balance review](review-2026-10-10.md).

Earlier integration/regression suites passed 137 tests; the camera/playback/
HUD/timer/postprocessing selection passed another 25. The final combined run
for that checkpoint passed all 162 with no failures. The current integration,
balance-semantics, navigation and presentation selection passes 256 tests.
Build commands and release
gates are documented in the prototype specification.
The resource-card refinement reran all 25 presentation regressions successfully.
The earlier local build and packaged-asset checks passed at 9,349,516 bytes
against the then-current 9,350,000-byte total product ceiling. That checkpoint
did not use the full production build arguments. The subsequent live-main
integration uses the production-image workflow's public test settings; its
measured allowance and current release evidence are recorded in
[the main integration notes](main-integration-2026-10-10.md). Startup and
individual chunk limits remain unchanged. No human playtest is claimed.
