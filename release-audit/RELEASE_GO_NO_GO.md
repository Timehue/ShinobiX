# Final Verdict

**APPROVED — LIMITED BETA GO**

## Critical Findings

None remain open in the code audit. Generic saves reject unreceipted wallet, progression, inventory, card, pet, mastery, title, and server-receipt mutations; reward-bearing gameplay paths now use authenticated server settlements.

## High Findings

- **SX-004 is closed (data recovery):** Supabase showed seven daily restore points and a real platform backup restored successfully to an isolated project. A second full hybrid drill then captured production Postgres plus the authenticated Raven's Ark overlay and restored both to distinct isolated targets: 3,401 base rows, 115 overlay keys, and 95 player saves matched independent SHA-256 checksums; representative player-save, clan, image, and receipt records all verified. Full-dataset verification passed in 212,082 ms with a 143,585 ms recovery-point age. Paid PITR remains an owner-accepted daily-RPO tradeoff, not an unevidenced recovery path.
- **SX-011 is an accepted limited-beta exception (live integration):** Production and real storage are healthy. The authenticated new/returning mission-combat, reconnect, token-restoration, and 390x844 mobile journey passed, as did bounded 25-client liveness bursts on both deployed backends. Parallel settlement, simultaneous PvP/Clan Boss, rollback execution, cron interruption, all-viewport authenticated mobile, and sustained presence load remain unverified and therefore limit—not block—the launch to the controlled beta envelope below.

SX-012 is closed: the sole historical OpenAI candidate was checked without logging it against OpenAI's non-billable model-list authentication endpoint on 2026-07-13 and returned HTTP 401. GitHub secret-scanning alert 1 was resolved as `revoked` at `2026-07-13T01:40:27Z`. The validated history rewrite remains optional repository hygiene and is not authorized or required for credential containment.

SX-013 is closed: GitHub CodeQL extended analysis completed successfully for Actions, JavaScript/TypeScript, and Python. Production SSRF sinks, SQL-pattern escaping, browser credential persistence, unsafe image sources, log formatting, weak ETag hashing, biased join-code mapping, and dynamic-record prototype hazards were fixed. CodeQL records 2 Critical and 67 High alerts as fixed; 17 Critical and 122 High offline-tooling/test/custom-sanitizer alerts are dismissed with per-alert rationale. Current open counts are **0 Critical / 0 High**.

SX-003 is closed: Better Stack authenticated to production `/health/db`, delivered the controlled 401 incident alert to the named operator, and then entered recovery validation after the correct token was restored.

On 2026-07-12 the owner declined additional staging spend and explicitly accepted the residual SX-011 risk. The missing tests remain recorded as unverified rather than passed; any approval must therefore be limited-launch approval with this exception disclosed.

Supabase showed seven daily restore points (2026-07-06 through 2026-07-12). Point-in-time recovery is a paid add-on and is not enabled; the owner declined the additional spend and accepts daily-backup recovery granularity for the limited launch.

On 2026-07-12 the owner also explicitly accepted launching Village War, Clan Boss, and ANBU Infiltration without their staging smoke/load evidence. Their emergency disable flags remain available, but the features stay enabled by owner decision.

Cloudflare/DNS MFA was subsequently enabled and verified with mobile TOTP on 2026-07-12, closing the earlier deferred DNS-account security gap.

## Conditions Required Before Scaling Beyond Limited Beta

1. Run sustained authenticated Socket.IO presence and settlement load before raising the 25-player cap.
2. Run simultaneous PvP/Clan Boss, cron interruption, rollback execution/schema compatibility, and remaining viewport tests in a disposable environment before broad public launch.
3. Keep production on one replica until presence is migrated to shared state or multi-replica behavior is proven.
4. Rehearse the hybrid restore again during the first launch week and retain redacted evidence; purchase PITR only if daily recovery granularity becomes unacceptable.

## Known Accepted Risks

- Single-instance in-memory presence limits the initial launch to one replica and requires measured capacity before scaling.
- The 4.87 MB JS/CSS payload and large optional pet models require monitored beta limits and mobile performance follow-up.
- Tutorial-tier client-resolved combat rewards remain deliberately bounded to very small catalog ceilings; higher-tier client-trusted combat rewards are disabled by default.

## Recommended Launch Limits

- Launch is approved for **up to 25 invited concurrent players** on one US East replica with staff coverage, live Sentry/Better Stack monitoring, and emergency switches immediately available.
- Keep registration controlled and do not advertise an unrestricted public launch yet.
- Do not raise the limit until authenticated presence, database latency, and settlement error rates are measured under load.

## First 24-Hour Monitoring Plan

