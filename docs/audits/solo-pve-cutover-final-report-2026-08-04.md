# Verified Solo-PvE cutover final report

Date: 2026-08-04
Verdict: **implementation and local CI green; production certification withheld**

This report records executable evidence for the ShinobiX Solo-PvE cutover. It
does not treat a foundation as a completed player journey. A mode is called
browser-certified only when the built client, real Express server, authoritative
battle, settlement, refresh/reconnect behavior, and resulting persistent state
were exercised together.

## 1. Starting ShinobiX SHA

`b815be4fe0088735df444fd7a1464c5e0c3bfa48`

## 2. Final branch SHA

The original cutover comparison SHA is
`4b53964abf13fe5a1a792d1d3b5871d0d1e5fb27`. The verified gap-closing
continuation implementation SHA is
`846a6bc5c24d77b2ffac646a2c94a39a9856bba8`. The final documentation commit
containing this report is supplied by `git rev-parse HEAD` in the Codex handoff.
A Git commit cannot embed its own content-derived object ID in a tracked file,
so the handoff SHA, not the comparison SHA above, is the final branch tip.

## 3. Reference the third-party reference SHA

`df6dcd0d7d4b23d9cf309ea3a0159f366f764869`, fetched from the reference
repository's `origin/main` immediately before the comparison. The review used
capability evidence only; no reference code, schema, formula, content, writing,
or asset was copied.

## 4. Branch name

`codex/solo-pve-cutover`

## 5. Commit list

Implementation commits after the starting SHA, oldest first:

1. `14063336a` — `docs(combat): baseline executable runtime inventory`
2. `2d2f2d354` — `feat(solo-pve): close combat parity and recovery gaps`
3. `2955cc504` — `feat(solo-pve): add server-owned companions`
4. `344d5dabb` — `feat(combat): cut generic AI to solo pve`
5. `ed7553962` — `feat(combat): cut missions and story to solo pve`
6. `b15c97277` — `cut Endless Tower over to solo PvE sessions`
7. `27b329dd5` — `cut Hollow Gate combat over to solo PvE`
8. `2472ca2e5` — `Harden Hollow Gate dungeon authority and recovery`
9. `6e453ab76` — `Migrate Weekly Boss combat to solo PvE`
10. `6fc693228` — `Harden Weekly Boss start recovery`
11. `d4e81808b` — `Migrate ANBU infiltration combat to solo PvE`
12. `53801dc2f` — `Harden ANBU start and settlement recovery`
13. `5ea4d3b6b` — `test: ratchet solo pve cutover contracts`
14. `d47c049a7` — `test: certify academy spar on solo pve`
15. `95d8fe81a` — `feat: add authored AI and combat event foundations`
16. `36c998bb5` — `fix: resume combat missions after refresh`
17. `acd45b671` — `test: type live browser responses safely`
18. `f1e6956a7` — `fix: recover lost mission settlement responses`
19. `4b53964ab` — `chore: retire obsolete weekly boss trust flag`
20. `846a6bc5c` — `fix(solo-pve): make physical outcomes durable`

The final documentation truth-pass commit is the handoff SHA from item 2.

## 6. Pre-existing worktree state

The worktree was clean at the starting SHA. No user edits, untracked files, or
staged changes had to be moved, overwritten, or stashed. The cutover branch was
created for this work.

## 7. Before/after runtime matrix

