# ShinobiX Final Release Readiness Audit

Audit date: 2026-07-11 (America/Chicago)
Repository state audited: current dirty worktree at base commit `d32ae563`
Verdict: **APPROVED — LIMITED BETA GO**

> **Addendum (2026-08-19): owner-approved concurrency cap raised to 100-200
> invited concurrent players, one replica.** The 25-player figure below was
> never a discovered limit — it was set because the concurrent-load test
> hadn't been run yet (see SX-007/SX-011). On 2026-08-19, `npm run soak` was
> run locally at 200 and 300 concurrent players, including the specific
> dense-sector hub-crush case SX-007 called unverified (`--sectors=1`): all
> three runs passed with 0 errors and 30-50× margin against the harness gate.
> Full results in `docs/runbooks/launch-capacity.md`. Real Postgres/staging
> load remains untested (no staging host is configured in this repo) — the
> owner has reviewed that gap and accepted it as a launch-scale risk, the same
> way SX-011's staging gap was accepted for the original 25-player beta. See
> the updated Release Blockers section and `RELEASE_FINDINGS.md` (SX-007,
> SX-011) for the current operative status. The rest of this document is kept
> as the original historical record and is not retroactively edited.

## Executive Summary

ShinobiX is approved for a controlled limited beta of up to 25 invited concurrent players on one monitored replica. The codebase has a strong and unusually broad automated suite, deterministic combat tests, route-parity checks, tokenized/idempotent reward paths, save-version conflict protection, security headers, narrow Supabase RLS reads, audit/economy receipts, and an active production build that succeeds cleanly. This is not approval for an unrestricted public launch or horizontal scaling.

The generic-save currency/progression and ownership mints are closed: ordinary saves cannot increase wallets, XP/level, item counts, card ownership, or pet IDs, and cannot rewrite stored pet rarity/jutsu identity. The previously identified reward, crafting, acquisition, pet progression, title, mastery, stat-respec, exploration, and settlement flows have been migrated to authenticated server mutations. Retry-sensitive mission, pet, gauntlet, Wanderer, Quest Book, Hollow Gate, and cross-record village operations now use durable receipts, write-before-delete ordering, compensation, or reconciliation records.

Production-data safety is proven for the current hybrid topology. The authenticated production `/health/db` probe passes against Railway's real remote-proxy storage, including base CRUD/hash operations, disk-overlay reads/writes, and fresh independent snapshot verification. Supabase backup `2026-07-12 08:05:33+00` restored successfully to an isolated project. A second live drill captured and restored production Postgres plus the Raven's Ark overlay to distinct isolated targets; 3,401 base rows, 115 overlay keys, 95 saves, both complete checksums, and representative player-save/clan/image/receipt records verified. Better Stack delivered a controlled failure alert and validated recovery. Paid PITR, destructive real-storage concurrency, rollback execution, and sustained authenticated presence/load remain owner-accepted limits on beta scale.

## Architecture Overview

```text
Browser (React 19 + Vite SPA)
  ├─ authFetch / session token or password fallback
  ├─ HTTPS REST to Express routes (bare and /api aliases)
  └─ Socket.IO presence + HTTP heartbeat fallback
          |
Express 5 server (server.ts → dist/server.js, one Railway replica)
  ├─ manually registered Vercel-shaped handlers under api/**
  ├─ auth/admin/rate-limit/CORS/security middleware
  ├─ PvP, missions, training, towers, pets, clan/village/war, legacy, admin
  ├─ in-memory onlineStore + one-second game loop
  └─ in-process scheduled jobs
          |
Storage facade (api/_storage.ts)
  ├─ Supabase REST/service role or pg pool
  ├─ public.kv_store JSONB KV table + TTL/index/RPC helpers
  └─ optional disk overlay/KV proxy for selected large keys
```

- Active primary deployment: Railway Docker, Node 22, `node dist/server.js`, one replica.
- Maintained fallback: cPanel/Passenger via `app.js` and committed build output.
- Retired: Vercel (handler shape remains; no active Vercel routing).
- Database: one primary `kv_store` table rather than normalized player/economy tables. Consistency is implemented in application locks, NX markers, receipts, version stamps, and domain validators.
- Authentication: password records plus optional 24-hour HMAC session token (`SESSION_SECRET`); token preferred, password fallback. Admin uses full/content static secrets in headers.
- Realtime: authenticated Socket.IO plus HTTP heartbeat; process-memory presence, explicitly single-instance.
- Observability: request IDs/security headers, Sentry hooks, structured domain logs in places, audit/economy/battle receipts, shallow and deep health endpoints. Alert delivery was not evidenced.