- Staff 5xx, deep health, authentication, database latency/connections, restart, save conflict, stuck economy transaction, duplicate receipt, negative balance, combat settlement, cron, and presence alerts.
- Review economy/audit receipts hourly and keep registration, rewards, cron, and risky-system kill switches immediately accessible.

## First 7-Day Monitoring Plan

- Daily economy reconciliation, duplicate/negative-balance scans, failed transaction review, backup verification, PvP/clan-boss settlement sampling, and presence/latency percentile review.
- Perform another non-production restore from a fresh backup during the first week.

## Rollback Triggers

- Any reproducible authorization bypass, unreceipted/duplicate premium grant, confirmed progress loss, or unreconciled partial economy transaction.
- Deep health failure for 2 consecutive minutes, database connection exhaustion, 5xx above 2% for 5 minutes, p95 gameplay API latency above 2 seconds for 10 minutes, or 3 restarts in 10 minutes.
- Combat settlement failures above 1%, presence unavailable/stale for over 5 minutes, or loss of a recent verified restore point.

## Current Validation Evidence

- `npm test`: **2,896 passed, 0 failed** across 434 suites, including the enforced hybrid backup-evidence tests.
- `npm run build`: server TypeScript, clean client install, client TypeScript/Vite build, dist verification, and sizecheck all passed.
- Dependency audit: **0 known vulnerabilities**.
- GitHub CodeQL evidence (2026-07-12/13): extended analysis completed successfully for Actions, JavaScript/TypeScript, and Python; current open alerts are **0 Critical / 0 High**. Commits `6186582a`, `d02e3769`, `aadadc05`, `b4019f3d`, and `619db538` contain the production fixes and regression coverage.
- Express route parity and handler wiring: passed.
- Local production runtime: `/health` returned 200; storage-aware deep health correctly returned 503 without credentials.
- Live Railway production evidence (2026-07-12): authenticated `https://shinobijourney.com/health/db` returned `ok: true`; set/get/delete, set-NX, hash, disk write/read, and `backupFresh` checks all passed; `saveStore` was `remote-proxy`; the independent snapshot was fresh; probe latency was 1,307 ms.
- Better Stack evidence (2026-07-12): a controlled missing-token check opened an incident and delivered an alert to the named operator; restoring the correct `x-health-token` produced successful checks and recovery validation.
- Supabase production evidence (2026-07-12): Pro project `main (PRODUCTION)` was healthy and reported its latest platform backup as 13 hours old.
- Supabase restore evidence (2026-07-12): backup `2026-07-12 08:05:33+00` restored successfully into disposable project `shinobix-restore-drill-20260712` at a dashboard-quoted `$0` additional monthly cost. The project returned online and its `public.kv_store` contained representative admin, asset, and player-avatar records; observed RPO was approximately 18 hours and restore time approximately 2 minutes. The disposable project was removed after evidence capture.
- Hybrid restore evidence (2026-07-12/13): the production Postgres store and Raven's Ark remote overlay were captured with a stable bracketed read and restored to distinct isolated targets. Verification passed for 3,401 base rows, 115 overlay keys, 95 player saves, both full-store SHA-256 hashes, and representative player-save/clan/image/receipt records. Source and target identities differed; total RTO was 212,082 ms and recovery-point age at completion was 143,585 ms. Redacted evidence is in `HYBRID_RESTORE_EVIDENCE_20260712.json`; both disposable projects, the sensitive export, transient credentials, and temporary overlay were deleted afterward.
- Bounded load evidence (2026-07-12): 25 concurrent read-only `/health` requests returned 25/25 HTTP 200 from Railway at p95 175 ms/max 180 ms and 25/25 from the separate Raven's Ark backend at p95 503 ms/max 506 ms. Both reported commit `38804f46`. This proves bounded liveness capacity only, not sustained authenticated presence or settlement safety.
- Railway scale evidence (2026-07-12): production was pinned by `railway.json` to exactly one replica in US East, satisfying the current in-memory presence constraint.
- Domain evidence (2026-07-12): `theravensark.com` returned a 301 to `https://shinobijourney.com/`; production explicitly allowed the Raven's Ark origin while returning no CORS allow-origin header for an unapproved origin.
- Rollback evidence (2026-07-12): Railway exposed both `Redeploy` and `Rollback` actions for a recent removed production image. The control is available; execution and schema compatibility remain part of the owner-deferred staging exception.
- Access-control evidence (2026-07-12): Supabase, Railway, GitHub, and Cloudflare/DNS account MFA were enabled with authenticator apps.
- Hosting-control evidence (2026-07-12): the owner attested that cPanel MFA is enabled behind layered, distinct password controls; no credentials were disclosed.
- Secret-separation evidence (2026-07-12): the owner attested that admin, content-admin, cron, session, restart, KV-proxy, and deep-health secrets all have distinct values; no secret values were disclosed.
- Admin-audit evidence (2026-07-12): the production content audit retained multi-day timestamp, actor, action, and target entries; source supports protected per-domain reads plus compact before/after, reason, and metadata. Player identifiers were excluded from the written audit report.
- Launch-flag evidence (2026-07-12): Railway's variable inventory did not enable weekly-boss client damage, public player AI image generation, or unrestricted client-trusted combat mission rewards; these opt-in client-trust paths remain disabled by default.
- Sentry evidence (2026-07-12): production server/client issues and request-SLO events were being ingested. The apparent `/api/player/roster` p95 event was a process-wide 35-request aggregate inheriting the trigger request's transaction label, not a roster trace; deployed commit `cffe5264` now labels warnings `request-slo/global` and attaches the snapshot. Historical max-connection and remote-KV errors remain visible for trend review.
- Deployment evidence (2026-07-12/13): CodeQL hardening commits through `619db538` and complete hybrid-recovery commit `38804f46` deployed successfully through Railway. CI run `29217444862` and CodeQL run `29217444619` succeeded. The authenticated GitHub API reported **0 open Critical / 0 open High** after analysis. Live `/health` reported `ok: true` and commit `38804f46`; an unknown `/api/*` returned HTTP 404 JSON with `Cache-Control: no-store`. The canonical root and Raven's Ark routing had already passed.
- Authenticated-journey evidence (2026-07-12): a disposable player completed UI registration/creation, starter-pet selection, village and mission navigation, live mission combat, logout/password return, hard-refresh token restoration, combat reconnect, and a 390x844 mobile combat/village pass without horizontal overflow. The disposable authentication record was removed; its inaccessible legacy save record remains identified for operator cleanup.
- Authentication-abuse evidence (2026-07-12): a bounded failed-login sequence reached HTTP 429. Live testing found that an unused name returned a distinguishable response; deployed commit `93125e90` removed the disclosure and performs dummy scrypt verification for nonexistent accounts. Production verification returned the identical HTTP 200 `{"ok":false}` body for an existing account with the wrong password and an unused name; the auth-only test account was deleted successfully. The regression and full 2,867-test suite passed before deployment.
- Emergency-control/rate-limit evidence (2026-07-12): deployed commit `83df546a` adds shared maintenance, registration, gameplay-mutation freeze, and scheduled-job switches plus an operator runbook. It also rejects injected non-terminal Cloudflare proxy hops and moves admin login to strict durable throttling. The full 2,879-test suite and server typecheck passed. Real local Express smokes proved maintenance preserves `/health`, registration shutdown spares login verification, gameplay freeze stops unsafe settlement before storage, scheduled jobs do not arm, and SIGINT drains cleanly. Production commit `3d6c9c8b` remained healthy with all switches default-open; player roster, registration validation, and settlement validation reached their normal handlers rather than a control 503.
- Secret-history evidence (2026-07-12/13): Gitleaks 8.28.0 scanned 3,005 commits (~852.6 MB) and produced 13 redacted candidates. Twelve were reviewed as local-storage/test-token false positives. The sole OpenAI candidate returned HTTP 401 from the provider's non-billable authentication endpoint without being logged; GitHub alert 1 was resolved as `revoked` at `2026-07-13T01:40:27Z`. No secret value is reproduced in this audit.
- History-remediation dry-run evidence (2026-07-12): the official `git-filter-repo` v2.47.0 `--sensitive-data-removal` workflow was run only in a disposable mirror. It rewrote 3,176 of 3,177 commits across 25 branch refs and six closed-PR refs; there were no affected tags, forks, or open PRs. The rewritten current `main` tree exactly matched production, the leaked path existed in zero rewritten commits, and a second redacted 852.3 MB Gitleaks scan returned zero OpenAI-key findings. A force/mirror push dry run succeeded. No remote ref was changed. The shared local repository currently registers 61 worktrees, so destructive rewrite execution requires an explicit cleanup/reclone window. Deployed commit `7f5f4d22` records the verified coordination, force-push, GitHub Support, and clone-recovery procedure; live `/health` reported that commit after Railway succeeded.
- Toolchain evidence (2026-07-12): deployed commit `3d6c9c8b` pins both Docker stages to Node 22.23.1 Bookworm Slim; the official Node release index records bundled npm 10.9.8. Root `package-lock.json` is lockfile version 3 with SHA-256 `34DBC2A62C9A62A0521767269C78D6D6A8EDF840DFEDE328F647C79FC6E733E4`. Live `/health` reported `3d6c9c8b` after the Railway deployment succeeded.
- Production secrets remain outside the repository and were not disclosed in the audit evidence.
