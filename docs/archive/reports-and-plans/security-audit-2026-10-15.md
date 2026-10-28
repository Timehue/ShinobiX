# Security audit, 2026-10-15

This was a read-only audit of `main` at `dc559edd2`. It covered:

- passwords and sessions
- storage and data at rest
- authorization on every route
- the client and HTTP layer
- abuse resistance, logging and infrastructure

The audit itself changed no code; the fixes that followed are summarised under Status. Each finding below was traced in the source. The ones marked **reproduced** were also run locally.

`npm audit --omit=dev` reports 0 vulnerabilities for both the root and `shinobij.client`.

## Status

The findings below are addressed on branch `claude/game-security-audit-d368ab`, with these exceptions and partial fixes:

- **M5 (IPv6 rate-limit buckets) and L2 (Postgres TLS verification)** were deliberately left out by the owner.
- **L1:** logging out still signs out only the current device. A Settings button, "Sign out other devices" (`logout-others`), now revokes every other session on demand.
- **L4:** the 90-day expiry is set on each new or refreshed IP and fingerprint row. Rows written before the deploy keep no expiry until that account is seen again. Giving them one would need a throttled one-off script, which is not written.
- **L9:** a weak secret logs a warning at boot rather than stopping the server. The two dangerous cases fail closed where the secret is used: a placeholder admin password is refused on every path, including `/admin-auth`, and a shared admin/player session secret disables admin tokens.
- **M6:** every route parses at most 5 MB unless the request already carries admin credentials. That covers the anonymous callers on `/images` and on the three admin content routes, and `/generate-image` and `/img` lost the 50 MB parser entirely.
- **L13 is partly done.** Both local tags that held the leaked secrets were deleted. Fifteen `refs/prescrub/*` backup refs still hold them. Deleting those, and confirming the keys were rotated, is an owner decision.
- **L3's legacy-hash wrap** ships as `scripts/wrap-legacy-password-hashes.mjs`. It does a dry run by default and has not been run against production.
- **L15** adds only the diagnostic log. The check itself still has to be read from the production logs.

Operator steps after deploy:

- Sign into the admin panel again, because admin tokens are now `av2`.
- Read the `[startup]` lines for weak-secret warnings.
- If the service is ever opened at its `*.up.railway.app` URL, add that exact origin to `EXTRA_ALLOWED_ORIGINS`.
- Ten wrong `x-admin-password` values from one IP within 15 minutes block that IP's admin password, the correct one included, for the rest of the window. A tool or panel that keeps sending an outdated password after a rotation triggers this within seconds. Signed admin tokens are unaffected.

## Fix first

| # | Severity | Finding | Fix size |
|---|---|---|---|
| H1 | High | The content-admin password can act as any player: move currency, drain treasuries, and open sockets as the victim | Small code change (auth helper) |
| H2 | High | The admin password can be brute-forced with no limit through any route | Production config only, or a small code change |
| H3 | High | A stolen session token becomes a permanent account takeover, through a Google link or by reissuing the recovery code | Medium code change |
| M1 | Medium | Admin tokens can be forged if `ADMIN_SESSION_SECRET` equals `SESSION_SECRET` | Config check, plus a small code change |
| M2 | Medium | Open redirect on the www/legacy hosts (**reproduced**) | Small code change |
| M3 | Medium | Any player can take over catalog pet art | Small code change |

Things to do in Railway or git today, with no code change:

- Set `ADMIN_SESSION_SECRET` to a value distinct from `SESSION_SECRET`.
- Set `ADMIN_STRICT_TOKEN_ONLY=1`, once the admin panel logs in through `/admin-auth`.
- Make sure `ADMIN_PASSWORD` and `ADMIN_CONTENT_PASSWORD` are long and random.
- Delete the local tag `early-progression-backup` (see L13).

---

## High

### H1. The content-admin role acts as full admin on gameplay routes

**Where:** `api/_auth.ts:546-564` and `api/_auth.ts:574-583`.

- `authedPlayerOrAdmin` falls back to `isAdmin()`, which accepts *either* admin password.
- `bodyNameMatchesAuth` then returns `true` for any admin ("admins can act as anyone").
- About 230 handlers use the pattern `!identity.admin && identity.name !== playerName`.
- The Socket.IO handshake (`api/_realtime/socket.ts:199-202`) trusts the claimed `x-player-name` for admin identities.

The code elsewhere clearly means Admin 2 to be limited (`adminSaveTargetAllowed`, `fullAdminOnlyKinds`, `save-snapshot` restricted to full admin). The gameplay routes bypass all of that.

**Exploit.** With only `ADMIN_CONTENT_PASSWORD`, a caller can:

- Move any player's currency to themselves, skipping the anti-alt overlap and outbound budget: `POST /api/player/trade` with `{"playerName":"victim","toPlayer":"me",...}`.
- Drain any clan or village treasury: `clan/treasury/transfer`, `village/treasury/transfer`, `clan/seal-pool/distribute`.
- Kick clan members and finalize clan-war results.
- Rewrite territory through the `world-state` POST.
- Post chat as anyone.
- Open a realtime socket as any player.

**Fix.**

1. Add `authedPlayerOrFullAdmin` (`isFullAdmin` instead of `isAdmin`).
2. Use it in `bodyNameMatchesAuth`, in every `identity.admin` act-as path, and in the socket handshake.
3. Keep `isAdmin` for content endpoints only.

**Risk:** Admin 2 tooling that currently acts as players would stop working.

### H2. The admin password can be brute-forced with no limit

**Where:** `api/_auth.ts:392-417`.

`isFullAdmin` and `isAdmin` accept a raw `x-admin-password` on every call with no failure budget. Only `api/admin-auth.ts:25` is rate-limited (20 per 15 min).

**Exploit.** Loop `GET /api/clans/list` with `x-admin-password: <guess>` and no player headers.

- A 401 means the guess is wrong; a 200 means it is right.
- `admin/grant-item`, `admin/content-publish`, `admin/legacy` and `admin/save-snapshot` also have no limiter before auth.
- The socket handshake is another oracle.

Thousands of guesses per second are possible. Combined with H1, guessing the *content* password alone is enough to move the economy.

**Fix.**

- **Production:** set `ADMIN_SESSION_SECRET` and `ADMIN_STRICT_TOKEN_ONLY=1`. The password is then only accepted at the rate-limited `/admin-auth`.
- **Code:** charge a per-IP failure budget inside `isAdmin`/`isFullAdmin` whenever an `x-admin-password` is present and wrong (the same pattern as `authpw-fail`). Refuse to boot with a placeholder or short admin password.

### H3. A stolen token becomes a permanent takeover

**Where:**

- `api/auth/google/start.ts:55-73`: link mode needs only `authedPlayer`.
- `api/player-auth.ts:1187-1221`: `recovery-issue` accepts a token alone.
- `api/player-auth.ts:1290` and `1462-1464`: `recover` and `adminreset` deliberately keep `google`.
- No unlink endpoint exists.

**Exploit.** With a token taken from `localStorage` (shared PC, malware, or any future XSS), the attacker can either:

- (a) link their own Google account. That door survives every password change and admin reset.
- (b) reissue the recovery code, then `recover`. This sets a new password, rotates the epoch and locks the real owner out.

**Fix.**

- For password accounts, require the current password or a recent login (token `iat` under 10 minutes) for Google link and for `recovery-issue`.
- Add owner and admin unlink actions.
- Have `adminreset` optionally drop `google`.

## Medium

### M1. Admin tokens can be forged if the two session secrets are equal

**Where:** `api/_auth.ts:120-123` and `api/_auth.ts:343-345`.

- Player tokens sign `"<name>.<exp>.<epoch>"`.
- Admin tokens sign `"<role>.<exp>.<epoch>"`.
- Both use bare HMAC-SHA256 with no domain separation.
- The name `full` is not reserved (`player-auth.ts:68`). A new account's epoch is 0, which matches the default `ADMIN_SESSION_EPOCH`.

**Exploit.** If the two secrets are equal:

1. Register `full`.
2. Re-wrap the issued player token's signature as `av1.full.<exp>.0.<sig>`.
3. The result is a valid full-admin token.

`.env.example` says to keep the secrets distinct, but nothing enforces it. I did not read the production values.

**Fix.**

- Prefix the HMAC inputs (`player-v2|`, `admin-v1|`).
- Refuse admin tokens when the two secrets are equal.
- Reserve the names `full` and `content`.

### M2. Open redirect on the canonical-host 301 (reproduced)

**Where:** `api/_canonical-domain.ts:79-82` and `server.ts:923-926`.

`new URL(originalUrl, canonicalOrigin)` with `//evil.example/login` resolves to `https://evil.example/login`. `/\evil.example/x` behaves the same way. Running it locally:

```
canonicalRedirectLocation('//evil.example/login') → https://evil.example/login
```

Any `www.` or legacy-domain URL of this shape sends a 301 off-site, and browsers cache it.

**Fix.**

- Collapse leading slashes and backslashes: `'/' + originalUrl.replace(/^[\/\\]+/, '')`.
- Assert that the resulting origin equals the canonical origin.
- Add tests for both cases.

### M3. Players can take over catalog pet art