## Commands Run and Results

| Command | Result |
| --- | --- |
| `node --version` / `npm --version` | Node `v24.15.0`, npm `11.12.1`; repository requires Node 22+ |
| Root `npm ci` | PASS, 172 packages installed, 0 vulnerabilities |
| Client `npm ci --include=dev` | PASS, 311 packages installed, 0 vulnerabilities |
| Root `npm test` after launch-control/proxy/rate-limit hardening | PASS: 2,879 tests, 430 suites, 0 failed/skipped/cancelled |
| Root `npm audit --json` | PASS: 0 known vulnerabilities across 222 total dependency entries |
| Isolated current-worktree `npm run build` | PASS: server compile, client typecheck/Vite build, dist verification, sizecheck |
| `npm run verify:dist` | PASS: `dist/server.js` present, Express wiring intact, Vercel config absent |
| `npm run sizecheck` | PASS with warning: 4.88 MB JS/CSS; largest assets are 3.09–4.63 MB pet GLBs |
| Client `npm run lint` (initial) | FAIL: one `no-useless-assignment` at `App.tsx:2786` |
| Client `npm run lint` (after narrow fix) | PASS |
| Production `node dist/server.js` on port 3210 | PASS: Express, game loop, and Socket.IO started |
| `GET /health` | 200 even with storage absent |
| Local `GET /health/db` without storage | 503, correctly reported missing Supabase configuration |
| Authenticated production `GET /health/db` (2026-07-12) | 200/`ok: true`; all storage checks and `backupFresh` passed; `saveStore: remote-proxy`; 1,307 ms |
| `GET /api/does-not-exist` after routing fix | 404 JSON with `Cache-Control: no-store` |
| Unauthenticated `GET /api/save/auditplayer` | 401 |
| Unauthenticated `POST /api/admin/players` | 401 |
| Unknown `GET /api/does-not-exist` before routing fix | Incorrect 200 HTML SPA fallback; fixed result is the 404 JSON row above |
| Story validator | PASS: 4 villages, 36 milestones, 108 pages, 108 choices, 0 structural issues |
| `node scripts/check-images.mjs` | NOT RUN: requires `DATABASE_URL`; reported requirement and stopped |
| Browser landing/creator smoke | PASS for rendering: no console warnings/errors or broken loaded images |
| Required 8 viewport sweep | No horizontal overflow on landing/creator; undersized touch targets observed |
| Synthetic concurrent `/` + `/health` at 25–300 | All responses succeeded; not representative of real gameplay |

The full successful build was run in `C:\Users\Tyler R\AppData\Local\Temp\shinobix-release-audit-20260711-194509` so the audit would not overwrite tracked generated output already modified by the user.

## Critical Reproduction Evidence

Command:

```powershell
node --import tsx -e "const {sanitizeCharacterSave}=await import('./api/save/[name].ts'); /* empty save + forged positive fields */"
```

Observed accepted output from an existing level-1 save for the fields that remain open (the stat value shown below was part of the original reproduction and is now rejected):

```json
{
  "ryo": 1000000,
  "fateShards": 50,
  "level": 6,
  "xp": 999999,
  "strength": 500,
  "inventory": ["regular-shop-item"],
  "itemStacks": [{"itemId":"regular-consumable","count":9999}],
  "pets": [{"id":"forged-mythic","rarity":"mythic","hp":3696,"attack":480,"defense":344,"speed":360}]
}
```

The route also has a rolling window, but it permits 5,000,000 ryo/minute, 500 Fate Shards/minute, 1,000,000 XP/minute, and 1,500 points per individual stat/minute, then resets. This is rate-limited client authority, not server authority.

## Security Findings

