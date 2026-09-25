# ShinobiX Luna handoff findings

Initial defect review was against 454aca73405b7239035aa0dfcf61e9127b9e91da on codex/shinobix-confirmed-defects; this scoped integration is based on live origin/main at a8ba2c978cb2a19e7f321f4f0b932e0328cb5653. This pass preserves the existing Supporter policy and pre-existing pet-model/art work. It does not apply a migration, write production data, publish, or deploy.

## A. Pet-showdown cold entry

The warmup source guard now distinguishes type-only imports from runtime imports and checks static and literal dynamic imports without exempting whole directories. The focused warmup suite passed 15 tests. This used mocked module loading; it did not exercise a browser first frame or WebGL context.

## B. Mission reads and action feedback

Mission reads now deduplicate pending requests and key application to owner/run identity. State reads are explicitly invalidated after progress, claims, accept/abandon, and reconnect/resume; read and mutation rate accounting are separate. `use-field-trail-refresh.ts` and the deadline store/hooks hold the new coordination outside `App.tsx`.

Raid and claim clients retain server status, reason/code, request identity, and retry deadlines. The daily raid cap's successful HTTP response without a token remains an error state to the caller. Countdown deadlines recompute after visibility/resume. Focused B tests passed 78 tests before the mission-outpost slice; final focused and repository suites are recorded in the delivery report.

## C. Mission, travel, and tutorial flows

### C1. Field mission outpost

Board and Logbook use one next-objective helper. Navigation carries the owner, mission ID, target sector, and next action; the World Map rechecks acceptance and objective before selecting the destination. The sector panel presents a mission outpost action independently of its war controls. `raid-start` validates the accepted eligible run and catalog target, requires current server presence, and does not use a client-selected opponent. A mission-marked sealed raid has a dedicated idempotent settlement path that only stamps the existing field receipt; it does not award Vanguard progress/bonuses, Legacy raid/war contribution, or territory damage.

The current server catalog assigns five rank-specific outpost IDs and maps each to a tested built-in Mission Hall combat profile: D to Academy Sparring Partner, C to Ember Duelist, B to Frost Sealer, A to Shadow Weaver, and S to Central Champion. The server clones and renames each profile; neither the client nor village guard state selects opponent difficulty. Mission authority tests verify the introductory outpost across villages, wrong-sector rejection, exact run/token binding, and that a win stamps only the field receipt without Vanguard, Legacy, or territory effects. The 40-test focused server slice passed after the profiles were added.

### C2. Authoritative travel

Location-sensitive village/sector actions now share `runWhenSectorConfirmed`, which waits for `beginSectorTravel` arrival before invoking the action and does not set a destination as current before the travel authority responds. The existing travel route remains lease-backed and the presence check remains strict. Focused travel and world-position tests passed in the 78-test slice. Browser travel/reload coverage remains part of final gates.

### C3. Tutorial continuation

The inspected academy flow already has explicit claim-to-Logbook, Logbook-to-World-Map, and return-to-village actions. Persisted `academyTrialClaimed` gates the transition. Existing academy handoff/narrative/first-session tests cover these links. No telemetry or persistent onboarding state was changed.

## D. Battle ownership and recovery contract

| Mode | Canonical owner | Pointer/projection | Terminal/recovery rule |
|---|---|---|---|
| Solo-PvE AI | `solo-pve:<sessionId>` | AI active pointer, optional per-player battle projection | Session expiry is gameplay expiry; lapsed sessions terminalize with the mode's abandon rule and durable usage settlement. Rows are retained after gameplay expiry so settlement can finish. |
| PvP | `pvp:<battleId>` | Reserving/active pending-session pointer and projection | Lapse terminalizes as a draw; terminal reward snapshots/journals survive the live row and allow recovery. |
| Tower story/spire | `tower:<runId>` | Compare-checked `battle-lock:<slug>` lease and projection | Run owns terminal outcome; lapse settles the forfeit and releases only leases still owned by that run. |
| Tower MPvP | `tower-pvp:match:<matchId>` | Per-player Tower MPvP pointers and leases | Match store owns status; member claims/release are all-member, compare-checked, and reconnect-aware. |
| Hollow Gate | `hg-run:<slug>:<token>` | Projection plus any current Solo-PvE encounter | Dive key owns the run; a lapsed encounter is voided/restarted and does not create a loss. |
| Pet showdown / legacy pet battle | `pet:showdown:<slug>:<sessionId>` or sealed `pet:battle-token:<slug>:<token>` | Showdown projection or `pet:battle-active:<slug>` pointer | `finished` or settled token is terminal; pet settlement stays in the pet engine. |
| Card Clash | Session key named by projection | Per-player projection | Card duel presence/status decides; done or missing session retires only the matching projection. |
| Realtime pet duel | In-process duel registry | No durable battle owner key | Pending invites engage only a side that has committed; running duels engage both. Registry/invite expiry owns its cleanup. |

The reviewed authority resolver treats unreadable owner storage as an error, not evidence of no battle. Lapse reconciliation is owner-scoped and idempotent; stale projections are retired by matching session ID. Existing tests cover live reconnect evidence, lapsed/terminal states, missing or changed owners, commit-then-throw recovery, CAS fencing, and Tower lease successor ownership. No reproducible defect justified changing lifecycle code, locks, or TTLs in this pass. This is an inspected contract, not certification of every mode or live storage outage.

