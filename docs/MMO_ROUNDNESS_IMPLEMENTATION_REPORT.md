# ShinobiX MMO Roundness Implementation Report

> [!IMPORTANT]
> **HISTORICAL IMPLEMENTATION EVIDENCE.** This report remains authoritative for the implementation and certification work it records, but its rollout recommendations do not define current player availability. See [`LIVE_PRODUCT_STATUS.md`](LIVE_PRODUCT_STATUS.md) for current product truth.

Date: August 6, 2026 (post-merge closeout update)
Branch: `codex/post-merge-release-closeout`
Current `origin/main` base: `cdecc459447c391407f269852cff1f9da59b3251`
Merged operation head verified at task start: `74198d9bad0813038cabf15edb2b7ddc6a575910`
Behavioral reference inspected read-only: a third-party shinobi RPG at `df6dcd0d7d4b23d9cf309ea3a0159f366f764869`

This report accompanies the evidence-first audit in `docs/MMO_ROUNDNESS_AUDIT.md`. The delivered slice upgrades the existing weekly Clan Boss into a server-owned 1–4 human-player Shinobi Operation. It does not introduce a new ordinary-combat engine, a new currency, a new backend, or a parallel boss menu.

## Post-merge release closeout

At closeout start, both a fresh `git fetch --prune origin main` and `git ls-remote origin refs/heads/main` returned the expected `74198d9bad0813038cabf15edb2b7ddc6a575910`. The existing workspace contained unrelated untracked `output/` and `tools/` directories, so certification ran in a new clean linked worktree and did not modify them. During the run, `origin/main` advanced through `0474a2dd0` and `cdecc4594`; those commits change documentation only. The closeout branch was rebased onto the new current main, and `git diff 74198d9..cdecc4594` confirms no runtime, package, workflow, or test-source delta in those two upstream commits.

Closeout changes are release-confidence work only:

- Correct the corrupt en dashes in `api/player/_activity-spine.ts` and three existing corrupt middle-dot labels in player-facing pet source.
- Add `scripts/player-facing-utf8.test.mjs`, scanning only text extensions under `api/player`, `shared`, and `shinobij.client/src` for common `â€“`, `â€”`, `â€™`, `â€œ`, `â€`, `Ã`, and `Â` mojibake families. Assets, dependencies, build output, and generated distributions are outside the scan.
- Make `npm test` install the clean client dependency tree it discovers, eliminating the hidden requirement that another CI step populate `shinobij.client/node_modules` first.
- Add the path-filtered `.github/workflows/clan-boss-operation.yml` gate for Clan Boss, Tower, Activity Spine, shared operation contracts, client operation surfaces, admin/cron adapters, and the two operation certification scripts. It runs `npm ci`, `npm run build:server`, `npm run certify:clan-boss-operation`, and `npm run audit:clan-boss-balance`.
- Make one transient combat-layout width assertion atomic so a WebKit re-render cannot detach the locator between two reads. This changes test code only.
- Repair the party-only kill-switch handoff discovered in the second-pass wiring audit: an intentional party-route 404 now produces a truthful `Solo Compatibility` state and starts only the server-owned one-human path. The real-HTTP certification covers duplicate start, one attempt, one actor, terminal play, and idempotent settlement with parties disabled.
- Add the executable disposable-staging procedure in `docs/CLAN_BOSS_OPERATION_STAGING_CERTIFICATION.md`.

No gameplay, boss phase, combat formula, contribution formula, currency, persistence backend, balance constant, analytics enablement, or size limit changed.

## 1. Outcome and selection rationale

The audit found that ShinobiX already had strong individual systems but weak connective tissue. Clan Boss was the highest-value intervention because it already had weekly cadence, clan competition, persistent boss health, authored Tower content, server settlement, and an existing Clan Hall entry. Extending it could connect eight existing systems without fragmenting players across another mode.

The completed path is:

`Daily Briefing → Activity Spine → Clan Hall → real clan party/finder → sealed N-actor Tower run → server contribution → existing weekly Clan Boss settlement → profession XP + clan progress + bounded sector pressure → activity/world refresh`

The player-facing recommendation surface was deliberately drained while this landed. Activity Spine is now the sole next-action authority in Daily Briefing; the Logbook retains exact rank checklists; the profile rail retains live timers. This reduces menu-dashboard duplication and keeps the shipped client within its unchanged size ratchet.

## 2. Systems now connected

| Existing system | Operation connection |
| --- | --- |
| Daily Briefing | Hosts one server-derived Now / Today / This Week / Long Term activity projection with direct operation navigation. |
| Clan Hall / Clan Boss | Remains the canonical operation entry and weekly clan competition surface. |
| Clan membership | Party eligibility, invitations, public finder results, and operation actors are derived from live server clan membership. |
| N-actor Tower combat | Seals one to four accepted human actors and reuses the four existing authored Clan Boss floor mechanics. |
| Character loadouts | Readiness snapshots the server save's equipped jutsu and equipment slots; start revalidates the party and save state. |
| Professions | Active Healer, Vanguard, and Pet Tamer participants receive bounded role-aware XP through the existing profession progression fields. |
| Hunts / crafting / inventory | Activity copy points hunt materials to the existing Crafter; existing equipped consumables remain consumed by Tower settlement. No operation-only material was invented. |
| Clan progression | The existing persistent weekly boss pool, participation, ranking, treasury, clan-XP, and weekly reward machinery remains authoritative. |
| World sectors | Each existing Clan Boss has a canonical sector. Active runs reduce weekly sector pressure by a capped amount without mutating territory ownership. |
| Identity / history | Contribution thresholds and profession progression reward support and objective play; existing battle history and Clan Boss weekly records remain intact. |
| Admin / telemetry | Admins can inspect aggregate operation health and safely disband only pre-start/stuck-starting parties; aggregate allowlisted events measure the funnel. |

## 3. Player-facing behavior

### Activity Spine

- Four explicit horizons: Now, Today, This Week, and Long Term.
- The server selects recovery, onboarding, reconnect, returner, short-session, weekly, economy, ranked, profession, Tower, and level-band goals.
- Every item includes commitment, eligibility, navigation, purpose, and an explicit blocker where relevant.
- The projection covers early, midgame, late-game, level-cap, and seven-day-returner states.
- Loading, offline, failed-fetch, retry, complete, and blocked states are visible.
- It creates no completion ledger and awards nothing merely for opening it.

### Party and finder

- A clan member can create a public or private party, invite clanmates, accept or decline, join a real public party, leave, kick, transfer leadership, recover leadership after a stale leader, ready/unready, queue/cancel, and disband.
- Population is the real count of currently stored open clan parties and seats. No synthetic population or bots are shown.
- Public solo parties receive a clearly described solo fallback after a bounded two-minute wait.
- Membership changes invalidate every prior ready snapshot, forcing the changed roster to seal current loadouts again.
- Connection is shown as online or stale. A browser refresh can recover the accepted party and the active Tower run.
- Communication is limited to predefined tactical pings: Focus Boss, Clear Adds, Need Healing, Hold, and Ready. It does not create an unmoderated freeform channel.

### Operation and results

- The existing Clan Boss card now shows its real sector, shared pressure, persistent clan boss health, party state, rejoin action, preparation loop, and clan standings.
- The start path seals exactly the accepted 1–4 human members into the existing N-actor Tower session.
- Existing authored mechanics remain `enrage`, `summon`, `regen`, and `bulwark`; Hollow Gate and normal Solo PvE are unchanged.
- Server-observed contribution includes immediate action damage, healing, shielding, cleanses, objective-state changes, action count, and survival.
- Results show role-inclusive contribution thresholds, profession awards, persistent clan progress, and bounded sector pressure.

