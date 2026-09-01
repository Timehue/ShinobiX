# Information Security Program — Shinobi Journey

**Status:** Internal operational document. Not user-facing legal advice.
**Version:** 1.0 · **Last reviewed:** 2026-07-20 · **Review cadence:** at least annually and after any major architecture or vendor change.

This is the written information-security program required by the amended US COPPA Rule
(in full effect 22 Apr 2026) and supports GDPR/UK-GDPR Art. 32 (security of processing).
It is deliberately **proportionate to a small, live indie browser game run by a single
operator** — it documents the safeguards that actually exist in the codebase and is honest
about what does not (§9). It pairs with the [Data Retention Policy](DATA_RETENTION_POLICY.md)
and the token-first threat model in [auth-and-anti-cheat-patterns.md](auth-and-anti-cheat-patterns.md).

## 1. Scope

The React SPA client, the Express API (`server.ts` → `api/**`), the Supabase Postgres
data store, and the Railway + Cloudflare hosting path. Covers player accounts, saves,
premium/virtual currency, user-generated content, and the security signals (IP, device
fingerprint) used to keep play fair.

## 2. Governance — responsible person

**Responsible person:** Tyler Rill, Operator of Shinobi Journey.
**Contact:** support@shinobijourney.com (also the published security-disclosure
address in `/.well-known/security.txt` and on the Notices page).

The amended COPPA Rule expects a named individual rather than a role, which is why
this is a person and not "the team".

The Operator is accountable for: keeping this document current, applying security patches,
managing secrets, overseeing sub-processors, and leading incident response.

## 3. Assets & risk assessment

| Asset | Primary threats |
| --- | --- |
| Player credentials & sessions | Account takeover, credential stuffing, token forgery |
| Character saves & premium currency | Client tampering, reward/currency duplication, save clobber |
| PII / security signals (IP, fingerprint, email via Google sign-in) | Unauthorized disclosure, doxxing |
| User-generated content (chat, names, titles, images, prompts) | Abuse, harassment, illegal content, impersonation |
| Availability | DoS, hostile traffic spikes, deploy-time outages |
| Supply chain | Compromised dependency, leaked secret (repo is **public**) |

The highest-value target is anything that mints currency/XP or overwrites a save; the
controls in §4.3 exist specifically for that.

## 4. Safeguards

### 4.1 Authentication & session management
- **Token-first auth** (`api/_auth.ts`): a 24h HMAC session token (`SESSION_SECRET`) is the preferred credential; the password is the fallback. The client never persists plaintext password once a token exists (`shinobij.client/src/authFetch.ts`).
- **Password hashing:** scrypt (`api/player-auth.ts`); plaintext passwords are never stored.
- **Immediate revocation:** a per-account session epoch (`auth-session:*`) is bumped on credential change, invalidating all outstanding tokens at once.
- **Admin sessions** are separate short-lived (12h) signed tokens with two roles (`full`, `content`) and an epoch kill-switch; the reusable admin password path can be disabled via `ADMIN_STRICT_TOKEN_ONLY`.
- **Ban gate:** every authed request re-checks active bans, so a valid token can never bypass a ban.

### 4.2 Authorization & access control
- Players can only act as themselves (`bodyNameMatchesAuth`); admins are gated on `isAdmin`/`isFullAdmin`, with destructive/PII surfaces restricted to `full`.
- **CORS allowlist** is a single source of truth in `api/_utils.ts`, mirrored by `server.ts` and the Socket.IO layer (kept in sync per CLAUDE.md).

### 4.3 Server-authoritative game integrity (anti-cheat)
- **Never trust the client for rewards/currency/XP/outcomes.** Values are recomputed server-side or gated on a **server-minted, single-use token** whose reward params are sealed in at issue time (`*-start` → report pattern; see `docs/auth-and-anti-cheat-patterns.md`).
- **Shared-state read-modify-write** (treasury, bank, territory, seal pool) goes through `withKvLock` (`api/_lock.ts`) with `failClosed: true` on currency paths; atomic `kv.incr` and compare-and-delete prevent raced double-spends.
- **Device fingerprint** (`shinobij.client/src/fingerprint.ts`) + IP linkage feed sock-puppet/ban-evasion detection — used strictly as a security signal.

### 4.4 Input handling & injection defense
- SQL access is parameterized (`pg` placeholders) or via PostgREST filters — no string-built SQL (`api/_storage.ts`).
- **Prototype-pollution guards** on all dynamic JSON keys (`isSafeRecordKey`/`setSafeRecordValue`, `api/_utils.ts`).
- **Path-traversal guards** on any key→path mapping (`_keyToPath` asserts the resolved path stays under root).
- Body size limits and malformed-JSON handling; user text is length-capped and moderated (§4.7). Admin UI renders user content through React (auto-escaped).

