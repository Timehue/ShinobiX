# Beastbound Warfront improvements

## Combat and positioning

Warfront retains actual earned pet stats. Speed now changes traversal and attack cadence, defense continues mitigating above the old cap, and support potency scales with the caster's trained health and move power. The stronger cinematic elemental multiplier is disabled for formation combat so it cannot overwhelm growth and placement. These changes are confined to Warfront's grid combat and mirrored in server authority.

Committed front/rear positions decide opening exposure and firing lanes. Each team's flanker follows its own chosen side. Healers require an ally within three cells and a clear line of sight. The deployment screen explains trained stats and shows pet levels.

The 60-roster audit found a 48.3% blue-seat win rate for mirrored bands, 21.4-second median clashes, and different winners in 46.7% of the deployment comparisons. A +25% HP/+20% attack band won all 60 sampled matches; this is a measured balance limitation, not a claim that positioning overcomes every stat gap. See [combat evidence](beastbound-warfront-combat-2026-09-09.md).

## Ranked and old modes

The former Pet Tactical ranked entry now launches Beastbound Warfront. It remains an asynchronous offline ladder: four saved pets and their ten-cell formation defend while the player is away. Challenges resolve server-side as best-of-three clashes, and the client replays both sealed plans. Both sides hold their saved deployment throughout ranked matches.

Existing ranking records, defense records, challenge limits and notifications keep their storage identity. Legacy defenses receive a default formation. Legacy role fallbacks and subroles survive server/client reconstruction. Unsaved lineup/formation edits block challenges, and stale clients must refresh before challenging under the new rules.

Ranked cards, artwork, leaderboards, tutorial copy and the runtime registry now identify the current mode. The old lane viewer is removed from production ranked navigation, standalone Tactical is marked retired, and old Warfront preview links route to the current formation mode.

## Moves, models and performance

Lightning uses branching yellow strikes and physical moves use neutral impacts instead of falling through to Water. Wind travel has a filled crescent and clearer tracer. Existing effect and particle limits remain enforced.

Tempest Hawk's model passed the geometry audit. The instability came from presentation: hit-stop could rewind its animation clock, frame inputs reached the mixer late, attack facing changed too rapidly, and body deformation stacked over its wing animation. The revised playback keeps a monotonic rig clock, latched attack heading and smaller eased avian reactions. Nineteen models were checked across 741 poses.

Simulation runs in a bounded worker that terminates after each result, failure or exit. Loading and rematch errors expose retry controls. Deployment warms the exact atlas set with three concurrent decodes; an LRU retains at most 20 decoded images. Hidden tabs suspend paint and playback work. Canvas backing stores release on cleanup. WebGL retirement explicitly releases renderer, texture and geometry bindings while preserving reusable CPU model source data.

## Verification

- 126 focused combat, ranked replay, settlement, formation, VFX, cache, playback and renderer-disposal regression tests passed.
- Existing shared cinematic tests and client/server generated-parity tests passed.
- Client and server TypeScript checks passed; changed runtime files lint without errors.
- The production client build succeeded, including the separate Rite worker bundle.
- Nine focused browser checks passed, covering simulation failure/retry, pending-work cancellation on exit, a complete spectator match, deployment/scouting, pet movement, occupied-cell protection, actual damage, explicit rematch locking and phone deployment layout. Nine duplicate/device-inapplicable cases were skipped by their existing project guards.
- The real ranked ladder and Arena District cards were checked at 1440, 390 and 320 pixels. Formation movement, occupied-cell swapping, unsaved/busy/partial-team locks and submitted plans/ruleset were verified, with no horizontal overflow or browser errors. The narrow-phone hero now reserves room for the wrapped title below its badge; bounding-box checks verify they do not overlap. Screenshots and results are under `output/warfront-ladder-qa/`.
- Production bundle size gates passed. The Warfront ladder no longer eagerly imports the Colosseum queue and its battle renderer.
- Reproducible browser resource audit: `node scripts/warfront-lifecycle-audit.mjs http://127.0.0.1:5180 --canvas` or `--3d` against the optimized local QA preview.

Browser resource reports are in `warfront-canvas-lifecycle-audit.json` and `warfront-3d-lifecycle-audit.json`. Measurements are local browser samples and do not establish long-duration behavior across all devices.

