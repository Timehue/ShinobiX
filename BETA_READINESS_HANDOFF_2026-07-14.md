# ShinobiX Beta Readiness Handoff — 2026-07-14

## 1. Executive verdict

| Release stage | Verdict | Basis |
| --- | --- | --- |
| Internal testing | Ready | Builds, 3,138-test suite, focused authority tests, topology, rollback-readiness, asset, size, lint, and dependency gates pass. |
| Closed alpha | Ready with monitoring | Core loop has prior production evidence and high-risk reward flags can remain closed. Limit accounts and retain emergency controls. |
| Controlled public beta | **Not certified on the current deployment yet** | Live deep health/backup and the two-role admin matrix now pass. First-server-reward evidence, live Clan Boss/War evidence, a repeated restore drill, and post-deploy proof that the local latency mitigation restores the SLO remain. |
| Wider public beta | Not ready | Real-storage concurrency, complete authority migrations, authenticated load, staffed war evidence, and broader live operations are incomplete. |
| Full release | Not ready | Late-game balance, authority migration, operational scale, moderation, and rollback execution remain beta work. |

The shortest path to controlled beta is: deploy and remeasure the roster/bloodline latency mitigation, certify the fresh-account journey, run Clan Boss and staffed War evidence, confirm backup/rollback owners, then integrate and deploy the candidate cleanly. Clan Boss and Village/Sector War do not need blanket launch shutdowns.

## 2. Work completed