## E. App coordination

The mission refresh and action-deadline coordination are extracted into focused client hooks/modules, with explicit invalidation and owner-scoped inputs. The current shared `App.tsx` is 6,263 lines; this slice did not attempt an app-wide state rewrite or story/battle relocation. Existing first-session and return behavior stays in its tested owners.

## F. Ranked entitlement policy

The server's current behavior is explicit: 12 ordinary techniques for a base account, 15 for an active Supporter, and the separate earned Legacy signature slot. Expired entitlement falls back to 12 without mutating stored preferences. Tests cover sealing both real PvP fighters and ranked 2v2 server hydration. The entitlement-focused suite passed 7 tests. The owner decision remains whether ranked should retain the existing 12/15 policy or move to a common cap; this pass preserves 12/15.

## G. Exchange browse bounds

The existing browse path reads one listing index, reads projected listing rows in batches of at most 500, and fetches at most 12 selected listings in full (with the existing 2,000 live-listing bound). Local QA-storage benchmark results:

| Live listings | Index reads | Projection reads / rows | Serialized projection bytes | Full rows / bytes |
|---:|---:|---:|---:|---:|
| 100 | 1 | 1 / 100 | 11,251 | 12 / 7,696 |
| 500 | 1 | 1 / 500 | 56,251 | 12 / 7,792 |
| 2,000 | 1 | 4 / 2,000 | 226,104 | 12 / 7,900 |

These are deterministic simulated-KV operation and payload counts, not provider latency or production measurements. Paging/filter/sort and stale-listing race coverage passed in the 17-test exchange integration suite. The current storage interface exposes no queryable listing index, so no safe schema/query change was justified.

## H. Late-game build-diversity diagnostic

`scripts/pvp-late-game-diversity.mts` runs fixed-order, no-RNG pairings through the existing `api/pvp/move.ts` resolver. It compares eight legal templates with 12 ordinary techniques, both seats and openers, at levels 80 and 100: 896 crossed fights per level. There is no random source, so reruns need no seed.

Under this scripted policy, Prevention scored 73.2% at level 80 and 73.0% at level 100; Control scored 23.7% and 28.6%. Initiative scored 38.2% and 37.2%. Level 100 had four timeouts and eight draws; the level-80 run had none. The separate 64-fight level-100 capacity comparison scored base 12 at 20.3% and active Supporter 15 at 79.7%. These are policy-sensitive hypotheses, not human balance evidence and not grounds for automatic changes. The diagnostic excludes Legacy signatures and consumable use; only levels 80 and 100 are sampled.

## I. Verification boundaries

The focused slices above exercise mocked cold entry, mission navigation and receipts, travel authority, entitlement, and local exchange bounds.

- The original source snapshot npm run build passed server/client typechecks, story-content checks, Vite production build, verify:dist, and size checks. The size checker emitted its existing budget warning for total emitted JS/CSS, then passed.
- The original source snapshot npm run lint passed with 0 errors and 14 warnings.
- Integrated live-main checkout at a8ba2c978cb2a19e7f321f4f0b932e0328cb5653: npm run build:server passed, client npm run build passed, focused API regressions passed 65/65, and focused client regressions passed 55/55.
- On the original dirty source snapshot, the segmented root suite previously passed all 12,003 tests before the concurrent curve edits. The focused progression/PvP batch passed 66/67; the late-game bracket/parity check expected [1999, 5292, 11866, 19994] but the concurrent 29,000-point server curve produced [2006, 5220, 10920, 19879]. This curve work was left out of this live-main integration at the user direction.
- The latest full `npm run test:e2e` run completed 1,321 passed, 692 skipped, and 17 failed in 52.4 minutes. It ran from an immutable preview snapshot while the shared workspace was also changing, so it records that run's build rather than source edits made afterward. The five mission-outpost journey cases passed. The initial mission-read-loop case failed only on its fixture expecting two active accepted contracts in one save; the fixture now covers D and C contracts in separate saves, and its focused Chromium desktop rerun passed 1/1 in 2.9 minutes. The focused server mission authority batch then passed 40/40, and the two outpost journey cases passed 2/2 against the current build. The remaining failures were outside this handoff slice: Chromium desktop central-hub/world-map artwork, profession switching, Ashen Leaf finale, Moonshadow opening, and world-position recovery; Firefox desktop Frostfang narrative integrity and Tomoe's seven-chapter course; WebKit desktop Crafter guidance and combat effects layout; Chromium compact journal shortcut; Chromium mobile Clan/world-map artwork and Ashen Leaf finale; WebKit mobile throttled-logout hint; and Chromium tablet archive-visit cleanup.
- The full strict combat-layout matrix completed 19 passed, 10 skipped, and one failure writing diagnostics after the runner removed its directory; no geometry assertion failed. The artifact helper now recreates parent directories, and the failed Chromium DPR 1.5 solo case passed on a strict 1/1 rerun.

On the concurrent local change set, the server 29,000-point curve and client mirror have a known parity failure: the late-game bracket check expected [1999, 5292, 11866, 19994] and received [2006, 5220, 10920, 19879]. Per the user direction, neither curve nor its fix is included in this live-main commit. Browser/WebGL cold first-frame behavior is not inferred from the mocked warmup suite.
