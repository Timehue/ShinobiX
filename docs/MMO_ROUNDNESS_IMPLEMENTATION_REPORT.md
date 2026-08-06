# ShinobiX MMO Roundness Implementation Report

Date: August 5, 2026  
Branch: `codex/aaa-mmo-roundness`  
ShinobiX base: `0960a192cfc383bd05a6c6d004c88b12b2754384`  
Behavioral reference inspected read-only: TheNinjaRPG `df6dcd0d7d4b23d9cf309ea3a0159f366f764869`

This report accompanies the evidence-first audit in `docs/MMO_ROUNDNESS_AUDIT.md`. The delivered slice upgrades the existing weekly Clan Boss into a server-owned 1–4 human-player Shinobi Operation. It does not introduce a new ordinary-combat engine, a new currency, a new backend, or a parallel boss menu.

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

Sector pressure begins at 100 each week and a contributing run reduces it by at most eight. The formula requires positive damage and an active contributor. Pressure is visible context and never changes ownership, travel, essential progression, shops, or ranked-PvP power. This is intentionally an anti-snowball world consequence, not a territorial buff.

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
- Parties cap at four, public results/admin scans are bounded, invite/receipt histories are capped, and ephemeral keys expire.
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

`GET /api/admin/clan-boss-operations` shows kill-switch status, party totals/statuses, public queues, stale-member counts, missing sessions, versions, ages, readiness, and session binding for up to 500 parties.

`POST /api/admin/clan-boss-operations` supports one recovery action: versioned disband of a forming, queued, or stuck-starting party. It cannot alter active combat, contribution, currency, rewards, profession XP, sector pressure, or settled history. The Admin Diagnostics Clan Boss tab exposes the same aggregate health and guarded recovery.

Recommended staged rollout:

1. Deploy with the full Clan Boss enabled and `DISABLE_CLAN_BOSS_PARTIES=1`; verify legacy solo compatibility and admin visibility.
2. Enable parties on disposable staging; exercise 1-, 2-, and 4-player create/ready/start/reconnect/settle/retry flows.
3. Enable for beta under staffed monitoring; watch queue-wait, abandonment, contribution category, missing-session, and stale-member aggregates.
4. Roll back party behavior with `DISABLE_CLAN_BOSS_PARTIES=1`; use full `DISABLE_CLAN_BOSS=1` only for settlement or weekly-state risk.

## 9. Mobile and accessibility

- The new surfaces use the existing adaptive shell rather than transform-scaling the interface.
- Canonical responsive boundaries are 979px and 559px; grids collapse, roster controls wrap, and action groups grow across the available width.
- Operation buttons have a 44px minimum touch target.
- Keyboard focus uses the existing global focus-visible authority; semantic sections, lists, status regions, labels, `aria-pressed`, `aria-live`, and descriptive button text are present.
- Readiness, status, contribution, and boss state use text in addition to color. Connection uses both text/labels and a symbol.
- Reduced-motion preference disables operation/activity transitions. Combat audio remains governed by the existing mute/audio controls.

Static responsive and accessibility contracts are automated. An authenticated browser fixture was not available for a trustworthy screenshot matrix of the live lobby/operation states, so this report does not claim manual proof at 360×640 through ultrawide or every requested zoom level.

## 10. Verification evidence

### Final automated results