| Player-facing mode | Before | After | Result authority |
| --- | --- | --- | --- |
| Generic/published AI, hunts, ambushes, guards | Client Arena resolved combat | Dedicated Solo-PvE session | Solo session and server-bound settlement token |
| E/D and C/B/A/S combat missions | Client win participated in claim truth | Solo-PvE with durable binding and active pointer | Terminal Solo evidence plus server mission receipt |
| Academy spar and story bosses | Client Arena with story wrapper | Solo-PvE with story binding | Terminal Solo evidence plus one-time story settle |
| Normal Endless waves | Tower/runtime coupling | Solo-PvE wave session | Durable Endless run, wave binding, Solo result |
| Hollow Gate shinobi fights | Client Arena/run-token bridge | Solo-PvE combat binding | Solo result plus HG ledger/manifest/receipt |
| Weekly Boss attempt | Client-reported damage | Solo-PvE score attack | Server terminal damage and contribution receipt |
| ANBU infiltration | Custom one-off action/state combat | Solo-PvE | Solo result plus infiltration recovery/settle record |
| Battle Towers | Tower | Tower retained | N-actor objectives and queue |
| Endless Spire | Tower | Tower retained | N-actor Tower rules and leaderboard |
| Clan Boss | Party Tower | Tower retained | Multi-actor party assault and clan receipt |
| PvP/ranked/sector-war shinobi | PvP | PvP retained | PvP session/move/settlement |
| Hollow Gate pet/Pet Arena | Pet runtime | Pet retained | Pet proof and pet receipt |
| Card Clash/sector card | Card runtime | Card retained | Card session and receipt |

The executable detail is in `docs/architecture/combat-runtime-inventory.md` and
is ratcheted by `scripts/combat-runtime-inventory.test.mjs`.

## 8. Solo-PvE capabilities completed

- Server-sealed player, enemy, loadout, items, board, weather, encounter, and
  optional companion state.
- Versioned state reads and expected-version actions with stable move tokens,
  duplicate-action replay, stale-version rejection, turn/round limits, and TTLs.
- Canonical server combat formulas for resource costs, jutsu/tags/statuses,
  cooldowns, weapons, consumables, movement, ground zones, DoTs, and weather.
- Server-resolved win, loss, draw, and flee, with immutable terminal evidence.
- Durable, mode-bound settlement receipts and item-use charging.
- Server-owned companion summon, obedience, actions, cooldowns, equipment,
  consumable use, targeting, expiry, and terminal usage evidence.
- Runtime-neutral ordered combat-event records.
- Validated authored-AI programs with canonical publication and Solo execution.

The last two bullets are completed foundations, not complete cross-runtime or
production adoption; those gaps are recorded in items 27–30.

## 9. Published compatibility report

`docs/architecture/solo-pve-compatibility.md` is executable documentation backed
by `api/solo-pve/_compatibility.test.ts`. It checks 217 current/legacy jutsu,
164 items, and 71 built-in AI profiles (30 unique referenced jutsu). All resolve
within the published Solo-PvE authoring contract.

## 10. Unsupported action count before and after

Before: **12 unique published ground/movement jutsu** were outside the starting
Solo engine's usable target/method behavior. After: **0 unsupported jutsu, 0
unsupported items, and 0 unresolved or unsupported built-in AI references**.
The post-cutover report separately counts 12 ground-target and 12 Move-tagged
jutsu; those sets overlap and are not presented as 24 unique starting gaps.

## 11. Generic AI behavior before and after

Before, rewarding generic AI launches could enter the client Arena, which
resolved enemy actions, winner, vitals, and item effects locally. After,
published AI IDs are resolved from canonical server content, the server seals a
Solo encounter, actions go through `solo-pve/action`, state through
`solo-pve/state`, and settlement consumes only the matching terminal session.
Unknown/unpublished persistent IDs fail closed. Explicit previews may remain
local only when they cannot create a persistent result or reward.

## 12. Mission behavior before and after

Before, mission settlement still depended on client-resolved AI wins, including
a legacy E/D exception. After, every combat rank starts a bound Solo session;
claim queuing requires matching player, mission, run, AI profile, reward
fingerprint, unexpired binding, terminal player win, and membership evidence.
`mission-combat-active:<player>:<mission>` makes start idempotent across refresh.
A lost settlement HTTP response is replayed only when the won binding, settled
Solo session, pending claim in the authoritative save, and server claim token
all agree. Item use and rewards remain once-only.

## 13. Story/Academy behavior before and after

Before, story/Academy wrappers launched client-resolved Arena fights. After,
Academy spar and story bosses use story-bound Solo sessions. Settlement rejects
unfinished, losing, mismatched, repeated, and out-of-onboarding attempts. The
real-server release certificate proves a fresh level-1 account fights the fixed
level-1/50-HP dummy, receives exactly 20 stat points and 30 ryo once, advances
onboarding, and cannot settle again.