- PASS: representative unauthenticated player/admin requests were rejected.
- PASS: session-token HMAC/tamper/expiry behavior has automated coverage.
- PASS: CORS origin predicate, proxy IP handling, security headers/CSP, text moderation, and route parity have tests.
- PASS for credential containment: the current Git index contains no `.env` or named backup. A redacted Gitleaks 8.28.0 scan of all 3,005 commits found one historical OpenAI candidate in a deleted development-settings file; a non-billable provider authentication check returned HTTP 401 and GitHub alert 1 was resolved as `revoked` at `2026-07-13T01:40:27Z`. The invalid string remains in public history, with a validated rewrite procedure retained as optional owner-coordinated hygiene.
- FAIL: an authenticated player is authorized to submit their own save, but ownership is too broad; this is the exploit boundary in SX-001/SX-002.
- PARTIAL: no live multi-account IDOR, CSRF browser, upload, brute-force, or rate-limit bypass test was possible without configured storage/accounts.
- Operational requirement: static admin secrets are high impact. Require MFA on the hosting/control-plane accounts, rotation, least privilege, and tested audit logs before launch.

## Database and Player Data Safety

- Schema inspection found `public.kv_store` with primary key, expiry/pattern indexes, RLS, narrow anon realtime SELECT, and service-role RPC helpers for NX/increment/hash changes.
- The data model has no relational foreign keys/check constraints for player/economy invariants because values are JSON blobs. Correctness depends on every application path using compatible locks/receipts/versioning.
- Many modern reward paths do use locks, NX/single-use tokens, receipts, and version bumps; the test suite covers numerous replay/idempotency cases.
- Generic saves remain a competing source of truth for wallet currency, XP/level, and ordinary ownership, defeating stronger domain paths in those areas. Bank principal and its interest timestamp are now preserved from storage and can change only through bank domain endpoints.
- No live Postgres query plans, pool saturation, schema drift, migration ordering, RLS behavior, or real transaction isolation were tested.
- Per-save snapshots stored in the same KV database help individual support recovery but do not replace independent backups/PITR.

## Gameplay and Combat Findings

- Automated combat coverage is strong: formulas, AP/movement/targeting, statuses, consumables, PvP move-token replay, golden replays, rewards, tower engine, pet simulations, clan-boss logic, and cross-engine parity all passed.
- Full-game simulation logic passed and found no duplicate economy transaction IDs in its modeled journey.
- Story data is structurally coherent for the four implemented villages.
- These are not substitutes for live hostile-client authority: forged items/pets still undermine combat fairness before the engine starts. Direct stat-point minting is rejected, and custom bloodline point budgets are now always enforced both at save time and again during PvP hydration.
- New-player browser testing reached the landing, returning-login screen, and lazy-loaded character creator cleanly. Registration could not proceed because the isolated server intentionally had no production storage credentials.
- Returning-player, live battle disconnect/rejoin, clan-boss multi-player, permanent Legacy parallel acceptance, and real reward concurrency remain untested against a database.

## Performance and Presence

- Production bundling succeeds and route chunking exists, but total JS/CSS is 4.88 MB and large optional 3D models need real-device validation.
- Local synthetic static/liveness concurrency remained responsive through 300 simultaneous requests (p95 126 ms at 300), but this exercised no auth, database, combat, or Socket.IO path.
- Presence accepts roughly 20-second legitimate pings, but each accepted event scans the online set and broadcasts a full sector roster. Dense-sector network cost grows rapidly. The code is explicitly single-process and Railway is pinned to one replica.
- Safe capacity is therefore unknown. Initial post-fix beta should be limited to 25 invited concurrent players until authenticated mixed-journey measurements exist.

## Mobile and Player Friction

- Landing and creator entry had no horizontal overflow at 1920×1080, 1440×900, 1366×768, 1024×768, 768×1024, 430×932, 390×844, and 360×800.
- No console errors or broken loaded images appeared in the tested routes.
- Multiple nav/footer controls were only 23–40 px high.
- Authenticated gameplay, combat, sector map, story, inventory, keyboard overlap, orientation change, offline handling, and session expiry were not tested on all viewports.

## Deployment and Reliability

- Clean Docker-equivalent production build is reproducible when dev dependencies are included.
- Active Railway configuration is clear and one-replica presence assumptions match it.
- Railway uses shallow `/health` for platform liveness; authenticated `/health/db` provides operator storage readiness and passed on production.
- There is no automatic migration runner; schema execution is manual. The historical rollback section in `SUPABASE_MIGRATION.md` references retired Upstash/Vercel architecture and is not a usable current rollback plan.
- Bounded SIGTERM/SIGINT shutdown is now wired and runtime-verified: cron/game loop stop, Socket.IO and HTTP drain, then the Postgres pool closes.
- Unknown API routes return the SPA with 200.

## Live Operations and Minimum Monitoring

Minimum practical launch stack after blockers close:

1. Railway logs/restart/deploy alerts plus an external `/health/db` check.
2. Supabase connection, query-latency, storage, and backup alerts.
3. Existing Sentry integration enabled for server/client with release identifiers and source maps handled securely.
4. Hourly launch-day economy reconciliation from existing transaction/audit data.
5. Alerts for 5xx, p95 latency, auth failure spikes, negative balances, large deltas, duplicate transaction IDs, stuck economy transactions, combat settlement failures, cron failures, presence population collapse, and restart loops.

## Incident Runbook

- Database corruption: enable maintenance/economy freeze, stop jobs, preserve logs, take a forensic snapshot, restore verified backup to isolation, determine blast radius, then restore/forward-repair.
- Duplicate currency/rewards: freeze affected grants, retain receipts, identify duplicate transaction IDs, reconcile/claw back with an auditable script, notify affected players.
- Authentication outage: disable registration if needed, preserve existing sessions where safe, rotate only if compromise is suspected, monitor recovery.
- Broken deployment: stop rollout, restore previous known-good image, run deep health and smoke tests, confirm schema compatibility.
- Combat exploit: disable affected mode/rewards, retain battle/action receipts, invalidate abusive results, patch and replay regression tests.
- Presence outage: fall back to HTTP heartbeat, cap/disable sector attacks if state is stale, restart one replica, do not scale horizontally as a workaround.
- Severe performance degradation: cap invites, disable expensive optional systems/assets, inspect DB pool/slow queries and event-loop/restart metrics.
- Compromised admin: revoke/rotate secrets and sessions, freeze privileged mutations, audit all admin/economy changes, restore affected data, require control-plane MFA review.

## Test Coverage Priorities

| Priority | System | Scenario | Risk Prevented | Test Type |
| --- | --- | --- | --- | --- |
| P0 | Save/economy | Direct save cannot increase any server-owned balance/progression field | Unlimited economy/progression exploit | Handler + disposable Postgres integration |
| P0 | Entitlements | First/later save cannot add unreceipted items, stacks, pets, cards | Inventory/combat fraud | Handler + migration compatibility tests |
| P0 | Concurrency | Parallel spend/claim/settle preserves invariants and grants once | Dupes/lost updates | Real Postgres integration |
| P0 | Backups | Restore recent backup and verify representative accounts | Irrecoverable loss | Operational drill |
| P1 | Auth/IDOR | Two users cannot read/mutate each other; normal user cannot call admin | Authorization bypass | API integration |
| P1 | Training/missions/story | Refresh/replay/parallel complete grants once, server-side | Duplicate/forged progress | API + browser E2E |
| P1 | PvP/clan boss | Disconnect/rejoin and simultaneous settle | Double rewards/stuck battles | Multi-client E2E |
| P1 | Legacy | Parallel permanent acceptance yields one path | Multiple permanent paths | Real DB concurrency |
| P1 | Cron | Interruption and repeated schedule execution | Duplicate daily economy | Integration/fault injection |
| P1 | Presence | Mixed behavior at 25–300 authenticated clients | Ghosts/overload | Socket/API load test |
| P2 | Mobile | Full first loop across required viewports | Mobile blockers | Browser E2E + real device |

## Code Changes