| Gate | Exact result |
| --- | --- |
| Clean full root test suite after implementation | 4,986 passed, 0 failed across 752 suites. |
| Focused party/contribution/profession/sector/activity contracts | 54 passed, 0 failed before the final client drain; all contracts were also included in the final 4,986-test pass. |
| Save-version focused coverage | 14 passed, 0 failed. |
| Clean client ESLint | Passed. |
| Clean client production build | Passed. |
| Server TypeScript build | Passed. |
| Distribution verification | Passed: server 95.9 KB, client 284.8 MB, no authoring sources. |
| Client-size ratchet | Passed at 7,241,865 budgeted bytes against the unchanged 7,245,000-byte threshold; initial graph 1.37 MB raw / 363.3 KB gzip. The optional CI Sentry environment could not be injected under the desktop command policy, so CI remains the instrumented authority. |
| Release certification | Passed 82/82 against the built Express server and isolated in-memory backend. |
| Deployment / rollback | Both passed; one Railway replica, `node dist/server.js`, `/health`, and no destructive rollback statements. |
| Mission eligibility / release assets | Passed; 65 achievement references, 165 badge PNGs, and 21 Pet Home WebPs verified. |
| Tooling handoffs | Passed after making generated JSON/CSV line endings deterministic on Windows. |
| Root / client production dependency audits | Both passed with 0 vulnerabilities. |
| `test:e2e` | 86 passed, 75 project-filtered/skipped, 0 failed across Chromium, Firefox, WebKit, 360×640, 390×844, and 768×1024 projects. |
| `test:e2e:visual` | 4 passed, 0 failed. |
| `test:e2e:visual:size` | Passed: 4 files, 2,634,130 bytes under the 3,145,728-byte cap. |
| `test:e2e:live` | 8 passed, 1 skipped, 1 failed. Existing mobile Solo-PvE at 375×667 reports the first jutsu center intercepted by `combat-layout has-rookie-tip`; desktop live, registration/relogin, mission recovery, flee, and mobile PvP passed. The operation CSS is scoped and does not alter ordinary combat. |
| `test:e2e:warfront` | Timed out after 904 seconds with no test summary or assertion output; status is unverified. The local port/process cleaned up. |

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
- Rollout: `FEATURE_FLAG_RELEASE_MATRIX.md`

The repository's four stable visual baselines remain in `shinobij.client/e2e-visual/__snapshots__`, and the full preview matrix passed. No operation-specific screenshots are claimed: the available browser harness does not provide deterministic authenticated multi-member party/run fixtures, and cosmetic screenshots would not prove reconnect, settlement, or authority.

## 11. Acceptance-scenario status

| Scenario | Status and evidence |
| --- | --- |
| New-player direction | Server activity tests cover onboarding priority and blockers; the preview journey and live registration/relogin passed. Existing Academy remains unchanged. |
| Midgame direction | Activity tests cover level 35 and explicit solo/social/economy/long-term choices. |
| Low-population formation | Party tests cover one-player queue, real counts, and two-minute fallback; client contract forbids presenting offline players as AI. |
| Full cooperative operation | Start/settle code binds the server party to N-actor Tower and role-inclusive settlement; clean full suite passed. A multi-browser manual playthrough remains staging work. |
| Reconnect | Active party lookup, heartbeats, pending-run discovery, rejoin UI, and stale-leader recovery are implemented and structurally tested. A forced-network browser scenario remains staging work. |
| Lost settlement response | Existing run banking plus start/party/profession/sector receipts are retry-safe; duplicate banking tests pass. No packet-drop browser fixture was added. |
| World consequence | Sector tests prove canonical metadata, active-contribution requirement, per-run cap, receipt replay, and no territory mutation. |
| Economy loop | Existing hunt/Crafter/consumable path is surfaced; profession XP and modern reward thresholds are tested. |
| Mobile | Responsive source contracts plus the broad compact/mobile/tablet preview matrix pass. The live suite separately exposed an existing 375×667 Solo-PvE jutsu hit-target defect; operation-specific authenticated screenshots and manual zoom checks remain unverified. |
| Administration | Full-admin route and client guard require reason, confirmation, version, safe status, lock, and audit. No credentialed browser smoke was performed. |

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
| Mobile UX | 3 | 3 | Responsive/touch contracts implemented; full manual viewport matrix is still outstanding. |
| Accessibility | 3 | 4 | Textual states, semantics, focus authority, touch targets, reflow, and reduced motion. |
| Reliability | 3 | 4 | Version locks, receipts, fail-closed settlement, TTLs, reconnect, and stale-save defense. |
| Live operations | 3 | 4 | Aggregate diagnostics, kill switches, bounded recovery, audit, and rollout matrix. |
| Maintainability | 3 | 4 | Shared contracts/domain modules, no App growth/new framework, and a net product drain under the unchanged size ceiling. |

