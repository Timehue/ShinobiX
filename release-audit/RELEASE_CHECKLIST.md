# ShinobiX Production Release Checklist

Unchecked items are conditions for scaling beyond the explicitly approved limited-beta envelope unless a line says otherwise.

## Environment and services

- [x] Confirm Railway is the intended primary; production is live at `shinobijourney.com` and pinned by `railway.json` to one US East replica (dashboard evidence, 2026-07-12).
- [x] Provision and validate `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` through authenticated production deep health.
- [x] Provision distinct `ADMIN_PASSWORD`, `ADMIN_CONTENT_PASSWORD`, `CRON_SECRET`, `SESSION_SECRET`, `RESTART_TOKEN`, `KV_PROXY_TOKEN`, and `HEALTH_DEEP_TOKEN` values (owner-attested 2026-07-12; values not disclosed).
- [ ] Configure only required optional services (`OPENAI_API_KEY`, Discord webhook, Sentry, disk overlay/KV proxy).
- [x] Verify no active service-role key, admin password, session secret, backup, or `.env` is exposed in Git history. Gitleaks found one historical OpenAI candidate; a non-billable provider authentication check returned HTTP 401 and GitHub alert 1 was resolved as `revoked` on 2026-07-13. Twelve other candidates were reviewed as local-storage/test-token false positives. A validated `git-filter-repo` procedure remains available for optional owner-coordinated history hygiene.
- [x] Record release toolchain: Docker build/runtime pinned to Node 22.23.1 (`node:22.23.1-bookworm-slim`) with bundled npm 10.9.8; root lockfile version 3, SHA-256 `34DBC2A62C9A62A0521767269C78D6D6A8EDF840DFEDE328F647C79FC6E733E4` (2026-07-12).

## Data safety

- [x] Replace client-authoritative positive currency/XP/level/stat save deltas with server-issued mutations.
- [x] Enforce server entitlement for items, stacks, pets, and cards.
- [x] Validate the live-restored schema/RLS/index/policy/grant shape through the enforced hybrid drill target inspection.
- [ ] Run migration/schema changes in staging before production.
- [x] Confirm automated Supabase platform backup and retention are operating: the dashboard showed seven daily restore points from 2026-07-06 through 2026-07-12. Point-in-time recovery is not enabled because Supabase offers it as a paid add-on; the owner declined additional staging/recovery spend and accepts daily-backup RPO for the limited launch.
- [x] Export and verify an independent full hybrid pre-launch recovery point; the sensitive artifact was deleted after isolated restore while its redacted counts, hashes, identities, timings, and representative proofs were retained in `HYBRID_RESTORE_EVIDENCE_20260712.json`.
- [x] Complete and record a Supabase platform restore drill to an isolated project. Backup `2026-07-12 08:05:33+00` restored into disposable project `shinobix-restore-drill-20260712`; Supabase reported the project back online and the restored `public.kv_store` exposed representative admin, asset, and player-avatar records. The dashboard quoted `$0` additional monthly compute and disk; the disposable project was removed after verification (2026-07-12 America/Chicago).
- [x] Complete the full production hybrid drill: stable Postgres + Raven's Ark overlay capture; distinct isolated database/disk targets; 3,401 base rows, 115 overlay keys, 95 saves; both full-store hashes and four representative categories verified; 212,082 ms total RTO and 143,585 ms recovery-point age. All temporary secrets, sensitive exports, overlay files, and disposable projects were removed.
- [ ] Define migration rollback or forward-repair for every launch migration.

## Build and test

- [x] Clean root dependency install.
- [x] Clean client dependency install.
- [x] Server typecheck/compile.
- [x] Client typecheck/Vite production build.
- [x] Deployment bundle verification.
- [x] Sizecheck.
- [x] Unit/integration suite (2,896/2,896 across 434 suites); programmatic runner avoids Windows command-length failure and includes all discovered source and hybrid backup-evidence tests.
- [x] Client lint after narrow fix.
- [x] Dependency audits (0 known vulnerabilities reported).
- [x] GitHub CodeQL default setup with the extended query suite covers Actions, JavaScript/TypeScript, and Python. The 2026-07-12/13 hardening pass closed all production Critical findings, removed reusable browser-password persistence, added prototype-safe dynamic record writes, and left **0 open Critical / 0 open High** alerts; tooling/test false positives were dismissed with per-alert rationale.
- [ ] Live configured integration suite against a disposable Supabase project.
- [ ] Parallel request tests against real storage for saves, purchases, training, missions, PvP rewards, clan boss, legacy selection, and daily jobs.
- [x] Production-safe new/returning browser journey: created a disposable player through the UI, selected a starter pet, entered a mission battle, logged out mid-battle, logged back in, hard-refreshed the token session, reconnected to combat, and returned to the village (2026-07-12). PvP and Clan Boss remain covered by simulations rather than destructive live multi-account testing.
- [x] Bounded no-cost liveness load smoke (2026-07-12): 25 concurrent read-only `/health` requests succeeded on Railway (p95 175 ms, max 180 ms) and 25/25 succeeded on the separate Raven's Ark backend (p95 503 ms, max 506 ms), both on commit `38804f46`. This is not a substitute for authenticated sustained presence or settlement load.

## Deployment

