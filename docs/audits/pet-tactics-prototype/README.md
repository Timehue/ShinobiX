# Pet Arena local acceptance evidence

This directory contains automated local evidence, not human playtesting or
production telemetry. The QA server uses signed local Alice/Bob accounts and
isolated memory storage with the production command/queue/settlement handlers.

## Current interface

- `ranked-battle-desktop.png` and `ranked-battle-mobile.png`: initial planning.
- `ranked-battle-selected-desktop.png` and
  `ranked-battle-selected-mobile.png`: two local orders and selected targeting.
- `ranked-command-preview-report.json`: integrated resource-card preview;
  keyboard selection, draft privacy, Escape dismissal and pinned mobile controls
  passed, alongside the arena/menu boundary and removal of duplicate friendly
  plates, with no browser errors or failed assets. This preview deliberately
  ends before submitting either player's orders and does not claim a match.

The current captures use `command-ink-v2.webp`. The rejected ornate background
has been removed from the project and runtime references. The generator's
original output remains outside the project; see the shipping asset README for
the final prompt and provenance.

## Full ranked and balance checks

- `ranked-browser-report.json`: 14 committed two-player rounds, knockout win,
  sealed-order reconnect recovery and exact-once two-player rating settlement.
  Alice/Bob ended at 1012/988 Elo, one receipt each, save version two, with owned
  pets and currency preserved. No browser errors or failed assets were reported.
  This full match includes the integrated friendly HP/energy cards, direct
  arena/menu boundary, restored playback HUD and resource updates after a round.
  The latest lifecycle check also covers search cancellation, parent battle and
  fullscreen flags, and both participants returning to their builder.
- `ranked-battle-resource-update-desktop.png`: second-round planning with server
  HP and energy changes reflected in both left pet cards.
- `ranked-result-desktop.png`: the full match's recorded result.
- `ranked-squad-builder-*.png`: the equal-access 12-species builder.
- `balance-report.json`: 960 deterministic heuristic policy comparisons and
  480 unprepared damage-signature probes. No unprepared full-health signature KO
  was observed; earliest signature was round four. The repeating squads and
  correlated seeds do not certify species balance or a competitive meta.
- `matchup-report.json`: 12,528 broader randomized, paired-seat, mirror and
  controlled lead-substitution matches; 24,192 signature probes across legal
  allocation extremes and setup/Guard states. Source hashes and limitations are
  included. Interpretation and remaining watch items are in
  [the integration/balance review](review-2026-10-10.md).

`browser-report.json` and files without the `ranked-` prefix are the earlier
unrated prototype checkpoint (21 rounds, knockout draw). Their older interface
captures are historical evidence, not the current visual acceptance captures.

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