- Added an aggregate-only population/economy report: level bands, ranks, professions, villages, exam holds, wallet/bank ryo percentiles, Academy claims, Tower participation, malformed saves, and hospital soft-lock risk. Raw saves and identifiers never leave the server helper.
- Extended beta event vocabulary and added aggregate mission reward duplicate/failure signals.
- Extended the existing full-admin beta metrics endpoint with opt-in batched save aggregation and JSON/text daily report output.
- Added a secure CLI daily report. Admin credentials stay in headers; remote plaintext HTTP is refused.
- Added a fail-closed release-certification evidence validator covering all 19 required journey steps, request IDs, final persisted state, dedicated-account labeling, cleanup, duplicate reward, wrong account, expiry, and retry/idempotency.
- Completed server-authoritative C/B/A/S combat missions: sealed start route, server-resolved actions, winning-session validation, durable claim queue, authority-tagged single-use claim token, and replay/wrong-account/loss rejection.
- Completed server-authoritative Weekly Boss contribution: server-sealed score-attack session, attempt reservation, server stamina charge, server-derived boss HP delta, once settlement, and consumable deduction. Public client-reported damage remains rejected.
- Added hostile authority tests for wrong player, mission, run, membership, expiry, incomplete/lost session, reward drift, and replay.
- Hardened Clan Boss before live staging: party creation now fails closed against the authoritative clan roster; assault starts bind a client request ID to one attempt/run and recover the same fight after a lost response; damage is idempotent by run ID even if the side-record write fails; participation/defeat point awards repair themselves on retry; and weekly treasury rewards commit their receipt in the same clan-record write before the week can close.
- Hardened Village/Sector War before its staffed event: combat, Card, and Pet outcomes now commit a durable per-battle receipt with the Control-HP mutation; a lost response cannot apply the battle twice; captured contests remain as inert audit records; combat tokens seal both fighters and their villages; and only a participating fighter can register a pristine, post-contest PvP session while holding the same lock as the first move and sealing defender terrain.
- Corrected restore/rollback tooling: `drill:restore` now invokes the evidence-producing export+restore drill rather than plain restore; target checksums and representative records verify before the database transaction commits; the readiness gate rejects a miswired drill command; and the runbooks now document the real hybrid source variables, empty-target/no-overwrite rule, isolated overlay boot, cleanup, operator assignments, UTC incident timeline, and player notices.
- Added an exact staged migration plan for higher-rank missions, Weekly Boss, Hollow Gate, and story/event Arena fights without creating another combat engine.
- Added live-operations, controlled-war, release-certification, and level 10–100 progression-spine documentation.
- Exposed deployment, rollback-readiness, backup-test, restore-drill, beta report, and beta certification commands in `package.json`.
- Created focused GitHub issues [#8](https://github.com/Timehue/ShinobiX/issues/8) through [#21](https://github.com/Timehue/ShinobiX/issues/21). There are no open PRs.

## 3. Release blockers

### P0

- [#21](https://github.com/Timehue/ShinobiX/issues/21): the isolated fresh-account creation, companion, save, logout, and second-login path now passes after fixing starter-companion persistence. Complete the first server-settled reward and hostile/retry cases on the deployed candidate.

### P1

- **Local mitigation complete; deployment proof pending:** the sampled 15-minute p95 was 4,513.4 ms against the 1,500 ms target, despite zero server errors. Coarse player-domain GETs averaged 4,188.4 ms and bloodlines-domain GETs averaged 9,910.3 ms. The hot full-roster and bloodline-list paths now use the existing process-local TTL cache with single-flight, so concurrent polls share one remote all-save `mget` and reuse the immutable result for 60 seconds. The edge TTL was reduced to one second to preserve the prior freshness budget. Deploy the candidate, remeasure the 15-minute SLO, and add exact subroute timing if it remains unhealthy.
- Railway variables confirm Clan Boss and Village War are enabled: neither `DISABLE_CLAN_BOSS` nor `DISABLE_VILLAGE_WAR` is set. The two retired client-trust flags are also unset.
- [#15](https://github.com/Timehue/ShinobiX/issues/15): certify Clan Boss end to end while it remains enabled and monitored.
- [#18](https://github.com/Timehue/ShinobiX/issues/18): live route-level matrix completed successfully with redacted evidence.
- [#10](https://github.com/Timehue/ShinobiX/issues/10): execute disposable rollback/current deployed release-health certification.
- [#9](https://github.com/Timehue/ShinobiX/issues/9): run Village/Sector War as scheduled, staffed beta events until live concurrency evidence exists.

### P2 post-beta

- [#13](https://github.com/Timehue/ShinobiX/issues/13): finish Hollow Gate combat authority before enabling uncapped valuable local-combat rewards there.
- [#16](https://github.com/Timehue/ShinobiX/issues/16): continue moderation certification for public user-generated content. There are no public creator reward payouts, and AI generation already has an OpenAI-side limit, so neither is an immediate launch-disable condition.
- [#14](https://github.com/Timehue/ShinobiX/issues/14) and [#17](https://github.com/Timehue/ShinobiX/issues/17): verify localized milestone guidance and level 50–100 spine against representative saves.
- Complete authoritative event emitters in [#11](https://github.com/Timehue/ShinobiX/issues/11); this handoff provides report infrastructure and mission rejection signals, not the full funnel.
- Measure and optimize only proven bundle/asset bottlenecks. Current product JS/CSS passes at 5.60 MB but remains observationally large.

### P3 long-term

- Authenticated 25/50/100/150/300-player presence and settlement load.
- Application-admin per-operator MFA/identity in place of shared application secrets.
- Complete ordinary Arena PvE migration and late-game balance decisions from real beta data.

## 4. Server-authority status

| System | Current authority | Risk | Launch flag/state | Work completed here | Remaining migration |
| --- | --- | --- | --- | --- | --- |
| PvP/ranked | Server session/actions/rewards | Medium live/reconnect | Enabled with monitoring | Existing tests passed | Two-browser live settlement/reconnect |
| Battle/Endless Towers | Server Tower session, sealed loadout, once receipts | Medium live | Enabled with warning | Existing suite passed | Live refresh/concurrency certification |
| Clan Boss | Tower session; server-derived damage; retry-safe settlement; weekly receipts | High live evidence | Code defaults on unless disabled | Fail-closed roster authorization, run-ID damage idempotency, retryable point awards, atomic clan-record weekly payout receipt | Full staging matrix/weekly payout |
| E/D combat missions | Capped client win signal; server catalog payout | Low-medium | Enabled, capped | Duplicate/failure analytics | Keep capped until later migration |
| C/B/A/S combat missions | Server-sealed Tower session; server win required before catalog claim | Medium live evidence | Enabled; legacy client-trust flag remains unset | Start/session/UI/settle/claim authority and hostile tests | Live refresh/concurrency certification |
| Weekly Boss | Server-sealed Tower score attack; server-derived boss HP delta | Medium live evidence | Enabled; legacy client-damage flag remains unset | Attempt/stamina/session/damage/once settlement authority | Live multi-attempt and despawn certification |
| Hollow Gate | Server run token/state; client Arena combat | High for valuable combat reward | Desktop-first, valuable rewards gated/capped | Exact migration plan/issue | Bind node/run to Tower session and once settle |
| Story/events Arena | Client Arena | Medium-high by reward | No high-value local outcome rewards | Migration order documented | Move high-value fights first |
| Field/hunt missions | Server progress receipts/catalog rewards | Medium live retry | Enabled | Existing tests passed | Staging retry/expiry evidence |
| Sector War | Authoritative PvP result; sealed participants/villages; durable once receipts; locked terrain/territory logic | High operations | Enabled; staff the scheduled certification event | Retry-safe combat/Card/Pet settlement, fighter-only pristine registration, retained capture audit record, controlled event runbook | Simultaneous live event certification |
| Creator rewards | No public reward payout exists | None for launch | Not applicable | Incorrect launch concern removed | Reassess only if public payouts are introduced |

## 5. Live certification results

| Check | Result |
| --- | --- |
| Fresh-account journey | **Deployed player journey pass with one deployment-bound restore failure on 2026-07-14.** Created retained/labeled `beta-cert-0714-c` on `shinobijourney.com`; completed registration, character creation, intro, starter companion, stat training, jutsu/loadout, equipment, Academy spar, Cafeteria heal, Academy Trial claim, Logbook, sector entry, village return, save/logout, and second login. The restored progression/equipment/mission/position/currency state matched, but production restored `activePetId: starter-water` with `pets: []`. This reproduces the already-fixed local starter-entitlement defect and prevents a full deployed-candidate pass until item 1 ships. |
| Save/reload | Live pass for level 4, 16 XP, Academy rank, Stormveil village, 140 ryo, four equipped jutsu, one equipped item, completed onboarding, Academy Trial latch, and sector 0 after second login. **Companion collection failed restore on the old production deployment** as described above; local canonical starter-entitlement tests pass 4/4. |
| First mission claim | **Live payout pass:** the Academy Trial paid the sealed +40 XP / +30 ryo / +5 stamina reward and persisted `academyTrialClaimed: true`. The original payout request ID was not captured, so the evidence validator must still be run after the candidate deployment. |
| Reward receipts | **Live hostile/retry matrix pass:** a duplicate and two concurrent retries returned `applied: false`, `reason: already-claimed` with request IDs `625ddcb0`, `94a51e98`, and `d5bf7b8c`; save version remained 35 and XP, ryo, and stamina were unchanged. A second disposable account received 403 `Can only claim your own missions` (`dd59b294`) when targeting the journey account. After rotating that account's password, its old session received 401 `Authentication required` (`5c8a9f02`). The second auth record was deleted successfully. |
| Admin smoke | **Live pass on `70ba56b4`:** Admin 1 = full/content 200; Admin 2 = full 403/content 200; ordinary = both 403. Credentials remained masked and were not logged. |
| Backup/restore | Backup tooling 9/9, rollback-policy tests 3/3, rollback-readiness, and server build pass after correcting the drill command and moving restore verification before commit. Prior 2026-07-12 isolated hybrid restore remains the latest executed drill; repeat launch-week drill, empty target, temporary credentials, named operators, and private incident channel are pending #20. |
| Release health | **Live authenticated pass on deployed `70ba56b48a44b660469bb998e8d4b54a9b6e6e80`:** `saveStore: remote-proxy`; set/get/delete/NX/hash/disk checks pass; backup is fresh and was about 54 minutes old. The observed request SLO was unhealthy at p95 4,513.4 ms versus 1,500 ms, with zero server errors; a local roster/bloodline single-flight cache mitigation now awaits candidate deployment and remeasurement. |
| Clan Boss | Focused authorization/assault/storage/content/parity/weekly-reward suite passes 36/36 after closing fail-open party membership, duplicate-attempt start retry, duplicate-damage, lost point-award, and receipt-before-credit defects. Full enabled staging party/deduction/standings/weekly-settlement certification is not yet run. |
| Village/Sector War | Broad focused sector-war, state, economy, daily, structures, roles, mercenary, telemetry, crate, spoils, and authoritative once-settlement suite passes 155/155 after closing replay-after-partial-write, mutable village mapping, pre-contest battle reuse, third-party registration, and first-move/terrain races. The simultaneous staffed event, dispute exercise, and rollback evidence remain pending. |
| Deployment health | Production index is `no-cache`; deployed hashed asset is `public, max-age=31536000, immutable`; one-replica repository topology passes. `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=10` is now applied in production, the configuration rollout completed successfully, and `/health` returned `ok: true` from the replacement process. |

The production deployment is Railway service `ShinobiX` in `production`, one US East replica, built from `main` commit `70ba56b48a44b660469bb998e8d4b54a9b6e6e80`. The local checkout remains `codex/auditbeta` at `e598ad5` with extensive pre-existing uncommitted work. This handoff and its starter-companion fix are not deployed.

## 6. Test results

| Command | Result |
| --- | --- |
| `npm ci` | Pass; 172 packages, 0 vulnerabilities. |
| `cd shinobij.client && npm ci` | Pass after stopping a repository Vite process that held the Windows native Rolldown binary; 316 packages, 0 vulnerabilities. |
| `npm test` | **3,138 pass, 0 fail, 486 suites.** |
| `npm run build:server` | Pass. |
| `npm run build` | Pass after the same Vite file-lock process was stopped; server/client build, dist verification, sizecheck all pass. |
| `npm run test:mission-eligibility` | Pass. |
| `npm run test:release-assets` | Pass; 65 references, 165 square/decodable badge PNGs. |
| `npm run sizecheck` | Pass; initial graph 1.72 MB raw / 480.3 KB gzip; product JS/CSS 5.60 MB with warning. |
| `cd shinobij.client && npm run lint` | Pass with 0 errors and 2 Fast Refresh warnings in pre-existing untracked `elementalvfx.tsx`. |
| `cd shinobij.client && npm run build` | Pass; 1,619 modules transformed. |
| `cd shinobij.client && npm audit --audit-level=high` | Pass; 0 vulnerabilities. |
| `npm run check:deployment` | Pass; Dockerfile, one replica, built server start, `/health`. |
| `npm run check:rollback-readiness` | Pass after exposing existing commands; no destructive schema statements. |
| `npm run test:backup` | 9 pass, 0 fail. |
| Rollback-readiness policy tests | 3 pass, 0 fail; includes rejection of a `drill:restore` command wired to plain restore mode. |
| Starter companion focused suite | 4 pass, 0 fail. |
| Clan Boss focused authorization/start-retry/settlement/weekly-reward suites | 36 pass, 0 fail. |
| Sector/Village War broad focused suites | 155 pass, 0 fail. |
| Isolated browser account certification | Pass through account creation, canonical companion commitment, save/logout, and second-login restoration. |
| New focused beta report/certification/mission and Weekly Boss authority tests | 17 new tests pass; also included in the 3,138 total. |
| `npm run release:health -- <host>` | Not run: `HEALTH_DEEP_TOKEN` and configured release target were unavailable. |

## 7. Files changed by this handoff

- `package.json`: exposes beta report/certification, deployment, rollback, backup, and restore drill commands.
- `api/_beta-metrics.ts`: expands aggregate event vocabulary.
- `api/_beta-report.ts`, `api/_beta-report.test.ts`: aggregate population/economy report, alerts, text formatter, and no-identifier tests.
- `api/admin/beta-metrics.ts`: existing full-admin endpoint gains opt-in batched population report and text output.
- `api/missions/claim-mission.ts`: aggregate rejected duplicate/failed claim signals.
- `api/missions/combat-start.ts`, `_authoritative-combat-session.ts`, and tests: routed sealed mission/Tower battles with hostile validation and single-settlement bindings.
- `scripts/beta-daily-report.mjs` and test: credential-safe admin CLI.
- `scripts/beta-certification.mjs`, `scripts/beta-certification-lib.mjs`, and test: fail-closed certification evidence gate.
- `docs/BETA_RELEASE_CERTIFICATION.md` and template JSON: dedicated-account deployed journey procedure.
- `docs/SERVER_COMBAT_MIGRATION_PLAN.md`: code-level migration stages, APIs, receipts, flags, rollback, tests, and acceptance criteria.
- `docs/CONTROLLED_WAR_EVENT_RUNBOOK.md`: staffed event, snapshots, dispute, exploit, rollback, and low-population plan.
- `docs/BETA_LIVE_OPERATIONS.md`: launch configuration, daily report, moderation, and emergency procedures.
- `docs/PROGRESSION_SPINE_LEVEL_10_100.md`: existing-system milestone direction without balance or UI changes.
- `api/pet/_starter.ts` and test: accept the current `academyIntro` cinematic state and persist the canonical starter through the dedicated entitlement path before companion introduction.
- `shinobij.client/src/App.tsx`: wire the intro cinematic to `/api/pet/choose-starter` and serialize the following generic save behind that server commitment.
- `api/clan-boss/_assault.ts`, `_storage.ts`, `assault-start.ts`, `assault-settle.ts`, and tests: fail-closed roster parties, request-ID start receipts, run-ID damage idempotency, durable kill attribution, and retry-healed clan-point awards.
- `api/cron/_clan-boss-weekly.ts` and test: commit weekly treasury value and its receipt atomically in the clan record; keep the week retryable until every earned reward is durable.
- `api/_sector-war.ts` and test: durable capped battle receipts, retry recovery, captured-session audit retention, and sealed PvP participant/village token fields.
- `api/village/sector-war.ts`, `sector-card.ts`, and `sector-pet.ts`: once-only Control-HP/capture commits across partial-write retries; combat registration is post-contest, fighter-only, pristine-session-only, and serialized with the PvP first-move/terrain seal.
- `package.json`, `scripts/kv-backup.mjs`, `rollback-readiness-lib.mjs`, and test: wire the evidence-producing restore drill, verify before commit, and fail readiness if the drill command regresses to plain restore.
- `docs/BACKUP_RESTORE_RUNBOOK.md` and `docs/DEPLOYMENT_ROLLBACK_RUNBOOK.md`: exact hybrid-drill variables/targets/cleanup plus launch-week roles, incident timeline, evidence custody, and player notice templates.
- Generated counterparts under `dist/api/` for the changed/new TypeScript modules.
- This report.

The worktree already contained many unrelated source, UI, VFX, story, realtime, save, and generated-asset changes before this handoff. They were preserved and are not claimed here.

## 8. Deferred findings

- No UI issue was identified that justified violating the visual freeze. The two lint warnings in `elementalvfx.tsx` are non-blocking and were not changed.
- No mobile/global responsive test or overhaul was performed.
- The branch could not be safely pulled/merged because of extensive uncommitted work. `origin/main` was fetched and inspected; local HEAD is one divergent commit ahead and five behind current `origin/main`.
- Clan Boss staging, the staffed war event, and the repeated restore drill still require isolated targets, test participants, or named operators. Local evidence is recorded above and is not presented as live proof.
- Railway production variables were inspected: neither `DISABLE_CLAN_BOSS` nor `DISABLE_VILLAGE_WAR` is set, so both systems are enabled by the server defaults. Recheck immediately before each staffed event.
- The complete reward-path inventory remains tracked in #19; no speculative global reward rewrite was attempted.

## 9. Recommended launch configuration

- **Enabled:** auth/saves, Academy, training, inventory/shop/bank/hospital, early missions/hunts, Logbook, village/world travel.
- **Enabled with warning:** PvP/ranked, Towers, pets, professions, clans, Card Clash, Legacy only with verified admin controls.
- **Admin monitored:** Clan Boss enabled; watch assault settlement, item deductions, damage, standings, and weekly receipts while #15 captures live evidence.
- **Desktop-first:** Hollow Gate, with valuable local-combat rewards gated/capped.
- **Staffed:** Village/Sector War runs as scheduled beta events with operators present; do not begin an unattended permanent season yet.
- **Enabled through server authority:** C/B/A/S combat mission rewards and Weekly Boss contributions.
- **Legacy trust flags stay disabled:** `ENABLE_CLIENT_TRUSTED_COMBAT_MISSION_REWARDS` and `ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE` remain unset because the new server paths replace them.
- **AI/creator:** OpenAI-side generation limits are accepted for beta. No public creator rewards exist. Apply moderation controls to public user-generated content without inventing a reward shutdown.
- **Emergency controls unset normally but ready:** maintenance, registration disable, economy/reward freeze, scheduled-job disable.

## 10. Exact next actions

Item 1 is intentionally deferred until last. Current status for items 2-7:

| Item | Current result | Still required |
| --- | --- | --- |
| 2. Deep health/backup | **Configuration complete; latency code complete locally:** authenticated production deep health passes on `70ba56b4`, `saveStore` is `remote-proxy`, the backup is fresh, and `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=10` is applied with a successful healthy rollout. The full roster and bloodline list now single-flight/cache the remote all-save projection for 60 seconds; focused cache tests pass 5/5 and the server build passes. | Deploy the code candidate and prove the 15-minute p95 is below 1,500 ms. Add exact subroute timing only if the post-deploy SLO remains unhealthy. |
| 3. Fresh account | **Live journey and hostile/retry evidence substantially complete on old production:** `beta-cert-0714-c` completed the full player-visible onboarding path, the Academy Trial paid once, three duplicate/concurrent retry attempts paid nothing, wrong-account claim was denied, a revoked session was denied, and second login restored progression, equipment, mission, position, and currency state. Production reproduced the known starter defect (`activePetId` present but `pets` empty); the local dedicated starter-entitlement path passes 4/4. The journey account is retained and clearly labeled; the second hostile-check account was deleted. | Ship item 1, rerun the companion restore, capture the original successful reward request ID, then produce the passing 19-step validator record. |
| 4. Admin matrix | **Complete:** live matrix passes for Admin 1, Admin 2, and ordinary denial on `70ba56b4`; no credential value was exposed. | Re-run only after a credential-policy or deployment change. |
| 5. Clan Boss | **Code hardening complete locally:** authoritative roster membership now fails closed; a retried start reuses one attempt and run; damage banks once by run ID across partial-write retries; point awards replay safely; weekly treasury value and receipt commit together; the week stays open if any earned clan reward is not durable. Focused coverage passes 36/36, and both server and client builds pass. | Run the enabled staging party, action/item deduction, standings, and end-of-week settlement matrix with monitoring. |
| 6. Village/Sector War | **Code hardening complete locally:** combat, Card, and Pet settlement store a durable per-battle receipt with the Control-HP result, so lost responses and partial writes replay without applying twice; captured contests remain as inert audit records; tokens seal fighter/village mapping; old battles are rejected; only a fighter can register an untouched battle; and registration shares the PvP move lock while sealing defender terrain before the first action. Broad focused coverage passes 155/155 and the server build passes. | Run the enabled, staffed simultaneous event and capture dispute and rollback evidence. |
| 7. Restore/rollback | **Tooling hardening complete locally:** the package drill now performs fresh export + isolated restore + redacted evidence instead of silently running plain restore; base checksum and representative verification happen before commit; readiness detects command regression; the runbook accurately requires the production overlay variables, an empty isolated target, isolated disk-overlay boot, cleanup, named operators/approver/evidence custodian, UTC timeline, and player notices. Backup tests pass 9/9, rollback-policy tests pass 3/3, rollback-readiness passes with no destructive statements, and the server build passes. | Provision a fresh empty isolated target and temporary proxy/database credentials, run the launch-week drill, then fill the private launch record with the actual rollback owner, backup, incident commander/channel, restore approver, communications owner, and evidence location. |

After those seven, Hollow Gate combat authority (#13), broader load/concurrency, analytics completion, and level 50–100 tuning remain post-launch beta work rather than immediate controlled-beta blockers.