**Where:** `api/images.ts:694-700` and `api/images.ts:742-758`.

- `pet:`, `petbody:`, `petsheet:` and `petlayers:` ids are first-writer-claimable by any player.
- Admin uploads return early and never write `img-owner:<id>`.
- So admin-published species art (`petbody:starter-fire`, `pet:<id>:variant:...`) is unclaimed.

**Exploit.** The first player to POST that id replaces the sprite for everyone. From then on, every non-admin is blocked from fixing it.

Legacy bloodline and pet slots from before the claim system have the same gap.

**Fix.**

- Record an `__admin__` claim on admin writes, and backfill the catalog ids.
- Refuse writes to existing images that have no owner row.

### M4. `/api/img` redirects to any URL a player stored, and `misc:` has no owner check

**Where:** `api/img.ts:148-151` and `api/images.ts:89-97, 945-998`.

Players can store an `https://` URL under `misc:*` (and under item, bloodline and jutsu ids). `/api/img?id=misc:x` then 302s there from the game domain, as a phishing link or a tracking pixel. Any player can also overwrite another player's `misc:` ids.

**Fix.**

- Accept only inline raster data URLs from non-admins, or proxy instead of redirecting.
- Refuse non-admin `misc:` uploads.

### M5. Per-IP rate limits are keyed on the full IPv6 address, and there is no per-account login throttle

**Where:** `api/_ratelimit.ts:176,254,399` and `api/_auth.ts:505-510`.

A single /64 gives an attacker unlimited fresh buckets for:

- `verify`
- the password header path
- guest minting
- `admin-auth`

There is no per-account failed-login counter, and the password policy accepts `password1`.

**Fix.**

- Bucket IPv6 by /64.
- Add a soft per-account throttle on failed `verify` that slows down but does not lock out.
- Add a common-password denylist.

### M6. Unauthenticated callers can force a 50 MB JSON parse

**Where:** `api/_body-limits.ts:16-17` and `server.ts:249-272`.

The 50 MB parser runs before auth on `/generate-image` and `/img`. A few concurrent large bodies stall the single event loop for every player.

**Fix.**

- Drop `generate-image` and `img` from `BIG_BODY_RE`.
- Check admin auth before parsing on the admin big-body routes.
- Shrink the global `urlencoded` limit, currently 5 MB.

### M7. Account deletion leaves data behind, and a re-registered name inherits it

**Where:** `api/_delete-player-account.ts:199-262`.

Deletion does not remove:

- `shared:img:avatar:<slug>` and its R2 copy, which stays publicly served
- `save-snapshot:<slug>:*`
- `img-owner:*` claims
- `upload:misc-count:<slug>`

Someone who later registers the same name inherits the avatar and the image claims.

**Fix.** Add these key families to the deletion, and call `deleteImage` for the avatar.

## Low and info