## 14. Endless behavior before and after

Before, normal one-human Endless borrowed the Tower runtime. After, a durable
Endless run seals each wave into Solo-PvE, preserves the exact opponent across
retry/reconnect, advances a winning wave once, banks once, and rejects stale or
mismatched wave evidence. Endless Spire remains Tower because it is an explicit
N-actor/objective/leaderboard mode rather than normal Solo Endless.

## 15. Hollow Gate behavior before and after

Before, shinobi fights bridged a client Arena outcome into the dungeon run.
After, the server-owned run manifest and combat binding seal encounter identity;
Solo owns actions, outcome, vitals, and item use; and the HG ledger owns exact
haul credits, extraction/death reconciliation, and recovery markers. Duplicate,
wrong-run, wrong-node, stale, expired, nonmember, or tokenless settlement fails
closed. Pet encounters remain in the separate Pet runtime and require matching
pet proof.

## 16. Remaining Tower callers and why each belongs there

- **Battle Towers:** multiple actors, turn queue, objectives, summons, boss
  phases, and floor-specific mechanics.
- **Endless Spire:** Tower actors/objectives plus Spire progression and
  leaderboard semantics; it is not normal one-human Endless.
- **Clan Boss:** a player party and boss/add actors, clan contribution, and
  multi-member assault settlement.

These are genuine N-actor or Tower-objective callers. No migrated normal
one-human PvE mode remains in Tower merely to obtain server authority.

## 17. Client-trust paths removed

- Client-reported generic-AI outcome, surviving HP, enemy truth, and item usage.
- Mission client-win claim truth and the rewarding legacy E/D exception.
- Weekly Boss client-damage contribution route; the retired action returns 410.
- Story/Academy client winner and reward authority.
- Normal Endless Tower coupling and client wave result authority.
- Hollow Gate shinobi client outcome/haul bridge.
- ANBU custom client action authority; the retired operation returns 410.
- The obsolete Weekly Boss client-damage release flag and its dead helper.

## 18. Local fallback paths remaining and proof they cannot reward

The legacy Arena implementation still supports presentation utilities and
explicit nonpersistent preview/simulation use. It is not a settlement authority
for the migrated rows. Published generic starts reject unknown IDs; migrated
clients fail closed when session creation/state/settlement fails; mode endpoints
require terminal server evidence; and the executable entrypoint/runtime
inventory tests reject a reintroduced rewarding local caller. PvP, Pet, Card,
and Tower paths are not “local fallbacks”; they are separate server authorities.

## 19. Settlement guarantees

All migrated modes bind terminal Solo evidence to owner and exact encounter.
Expected run/session IDs, expiry, winner/outcome, encounter discriminator,
source ID, and mode binding must agree. Mode locks fail closed. Stable receipts
make rewards, progression, contribution, item deduction, and terminal marking
idempotent. Interrupted metadata writes are retryable; mission usage uses a
private NX receipt so a retry does not recharge items. A settled mission response
is replayable only from the complete durable quartet described in item 12.
Failures, draws, and flees do not enter winning reward settlement.

## 20. Cross-runtime tests

The suite covers shared formula/tag/resource behavior, Solo compatibility,
server encounter sealing, client adapter mapping, runtime entrypoint ownership,
mode bindings, settlement rejection/replay, and retained-runtime boundaries.
Notable executable contracts include `api/_combat-formula-parity.test.ts`,
`api/solo-pve/_solo-pve.test.ts`, `api/solo-pve/_compatibility.test.ts`,
`api/solo-pve/_entrypoint-cutover.test.ts`,
`scripts/combat-runtime-inventory.test.mjs`, mode-specific Solo cutover tests,
and `shinobij.client/src/lib/solo-pve-arena-adapter.test.ts`.

## 21. Mutation-verification record

Eight real source mutations were introduced one at a time, required to fail,
then restored:

1. weakened mission duplicate/replay guard — caught;
2. weakened active-session/payment guard — caught;
3. allowed a losing session through the win guard — caught;
4. weakened wrong-owner/nonmember guard — caught;
5. weakened expiry guard — caught;
6. weakened Solo persistence runtime discriminator — caught;
7. allowed stale/settled mission recovery — caught; and
8. weakened the lost-response settled-proof gate — caught by the new focused
   test (5 pass, 1 intentional fail), then restored to 6/6 passing.

The restored combined focused set passed 33/33 before the final added mutation;
the authoritative full suite subsequently passed 4,885/4,885. The gap-closing
continuation added atomic receipt, compatibility-marker fault, lost-response,
vital-normalization, expired-repair, and concurrent-response-order coverage;
the final authoritative full suite passed 4,898/4,898.

## 22. Full command log and results

| Command / check | Result |
| --- | --- |
| Starting `git status --short` | Clean |
| Reference fetch and `git rev-parse` | `df6dcd0d7d4b23d9cf309ea3a0159f366f764869` |
| Focused mission binding/recovery test | 6/6 pass after restoration |
| Full `npm test` first final attempt | 4,880 pass; one file-level `_route-request-shape` transient |
| Isolated `node --import tsx --test api/_route-request-shape.test.ts` | 5/5 pass; transient did not reproduce |
| Required full `npm test` rerun | **4,898/4,898 pass**, 737 suites, 0 fail/skip/todo/cancel, 283.5 s |
| `npm --prefix shinobij.client run lint` | Pass, 90.7 s; known Babel size note only |
| Exact Sentry-enabled `npm run build` | Pass at `846a6bc5c24d77b2ffac646a2c94a39a9856bba8`, 64.9 s |
| `npm run certify:release` | 61/61 pass against built Express server |
| `npm run check:rollback-readiness` | `ok: true`; no destructive statements |
| `npm run check:deployment` | One replica, `node dist/server.js`, `/health` topology accepted |
| `npm run test:mission-eligibility` | Pass |
| `npm run test:release-assets` | 65 references, 165 badge PNGs, 21 Pet Home WebPs verified |
| Root and client `npm audit` | 0 vulnerabilities in both |
| Standard Playwright matrix | 31 pass, 25 intentional project-scoped skips, 0 fail, 54.6 s |
| `npm run test:e2e:live` | **4/4 pass**, desktop/mobile win and flee, 162 s on the final implementation |

One mistyped command, `npm run test:release-certification`, returned “Missing
script”; `package.json` was inspected and the correct `npm run certify:release`
then passed 61/61. The first full-suite transient and this invocation mistake
are retained here rather than hidden.

## 23. Browser journey results

Completed against the real built client and local Express server:

- desktop mission win: start, server actions, duplicate/stale checks, refresh
  resume, terminal win, deliberately lost settlement response, durable replay,
  duplicate retry, return, reward claim, refresh persistence, and new-login
  persistence;
- mobile mission win: the same journey at the mobile viewport;
- desktop mission flee/defeat: terminal non-win, exact immediate HP/hospital
  persistence with an in-save receipt, deliberately lost outcome response,
  idempotent retry, refresh recovery without full-HP resurrection, refused
  reward, unchanged ryo, and return to Mission Hall; and
- mobile mission flee/defeat: the same nonreward journey at mobile viewport.

All four passed. Evidence images are under
`docs/screenshots/solo-pve-cutover/`. Academy has real built-Express HTTP
certification (61/61 overall), but not a browser UI certificate. The remaining
modes are not called browser-certified; see item 30.

## 24. Build-size result

The exact release build used non-empty `VITE_SENTRY_DSN`,
`VITE_SENTRY_RELEASE`, and `VITE_BUILD_COMMIT`. It passed with server output
95.2 KB; client artifact 284.7 MB with no authoring sources; initial JS/CSS
1.38 MB raw / 364.1 KB gzip across 10 files; budgeted product JS/CSS 6.87 MB;
all emitted JS/CSS 6.95 MB; and lazy Sentry 81.9 KB. The build retains a
nonblocking warning for chunks over 700 KB and reports one already-larger image
optimization candidate as skipped rather than replacing it with a larger file.