## 13. Known limitations and residual risks

1. Contribution records immediate authoritative state deltas around each accepted human action. Damage or support caused later by environmental ticks/AI continuation is not always attributable to the originating player. Interrupts, revives, and add-control are not separate score axes yet.
2. The four retained authored bosses provide enrage, adds, regeneration, and bulwark mechanics, but this pass did not build a new multi-phase objective encounter. Expected 8–15 minute duration was not measured with live 1-, 2-, and 4-player staging groups.
3. The operation uses HTTP/KV polling and the existing Tower action protocol. The existing Socket.IO load harness was not extended because this party flow does not use Socket.IO. No production load test was run.
4. Party cleanup primarily relies on the two-hour KV TTL plus index cleanup on observed invalid state. There is no separate scheduled party sweeper.
5. Admin enumeration is intentionally capped at 500 live party keys; larger scale would need indexed pagination before raising the one-replica scaling boundary.
6. Sector pressure is contextual and weekly only. It does not yet change missions, hunts, profession contracts, village projects, services, or NPC reactions.
7. Village purpose gains shared world context but no direct village contribution ledger in this slice. Clan purpose received the complete connection.
8. Weekly personal rewards are still distributed through the existing weekly Clan Boss authority, not immediately by each operation result. This avoids a new faucet but makes the reward timing less immediate.
9. Operation screenshots, multi-client reconnect, packet-loss settlement, every requested zoom state, live admin credentials, and a disposable-staging load run remain unverified. The general preview matrix passed, but the live gate has one existing 375×667 Solo-PvE hit-target failure and the Warfront DPR gate timed out. These outcomes prevent describing the whole product as fully production-certified.

## 14. Deferred backlog, ordered by player value and risk

1. **Deterministic multi-client staging certification** — add authenticated fixtures for 1/2/4-player ready/start/refresh/settle/lost-response flows, then capture the activity/lobby/entry/result/admin viewport matrix. Highest release-confidence value, low product risk.
2. **Operation-specific hermetic load/reconnect harness** — drive the HTTP party and Tower protocols through ramp, queue, readiness, forced reconnect, settle, and TTL cleanup; define evidence-based single-replica triggers. High reliability value, medium engineering risk.
3. **Deeper sector consequence contract** — let bounded weekly pressure influence a rotating mission/hunt/profession contract or village project without ownership power or essential lockout. High world-cohesion value, medium economy/balance risk.
4. **Contribution attribution v2** — carry source ownership through delayed statuses, adds, prevented damage, interrupts, and revives; keep caps and role-neutral thresholds. Medium player-fairness value, medium combat risk.
5. **Featured-window scheduling and population forecast** — concentrate the small beta population without creating another queue or faking estimates. Medium social value, low-to-medium operations risk.
6. **Party lifecycle index/sweeper** — add a bounded party registry and hermetic cleanup/reconciliation job before population makes key scans material. Medium reliability value, low risk.
7. **Village reaction layer** — news/herald/project acknowledgment for sector pressure and clan clears, with no new reward ledger. Medium world-believability value, low economy risk.
8. **Additional authored operation phases** — only after contribution and staging telemetry prove the base loop; teach one mechanic at a time. Medium content value, high balance/QA cost.

## 15. Intentional non-changes

- Ordinary PvP remains the truth source for shinobi combat formulas.
- Normal Solo PvE remains on its authoritative path.
- Hollow Gate remains normal PvE.
- Pet and Chronicle combat remain separate intentional engines.
- Bloodlines and Legacies remain separate identity systems.
- No generic skill tree, currency, backend, permanent ladder, eight-player raid, freeform party chat, fabricated population, or AI human substitute was added.
- Railway, Express, Socket.IO, Supabase/Postgres, and the accepted one-replica deployment boundary remain unchanged.
- Production analytics remain opt-in and were not enabled.