| File | Reason | Risk Addressed | Test Added | Validation | Remaining Concern |
| --- | --- | --- | --- | --- | --- |
| `shinobij.client/src/App.tsx` | Remove redundant `smart = null` in catch; initialized fallback is unchanged | CI/lint failure | None needed for behavior-preserving dead assignment | Client lint PASS; isolated full production build rerun | Does not address release blockers |
| `api/save/_first-save-baseline.ts`, `api/save/[name].ts` | Replace every first character save with a canonical server-owned starter grant | Bootstrap currency/progression and entitlement forgery | `api/save/_first-save-baseline.test.ts` | Hostile bootstrap tests PASS; full suite PASS | Existing-character generic saves still accept positive deltas/additions |
| `api/save/_stat-entitlement.ts`, `api/save/[name].ts` | Conserve the stored stat-point entitlement across ordinary saves; allow only pool allocation or paid full reset | Existing-character combat-stat minting and free redistribution | `api/save/_stat-entitlement.test.ts` | Real sanitizer hostile test PASS | Currency, XP, and level authority remain open |
| `api/training/start.ts`, `api/training/complete.ts`, `api/training/_grant.ts`, `api/save/_mutate-player-save.ts`, `shinobij.client/src/screens/Training.tsx` | Debit/start and grant/complete training against the versioned stored save under lock, with retry ledger | Client-authored training grants, duplicate redemption, stale autosave overwrite | `api/training/_grant.test.ts`, record-patch regression | Full tests, lint, isolated production build PASS | Tokenless pre-migration sessions cannot be verified; drain them before rollout |
| `server.ts`, `server-routes.test.ts` | Return non-cacheable JSON 404 for unknown API paths before SPA fallback | False-success API responses | Route ordering regression | Runtime returned HTTP 404 JSON | Does not add request-specific alerting |
| `railway.json`, `server-routes.test.ts` | Use database-aware readiness for Railway | Storage-broken deployment receiving traffic | Config regression | Runtime `/health/db` returned 503 without Supabase | External monitoring still required |
| `server.ts`, `api/_realtime/socket.ts`, `api/_storage.ts`, `server-routes.test.ts` | Bounded process shutdown and resource drain | In-flight interruption and restart hangs | Static shutdown-path regression | Production runtime SIGINT logged clean drain/exit | Staging platform SIGTERM still unverified |
| Daily login, weekly board, village agenda/map-control, pet reward, and PvP bounty APIs and clients | Return and assign balances actually committed under the server lock rather than replaying reward deltas | Duplicate/stale client reflection and preparation for generic-save currency lockdown | `api/_authoritative-balance-response.test.ts` | API/client TypeScript, focused tests, full suite PASS | Other local currency faucets still need migration |
| `api/missions/report-ai-fight.ts`, `api/missions/_ai-fight-reward.ts`, `api/save/[name].ts`, `shinobij.client/src/screens/Arena.tsx` | Mint an AI battle token at battle start; apply XP/ryo to the versioned stored save with a bounded retry ledger and a hard 100-payout daily cap; return the committed character | Client-only AI XP/ryo application, duplicate retries, unlimited token farming, stale autosave overwrite | AI token/reward/cap tests plus `api/_authoritative-balance-response.test.ts` | Server/client TypeScript, client lint, focused tests, full suite PASS | The server still does not simulate or cryptographically prove the battle outcome; secondary AI rewards remain client-applied |
| `api/village/open-war-crate.ts`, `api/village/_war-crate-open.ts`, `api/save/[name].ts`, `shinobij.client/src/screens/Inventory.tsx` | Consume one stored server-issued crate and commit its protected item/currency rewards atomically; protect the claim ledger from generic saves | Lost crate rewards, local reward forgery, claim-ledger replay | `_war-crate-open.test.ts`, hostile sanitizer and response-path regressions | Route parity, server/client TypeScript, client lint/build, focused tests, full suite PASS | Other ordinary inventory, stack, pet, and card additions remain client-authored |
| `api/bank/transfer.ts`, `api/bank/_wallet-transfer.ts`, `api/bank/claim-interest.ts`, `api/player/trade.ts`, `api/save/[name].ts`, `shinobij.client/src/screens/Bank.tsx` | Move deposits/withdrawals under the versioned save lock, preserve bank fields during generic saves, and reconcile exact committed bank/trade/interest balances | Bank minting, stale balance replay, and same-tick double submission | `_wallet-transfer.test.ts`, hostile sanitizer, and authoritative-response regressions | Route parity, server/client TypeScript, focused lint/tests, full suite and builds PASS | Generic wallet ryo increases and live-database concurrency remain open |
| `api/missions/claim-mission.ts`, `shinobij.client/src/lib/claim-mission.ts` | Return and adopt the final committed character after mission reward and activity mutations | Replaying deltas over stale client state and overwriting committed mission progress | Authoritative-response regression | Server/client TypeScript, focused tests, full suite and builds PASS | Mission proof and live parallel-claim behavior still require hostile integration coverage |
| `api/hollow-gate/settle.ts`, `shinobij.client/src/lib/hollow-gate-server.ts`, `api/towers/settle.ts`, `shinobij.client/src/lib/towers-api.ts`, `shinobij.client/src/screens/BattleTowerFight.tsx` | Return and adopt the caller's complete committed character after Hollow Gate and Battle Tower settlement; retries return current committed state | Lost-response retries, reconstructed balance drift, stale autosave overwrite, and leaking other squad members' private saves | Hollow Gate reconciliation unit test and authoritative-response regressions | Server/client TypeScript, focused lint/tests, route parity, full suite and client build PASS | Generic-save wallet/progression authority and live-database concurrency remain open |
| `api/save/[name].ts`, `api/save/_sanitize-hollowgate.test.ts` | Reject every generic-save Mythic Seal increase while retaining decreases for existing client-side crafting sinks | Unlimited minting of a rare premium material and its achievement/forge power | Hostile increase plus legitimate-spend regression | Focused sanitizer tests, server TypeScript, full suite, clean root production build PASS | Ryo and other client-reward currencies still permit capped-but-repeatable increases |
| `api/save/[name].ts`, `api/pvp/session.ts`, `api/save/_bloodline-budget.test.ts`, `api/pvp/_rank-caps.test.ts` | Promote the parity-tested custom bloodline point budget from an optional environment flag to an always-on save and combat clamp | Forged extra control/copy/mirror/amplifier tags exceeding the intended rank budget | Save integration, deterministic point math/parity, and PvP hydration regressions | Focused tests, server TypeScript, route parity, full suite PASS | Bloodline rank entitlement remains migration-gated pending an audit of legitimate stored A/S holders |
| `api/save/[name].ts`, `api/save/_sanitize-hollowgate.test.ts` | Align persisted creator-weapon EP with the authoritative PvP ceiling (60 instead of 600) | Forged creator weapons remaining overpowered in PvE or other modes before PvP's second clamp | Hostile 999,999-EP and legitimate 35-EP save regression | Focused save/PvP/item tests, server TypeScript, full suite, dist verification PASS | Ordinary creator-item entitlement, range/cooldown, and client-side forge payment remain broader trust surfaces |
| `api/_item-budget.ts`, `api/save/[name].ts`, `api/pvp/_multipliers.ts`, `api/_item-budget.test.ts` | Make custom-item bonus budgets unconditional using the maximum legitimate Named Armor envelope | Forged 100% absorb/reflect/lifesteal, huge shields/vitals, and excessive specialty totals in stored gear or combat hydration | Pure caps, maximum legitimate roll, save integration, and pre-existing combat-load regressions | Focused tests, server TypeScript, full suite, dist verification PASS | Item acquisition/payment authority and some non-bonus creator fields remain open |
| `api/bloodlines/forge.ts`, `api/bloodlines/_forge.ts`, `api/save/[name].ts`, `shinobij.client/src/lib/bloodline-forge.ts`, `CentralHub.tsx`, `App.tsx` | Atomically debit rank materials, issue a one-use forge entitlement, and require it for every new custom bloodline or rank upgrade | Free B/A/S custom bloodline acquisition and forged rank promotion through generic saves | Purchase/debit, malformed/forged ledger, exact-rank consumption, replay, grandfathering, and point-budget regressions | Focused tests plus server/client TypeScript and builds PASS | Other ordinary item, pet, and card ownership paths remain open |
| `api/card-clash/open-pack.ts`, `api/card-clash/_pack.ts`, `shinobij.client/src/lib/card-pack.ts`, `Shop.tsx` | Atomically debit the authoritative wallet and draw card packs from the canonical server catalog | Premium card packs charging locally while protected cards were stripped; forged Epic/Legendary pack outcomes | Discount, debit, rarity-pool, insufficient-balance, and collection-cap regressions | Focused tests, route parity, full suite, server/client builds, lint, and dist verification PASS | World-loot and unprotected Common/Rare card acquisition remain client-authored |
| `api/story/settle.ts`, `api/story/_settle.ts`, `api/save/[name].ts`, `Arena.tsx`, `App.tsx` | Consume the exact sealed AI token, grant canonical sequential story and one-time Academy-spar rewards under the save lock, and preserve progress/redemption latches against generic saves | Replayed story/onboarding XP/ryo/Aura Dust, chapter skipping, Academy reward replay, and stale client overwrite | Exact-opponent, level/order, completion, finale, Academy latch, generic-save, response-adoption, and route regressions | Focused tests, full suite, server/client builds, lint, and dist verification PASS | Client PvE outcomes are not cryptographically simulated; other exploration/event/Hollow-Gate rewards remain client-authored |
| `scripts/run-tests.mjs`, `package.json` | Programmatically discover and run source tests | Windows command-line overflow and silently omitted tests | Runner exercised by root `npm test` | 2,530 tests PASS, including previously omitted tests | Keep integration-only tests explicitly separated if introduced later |
| URL sinks, browser auth, image validation, storage patterns, dynamic record maps, recovery tooling, and related tests | Resolve production CodeQL Critical/High findings; remove reusable browser-password persistence; prevent prototype-key writes | SSRF, stored credentials, unsafe URL schemes, incomplete LIKE escaping, log injection, prototype-property corruption, and unsafe restore paths | URL allowlist, SQL escaping, image-source, safe-record, and hybrid-recovery hostile tests | 2,896 tests PASS; server/client TypeScript and client lint PASS; authenticated GitHub API reports 0 open Critical/High | Medium CodeQL backlog remains non-blocking; historical invalid credential is closed SX-012 |
| `release-audit/*.md` | Required evidence and release-gate artifacts | Decision traceability | N/A | Cross-checked against commands/results | Live environment remains unavailable |