## 4. Server authority and data architecture

### Authority boundary

The client supplies intent only: action name, target, visibility, ping kind, expected membership version, and request ID. The server derives authentication, player slug, clan, membership, leadership, eligibility, readiness, saved loadout, operation actors, encounter outcome, contribution, profession award, sector consequence, and every reward amount.

`assault-start` rechecks the weekly boss, clan roster, party leader, ready state, membership version, and sealed saves before reserving the existing weekly attempt and creating the Tower run. It never accepts a client member list. `assault-settle` reads the authoritative terminal Tower session and fails closed when its bindings do not match.

### Ephemeral party keys

| Key family | Owner | Retention / behavior |
| --- | --- | --- |
| `clan-boss:party:<cbp-id>` | Clan Boss party service | Two-hour TTL refreshed on mutation/heartbeat; versioned state and last 80 actor/request receipts. |
| `clan-boss:party-player:<slug>` | Clan Boss party service | Two-hour member lookup index; deleted when membership is no longer valid. |
| `clan-boss:party-invites:<slug>` | Clan Boss party service | Two-hour invite index, capped at 20 entries. |
| `clan-boss:party-registry:v1` | Clan Boss party service | Best-effort global hash index used for cursor pagination and reconciliation; party rows remain authoritative. |
| `clan-boss:party-registry:clan:<clan-slug>` | Clan Boss party service | Best-effort per-clan hash index for finder queries, with legacy-scan migration fallback. |
| `clan-boss:party-registry:sweep-cursor` | Clan Boss scheduler | Cursor for bounded reconciliation passes; no reward authority. |

Party state is intentionally ephemeral. Accepted operation binding moves to the durable/retryable Tower and Clan Boss settlement authorities. Terminal party summaries remain only for the TTL window and cannot pay rewards.

### Durable and weekly records

| Record | Integrity mechanism |
| --- | --- |
| Existing Clan Boss weekly progress/start receipts | Existing KV lock plus host/request fingerprint; repeated starts reserve one attempt and bind one party/run. |
| Tower session | Existing server session store; party ID and owner-bound actors are sealed at creation. |
| Contribution | Stored inside the authoritative Tower session and copied to the existing assault record at settlement. |
| Profession XP | `save:<slug>` fail-closed lock plus `clanBoss:<runId>:profession` receipt; last 30 operation receipts retained and save version bumped. |
| Sector pressure | `clan-boss:sector-state:<weekId>`, nine-day TTL, fail-closed lock, 500 run receipts, version increment. |
| Admin recovery | Existing audit domain with before/after, canonical reason, entity ID, and admin actor. |

No database migration is required. The added fields are compatible optional fields in existing JSON records. Old weekly assaults without modern contribution data retain their historical personal-reward calculation; modern records use contribution thresholds. Existing KV export/restore covers the new key families. Rollback can disable parties immediately, retain readable modern records, and allow old solo-compatible starts without deleting data.

## 5. Contribution, rewards, and economy

Contribution is derived from state deltas around accepted human actions. Damage is capped at 12,000 per scored aggregate, healing and shielding at 5,000 each, cleanse at four, objective changes at three, and action credit at 20. An actor must take an accepted action and reach score 60 to be active. Thresholds are field (60+), veteran (220+), and elite (500+).

Modern weekly personal rewards use those role-neutral thresholds: active contributors receive the existing member ryo award; field/veteran/elite grant one/two/three existing Fate Shards. AFK actors receive no personal award. The existing legacy calculation remains for already-recorded weeks without contribution projections.

Profession XP is 50–150 per active run. Healer weights healing/shielding/cleanse; Vanguard weights damage/objectives and retains its existing rank multiplier; Pet Tamer weights objectives/survival. XP uses existing profession fields and rank thresholds, so no parallel progression or currency was added.