## 25. Console/network findings

The four real mission journeys captured page errors and API responses. The
final run had no unexpected browser runtime errors and no API responses at or
above HTTP 500. The first settlement response was deliberately aborted after
the server committed; the UI retry returned the durable replay and completed
normally. The flee journey also aborts the first physical-outcome response
after its server commit and proves the retry replays the same in-save receipt.
Intentional stale/duplicate/refused actions returned controlled
application responses rather than server errors. No production network trace
was available.

## 26. Documentation corrected

The runtime inventory, runtime boundary document, server migration plan,
runbook, beta handoff/live-operations/release notes, feature/release matrices,
README, release checklists, and database/background-job audit now describe the
cutover as current truth. Historical audits are bannered as superseded rather
than silently rewritten as current. Dead Weekly Boss client-damage flag text and
code were removed. Live GitHub issue reconciliation correctly keeps #8, #12,
and #13 open while noting their local implementation pending review/merge.

## 27. Updated comparison against the third-party reference

`docs/audits/post-cutover-gap-comparison-2026-08-04.md` compares capabilities at
the implementation SHA without copying the reference. ShinobiX now has an
equivalent-but-different dedicated Solo authority, substantial retained PvP,
Tower/party, clan/village, sector-war, leadership, economy, and live-operations
systems. The comparison identified authored AI and normalized combat events as
high-leverage gaps; this branch implements their validated foundations. Their
broader adoption remains unverified and is not labeled complete.

## 28. Next verified gap ranked by player value and engineering risk

1. **Highest player/operational value, medium risk:** adopt normalized combat
   events in battle history, achievements/logbook/mission progress,
   clan/village contribution, balance telemetry, dispute support, and
   anti-cheat; then add PvP/Tower adapters.
2. **Medium value, medium-high risk:** add Tower authored-AI evaluation for
   allies/adds, objectives, threat, summons, and hold-objective selectors.
3. **High design cost, low value at ~100-player beta scale:** general group PvP;
   defer until population evidence justifies another permanent queue.

The immediate release-engineering priority ahead of feature adoption is the
missing deployed browser/operations certificate in item 30.

## 29. Remaining risks

- Local in-memory Express evidence does not prove production KV/database
  latency, shared concurrency, scheduled-job ownership, or deployment flags.
- Real browser coverage is complete only for combat missions; Academy has HTTP
  certification and the other migrated/retained modes rely on lower-level and
  source-contract tests.
- Authored AI lacks a deployed admin-publish-to-fight journey and full Tower
  selector adoption.
- Normalized combat events lack durable downstream consumers and non-Solo
  adapters.
- The client remains large, with known Pet Coliseum source and chunk warnings.
- GitHub issues #8, #12, and #13 require review/merge and external issue updates;
  this local task did not mutate issue state.
- Live balance, abuse, mobile-device, accessibility, and multi-user raid data
  remain beta operational evidence, not properties a local suite can prove.

## 30. Incomplete items and exact executable blockers

**Production readiness is not certified.** The following requested evidence is
incomplete:

- Real built-browser start/action/invalid-action/win/loss-or-flee/refresh/
  reconnect/duplicate/stale/duplicate-settle/lost-response/return/persistence
  journeys are missing for generic AI, story/Academy UI, normal Endless,
  Hollow Gate shinobi, Weekly Boss, ANBU infiltration, Battle Towers, Endless
  Spire, and Clan Boss. Only combat missions have the complete desktop/mobile
  browser journey; Academy has real-server HTTP certification.
- The exact external blocker for deployed certification is the absence of a
  supplied staging deployment URL, authenticated test accounts/admin access,
  deep-health token, seeded clan/Weekly Boss/Hollow Gate/ANBU state, and a
  rollback-capable operator context. Local fixture engineering for the remaining
  mode journeys is also unfinished and therefore is not mischaracterized as an
  external blocker.
- A production deep-health probe, backup-freshness proof, restore drill, live
  Sentry event, cron/lease observation, shared-backend concurrency run, and
  production rollback drill were not executable from the supplied local scope.
