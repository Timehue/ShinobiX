# Authoritative jutsu parity and combat UI proportion pass

Date: 2026-08-04

Branch: `codex/jutsu-parity-combat-ui`

Certified code SHA: `35db1c78f443fa8c6b22a86f35916523d9623c2f`

Starting ShinobiX SHA: `5c699ccf0eca7837494a64a8fd96df41bd101439`

Read-only TheNinjaRPG reference SHA: `df6dcd0d7d4b23d9cf309ea3a0159f366f764869`

The starting task worktree was clean. Concurrent adaptive-shell and pet-arena
changes appeared later in the shared desktop workspace; none of those files was
staged or committed by this task. Final certification therefore ran in a
detached worktree at the certified code SHA.

## Outcome

PvP and authoritative Solo PvE now plan a jutsu cast through the same canonical
target, range, footprint, movement, ground-effect, AP/resource, cooldown,
status-timing, event-fact, and semantic-VFX contract. Runtime adapters still own
transport, persistence, AI turns, settlement, and bounded encounter modifiers.

PvP and server-authoritative Solo PvE now render through one
`ShinobiCombatShell`. The shell uses container dimensions rather than a
viewport-only three-column assumption, preserves the 120-tile board's 1.6214
aspect, shares canonical jutsu-card facts, uses 44px controls, and treats action
notices as an explicit grid region. Tower remains separate for N-actor combat.

## Commits

1. `cc6ad9fb79060f2c068e0609f8eb56d491d56ed2` — shared jutsu action planning,
   AOE, VFX, and the first real PvP/Solo differential harness.
2. `0682604b9301745d2a2ae788594667804082d455` — executable inventory, closed
   mode-exception registry, tests, and architecture document.
3. `3431174b6d6ea2b21a4a0497e90f768156785516` — deterministic Abandon/Forfeit
   separated from probabilistic Flee.
4. `4f3f875a0bd78cc5d6c99780731b77530998ec67` — targeted parity boundaries,
   immediate-ground and poison-reaction VFX parity, and one shared VFX tile cap.
5. `5b27093b8c4ee0126626ed25a197e5d072c33ab4` — shared responsive shell,
   canonical card metadata, refresh recovery guard, accessibility labels, and
   layout contracts.
6. `f580794247b2d8103881a06df7e0e5fb9a2cbc60` — before/after screenshots,
   measurement telemetry, and the cross-engine viewport/zoom matrix.
7. `35db1c78f443fa8c6b22a86f35916523d9623c2f` — scope the new shell contract to
   PvP and authoritative Solo PvE while preserving legacy Arena/Tower boundaries.

## Executable parity inventory

The live inventory is derived on every run, not fixed at 217. The starting
snapshot contains 217 executable shipped jutsu: 117 built-in and 100 legacy.
It includes 30 AI-referenced IDs with zero missing references, 3 target values,
3 canonical method values, AP tiers 20/40/60, cooldowns 2/7/10, and ranges
2/3/4/5. Dynamic admin/creator publication is accepted as an input and has a CI
specimen.

The inventory classifies 15 resolver behavior families. Ten occur in the
shipped snapshot and five are retained in the accepted publication/tag
contract. All 36 accepted canonical tags are mapped; 21 occur in the shipped
snapshot. Every shipped jutsu receives at least one family and a neutral real
handler/engine comparison.

The behavioral differential harness invokes the real PvP handler and real Solo
engine with equivalent sealed sessions. It compares acceptance/rejection,
reason class, AP/action count, chakra/stamina/HP costs, cooldown, positions,
HP/shield, complete status payloads, ground effects, raw/resolved/HP/shield
damage, healing, shielding, displacement, events, and VFX after normalizing only
runtime identities, generated IDs, timestamps, and cosmetic log differences.

Targeted matrices cover exact/insufficient AP and resources, Lag/Overclock,
poison-on-spend, active cooldown, out-of-range, circle/spiral/instant ground,
immediate application, push/pull, resource/status/cooldown ordering, comparator
sentinels, and mastery 0/1/49/50 at account levels 1/50/100. The catalog sweep
and targeted cases found no legitimate numeric PvP/Solo jutsu divergence after
canonical planning. Two observable Solo presentation facts were corrected:

- instant ground casts now include the authoritative footprint in Solo VFX;
- poison-on-resource-spend now emits the same semantic reaction VFX in Solo.

The shared VFX tile limit is `MAX_COMBAT_VFX_TILES = 18`; PvP and Solo no longer
carry separate cap literals.

## Architecture and retained mode exceptions

Shared helpers added:

- `combat-core/resolve-jutsu-action.ts` — eligibility, range, target contract,
  movement destination, footprint, AP/resources, cooldown, and cast facts;