Sector pressure begins at 100 each week and a contributing run reduces it by at most eight. The formula requires positive damage and an active contributor. Crossing 75, 50, 25, or 0 emits one idempotent World Herald announcement through the existing village-chat broadcast path. Pressure never changes ownership, travel, essential progression, shops, or ranked-PvP power. This is intentionally an anti-snowball world consequence, not a territorial buff.

The preparation loop uses existing hunt drops, Crafter recipes, consumable inventory, ryo, Fate Shards, Bone Charms, clan XP, and clan treasury settlement. No new faucet, material, token, shared-loot dispute, or player-controlled loot assignment was introduced.

## 6. Reliability, concurrency, and abuse controls

- Full authentication and existing rate limits guard every party/start/settle/admin route.
- Party mutations use the existing fail-closed KV lock, expected membership version, and request-ID fingerprint receipts.
- Reusing a request ID with a different intent conflicts rather than replaying another mutation.
- Start reservation is idempotent and bound to host, party, week, and request fingerprint.
- Settlement banks the run through the existing once-only assault receipt before profession and sector projections; every secondary write has its own run receipt.
- Settlement rereads the final caller save and echoes its current save version so a stale client autosave cannot silently overwrite the award.
- Membership changes clear ready state; clients cannot carry an old legal snapshot into a changed roster.
- Leadership recovery is limited to a real member after the leader has been stale for 45 seconds.
- Player membership indices use atomic compare-and-delete so stale terminal cleanup cannot erase a newer party binding.
- Party joins serialize the active-party check, roster mutation, and index publication on the joining player's key; live reconciliation refuses to overwrite a different, newer binding.
- A leased scheduler reconciles up to 250 registered parties every five minutes, removes stale secondary-index rows, repairs missing member/clan/global indices, releases terminal indices, and discovers authoritative TTL party rows missed by a failed registry write.
- Parties cap at four, public results/admin pages are bounded, invite/receipt histories are capped, and authoritative party rows expire.
- AFK participants must take an accepted action and cross a contribution threshold.
- Admin recovery requires full-admin permission, explicit browser confirmation, canonical reason, exact party version, a fail-closed lock, and an audit entry. Active sessions and reward values are immutable there.
- `DISABLE_CLAN_BOSS_PARTIES=1` disables the party/finder route and restores the compatible solo start path. `DISABLE_CLAN_BOSS=1` remains the complete Clan Boss kill switch.

## 7. Aggregate telemetry and privacy

The optional analytics boundary remains disabled unless the owner enables its existing configuration. The allowlist adds only:

- `activity_recommendation_viewed`
- `clan_boss_party_state_changed`
- `clan_boss_operation_started`
- `clan_boss_operation_settled`

Properties are categorical and bounded: horizon, mode, state category, party-size bucket, queue-wait bucket, contribution category, duration/result/error categories, and feature state. Player names, stable identifiers, saves, inventory, balances, freeform errors, chat, request bodies, and authentication values are not accepted.

## 8. Admin and live operations

`GET /api/admin/clan-boss-operations` shows kill-switch status, registry totals, page totals/statuses, public queues, stale-member counts, missing sessions, versions, ages, readiness, and session binding through cursor pages of up to 500 parties. The Admin Diagnostics UI exposes first/next navigation and distinguishes page counts from registry totals.

`POST /api/admin/clan-boss-operations` supports one recovery action: versioned disband of a forming, queued, or stuck-starting party. It cannot alter active combat, contribution, currency, rewards, profession XP, sector pressure, or settled history. The Admin Diagnostics Clan Boss tab exposes the same aggregate health and guarded recovery.

Recommended staged rollout:

1. Deploy the candidate with the full Clan Boss enabled and `DISABLE_CLAN_BOSS_PARTIES=1`.
2. Verify the legacy-compatible solo start/reconnect/settle path and credentialed admin diagnostics while parties remain disabled.
3. Remove only `DISABLE_CLAN_BOSS_PARTIES` on disposable staging and complete `docs/CLAN_BOSS_OPERATION_STAGING_CERTIFICATION.md` with real Postgres and 1-, 2-, and 4-player human parties.
4. Enable parties in the intended staffed environment only after every staging row has evidence; watch queue wait, abandonment, contribution category, missing-session, and stale-member aggregates.
5. Retain `DISABLE_CLAN_BOSS_PARTIES=1` as the party-only kill switch. Use `DISABLE_CLAN_BOSS=1` only for settlement-authority or weekly-state risk.

## 9. Mobile and accessibility

- The new surfaces use the existing adaptive shell rather than transform-scaling the interface.
- Canonical responsive boundaries are 979px and 559px; grids collapse, roster controls wrap, and action groups grow across the available width.
- Operation buttons have a 44px minimum touch target.
- Keyboard focus uses the existing global focus-visible authority; semantic sections, lists, status regions, labels, `aria-pressed`, `aria-live`, and descriptive button text are present.
- Readiness, status, contribution, and boss state use text in addition to color. Connection uses both text/labels and a symbol.
- Reduced-motion preference disables operation/activity transitions. Combat audio remains governed by the existing mute/audio controls.

Static responsive and accessibility contracts are automated. The real built-client Solo-PvE matrix covers compact portrait through desktop, including the corrected 375×667 short-phone action row. An authenticated browser fixture is still not available for a trustworthy screenshot matrix of every live operation lobby state, so this report does not claim every requested zoom level.

## 10. Verification evidence

### Final automated results

After the command-order dependency described below was closed, the required chain was restarted from clean installs and passed on the current main-derived tree. The local host was Windows with Node 24.15.0; repository CI and the new operation workflow use Node 22, so the first hosted Linux/Node 22 workflow run remains an external confirmation rather than a claimed local result.

| Exact command | Closeout result |
| --- | --- |
| `npm ci` | Passed from the repository root: 174 packages, 0 vulnerabilities. |
| `npm test` | Final second-pass run passed 5,001/5,001 tests in 755 suites. The first ordered closeout run exposed that root discovery imports client test files before the later client install; the new `pretest` performs `npm ci --prefix shinobij.client`, and the full root suite now passes from a clean dependency state. |
| `CI=1 VITE_SENTRY_DSN=https://public@example.invalid/1 VITE_SENTRY_RELEASE=ci VITE_BUILD_COMMIT=cdecc459447c391407f269852cff1f9da59b3251 npm run build` | Final second-pass build passed server build, clean client install/build, distribution verification, and the unchanged size check. Budgeted client code is 7,238,390 bytes against the unchanged 7,245,000-byte ceiling: 6,610 bytes of headroom. The excluded Sentry chunk is 84,545 bytes; all JS/CSS totals 7,322,935 bytes. |
| `npm run certify:release` | Passed 82/82 against the built Express server and isolated in-memory backend. |
| `npm run certify:clan-boss-operation` | Two consecutive final second-pass runs passed a stable 75/75 against the real Express routes and in-memory QA store. The fixed scenario assertions cover 1/2/4 members, ready conflicts/retries, duplicate start, every-member reconnect, authoritative Tower actions, concurrent settlement, terminal index cleanup, and the party-disabled solo-compatible start/action/settlement path; variable combat-turn counts no longer make the headline total drift. |
| `npm run audit:clan-boss-balance` | Passed 12 deterministic seeds per boss for 1/2/4-player parties. Solo parties removed 65.2–77.7% average HP, two-player clear rates were 92–100%, and four-player parties cleared every boss in 7.5–9.1 average rounds. This is offline balance evidence, not human-duration evidence. |
| `npm run soak:smoke` | Passed 24/24 scenarios and 169 calls with 0 errors at 9.9 requests/second against the isolated in-memory store. This is a bounded smoke, not a production or Postgres load test. |
| `npm run check:deployment` | Passed: one replica, `node dist/server.js`, and `/health`. |
| `npm run check:rollback-readiness` | Passed with `ok: true`, no failed checks, and no destructive rollback statements. |
| `npm run test:backup` | Passed 11/11. |
| `npm run test:mission-eligibility` | Passed. |
| `npm run test:release-assets` | Passed: 65 achievement references, 165 badge PNGs, and 21 Pet Home WebPs. |
| `npm run check:tooling-handoffs` | Passed; generated handoff artifacts are current. |
| `npm audit --omit=dev --audit-level=high` | Passed at the root with 0 vulnerabilities. |
| `cd shinobij.client && npm ci` | Passed: 319 packages, 0 vulnerabilities. |
| `npm run lint` | Passed. Babel reported only the pre-existing large-file deoptimization warning for `PetColiseum.tsx`. |
| `npm run build` | Passed the standalone client production build. The CI-instrumented root build above is the artifact used for the final CI-mode browser runs. |
| `CI=1 npm run test:e2e` | Passed 87 tests, with 74 project-filtered skips and no retries, across desktop Chromium/Firefox/WebKit, compact Chromium, 390×844 Chromium/WebKit, and tablet Chromium. The final run used the CI-instrumented build and its required dummy Sentry values. |
| `npm run test:e2e:live` | Passed 9 tests with 1 intentional project skip. |
| `CI=1 npm run test:e2e:warfront` | Passed 8 tests with 16 expected project/fixture skips. |
| `npm audit --omit=dev --audit-level=high` (client) | Passed with 0 vulnerabilities. |