The optimized four-cycle test used an RTX 3080 browser. After the WebGL fix, every closed 3D match returned to 229 DOM nodes and 319 listeners, with zero workers, canvases or live WebGL contexts. Before the fix, closed nodes climbed from 229 to 679 and five listeners accumulated per match. Shared model data and JIT warm-up retained about 11.7–12.8 MB of JS heap during the short test; the measured per-match DOM accumulation stopped.

The Canvas path returned to 58 nodes and 309 listeners after every close, with zero workers or canvases. With the roster warmed on the deployment screen, lock-to-ready was 230–428 ms. The 3D canary took 4.3–5.3 seconds including its deliberate hardware validation window; this pass does not claim sub-second 3D cold loading.

## Follow-up integration audit

The follow-up traced the actual ranked card and mounted API through saved defense, opponent offer, scoring, sealed replay and return to standings. It found and corrected further cross-system gaps:

- Ranked commits re-check rank eligibility, rematch exclusion and daily quota inside the lock. A stale offer no longer produces a phantom successful replay. Defense updates fail closed under contention, and optional notification failures no longer hide committed results.
- Standings retain players beyond rank 1,000. The viewer's record travels separately from the bounded public list, and the UI identifies their row by rank. Account changes discard earlier drafts/results; late requests cannot populate the next account's screen.
- Ranked snapshots retain model, evolution and palette identity. Older defenses recover missing visual identity from the matching owned pet without replacing sealed stats, moves, roles or positioning. This fixed an observed complete-replay stall at 0/8 combatants.
- Co-op snapshots retain full move kits, trained stats, native roles and visual identity. Starting a lobby refreshes the chosen pets from their current saves. Both peer participants receive the same accepted authoritative roster; co-op spectator arrays remain stable across rerenders. Ranked and co-op AI slots now have actual move kits and canonical model identities.
- Warfront's equipment-free rules no longer consume unused equipped items during AI start/resume or settlement, including previously sealed matches.
- Failed images, missing model identity and failed renderer chunks expose recovery controls. Image loads expire after 25 seconds, and a stalled WebGL preparation falls back to Canvas after 45 visible seconds. Hidden time does not consume that preparation budget.

The combined affected regression run passed **138 tests with no failures or skips** (`output-warfront-integration-final-tests.log`). Authenticated handler tests use isolated memory KV, including save→offer→challenge→records/replay, both outcomes, legacy defenses, contention, quota, notification failure and off-page records.

The final production client and server builds passed, including TypeScript and the standalone Rite worker bundle. Final lint found two integration issues (co-op memo dependency inference and an unused initial assignment); both were corrected and the affected files rechecked with zero errors. Three existing renderer warnings remain.

The final production client and server builds passed, including TypeScript and the standalone Rite worker bundle. Final lint found two integration issues (co-op memo dependency inference and an unused initial assignment); both were corrected and the affected files rechecked with zero errors. Three existing renderer warnings remain.

The real ranked UI completed server-core-derived matches at 1440px and 390px. Both final replay scores agreed with authority, parent rerenders did not restart the single simulation worker, and exit restored rank and charges with zero remaining workers/canvases. Navigation, formation save, account switching during a delayed response and layout passed at 1440px, 390px and 320px. A separate 320px check verified the record for rank 1001 and own-row highlighting. Reproduce with `node --import tsx shinobij.client/scripts/warfront-ladder-browser-qa.mjs` (or `--record-check` for the latter); evidence is in `output/warfront-ladder-qa/`.

Four optimized-browser graphics fault scenarios passed: image failure, image plus renderer-chunk failure, missing model identity, and a stalled WebGL download. Each exposed a recoverable state or reached Canvas readiness, with no unexpected errors. See `warfront-render-failure-audit.json` and `shinobij.client/scripts/warfront-render-failure-audit.mjs`.

Resume deliberately returns to deployment using the original sealed roster/seed; there is no persisted mid-fight clock. Already-running historical co-op snapshots cannot recover move kits discarded by the old serializer. The ranked adapter still lacks multi-key transactions: a backing-store failure between quota and standings writes can consume an attempt without completing settlement. The exact storage boundary is documented in [the ranked audit](warfront-ranked-integration-audit-2026-09-09.md). No live-account writes or deployment were used for verification.