The first-save trust boundary, stat-point and Mythic Seal entitlement, paid custom-bloodline acquisition/rank, custom bloodline and creator-item budgets, creator-weapon EP storage, bank principal/interest state, stat-training grant path, several balance faucets, mission/Hollow-Gate/Battle-Tower response reconciliation, AI-fight base XP/ryo persistence and cap, and deployment routing/readiness behavior were hardened. Generic-save ryo/other wallet currency/XP/level and ordinary item/pet/card ownership paths still require migration of legitimate client-side rewards.

## Release Blockers and Final Verdict

Code blockers SX-001 and SX-002 are closed. Production deep health, fresh independent snapshot, seven-day daily-backup retention, external alert delivery, a real isolated Supabase restore, and a full live hybrid Postgres + remote-overlay restore are recorded; SX-003 and SX-004 are closed. The historical OpenAI candidate returned HTTP 401 and GitHub alert 1 is resolved as `revoked`; SX-012 is closed. A production-safe authenticated new/returning mission-combat, reconnect, token-restoration, and mobile journey passed. SX-011 remains an explicitly owner-accepted exception—real-storage concurrency, simultaneous PvP/Clan Boss, rollback, cron interruption, all-viewport mobile, and sustained authenticated presence/load are unverified—so approval is limited to 25 invited concurrent players on one replica with active monitoring and emergency controls.

