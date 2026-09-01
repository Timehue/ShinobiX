# Data Retention Policy — Shinobi Journey

**Status:** Internal operational policy. Not user-facing legal advice.
**Owner:** Tyler Rill — Operator, Shinobi Journey · support@shinobijourney.com; see [Security Program](SECURITY_PROGRAM.md).
**Version:** 1.1 · **Last reviewed:** 2026-08-31 · **Review cadence:** at least annually and after any material change to what is collected.

This policy satisfies the written data-retention-policy requirement of the amended
US COPPA Rule (in full effect 22 Apr 2026) and supports GDPR/UK-GDPR storage-limitation
(Art. 5(1)(e)). The user-facing description of what is collected and why lives in the
[Privacy Policy](../shinobij.client/src/screens/LegalPage.tsx) (`/privacy`); this document
is the operational retention schedule and deletion process behind it.

## 1. Principles

- **Data minimization.** Collect only what the game needs to run, be fair, and stay secure.
- **Purpose limitation.** Each category below has a stated purpose; data is not repurposed (e.g. security signals are not fed into advertising — there is none).
- **Storage limitation.** Nothing personal is retained indefinitely "just in case." Ephemeral data self-expires via TTL; account data is deleted on account deletion; shared records that cannot be deleted are anonymized.
- **No advertising/tracking retention.** The client loads no analytics or ad trackers, so there is no behavioral profile to retain.

## 2. Where data lives

One Supabase Postgres table (`kv_store`, key→JSONB) is the system of record, reached only
by the server (`api/_storage.ts`). Hosted on Railway (compute) behind Cloudflare (TLS/CDN/WAF).
Sub-processors: Supabase, Railway, Cloudflare, and — only when explicitly enabled — OpenAI
(optional image generation) and Sentry (optional error reporting). See the
[Security Program](SECURITY_PROGRAM.md) §7 for the sub-processor list.

## 3. Retention schedule

Retention periods below reflect the TTLs and caps actually enforced in code (cited), not
aspirations. "While account active" means the data is kept as long as the account exists
and is removed by the deletion process in §5.

| Data | Purpose | Retention (enforced) |
| --- | --- | --- |
| Account credentials — scrypt password hash, session-revocation epoch (`auth:*`, `auth-session:*`) | Authentication | While account active; removed on deletion |
| Player session tokens (`x-player-token`) | Auth without re-running scrypt each request | **24h** TTL, self-expiring; revoked immediately on credential change (`api/_auth.ts`) |
| Admin session tokens | Admin auth | **12h** TTL (`api/_auth.ts`) |
| Character save (`save:<name>`) | Core gameplay/progression | While account active; removed on deletion |
| Player save snapshots — daily cron + manual (`save-snapshot:*`) | Corruption/rollback recovery | **90-day** TTL, auto-expiring (`api/cron/snapshot-saves.ts`, `api/admin/save-snapshot.ts`) |
| Snapshot success marker | Backup-health monitoring | **180-day** TTL |
| Battle receipts (`receipt:*`) | Reward-dispute / debugging | **90-day** TTL (`api/_receipts.ts`) |
| Mission progress receipts | Anti-replay of reward claims | **14-day** TTL (`api/missions/record-progress.ts`) |
| Server-authoritative flow tokens — raid / expedition / combat-claim / arena lobby / story session / trade nonce / Google OAuth state | Anti-cheat sealed-reward flows | Short TTL: 5 min → 7 days depending on flow (see each `*-start` handler) |
| Moderation records — bans, silences, IP/fingerprint linkage (`mod:*`) | Safety, ban enforcement, repeat-abuse detection | Bans/silences expire at their set `until`; linkage indexes retained as security data while the account exists |
| Moderation audit log (`mod:audit`) | Staff accountability | Rolling **last 5,000** entries (`api/admin/moderation.ts`) |
| Domain audit logs (`audit:<domain>`) | Integrity/accountability (content, reward, sector, combat, legacy) | Rolling **last 5,000** per domain (`api/_audit.ts`) |
| Player abuse reports (`reports:queue`) | Safety triage (DSA/OSA) | Until resolved/removed by staff (`api/report.ts`); reporter identity retained with the report |
| Presence / online status (`presence:*`) | Show who is online | **~90s** TTL |
| Rate-limit counters (`ratelimit:*`) | Abuse/DoS prevention | ~2× the window (minutes), self-expiring (`api/_ratelimit.ts`) |
| Follows list (`friends:*`) | Social follow | **365-day** TTL, refreshed on use |
| Uploaded / AI-generated images (`shared:img:*`, `shared:imgfields:*`) | Display player/creator content | While referenced by a save/record; first-writer-wins ownership |
| IP address + device fingerprint (security context) | Anti-sock-puppet, abuse investigation, rate-limit fairness | Treated as **security data**; retained while the account exists or an abuse investigation is open |
| Client error diagnostics (Sentry, only if enabled) | Reliability | Per Sentry project retention (default ~90 days); `sendDefaultPii: false` is set (`shinobij.client/src/lib/sentry.ts`) |

## 4. Backups

- **Managed database backups:** provided by Supabase per the active plan (point-in-time / daily). These are Supabase's infrastructure backups; deletion requests are reconciled against them over the normal backup rotation rather than by reaching into a backup.
- **Application snapshot layer:** the 90-day `save-snapshot:*` copies above, for player-specific rollback.
- A record deleted from live storage may persist in a backup until that backup naturally rotates out; this is disclosed to users in the Privacy/Privacy-Request pages ("backups" caveat).

## 5. Deletion & data-subject requests

Process is described to users on the [Privacy Request](../shinobij.client/src/screens/LegalPage.tsx) page (`/privacy-request`). Operationally, a completed account deletion reviews and removes/anonymizes:

1. Credentials (`auth:*`) and the session epoch (`auth-session:*`) — revokes all tokens.
2. The character save (`save:<name>`) and any per-player side stores (follows, presence, receipts).
3. Public projections / roster references so the player stops appearing to others.
4. Uploaded content and generation prompts the player owns.
5. Security linkage indexes (`mod:ip`, `mod:fp`) — retained only where a lawful safety/fraud need exists, otherwise removed.
6. Shared records that cannot be deleted without corrupting other players' history (e.g. a battle both fought, clan-war logs) are **anonymized** (the departing name is scrubbed) rather than deleted.

Snapshots (`save-snapshot:*`) self-expire within 90 days; managed DB backups reconcile on their own rotation.

## 6. Children's data (COPPA)

The service is **not directed to children under 13** and states a 13+ minimum at sign-up and in the Terms. We do not knowingly collect personal information from under-13 users. **On discovering a under-13 account**, delete the account and its personal information promptly using §5, and record the action in the moderation audit log. Do not retain a under-13 account's data beyond what is needed to complete deletion.

## 7. Known gaps / roadmap (be honest here)

These are current limitations to close, not claims of compliance:

- **Deletion is request-based, not self-serve.** There is no one-click "delete my account" button yet; requests go through staff (`/privacy-request`). Consider adding a self-serve flow.
- **No automated inactivity purge.** Accounts persist while they exist; there is no job that deletes long-dormant accounts. Decide on (and document) an inactivity horizon if desired.
- **Sentry retention is config-dependent.** If Sentry is enabled in production, confirm/lower its retention and scrubbing settings to match this policy.
- **Sub-processor DPAs** must be in place (Security Program §7) for the transfers above to be covered.

_When any of these is resolved, update the relevant row above and bump the version + review date._