- `combat-core/aoe.ts` — canonical hex disks/rings;
- `combat-core/jutsu-vfx.ts` — method normalization and semantic VFX;
- the existing authoritative `applyJutsu`/formula path for damage, healing,
  shield, status, and post-damage ordering.

The refactor removed 454 lines from the duplicated PvP/Solo orchestration
surface while leaving matchmaking, settlement, Solo AI turns, and mode bindings
separate.

The closed exception registry retains only:

- `solo-difficulty-guard` — generated-enemy incoming-damage envelope;
- `weekly-boss-score-attack` — guard/round damage envelope and survival budget;
- `hollow-gate-director` — floor-sealed damage directives, hazards, and retreat
  seal.

These modifiers cannot override AP, resources, cooldown, target/range/method,
tags, status duration, footprint, or semantic VFX.

## Flee and Abandon

Before, the Solo transport's `forfeit` operation submitted probabilistic
`flee`; a failed roll could leave an active session while the UI exited. After:

- Flee retains its escape roll; failure applies its consequences, returns the
  updated active session, and keeps the player in combat.
- Abandon submits a separate deterministic `forfeit`, applies the terminal loss
  consequence once, settles once, and only then permits exit.

Server, transport, adapter, outcome-wiring, and screen tests cover both paths.

## Client display parity

`CombatJutsuMeta` is shared by PvP and Solo cards. Given the same character,
statuses, jutsu, and cooldown it renders the same adjusted AP, range, cooldown
remaining, method, target, and scaled chakra/stamina resource costs. Both
screens use the same affordability AP adjustment. Active cooldown and selected
states remain explicit.

The initial async restore no longer removes the PvP session breadcrumb before
the restored battle ID is installed, so refresh/reconnect reaches the live
combat path rather than silently abandoning it.

## Combat layout before and after

Telemetry covers both modes at 360x640, 390x844, 412x915, 768x1024, 1024x768,
1280x720, 1366x768, 1440x900, 1920x1080, 2560x1440, and 3440x1440.

| Measurement | Before | After |
| --- | --- | --- |
| Battlefield aspect across Chromium matrix | 1.0409–3.6204 | 1.6213–1.6215 |
| 120 tile centers inside battlefield | 0/22 mode-viewports | 22/22 |
| Horizontal overflow failures | 0 | 0 |
| Board/action or dossier overlap | 1 PvP viewport | 0 |
| Minimum command/tab touch target | 40px | 44px |
| Cross-engine after states | not captured | 66 viewport + 24 zoom states |

The apparent reduction in minimum phone board height (Solo 216px to 99.7px;
PvP 216px to 113.7px) is intentional on 360x640: the old rectangle was taller
but distorted and its tile centers escaped the viewport. The new smaller board
contains all 120 correctly proportioned, tappable tiles while keeping commands
reachable.

Breakpoint strategy:

- default: compact symmetric top fighter summaries and one center column;
- `max-width: 520px`: phone compaction;
- `max-width: 520px` and `max-height: 700px`: the notice floats in its reserved
  shell slot instead of creating an implicit board-collapsing track;
- `min-width: 800px` and `max-height: 800px`: short-landscape compaction;
- only `min-width: 1360px` and `min-height: 820px`: equal 210–260px side
  dossiers and a centered battlefield.

Battlefield sizing uses a named size container and the real ratio:

```css
--combat-board-aspect: 1.6214;
width: min(100cqw, calc(100cqh * var(--combat-board-aspect)));
height: min(100cqh, calc(100cqw / var(--combat-board-aspect)));
```

The existing board scaler fits the real grid layer inside that stage; the
entire UI is never transform-scaled.

Before/after Chromium PNGs for every required viewport are under
`docs/screenshots/combat-layout/{before,after}/{solo,pvp}/chromium/`. After
telemetry for Chromium, Firefox, and WebKit, including zoom, is stored beside
them. Browser zoom 80/100/125/150% was represented by the exact 1440x900
physical-window CSS viewport equivalents 1800x1125, 1440x900, 1152x720, and
960x600. All 24 mode/engine zoom states passed.

## Accessibility and performance

- Actions/tabs have a measured 44px minimum; native buttons and tabs retain
  keyboard behavior and visible focus styling.
- Every one of the 120 tile buttons has a screen-reader name with tile number,
  row, column, occupant, and current target purpose. The matrix fails if any
  name is empty.
- The browser suite runs with reduced motion and the existing WCAG A/AA axe
  smoke checks passed where executed.
- Target states remain color-independent through selected/target classes,
  outlines, text, and accessible names.
- No WebGL path or new render-loop observer was added. Container-query layout
  is CSS-driven; pointer hover only updates React state for ground previews.
- VFX fan-out is capped at 18 tiles. Cross-engine measurements stabilize after
  bounded retries and showed no ResizeObserver loop or layout-thrash symptom.

## Mutation verification

Each mutation was applied to executable source, the named focused test was run
and observed failing, and the source was restored before the next mutation:

| Mutation | Detection |
| --- | --- |
| Solo jutsu AP +1 | eligibility/AP differential failed |
| PvP Lag duration +1 | status-duration differential failed |
| Solo AOE footprint truncated | ground footprint differential failed |
| immediate ground application removed | target status/ground differential failed |
| Solo push/pull extra displacement | destination differential failed |
| Solo resources paid before effect | resource/HP/heal ordering differential failed |
| Solo cooldown +1 | cooldown differential failed |
| 235/620/235 desktop grid restored | shell contract failed |
| 140/210 Solo-only dossiers restored | shell contract failed |
| unordered armed-action notice child restored | strict grid-row/board-collapse matrix failed |

Result: 10/10 intentional divergences detected.

## Command log and results

| Command | Result |
| --- | --- |
| `node --import tsx --test api/combat-core/pvp-solo-jutsu-parity.test.ts` | 6/6 pass |
| inventory + exception focused tests | 4/4 pass |
| shell/card/layout focused tests | 10/10 pass after stale boundary contract update |
| `npm test` at certified SHA | 4,925/4,925 pass |
| `npm run build:server` | pass (also exercised by full build) |
| `npm run build` at certified SHA | pass |
| `npm run certify:release` | 61/61 pass |
| `npm run check:deployment` | pass |
| `npm run check:rollback-readiness` | pass; no destructive statements |
| `npm run test:release-assets` | pass; 65 achievement refs, 165 badges, 21 Pet Home WebPs |
| `npm run test:mission-eligibility` | pass |
| root `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| client `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| client `npm run lint` at certified SHA | pass |
| client production build at certified SHA | pass |
| standard `npm run test:e2e` at certified SHA | 31 pass, 25 environment-gated skip, exit 0 |
| `npm run test:e2e:live` | 8/8 pass after fixing disposable-account namespace collision |
| strict combat matrix | 6/6 projects; 66 viewport and 24 zoom states pass |
| independent `agent-browser` 390x844 Solo walkthrough | 0 overflow, 120 tiles, 1.6215 ratio, 44px controls, 0 unnamed tiles |

The authoritative build-size result is 6.88 MB product JS/CSS, all emitted,
with an initial graph of 1.37 MB raw / 363.8 KB gzip. Sizecheck passed. The
existing warning for chunks above 700 KB remains.

The shared-worktree runs also surfaced unrelated concurrent adaptive-shell
failures and a PetArena lint error. They disappear at the certified task SHA
and are not attributed to this branch.

## Remaining risks and incomplete coverage

1. The live visual matrix certifies neutral, armed-action, maximum equipped
   jutsu, weapon, consumable, and PvP/Solo transport states. It does not capture
   a distinct PNG for every encounter-specific overlay/result combination in
   the request (companion, many statuses, active ground zone, Hollow Gate,
   Weekly Boss, reconnecting, settlement retry, and every terminal result).
   Exact executable blocker: the production API has no deterministic,
   test-only sealed-session fixture for arbitrary encounter/status/settlement
   projections. Adding a privileged fixture to production routing solely for
   screenshots was judged a larger security surface than this layout pass.
   Static grid-row contracts, real mode flows, and the notice-collapse mutation
   cover the shared composition risk, but a future internal-only fixture would
   close the visual-state matrix completely.
2. Combat keyboard names, touch size, reduced motion, and color-independent
   cues are automated. A combat-specific axe/contrast sweep across every biome,
   status color, and encounter overlay is not. The standard app axe smoke suite
   passed; exhaustive combat contrast remains manual visual-review risk.
3. Cards now share adjusted AP/range/cooldown/target/method/resource facts. The
   server session still does not seal one complete display-facts projection for
   HP cost, scaled effect magnitude, status duration, and environment modifier
   copy. Those values remain inspect-panel/event concerns and should be moved to
   a server-sealed display contract before adding richer card prose.
4. Dynamic admin-published jutsu are covered through the inventory input and a
   publication specimen, but offline CI cannot enumerate live production admin
   storage. Production inventory export must pass the loaded admin collection.
5. A disposable detached certification worktree remains at
   `C:\Users\Tyler R\AppData\Local\Temp\NinjaK-jutsu-parity-cert-f5807942`.
   Cleanup stopped after PowerShell raised a junction-removal
   `NullReferenceException`; no recursive removal was attempted. Both dependency
   junctions still target this repository's `node_modules` directories. Remove
   it only after explicitly unlinking and validating those two junctions.

The parity invariant now enforced is: identical canonical inputs with no mode
modifier produce an identical authoritative PvP/Solo jutsu result. The UI
invariant now enforced is: PvP and authoritative Solo PvE share one responsive
composition, preserve the board ratio, keep all tile centers inside the board,
and retain reachable 44px controls at every certified viewport.
