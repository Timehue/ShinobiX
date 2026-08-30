# ShinobiX targeted security audit

Audit snapshot: 2026-08-27. This is a code-and-local-test assessment of the checked-in runtime. Production environment values, edge controls, database rows, and live traffic were not inspected.

## Verdict

No critical authorization bypass, currency-mint path, or known vulnerable production dependency was found. HTTP and Socket.IO identity converge on the same server authentication, important mutations derive outcomes from stored state, PostgreSQL row-level access is narrowly scoped, and replay/concurrency defenses are unusually extensive for this application size.

The most important unresolved exposure is availability: selected public routes accept a 50 MB JSON parse before their handler authenticates the caller. Live pet-duel events also lack a protocol-level message budget for progress and terminal hints. These are bounded trust/availability issues; neither was changed during the behavior-preserving combat refactor.

Severity counts for this snapshot:

| Severity | Count | Summary |
| --- | ---: | --- |
| Critical | 0 | No proven unrestricted account/admin takeover or authoritative reward forgery. |
| High | 1 | Pre-authentication 50 MB JSON parsing on selected routes can amplify memory/CPU pressure on the single process. |
| Medium | 3 | Live pet-duel event abuse; public-DB TLS certificate verification disabled; production secret/token-only posture is optional rather than readiness-gated. |
| Low | 2 | Restart-token compatibility fallback; non-atomic best-effort AI daily-cost counter. |

## Verified controls

### Authentication and identity

- Player tokens are HMAC-SHA256 signed, expire after 24 hours, bind the canonical player name and a shared session epoch, and fail closed when epoch storage is unavailable. Credential changes can revoke prior tokens by incrementing the epoch.
- Password fallback verifies scrypt hashes. Failed password verification is capped before repeated blocking scrypt work can saturate the event loop.
- Admin requests support 12-hour signed role tokens. Full and content roles are distinct; sensitive routes use the full-admin gate. Constant-time comparisons protect password/token equality checks.
- Socket.IO builds the same auth headers and calls `authedPlayerOrAdmin`. The canonical socket identity is stored at handshake and is used instead of event-supplied names.
- A static mutation-handler scan found an auth/signature/token guard in every default-exported handler containing an unsafe-method branch except `admin-auth.ts`; that route is the credential bootstrap and performs constant-time password checks plus a strict KV-backed limit. This is a useful coverage signal, not a semantic proof for every branch.

### Browser and transport boundary

- Express applies CSP, `nosniff`, frame denial, restrictive permissions policy, referrer policy, and conditional HSTS.
- CORS uses one allowlist predicate for HTTP and Socket.IO. Unsafe no-origin requests do not receive a wildcard browser credential grant.
- Default JSON parsing is 5 MB and save parsing is 1 MB. Malformed JSON receives a stable 400 response rather than reaching route logic.
- Inbound Socket.IO frames are capped at 64 KiB. Presence payloads are normalized and stripped to a small allowlist; inline pet/avatar blobs do not enter the live roster.
- The client source has no `dangerouslySetInnerHTML`, direct `innerHTML`, `eval`, or `new Function` use. BBCode and timeline content are rendered structurally.
- Uploaded images accept raster data URLs or public HTTP(S) hosts, reject SVG/non-image data URLs and internal/single-label/numeric hosts, cap payload length, and enforce player/admin ownership.

### Persistence and replay boundary

- `public.kv_store` has RLS enabled. `authenticated` has no grant; `anon` can select only `pvp:*` rows needed by the legacy realtime subscription. Mutation RPC execution is restricted to the server role by the schema hardening.
- Save authority keys bypass the process cache. Important writers use exact JSON compare-set, fail-closed distributed locks, embedded receipts, or durable settlement state.
- The local release certification passed 90/90 checks, including forged wallet/progression attempts, stale autosave recovery, duplicate rewards, cross-account save projection, Solo PvE outcome authority, PvP action replay, and participant-only receipt access.
- Root and client `npm audit --omit=dev` reported zero known production dependency vulnerabilities on 2026-08-27.
- A source scan found no committed OpenAI/AWS/private-key/JWT literal. Database URL matches were redacted test/example values only.

## Findings

### SECURITY ISSUE — HIGH — large request bodies are parsed before authentication

| Field | Evidence |
| --- | --- |
| Files | `server.ts`, `api/_body-limits.ts`, `api/images.ts`, `api/generate-image.ts`, selected admin handlers |
| Behavior | Express selects and runs the JSON parser before route handlers. `BIG_BODY_RE` grants a 50 MB parser to `/images`, `/img`, `/generate-image`, `/kv-proxy`, and three admin routes. Handler authentication and rate limiting occur only after parsing. |
| Why it matters | A non-browser client can submit concurrent large JSON bodies and force buffering/parsing on the one production Node process. CORS does not protect a server from direct HTTP traffic. `/generate-image` accepts only roughly 2,000 useful prompt/label characters, `/img` is a read path, and `/images` rejects image strings above 3,000,000 characters, so 50 MB is not justified for those public request shapes. |
| Impact | Plausible process memory/CPU exhaustion and service-wide latency or restart. No data-authority bypass was found. |
| Safe fix | Introduce small/default classes for `/img`, `/generate-image`, and ordinary `/images`; keep a large class only where an actual import/restore payload requires it. Add a pre-parser header/content-length gate for internal/admin large-body routes, with focused bare and `/api` tests. Confirm any edge request-size control rather than assuming it. |