- [ ] Before deploying stat authority, stop new training on the old build and allow the maximum 8-hour tokenless session to drain; then deploy and restore training. Do not silently discard an in-flight legacy session.
- [ ] Build command: `npm ci --include=dev && cd shinobij.client && npm ci --include=dev && cd .. && npm run build` (Dockerfile performs equivalent stages).
- [ ] Start command: `node dist/server.js`.
- [ ] Schema command/process: apply reviewed `supabase-schema.sql` changes manually/staged; no automatic migration runner exists.
- [x] Liveness URL: `/health`.
- [x] Railway platform liveness URL: `/health`; authenticated operator readiness URL: `/health/db` (bounded, storage-aware, and verified fail-closed).
- [x] Authenticated production deep health: all base-store and disk-overlay checks passed with `saveStore: remote-proxy`; backup freshness passed (2026-07-12).
- [x] Unknown `/api/*` returns a non-cacheable JSON 404 before the SPA fallback (verified live on commit `8cce1b6b`, 2026-07-12).
- [x] Add and test bounded SIGTERM/SIGINT shutdown across cron, game loop, Socket.IO, HTTP, and storage pool.
- [ ] Run `npm run release:health -- https://staging-host` with expected save store.
- [x] Confirm Railway exposes `Rollback` for the recent removed production image (2026-07-12); execution/schema-compatibility drill is owner-deferred with staging.

## Security and operations

- [ ] Hostile-client matrix rejects currency, XP, items, pets, cards, mission completion, combat actions, movement spoofing, cross-player access, and admin access. Stat-point minting and over-budget custom bloodlines are now rejected and regression-tested.
- [x] Rate-limit login/admin/expensive endpoints under trusted proxy headers: live player-login throttling reached HTTP 429; admin login now uses the durable strict KV limiter; paid image generation and settlement routes use strict durable limits; proxy identity rejects injected non-terminal Cloudflare hops. Focused proxy/limiter tests and the full suite pass (2026-07-12).
- [x] Confirm CORS allowlist and TLS/token behavior on the real domain: approved and unapproved origins behaved correctly, password login succeeded, and a hard reload restored the authenticated token session without another password prompt (2026-07-12). The application uses revocable bearer tokens and no longer persists reusable player passwords or admin-prefill passwords in browser storage.
- [x] Live origin-policy smoke: `theravensark.com` received an explicit allow-origin response from production while an unapproved origin received no allow-origin header; both domains served HTTPS (2026-07-12).
- [ ] Require MFA and least privilege on Railway, Supabase, GitHub, DNS, and admin operator accounts.
- [x] Supabase, Railway, GitHub, and Cloudflare/DNS account MFA confirmed with authenticator apps; cPanel MFA and layered password protection are owner-attested (2026-07-12). Application admin-operator evidence remains open.
- [x] Verify production admin audit retention includes timestamp, actor, action, and target; code supports compact before/after/reason/meta fields and protected per-domain reads (2026-07-12 evidence; player identifiers not retained in the audit report).
- [x] Test registration/login brute-force and account enumeration behavior: production returned 429 during the bounded failed-login sequence; unused-name disclosure was found, fixed with equalized scrypt work and a generic response, covered by regression tests, and published as commit `93125e90` (2026-07-12).
- [x] Configure authenticated Better Stack deep-health monitoring and prove incident delivery to the named operator (2026-07-12).
- [x] Confirm Sentry is ingesting server and client production events (2026-07-12). The apparent `/api/player/roster` p95 was diagnosed as a global aggregate inheriting the trigger request's route label; a source fix now labels future warnings `request-slo/global` and attaches the aggregate snapshot.

## Gameplay validation

- [ ] Economy invariants: no negative balances, unreceipted gains, duplicate grants, or partial transfers.
- [ ] Combat: two-browser PvP action/reconnect/disconnect/reward test.
- [ ] Clan boss: simultaneous participants, disconnect, rejoin, settle, and one reward each.
- [ ] Training: early/complete/cancel/parallel/retry with server-side credit.
- [ ] Missions/story: completion proof, refresh/replay, flags, and reward idempotency.
- [ ] Permanent Legacy: parallel accept proves one permanent path.
- [ ] Daily/cron jobs: interruption and same-day rerun are idempotent.
- [ ] Presence: measured authenticated tests at 25, 50, 100, 150, and 300 players.
- [ ] Mobile: authenticated combat and village navigation passed at 390x844 without horizontal overflow (2026-07-12); the remaining required viewport sweep is still open.

## Launch controls

- [x] Keep opt-in client-trust flags absent in Railway: weekly-boss client damage, player AI image generation, and unrestricted client-trusted combat mission rewards remain disabled by default (variable inventory evidence, 2026-07-12).

- [x] Maintenance mode tested at the real Express boundary: `/health` remained 200 while a player API returned non-cacheable 503 with `maintenance_mode`; SIGINT drain completed. Production activation/recovery remains a non-destructive operational drill (2026-07-12).
- [x] New-registration kill switch tested at the real Express boundary: registration returned non-cacheable 503 with `registrations_disabled` while verification still reached its normal validation path (2026-07-12).
- [x] Economy/reward freeze tested at the real Express boundary: an unsafe shop mutation returned non-cacheable 503 with `gameplay_mutations_frozen` while player authentication remained reachable (2026-07-12).
- [x] Scheduled-job disable switch tested at real server startup: the scheduler logged that all jobs were disabled and did not arm its timers; the server remained healthy and drained cleanly (2026-07-12).
- [x] Session invalidation procedure: rotating `SESSION_SECRET` invalidates prior global tokens; password change/admin reset rotate per-account epochs. Token rotation/revocation tests pass and the operator procedure is documented in `docs/EMERGENCY_LAUNCH_CONTROLS.md` (2026-07-12).
- [x] Owner explicitly accepted launching Village War, Clan Boss, and ANBU Infiltration without staging smoke/load evidence (2026-07-12); features remain enabled and the exception must be reviewed before scaling.
- [ ] Rollback owner, incident channel, player-communication template, and evidence-retention procedure assigned.