### 4.5 Transport & secrets
- TLS end to end: Cloudflare in front, Supabase requires SSL.
- **Secrets live only in environment variables**, never committed. The repository is **public**, so the rule is: on any exposure, **rotate the secret** (do not try to rewrite history). `SESSION_SECRET` must match across hosts.
- Post-build `verify:dist` fails the deploy if `dist/server.js` is missing/broken, so a bad compile never ships.

### 4.6 Rate limiting & abuse prevention
- Two-tier limiter (`api/_ratelimit.ts`): in-memory burst check + KV-backed fixed window that survives instance hops. Cost-bearing/abuse-sensitive paths (auth, save, image generation, reports) use the strict KV-backed variant.
- Cloudflare provides upstream DDoS mitigation / WAF; the real client IP is resolved Cloudflare-aware (`api/_client-ip.ts`) so limits key on the true origin.

### 4.7 Content safety & moderation
- Server-side text moderation (`api/_text-moderation.ts`) masks slurs/PII and rejects reserved/impersonation terms in names & titles.
- Staff tools (`api/admin/moderation.ts` + `ModerationPanel`): ban, silence, delete chat, IP/fingerprint linkage lookup.
- **In-app reporting** (`api/report.ts` + `components/ReportControl.tsx`) lets any player flag a player/message/chat; reports queue to the Moderation panel for triage (EU DSA notice-and-action + UK OSA).

### 4.8 Logging, monitoring & audit
- Append-only, capped audit logs for admin actions (`mod:audit`) and game-integrity domains (`api/_audit.ts`).
- Battle/action receipts (`api/_receipts.ts`) give a 90-day tamper-evident trail for reward disputes.
- `/health` reports an immutable deploy SHA (`RAILWAY_GIT_COMMIT_SHA`); optional Sentry error reporting with `sendDefaultPii: false`.
- Kill switches (`DISABLE_*`) let the operator shed a misbehaving subsystem without a redeploy.

### 4.9 Backups & recovery
- Supabase managed DB backups + a 90-day application snapshot layer (`api/cron/snapshot-saves.ts`); snapshots are read-only copies. See the [Data Retention Policy](DATA_RETENTION_POLICY.md) §4.

## 5. Change management & testing
- Every change runs the test suite (**3,400+ `node:test` tests**) including a route-parity test (client call ↔ server registration ↔ handler wiring), plus client ESLint + `tsc` and server `tsc`.
- Railway **builds from source on every push to `main`** (committed `dist/` is not served), so the shipped artifact is reproducible from the commit.

## 6. Incident response & breach notification
- **On a production incident: stop shipping.** Diagnose from logs first; revert once rather than pushing speculative fixes forward (established practice).
- Contain → rotate any exposed secret → assess scope → remediate → record in the audit log.
- **Breach notification:** where a personal-data breach is likely to risk individuals, notify the appropriate supervisory authority within the legally required window (GDPR/UK-GDPR: **72 hours**) and affected users where required. Confirm the applicable authority for the operator's jurisdiction as part of readiness.

## 7. Sub-processor / vendor oversight
Each processor must have a signed DPA and be reviewed at least annually:

| Sub-processor | Role | Data reached |
| --- | --- | --- |
| Supabase | Postgres database + managed backups | All stored data |
| Railway | Application compute / hosting | Data in transit through the app |
| Cloudflare | TLS, CDN, WAF, DDoS | Request metadata, IPs |
| OpenAI | Optional AI image generation | Only the submitted prompt, when enabled |
| Sentry | Optional error reporting | Error context (PII scrubbing on) |

> **Action:** confirm a signed Data Processing Agreement is on file for each of the above.

## 8. Review
Reviewed at least annually and after any major change (new sub-processor, new PII category,
auth/storage rework, or a security incident). Bump the version + date on each review.

## 9. Known gaps / roadmap (be honest here)

Current limitations to close — documented so they are tracked, not hidden:

- **Single operator, no separation of duties.** Admin actions are audit-logged but not four-eyes reviewed.
- **No admin MFA yet.** Admin auth is password/token; add MFA or an SSO layer for the admin surface.
- **No formal penetration test / external audit** has been performed.
- **Sub-processor DPAs** (§7) need to be confirmed on file.
- **Dependency/supply-chain scanning** is ad hoc; consider automated `npm audit` / Dependabot gating given the public repo.
- **Breach-notification runbook** is described here but not yet drilled; identify the supervisory authority and a contact template in advance.

_When any gap is closed, update the relevant section and this list, then bump the version + review date._