### SECURITY ISSUE — MEDIUM — live pet-duel control events lack an event budget

| Field | Evidence |
| --- | --- |
| Files | `api/_realtime/pet-duel-socket.ts`, `api/_realtime/pet-duel-session.ts`, `api/pet/_duel-replay.ts` |
| Behavior | `petduel:input` is capped at 400 accepted commands per side. `petduel:progress` is not rate-limited and broadcasts a cumulative sync on every call. `petduel:finished` is not rate-limited and triggers a complete deterministic replay. |
| Trust effect | Only an authenticated participant can address the session, and the fight has no rewards. However, one participant can amplify broadcasts/CPU, affect the peer's live experience, and ask the server to resolve the deterministic replay immediately rather than waiting for honest playback. |
| Safe fix | Characterize honest progress/finish cadence, then add a per-socket token bucket/coalescing rule and a server-verifiable terminal/progress gate. Preserve reconnect and dropped-player standing-order behavior. |

### SECURITY ISSUE — MEDIUM — public PostgreSQL TLS does not verify the certificate

| Field | Evidence |
| --- | --- |
| File | `api/_storage.ts` |
| Behavior | Unless `PG_SSL=disable`, the pool uses `ssl: { rejectUnauthorized: false }`. Traffic is encrypted but the server certificate is not authenticated. |
| Impact | A network/DNS attacker able to intercept a public database connection could impersonate the database and capture credentials/data. Railway's private internal connection intentionally disables TLS and is a separate case. |
| Safe fix | Use a verified CA/`verify-full` posture for public Supabase/Railway proxy URLs; retain explicit plaintext only for the documented isolated Railway private hostname. Add configuration tests for public vs private host selection. |

### SECURITY CONFIGURATION RISK — MEDIUM — secure production modes are optional

- Missing `SESSION_SECRET` disables player tokens and falls back to blocking password verification on each authenticated request. Passwordless account creation fails closed, but ordinary accounts remain functional and potentially slow.
- Missing `ADMIN_SESSION_SECRET` keeps the reusable admin password on every admin request. `ADMIN_STRICT_TOKEN_ONLY` defaults off for migration compatibility.
- These choices avoid accidental lockout, but startup only logs them; `/health` still returns success. Production configuration was not available to confirm the intended secure state.

Safe next step: add a non-secret production readiness validator that requires high-entropy session secrets, token-only admin mode after rollout, and a dedicated restart token. Keep local/test fallback behavior explicit.

### SECURITY CONFIGURATION RISK — LOW — restart shares the KV token when not configured separately

`/restart` prefers `RESTART_TOKEN` but falls back to `KV_PROXY_TOKEN`. Authentication is constant-time, array-header safe, logged, and capped at five attempts/minute. The fallback expands the blast radius of one leaked internal token and should be removed after deployment configuration proves the dedicated token is present.

### SECURITY / COST RISK — LOW — image-generation daily cap is best effort

`generate-image.ts` reads and sets the daily count non-atomically and increments before prompt validation/upstream success. The strict atomic two-per-minute limiter still bounds abuse, but concurrent calls can lose a daily-counter update and rejected requests consume quota. Use `kv.incr` with an expiry after successful local validation; decide explicitly whether upstream failures should consume the daily budget.

## Replay and concurrency posture

| Boundary | Status | Evidence |
| --- | --- | --- |
| Save overwrite / stale autosave | Strong | Save version plus exact compare-set; release certification rejected stale writes without losing rewards. |
| Purchases / item sale | Strong | Server catalog, one-save mutation, request/fingerprint receipts, focused replay/concurrency tests. |
| Combat actions and rewards | Strong | Session authority, action tokens/receipts, exact result settlement, duplicate claim tests. |
| Training / mission / story claims | Strong but route-specific | Stored proof and bounded/durable receipts; many focused race tests. No single executable writer registry proves every route. |
| Cross-key economy | Defended, operationally complex | Deterministic locks, reserve-first receipts, compensation/reconciliation. Not a database transaction. |
| Lock lease duration | Architectural integrity risk | General lock TTL defaults to 5 seconds with no renewal. A slow critical section can outlive the lease even though stale release cannot delete a new owner's lock. Measure before scale-out. |

## Not tested

- No penetration test, dynamic malformed-payload campaign, or production edge/WAF inspection.
- No live privilege test against production accounts/clans/admin roles.
- No live currency ledger/data-integrity scan.
- No public-database certificate migration test.
- No simultaneous socket-abuse reproduction; the event paths above are direct code findings.

## Priority order

1. Reduce/gate the pre-authentication large-body surface.
2. Add pet-duel progress/finish characterization and event budgets.
3. Verify production session/admin/restart secret posture and public-DB certificate validation.
4. Run the read-only production ledger/data scan and a controlled concurrency suite on disposable staging.
