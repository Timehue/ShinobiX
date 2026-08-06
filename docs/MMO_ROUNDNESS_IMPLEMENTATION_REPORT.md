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

Static responsive and accessibility contracts are automated. The real built-client Solo-PvE matrix covers compact portrait through desktop, including the corrected 375×667 short-phone action row. An authenticated browser fixture is still not available for a trustworthy screenshot matrix of every live operation lobby state, so this report does not claim every requested zoom level.

## 10. Verification evidence

### Final automated results

| Gate | Exact result |
| --- | --- |
| Broad root discovery | The completed run passed 4,946 tests and surfaced 15 failures: four stale source-wiring guards were corrected and pass in the 40/40 guard rerun; the other 11 were client worker-load failures under the Windows-locked partial `node_modules`, and those exact files pass 46/46 in the clean client worktree. A single-worktree all-green rerun is therefore not claimed. |
| Final focused cross-cutting contracts | 56 passed, 0 failed across party pagination/reconciliation/index safety, PvE guard/mastery wiring, authored encounter configuration, and deterministic balance ratchets. |
| Save-version focused coverage | 14 passed, 0 failed. |
| Clan Boss real-HTTP operation certification | Passed 110/110 against the real Express server and in-memory QA store: 1/2/4 members, ready conflicts/retries, every-member reconnect, real Tower actions, duplicate starts, concurrent settle, and terminal index release. |
| Clan Boss deterministic balance audit | Passed across 12 seeds per boss and 1/2/4-player parties. Solo parties removed 65.2–77.7% average HP; full parties cleared every boss in 7.5–9.1 average rounds; two-player clear rates were 92–100%. This is offline balance evidence, not human-duration evidence. |
| Clean client ESLint / production build | Passed in the isolated installed worktree after every final TSX/CSS change. The main worktree's dependency refresh hit a Windows `EPERM` lock on the native Rolldown binding, so no destructive retry was attempted. |
| Server TypeScript build | Passed. |
| Distribution verification | The server build passed in the main worktree and the final client build passed in the isolated worktree. The earlier combined distribution verification passed, but it was not re-claimed after the main client dependency lock. |
| Client-size ratchet | Passed at 7,243,458 budgeted bytes against the unchanged 7,245,000-byte threshold with a dummy Sentry DSN enabled; initial graph 1.37 MB raw / 363.3 KB gzip. This is only 1,542 bytes of raw-budget headroom, so the next feature must drain or split product code rather than raise the ratchet. |
| Release certification | Passed 82/82 against the built Express server and isolated in-memory backend. |
| Deployment / rollback | Both passed; one Railway replica, `node dist/server.js`, `/health`, and no destructive rollback statements. |
| Mission eligibility / release assets | Passed; 65 achievement references, 165 badge PNGs, and 21 Pet Home WebPs verified. |
| Tooling handoffs | Passed after regenerating the design-token artifact for the new 479px boundary; the economy artifacts remained byte-identical. |
| Root / client production dependency audits | Both passed with 0 vulnerabilities. |
| `test:e2e` | 86 passed, 75 project-filtered/skipped, 0 failed across Chromium, Firefox, WebKit, 360×640, 390×844, and 768×1024 projects. |
| `test:e2e:visual` | 4 passed, 0 failed. |
| `test:e2e:visual:size` | Passed: 4 files, 2,634,130 bytes under the 3,145,728-byte cap. |
| `test:e2e:live` | 9 passed, 1 intentional project skip, 0 failed in 3.8 minutes. Desktop/mobile combat matrices, registration/relogin, mission recovery, and the real Hospital discharge branch after a failed flee all passed. |
| `test:e2e:warfront` | 8 passed, 16 expected project/fixture skips, 0 failed in 2.7 minutes. All four DPR/alignment projects passed through a real demand-rendered R3F geometry seam; the full scene's functional and context-loss coverage remained active. |

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
| Full cooperative operation | The real Express HTTP certification creates, readies, starts, reconnects, and settles 1-, 2-, and 4-player parties against the actual Tower action route. A multi-browser human playthrough remains staging work. |
| Reconnect | The HTTP certification refreshes every accepted member, rediscovers the same active run, and proves that a lost ready response replays without duplicating state. Deliberate packet loss against staging remains outstanding. |
| Lost settlement response | Real HTTP settle retries and concurrent settles bank once; start, party, profession, and sector projections remain receipt-protected. External packet shaping was not used. |
| World consequence | Sector tests prove canonical metadata, active-contribution requirement, per-run cap, one-time 75/50/25/0 herald milestones, receipt replay, and no territory mutation. |
| Economy loop | Existing hunt/Crafter/consumable path is surfaced; profession XP and modern reward thresholds are tested. |
| Mobile | Responsive contracts and the built-client combat matrix pass across desktop/mobile projects; the 375×667 jutsu hit-target defect is fixed and visually inspected. Operation-specific authenticated screenshots and every manual zoom state remain unverified. |
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
| Mobile UX | 3 | 4 | Responsive/touch contracts plus the built-client compact/mobile/tablet combat matrix pass; exhaustive manual zoom remains staging work. |
| Accessibility | 3 | 4 | Textual states, semantics, focus authority, touch targets, reflow, and reduced motion. |
| Reliability | 3 | 4 | Version locks, receipts, fail-closed settlement, TTLs, reconnect, and stale-save defense. |
| Live operations | 3 | 4 | Aggregate diagnostics, kill switches, bounded recovery, audit, and rollout matrix. |
| Maintainability | 3 | 4 | Shared contracts/domain modules, no App growth/new framework, and a net product drain under the unchanged size ceiling. |

## 13. Known limitations and residual risks

1. Contribution records immediate authoritative state deltas around each accepted human action. Damage or support caused later by environmental ticks/AI continuation is not always attributable to the originating player. Interrupts, revives, and add-control are not separate score axes yet.
2. The four retained authored bosses provide enrage, adds, regeneration, and bulwark mechanics, but this pass did not build a new multi-phase objective encounter. Expected 8–15 minute duration was not measured with live 1-, 2-, and 4-player staging groups.
3. The operation uses HTTP/KV polling and the existing Tower action protocol. Hermetic HTTP concurrency/reconnect certification passes, but no disposable-staging Postgres, cross-replica, packet-shaping, or production load test was run.
4. Sector pressure now produces one-time village-chat Herald reactions, but it still does not alter missions, hunts, profession contracts, village projects, services, ownership, or ranked power. Any deeper consequence needs a separate balance/economy contract.
5. Village purpose gains shared world reaction but no direct village contribution or reward ledger in this slice. Clan purpose received the complete progression connection.
6. Weekly personal Ryo and Fate Shards intentionally remain in the existing once-only weekly settlement rather than each operation result. The UI now states this timing explicitly; changing it would create a new payout cadence and needs an economy decision.
7. Operation-specific authenticated screenshots, every requested zoom state, live admin credentials, real human 8–15 minute duration, and a disposable-staging run remain unverified. The hermetic protocol, general visual, live-combat, and Warfront gates do not replace those external checks.

## 14. Deferred backlog, ordered by player value and risk

1. **Disposable-staging certification** — run the proven 1/2/4-player protocol against Postgres and cross-replica conditions with packet shaping, then capture authenticated lobby/entry/result/admin viewport evidence and measure human 8–15 minute duration. Highest release-confidence value, low product risk.
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