| # | Finding | Where | Fix |
|---|---|---|---|
| L1 | Logout does not revoke tokens. Sliding refresh keeps a stolen token alive indefinitely. | `server.ts:394-411`, `_auth.ts:294-309` | Add a `logout-all` action that rotates the epoch, and call it on explicit logout. |
| L2 | Postgres TLS does not verify the certificate (`rejectUnauthorized: false`). | `api/_storage.ts:409`, `scripts/kv-backup.mjs:310` | Pin the Supabase CA. |
| L3 | scrypt N=2^14, below the 2^17 guidance. Dormant accounts keep the fast legacy `HMAC(salt,pw)` hash. | `player-auth.ts:224-248` | Wrap legacy hashes in scrypt, raise N, and use async `crypto.scrypt`. |
| L4 | The `mod:ip-v2`, `mod:by-ip-v2` and `mod:fp` indexes have no TTL (IP history kept forever). | `api/admin/moderation.ts:174-219` | Add a 30–90 day TTL and document it in the privacy docs. |
| L5 | CORS allows every `*.up.railway.app` origin, plus localhost, in production. Harmless today (no cookies), critical if cookie auth is ever added. | `api/_utils.ts:207-227` | List the exact Railway domain instead. |
| L6 | One global `/restart` attempt counter, counted before auth. Anyone can lock the operator out. The log line records the spoofable `X-Forwarded-For`. | `server.ts:722-740` | Count failures per IP and log `clientIp()`. |
| L7 | Names such as "Admin", "Moderator" and "GameMaster" are allowed (the reserved-term check covers titles only). | `api/_text-moderation.ts:225-235` | Apply `RESERVED_TITLE_TERMS` at register and rename. |
| L8 | Account enumeration: `change` and `delete` return 404 vs 401. | `player-auth.ts:1070,1362` | Return a uniform 401. |
| L9 | Placeholder or short `SESSION_SECRET`, `ADMIN_*` values are accepted at boot. | `_auth.ts:94-97` | Add a boot check (≥32 bytes, no `change-me`). |
| L10 | Any logged-in player can read a clan's full save (treasury, receipts, join requests). | `api/save/[name].ts:660`, `clans/list.ts:40-60` | Project these fields out for non-members. |
| L11 | Profile `[img]` BBCode and external art work as IP-logging pixels (CSP `img-src https:`). | `nindo-bbcode.tsx:217-231` | Proxy external images or restrict them to own hosts. |
| L12 | Tebex idempotency list is trimmed to 200 entries, so a very old replayed signed webhook could re-grant. | `api/tebex/webhook.ts:212` | Add a persistent `tebex-txn:<id>` NX key. |
| L13 | Previously leaked secrets (an OpenAI key and a Supabase password, commits `f316dc14a` and `0069b0f15`) are still reachable through the **local** tag `early-progression-backup`. It is not on origin, but `git push --tags` would republish them. | local git | Delete the tag, run `git gc --prune=now`, and confirm both were rotated. |
| L14 | Backups (`kv-backup.mjs`) are unencrypted gzip JSON, including auth hashes, recovery digests and IPs. | `scripts/kv-backup.mjs:383-407` | Encrypt with age or GPG. |
| L15 | Client-IP trust depends on Railway's `X-Real-IP`. If Cloudflare is in front, verify it is the visitor's IP and not the edge's. The origin is directly reachable. | `api/_client-ip.ts:204-260` | Log `X-Real-IP` against `CF-Connecting-IP` once in production. |
| L16 | `/api/player/leaderboards` is unauthenticated, uncached and unthrottled, and runs a full `hgetall` on every request. | `api/player/leaderboards.ts:13-38` | Add a short `cachedFor` cache and a per-IP limit. |
| L17 | The container runs as root. | `Dockerfile` | Add `USER node`. |
| L18 | Minor hygiene items. | — | See below. |

L18 covers:

- `village/war-campaign.ts:584` echoes raw `error.message`.
- The Sentry `OMIT_KEYS` list lacks `x-kv-token`, `x-restart-token` and `recoveryCode`. The request and body are already dropped, so this is low risk.
- `generate-image`'s daily cap is a get-then-set race. It is off by default.
- GitHub Actions are pinned by tag, not SHA. They have read-only tokens.
- `connect-src https: ws:` is broad.

## Checked and sound

**Password storage**

- Hashes use scrypt with 16-byte CSPRNG salts.
- Comparison is timing-safe.
- `verifyAgainst` fails closed on a missing hash or salt.
- A dummy scrypt runs for unknown names.
- Hash and salt live only in `auth:<slug>`. No read path returns them.

**Session tokens**

- Strict parsing.
- Bound to `x-player-name` and the route name.
- Epoch revocation, which fails closed on a storage error.
- The ban gate applies on both auth paths.
- Without `SESSION_SECRET`, tokens are off and Google and guest account creation are refused.

**Credential changes**

- Change, recover and admin reset rotate the epoch under `withKvLock(failClosed)`.
- Recovery codes have 100 bits of entropy, are stored as salted SHA-256, and are single-use.

**Google sign-in**

- Signed state with a 5-minute TTL.
- Full validation of the ID token claims.
- A single-use ticket plus a browser nonce, and no token in the URL.

**Storage**

- Every SQL query is parameterized, and LIKE patterns are escaped.
- RLS is on, and `anon` and `authenticated` are revoked on `kv_store` and the RPCs.
- The server uses only the service key. The anon key in the client is unused and can read nothing.
- `safeName` strips `:`, so no key can be injected from a client name.

**Client**

- No `dangerouslySetInnerHTML`, `innerHTML` or `eval`.
- BBCode renders as React nodes with http(s)-only links.
- `noopener` on every new window.
- The plaintext password is held in memory only.
- No server secrets in the bundle, and no source maps.

**HTTP headers**

- A strict CSP `script-src`, plus `frame-ancestors 'none'` and `nosniff`.
- No cookies, so CORS grants no ambient authority.
- The service worker never caches authenticated JSON.

**Other surfaces**

- **Tebex webhook:** HMAC over the raw body, and it fails closed.
- **Cron:** cron routes take a bearer secret.
- **Health and restart:** fail closed in production.
- **QA routes:** unreachable in production.
- **Logging:** Sentry sets `sendDefaultPii:false` and scrubs data. No logs contain passwords, tokens or bodies.
- **Containers and CI:** `.dockerignore` excludes `.env`. No `pull_request_target` in workflows. `npm audit` is clean.