- Not every requested fault boundary has a route-level live fault injection.
  Source/focused tests cover many session, binding, save, receipt, lock, and
  settlement failures, and the mission browser proves settlement-response loss,
  but the complete every-mode/every-boundary fault matrix remains unfinished.
- Authored-AI and combat-event foundations are implemented, tested, and used by
  Solo where stated, but the comparison's cross-runtime/downstream adoption is
  incomplete.

Accordingly, the safe handoff is: **code/CI ready for review and staging;
production go-live remains no-go until the missing deployed evidence passes.**

## 31. Gap-closing continuation: durable physical fight consequences

The post-report audit found one release-significant boundary that the original
cutover did not close: mission/story physical consequences were confirmed by a
best-effort client call. A lost response, tab close, or process interruption
could leave a terminal fight without its HP or hospital consequence even though
the combat session itself was authoritative.

The continuation closes that boundary as follows:

- HP/hospital mutation and a fingerprinted `pve-outcome` settlement receipt are
  written atomically in the player save. Exact replay returns the authoritative
  snapshot without rewriting it or manufacturing a save-version bump.
- The former per-run KV marker remains as a seven-day rolling-deploy
  compatibility receipt. Existing markers migrate into the in-save ledger
  without reapplying a consequence; a marker-write interruption is safely
  retryable because the in-save receipt already prevents double application.
- Terminal mission actions reconcile before acknowledging completion. Terminal
  state reads repair an interrupted settlement, including a terminal record
  that is still readable but has reached its expiry time.
- Mission reward queueing refuses to proceed until the physical consequence is
  confirmed, including the durable lost-response replay path.
- The client confirmation retries four times and throws if it cannot obtain a
  durable acknowledgement; it no longer swallows failure as `null`.
- Mission UI state adopts both authoritative characters and save versions.
  Version ordering prevents an older physical-outcome response from overwriting
  a newer queued-claim response when the two requests finish out of order.
- Save-load normalization now preserves the authoritative current HP/chakra/
  stamina while raising obsolete derived maxima. Loading `30/100` into a
  current `500` maximum becomes `30/500`, never a free `500/500` heal. Explicit
  level-up logic remains the owner of intentional full refills.
- The live flee journey asserts the exact consequence immediately, then allows
  only normal timed village regeneration during its reload/retry window.

Executable continuation evidence:

| Gate | Final result |
| --- | --- |
| Focused outcome, binding, wiring, normalization, and ordering tests | 49/49 pass |
| Fault injection | save/receipt atomicity, compatibility-marker failure/retry, wrong owner, legacy migration, lost HTTP response |
| Full repository suite | **4,898/4,898 pass**, 737 suites |
| Whole-client lint and direct TypeScript build | Pass |
| Real built Express mission matrix | **4/4 pass** across desktop/mobile win and flee |
| Standard cross-browser/responsive Playwright matrix | 31 pass, 25 intentional skips, 0 fail |
| Real-server release certification | 61/61 pass |
| Deployment, rollback, dist, size, asset, mission-catalog gates | Pass |
| Root and client dependency audits | 0 vulnerabilities |

During diagnosis, the first new live assertion exposed the load normalizer's
full-heal defect (saved HP was 500 instead of terminal HP). After that fix, an
overly strict assertion observed legitimate one-HP-per-second regeneration;
the test was corrected to assert the exact immediate commit and separately
bound the post-reload state below full HP. A later audit found and fixed the
two-response ordering race described above. These were product and test gaps
found by full-story verification, not hidden as transient noise.

Several command-invocation mistakes were also retained in the record: one
`npm exec tsc -b` invocation printed TypeScript help before the direct compiler
passed; two client-only/root-only scripts were initially launched from the
wrong workspace; and one manually expanded SHA guard stopped before building.
All were corrected, none changed source, and the exact commands subsequently
passed.

This continuation makes the locally exercised combat-mission physical outcome
chain release-grade. It does not erase item 30: deployed shared-backend,
operations, and every-mode browser certification still require staging access
and additional fixtures. The honest verdict remains **local code/CI and the
mission full story are green; global production AAA certification is not yet
proven**.