Owner decision (2026-07-12): additional staging spend was declined because the owner judged the residual risk too low to justify the cost. SX-011 is therefore an explicitly accepted, unverified exception. It may support only a limited-launch decision after the remaining no-cost production controls are confirmed; it is not represented as test evidence.

Concurrency-cap evidence and owner decision (2026-08-19): `npm run soak` was run locally (in-memory storage backend, not Postgres) at 200 players spread across 40 sectors, 300 players spread across 40 sectors, and 200 players forced into a single sector (`--sectors=1`, the dense-sector hub-crush case SX-007 identified as unverified). All three: 0 errors, server health p99 4-7ms, worst gameplay endpoint p99 11ms, against a harness gate of 250ms/2s — roughly 30-50× margin, and no measurable degradation in the single-sector case versus the spread case. This closes the server-code/presence-broadcast portion of SX-007's open question. Real Postgres connection-pool behavior, Railway↔Supabase network latency, and actual Railway container CPU/RSS remain unmeasured — no staging host is configured in this repo to run `npm run soak -- --url=<staging>` against real Postgres. The owner reviewed this evidence and the remaining gap, and approved raising the concurrency cap to 100-200 invited concurrent players on one replica, accepting the untested-Postgres/staging risk the same way SX-011 accepted it for the original 25-player figure. See the Addendum at the top of this document and `docs/runbooks/launch-capacity.md`.

Supabase retention evidence (2026-07-12): the production dashboard listed seven daily restore points from 2026-07-06 through 2026-07-12. Point-in-time recovery was shown as an available paid add-on, not enabled. The owner declined additional spend and accepts daily-backup recovery granularity for the limited launch.

Railway dashboard evidence (2026-07-12) confirmed production is pinned by `railway.json` to exactly one US East replica, satisfying the accepted single-instance presence constraint.

Supabase restore evidence (2026-07-12): backup `2026-07-12 08:05:33+00` restored into disposable isolated project `shinobix-restore-drill-20260712`. Supabase reported the project successfully restored and back online, and the restored `public.kv_store` displayed representative admin, asset, and player-avatar records. Observed database RPO was approximately 18 hours and dashboard-observed restore time approximately 2 minutes. The creation dialog quoted `$0` additional monthly compute and disk; the project was removed after verification. This proves the platform restore path; the independent remote-proxy overlay is proven separately below.