The initial non-CI six-worker browser probes exposed two test-environment issues: a re-render could detach the mobile combat width locator between two reads, and a reused preview server could leave the Warfront bundle without the expected DPR build settings. The width read is now atomic; the required clean CI-mode runs above used fresh builds/servers and passed without retries. No product behavior or budget was changed for either issue.

### Code and contract evidence

- Audit/system graph: `docs/MMO_ROUNDNESS_AUDIT.md`
- Shared contracts: `shared/activity-spine.ts`, `shared/clan-boss-operation.ts`, `shared/product-analytics.ts`
- Party authority: `api/clan-boss/_party.ts`, `api/clan-boss/party.ts`
- Operation lifecycle: `api/clan-boss/assault-start.ts`, `api/clan-boss/assault-settle.ts`
- N-actor contribution hook: `api/towers/action.ts`, `api/towers/_tower-session.ts`, `api/clan-boss/_contribution.ts`
- Economy/world connections: `api/clan-boss/_profession.ts`, `api/clan-boss/_sector-state.ts`, `api/clan-boss/_storage.ts`
- Player experience: `shinobij.client/src/components/ActivitySpine.tsx`, `shinobij.client/src/components/ClanBossPartyLobby.tsx`, `shinobij.client/src/components/ClanBossOperationComms.tsx`, `shinobij.client/src/screens/ClanBoss.tsx`
- Admin: `api/admin/clan-boss-operations.ts`, `shinobij.client/src/screens/AdminDiagnosticsPanel.tsx`
- Focused tests: `api/clan-boss/_party.test.ts`, `_contribution.test.ts`, `_profession.test.ts`, `_sector-state.test.ts`, `api/player/_activity-spine.test.ts`, `shinobij.client/src/clan-boss-operation.test.ts`
- Encoding guard: `scripts/player-facing-utf8.test.mjs`
- Dedicated CI gate: `.github/workflows/clan-boss-operation.yml`
- Disposable-staging runbook: `docs/CLAN_BOSS_OPERATION_STAGING_CERTIFICATION.md`
- Rollout authority: `FEATURE_FLAG_RELEASE_MATRIX.md`

The repository's four stable visual baselines remain in `shinobij.client/e2e-visual/__snapshots__`, and the full preview matrix passed. No operation-specific screenshots are claimed: the available browser harness does not provide deterministic authenticated multi-member party/run fixtures, and cosmetic screenshots would not prove reconnect, settlement, or authority.

## 11. Acceptance-scenario status

| Scenario | Status and evidence |
| --- | --- |
| New-player direction | Server activity tests cover onboarding priority and blockers; the preview journey and live registration/relogin passed. Existing Academy remains unchanged. |
| Midgame direction | Activity tests cover level 35 and explicit solo/social/economy/long-term choices. |
| Low-population formation | Party tests cover one-player queue, real counts, and two-minute fallback; client contract forbids presenting offline players as AI. |
| Full cooperative operation | The stable 75/75 real Express HTTP certification creates, readies, starts, reconnects, and settles 1-, 2-, and 4-player parties against the actual Tower action route, then proves the party-disabled one-human compatibility path through idempotent settlement. A multi-browser human playthrough against disposable-staging Postgres remains outstanding and is specified in the staging runbook. |
| Reconnect | The HTTP certification refreshes every accepted member, rediscovers the same active run, and proves that a lost ready response replays without duplicating state. Deliberate packet interruption and every-member browser reconnect against staging remain outstanding. |
| Lost start/settlement response | Real HTTP duplicate-start, settle-retry, and concurrent-settle contracts bank once; start, party, profession, and sector projections remain receipt-protected. Forward-then-drop packet tests against staging remain outstanding. |
| World consequence | Sector tests prove canonical metadata, active-contribution requirement, per-run cap, one-time 75/50/25/0 herald milestones, receipt replay, and no territory mutation. |
| Economy loop | Existing hunt/Crafter/consumable path is surfaced; profession XP and modern reward thresholds are tested. |
| Mobile | Responsive contracts and the built-client combat matrix pass across desktop/mobile projects. Operation-specific authenticated checks at 390×844, 1440×900, and 150% zoom remain staging work. |
| Administration | Full-admin route and client guard require reason, confirmation, version, safe status, lock, and audit. Credentialed diagnostics and safe-disband staging smoke remain outstanding. |

## 12. Before/after scorecard

Scores use a conservative 1–5 evidence scale, where 5 means coherent, operationally supported, and verified in representative end-to-end use—not visual ambition alone.

| Dimension | Before | After | Evidence-based change |
| --- | ---: | ---: | --- |
| Early-game clarity | 3 | 4 | Server activity projection prioritizes onboarding/recovery and explains blockers; existing Academy remains owner. |
| Midgame clarity | 2 | 4 | Daily, economy, ranked, profession, social, and long-term options are visible from one authority. |
| Endgame clarity | 2 | 3 | Cap/returner/weekly/Tower goals exist; deeper rotating endgame campaigns remain deferred. |
| Solo PvE | 4 | 4 | Preserved normal PvE/Hollow Gate; adds an honest bounded solo operation fallback. |
| Group PvE | 1 | 4 | Real 1–4 server party, N-actor boss, reconnect, role contribution, settlement, and admin path. |
| Competitive PvP | 4 | 4 | Intentionally unchanged; activity spine surfaces the existing ranked objective. |
| Social systems | 2 | 4 | Real clan finder, invites, readiness, leadership recovery, reconnect, and tactical pings. |
| Clan/village purpose | 3 | 4 | Clan roster, weekly boss pool, standings, participation, and treasury now drive a live group operation; village linkage remains lighter. |
| World consequence | 2 | 3 | Visible capped weekly sector pressure; no ownership or ranked-power snowball. |
| Economy | 3 | 4 | Existing hunt → Crafter → consumable → operation loop is explained and authoritative. |
| Professions | 2 | 4 | Existing profession identity gains bounded role-aware operation XP. |
| Low-population viability | 2 | 4 | 1–4 scale, truthful counts, two-minute fallback, no fabricated actors. |
| Mobile UX | 3 | 4 | Responsive/touch contracts plus the built-client compact/mobile/tablet combat matrix pass; exhaustive manual zoom remains staging work. |
| Accessibility | 3 | 4 | Textual states, semantics, focus authority, touch targets, reflow, and reduced motion. |
| Reliability | 3 | 4 | Version locks, receipts, fail-closed settlement, TTLs, reconnect, and stale-save defense. |
| Live operations | 3 | 4 | Aggregate diagnostics, kill switches, bounded recovery, audit, and rollout matrix. |
| Maintainability | 3 | 4 | Shared contracts/domain modules, no App growth/new framework, and a net product drain under the unchanged size ceiling. |