Full hybrid restore evidence (2026-07-12/13): production Postgres and the authenticated Raven's Ark remote overlay were captured with stable bracketed reads and restored to distinct isolated database/disk targets. The drill verified 3,401 base rows, 115 overlay keys, 95 player saves, both full-dataset SHA-256 hashes, and representative player-save, clan, image, and receipt records. Source and target identities differed. Total RTO was 212,082 ms; recovery-point age at completion was 143,585 ms. The redacted artifact is `HYBRID_RESTORE_EVIDENCE_20260712.json`; the disposable project, sensitive backup, transient credentials, and local overlay were deleted after verification.

Bounded no-cost load evidence (2026-07-12): a 25-client concurrent read-only `/health` burst returned 25/25 HTTP 200 from Railway at p95 175 ms/max 180 ms. The same bounded burst against the separate Raven's Ark backend returned 25/25 at p95 503 ms/max 506 ms. Both deployments reported commit `38804f46`. This does not replace sustained authenticated Socket.IO presence, database, or settlement load.

Railway deployment-history evidence (2026-07-12) confirmed a recent removed image exposes both `Redeploy` and `Rollback`. The emergency control is available, but executing it and proving schema compatibility remain inside the owner-deferred staging exception.

Production deployment evidence (2026-07-12): Railway successfully deployed Sentry global-SLO labeling commit `cffe5264` and unknown-API guard commit `8cce1b6b`. Live shallow health returned `ok: true` on `8cce1b6b`; unknown `/api/*` returned HTTP 404, `application/json`, and `Cache-Control: no-store`; the canonical root remained 200 and Raven's Ark remained a 301 to the canonical host.

Production journey/security evidence (2026-07-12): a disposable player completed account creation, starter-pet selection, village/mission navigation, live mission combat, mid-combat logout/password return, hard-refresh token restoration, combat reconnect, and authenticated mobile combat/village navigation at 390x844 without horizontal overflow. A bounded failed-login sequence reached HTTP 429. Testing found an account-enumeration response difference; deployed commit `93125e90` replaces it with a generic failure and dummy scrypt verification. Live verification produced the same HTTP 200 `{"ok":false}` response for an existing-name wrong password and an unused name, and the auth-only verification account was deleted. All 2,867 tests passed before deployment.

Emergency/security evidence (2026-07-12/13): deployed commit `83df546a` added maintenance, new-registration, gameplay-mutation freeze, and scheduled-job switches; hardened proxy identity against injected non-terminal Cloudflare hops; and moved admin login to strict durable throttling. Real local Express smokes proved the control responses, health availability, auth exemptions, disabled scheduler startup, and graceful drain. GitHub secret scanning, push protection, and Dependabot security updates remain enabled; alert 1 is resolved as `revoked` after provider HTTP 401 verification.

Code-scanning evidence (2026-07-12/13): GitHub CodeQL default setup with the extended query suite completed successfully for Actions, JavaScript/TypeScript, and Python. Production Critical SSRF findings were fixed rather than dismissed. Subsequent fixes removed reusable player/admin-prefill browser passwords; constrained image sources; completed LIKE escaping; hardened log formatting, ETags, and join-code mapping; and routed dynamic server map writes through prototype-safe own-property helpers. The authenticated GitHub API reports **0 open Critical / 0 open High** after final hybrid-recovery analysis. CI run `29217444862` and CodeQL run `29217444619` passed; the enforced suite contains 2,896 tests across 434 suites. Railway deployed commit `38804f46`, live `/health` reported that exact commit, and the unknown-API JSON 404 remained correct with `Cache-Control: no-store`.

Release-toolchain evidence (2026-07-12): commit `3d6c9c8b` pins both Docker stages to Node 22.23.1 Bookworm Slim (official bundled npm 10.9.8). Root `package-lock.json` is lockfile version 3 with recorded SHA-256 `34DBC2A62C9A62A0521767269C78D6D6A8EDF840DFEDE328F647C79FC6E733E4`.

**Original 2026-07-11 verdict: APPROVED — LIMITED BETA GO (maximum 25 invited concurrent players, one replica).**

**Current operative verdict (2026-08-19 addendum): APPROVED — BETA GO (100-200 invited concurrent players, one replica).** See the Addendum at the top of this document.