## 13. Known limitations and residual risks

1. Contribution records immediate authoritative state deltas around each accepted human action. Damage or support caused later by environmental ticks/AI continuation is not always attributable to the originating player. Interrupts, revives, and add-control are not separate score axes yet.
2. The four retained authored bosses provide enrage, adds, regeneration, and bulwark mechanics, but this pass did not build a new multi-phase objective encounter. Actual human duration against the player-facing 10–20 minute commitment was not measured with live 1-, 2-, and 4-player staging groups.
3. The operation uses HTTP/KV polling and the existing Tower action protocol. Hermetic HTTP concurrency/reconnect certification passes, but no disposable-staging Postgres, cross-replica, packet-shaping, or production load test was run.
4. Sector pressure now produces one-time village-chat Herald reactions, but it still does not alter missions, hunts, profession contracts, village projects, services, ownership, or ranked power. Any deeper consequence needs a separate balance/economy contract.
5. Village purpose gains shared world reaction but no direct village contribution or reward ledger in this slice. Clan purpose received the complete progression connection.
6. Weekly personal Ryo and Fate Shards intentionally remain in the existing once-only weekly settlement rather than each operation result. The UI now states this timing explicitly; changing it would create a new payout cadence and needs an economy decision.
7. Operation-specific authenticated viewport checks, 150% zoom, live admin credentials, human duration, support attribution, AFK exclusion, and the disposable-staging run remain unverified. The hermetic protocol, general browser, live-combat, and Warfront gates do not replace those external checks.

## 14. Deferred backlog, ordered by player value and risk

1. **Disposable-staging certification** — execute `docs/CLAN_BOSS_OPERATION_STAGING_CERTIFICATION.md` against real Postgres with packet interruption, then capture authenticated lobby/entry/result/admin viewport evidence and measure human duration against the advertised 10–20 minute commitment. Highest release-confidence value, low product risk.
2. **Deeper sector consequence contract** — let bounded weekly pressure influence a rotating mission/hunt/profession contract or village project without ownership power or essential lockout. High world-cohesion value, medium economy/balance risk.
3. **Contribution attribution v2** — carry source ownership through delayed statuses, adds, prevented damage, interrupts, and revives; keep caps and role-neutral thresholds. Medium player-fairness value, medium combat risk.
4. **Featured-window scheduling and population forecast** — concentrate the small beta population without creating another queue or faking estimates. Medium social value, low-to-medium operations risk.
5. **Additional authored operation phases** — only after contribution and staging telemetry prove the base loop; teach one mechanic at a time. Medium content value, high balance/QA cost.

## 15. Intentional non-changes

- Ordinary PvP remains the truth source for shinobi combat formulas.
- Normal Solo PvE remains on its authoritative path.
- Hollow Gate remains normal PvE.
- Pet and Chronicle combat remain separate intentional engines.
- Bloodlines and Legacies remain separate identity systems.
- No generic skill tree, currency, backend, permanent ladder, eight-player raid, freeform party chat, fabricated population, or AI human substitute was added.
- Railway, Express, Socket.IO, Supabase/Postgres, and the accepted one-replica deployment boundary remain unchanged.
- Production analytics remain opt-in and were not enabled.
