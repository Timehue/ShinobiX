# Security and performance audit — 2026-11-04

Base: `main` at `1a21fd4ecd`. Method: eight read-only audits, each on an angle
the 10-15 security audit, the 10-28 load check and the 11-04 gap scan did not
cover: auth and privilege, currency integrity, input handling and resource
abuse, data exposure and the socket, client and secrets, concurrency, server
performance, client performance. Every finding fixed below was re-read in the
code before the fix; the open ones are marked CONFIRMED (path traced) or
SUSPECTED.

## Production baseline (Railway, last 7 days)

- 930k requests, 72 server errors (0.008 %), 22.7k 4xx.
- Latency p50 6-38 ms, p90 44-207 ms. p99 reaches 1.2-1.8 s in two
  12-hour buckets.
- Memory averages 0.36 GB; one peak hit 1.03 GB. CPU is idle (avg 2 %).
- Row sizes (JSON): largest player save 609 KB (median 63 KB stored), largest
  clan 56 KB, largest village 5 KB.
- `npm audit --omit=dev`: 0 known vulnerabilities in either package.

## Fixed in this change

| # | Severity | What | Where |
|---|---|---|---|
| 1 | Critical | One request could freeze the whole server. The email pattern in `sanitizeUserText` was quadratic on a long run of word characters (measured: 20k chars = 0.9 s, so a 1 MB DM ≈ 40 min of a blocked event loop), and the text was only cut to length *after* every regex ran. Now the input is cut to `maxLen*4+256` before any scan, and the email pattern has RFC-length bounds. | `api/_text-moderation.ts` |
| 2 | High | A player could make themselves immune to world raids by broadcasting a low `level` in presence: `attackBlock` read the client-claimed level and refused every attacker with "newcomer protection". Player attacks now take the floor from the target's save. | `api/player/attack.ts` |
| 3 | High | Player saves, clan saves and village state merge the body over the stored row and keep unknown keys, so a client could grow one row by MBs a minute (slower reads for everyone, the snapshot cron copies it, and the Postgres disk has filled before). A write that would leave the row over 4 MB / 512 KB / 256 KB **and** bigger than it is now is refused with 413. | `api/_row-growth-cap.ts`, `api/save/[name].ts`, `api/game-state.ts` |
| 4 | Medium | New clan notices skipped the author check when `author` was empty, and their text was never moderated or capped. Now the author must be the caller, and title/body go through the same sanitizer as village orders. | `api/_clan-save-validate.ts` |
| 5 | Medium | The public, edge-cached roster leaked jutsu loadouts: the strip list named `equippedJutsu`, but the field is `equippedJutsuIds`. Also stripped now: named gear, card deck, warfront loadout, ranked weapon, unspent stats, and private run/outcome state. | `api/player/roster.ts` |
| 6 | Perf High | The village-war `guard-state` / `shrine-state` polls (every 3-5 s per player) rewrote the whole war row through a full-row compare-and-set even when nothing changed. Unchanged results now skip the commit. | `api/_village-war-campaign.ts` |
| 7 | Low | `presence:request` on the socket had no throttle; each answer is an O(sector) snapshot. Now once a second per socket, with the last request answered at the end of the window (never dropped). | `api/_realtime/socket.ts` |

One more finding, the ANBU win hook rewriting the clan treasury under a
fail-open lock, is already fixed (uncommitted) on the 11-04 gap-scan branch
`claude/game-gaps-scan-218f19`, so it is not touched here.

## Fixed in the second round (owner: "fix these, no player friction")

| Finding | Fix | Player-visible change |
|---|---|---|
| Exchange skips the send limit (High) | A Fate Shard / Bone Charm / Aura Stone lot is charged to the seller's rolling outbound budget at listing creation, under the same per-sender gate as `/api/player/trade` (`api/festival/_exchange.ts`). Items, pets, cards and every purchase are untouched. | Only a seller listing more than 1,000 of one currency a day (25 for new/sub-10 accounts), the same limit trades have. |
| Google-only account takeover with a lifted token | A first password on a Google-linked account needs a Google sign-in in the last 30 min (`google.lastAuthAt`, stamped at claim, link and Google signup). Guests keep the token-only path. | A Google player setting a password long after signing in is asked to sign in with Google again first (409, plain message, never a sign-out). |
| Link-mode login CSRF | The callback only checks; the link is written at `/claim`, which needs the nonce only the starting browser holds (`api/auth/google/_link.ts`). "taken"/"expired" still come back from the callback as before. | None. |
| Google ticket burned by a wrong nonce | The nonce is compared before the ticket is consumed. | None. |
| Sockets outlive ban / sign-out-others / password change | Ban and every session-epoch rotation close that player's sockets at the transport (`disconnectPlayerSockets`), so the client's own reconnect runs: the current device comes back with its new token; a revoked token or a ban is refused at the handshake. | A sub-second socket blip on the device that changed its password. |
| Password account deletable with only a token | `DELETE /api/save/<self>` and `player-auth delete` require the password when the account has one; the client already sends it. Google-only and guest accounts unchanged. | None. |
| World-boss GET took 3 locks per poll (perf High) | The tick is coalesced to one per second process-wide; a no-change tick takes no lock and writes nothing; join/leave still tick directly. | None. |
| Idle regen re-rendered the open sector at 1 Hz (perf, partial) | The 144 sector tiles and the peer layer are memoized; the save snapshot is not rebuilt when its inputs are unchanged. The App/WorldMap render itself stays (WorldMap reads vitals in handlers, so a memo would serve stale HP). | None. |

**Deliberately NOT changed:** the 2 s `world-move` poll. It returns nearby players across sector seams (distance 10, any sector), and the socket only pushes movement to the mover's own sector, so stretching it would make players just over a boundary appear late. It needs a server push to neighbouring sector rooms first.

## Open — needs an owner decision

### Security

**Auth, password and admin paths** (CLAUDE.md: explain the risk before changing):

1. **Medium-High, CONFIRMED: a stolen token on a Google-only account becomes a permanent takeover.**
   - **Path:** `change` with only `newPassword` is accepted on a passwordless record (`api/player-auth.ts` ~1196). It returns a fresh recovery code. Then `google-unlink` with that new password detaches the owner's Google and rotates the epoch.
   - **Proposed fix:** a first password on a Google-linked account needs a fresh Google re-auth. Guests keep token-only.
2. **Medium, CONFIRMED: login CSRF on the Google *link* flow.**
   - **Path:** an attacker starts link mode on their own account and sends the authorize URL to a victim. The callback commits the link before any check that this browser started the flow (`api/auth/google/start.ts`, `callback.ts`). From then on, the victim's "Sign in with Google" opens the attacker's account.
   - **Proposed fix:** bind the start to the browser (HttpOnly SameSite=Lax cookie holding H(nonce)), or move the link write to `/claim`, which already checks the nonce.
3. **Medium, CONFIRMED: an open socket outlives a ban and "sign out other devices".**
   - The handshake is the only auth check. Ban and epoch rotation never disconnect sockets, so the next `presence` / `world:move` puts the player back in the world.
   - **Proposed fix:** `io.in('user:<slug>').disconnectSockets(true)` on ban and on every epoch rotation.
4. **Medium, CONFIRMED: a password account can be deleted with only a token.** The 24 h delay and cancel help, but a thief's token survives the owner's normal logins. **Proposed fix:** require the current password for the request when the account has one.
5. **Low-Medium (misconfiguration only): placeholder secrets are accepted.** `SESSION_SECRET`, `RESTART_TOKEN` and `CRON_SECRET` are not checked against `isPlaceholderSecret`, and the boot warning claims they are "refused until replaced", which is false. **Proposed fix:** treat a placeholder as unset.
6. **Low: anyone who sees a Google ticket can burn it.** `consumeGoogleTicket` deletes the ticket before comparing the nonce (denial of service only).

**Economy** (balance-sensitive):

7. **High, CONFIRMED: the Sunscar Exchange skips the outbound transfer budget.**
   - Trade, clan treasury and village treasury transfers all charge the 24 h budget and the 10 % burn. The Exchange charges neither.
   - A resource lot can hold Fate Shards, Bone Charms or Aura Stones at `price: 1`, where the fee `floor(1*5/100)` is 0. One account can therefore hand another unlimited premium currency, untaxed, past the restricted-account limits. The only guard is the same-connection check.
   - **Decide:** ban currency resource lots, set a minimum price per unit, or run the budget gate on Exchange purchases.
8. **Medium, CONFIRMED: Clan Seal Pool `distribute` has no shared-IP/fingerprint guard and lets the leader pay themself** (`api/clan/seal-pool/distribute.ts`). Both treasury transfers refuse shared connections.
9. **Medium, CONFIRMED: the clan-war tile-card finalize can overwrite the war row and pay war-end clan XP twice.** It uses a fail-open lock and a plain `kv.set` (`api/clan/war/tilecards.ts:77-86`), while the PvP path uses `failClosed` + `compareSet`. A stale write can revert a PvP-ended war, and the second ending pays XP again under a different receipt namespace.
10. **Medium (griefing), CONFIRMED: clan treasury gift idempotency IDs can be poisoned.** The `transactionId` is global and derived from a public fingerprint when the client sends no `requestId` (it never does). Another player can pre-bind it for 90 days and make a real gift fail with 409. **Fix:** scope the ID by actor, and have the client send a random `requestId`.

**Content and exposure:**

11. **Medium, CONFIRMED: player-authored image fields accept any URL.** Bloodline and creator-item images take any `https://` (or LAN `http://`) URL, are served raw by `bloodlines/list`, and are rendered in the Archives. Any viewer's IP and user agent leak to that host. **Fix:** accept only an inline raster image or a same-origin `/api/img` path, as `/api/images` already does.
12. **Medium, CONFIRMED: `warRecords` and `kageHistory` content in village state is client-writable.**
    - It is only checked for "not shorter than before", and both are public on the polled game-state frame. The new 256 KB cap bounds the size, but entries are still unmoderated.
    - SUSPECTED: a forged `kageHistory: [{}]` would crash `LogbookCareerRecord.tsx` on `term.name.toLowerCase()`.
    - **Fix:** make both server-owned, or validate each entry. The longer-term fix for all three merges is a field allowlist instead of `{...prev, ...incoming}`.
13. **Medium, SUSPECTED: admin and per-player GETs send no `Cache-Control`.** Examples: `admin/moderation`, `report`, `solo-pve/state`. It is harmless unless the Cloudflare rule applies a default edge TTL. **Proposed fix:** default `/api/*` to `private, no-store` in one middleware; public handlers already set their own header.
14. **Low: smaller items.**
    - No socket connection cap per IP or account.
    - Clan chat does not filter blocked players (every other chat does).
    - The retired `theravensark.com` origins are still in the CORS allowlist.
    - The `clan/war/list` anonymous view is publicly cached on the URL that members poll.
    - The Field Recovery shield clear is fire-and-forget and fail-open.
    - The clan-boss party heartbeat can rewind party state.
    - The war-end XP receipt is set before the clan write, so a failed write loses the XP.
    - The dev-only Vite `/api/generate-image` accepts a cross-site `text/plain` POST.
    - `authFetch` attaches credentials to any `URL` whose path starts with `/api/`, without checking the origin. No caller triggers it today.
15. **Action, not code: an OpenAI key is still reachable in git history.**
    - It is in `ShinobiJ.Server/appsettings.Development.json` at `a3d304de36`, reachable from `refs/remotes/pr/421`, `refs/remotes/pr/423` and the local `refs/archive/storage-*` refs. GitHub keeps PR refs after a force-push.
    - **Needed:**
      - Confirm the key is revoked in the OpenAI dashboard.
      - Ask GitHub Support to purge PR refs 421 and 423.
      - Then drop the local refs and run gc.

### Performance

**Server:**

1. **High, CONFIRMED: every world-boss status GET takes three locks on two global keys and writes the queue row.**
   - It runs `tickWorldBossQueue` → `syncWorldBossMovementPause` ×2 (`api/world-boss-event.ts:142`).
   - Callers: per-player polls every 2 s (6 s in a fight), plus the anonymous 20 s map overlay. At 300 players that is about 300 lock takes a second.
   - **Fix:** make the GET read-only and tick from one in-process 1 s timer.
2. **Medium-High, CONFIRMED: socket `presence:move` fans out unbatched to the whole sector.**
   - Up to 12.5 moves a second per player, the same O(N²) shape that set the 09-18 ceiling.
   - **Fix:** fold moves into the 500 ms sector flush, or a 100-150 ms one.
3. **Medium, CONFIRMED: durable rate limits do a database `incr` on every request** (about 190 call sites, 13 % of DB calls in the 09-18 probe). **Fix:** `local: true` by default on the single instance. This changes rate-limit logic, so it needs sign-off.
4. **Medium, CONFIRMED: every statement inside a lock is a fenced 3-round-trip transaction, reads included** (`api/_storage.ts:489-516`). **Fix:** fence writes only. This changes lock logic.
5. **Medium, CONFIRMED: an `/api/img` miss loads multi-MB legacy rows.**
   - Any unknown id, anonymous included, does an R2 HEAD, then reads `shared:imgfields:<cat>` (11 MB for jutsu). Misses are never cached.
   - The read cache is capped by entry count, not bytes.
   - **Fix:** negative-cache misses, single-flight the fill, and give the cache a byte budget.
6. **Medium, CONFIRMED: save compare-and-set compares the whole JSON value** (`WHERE value = $2::jsonb`). Autosave is 44-62 % of DB time. **Fix:** compare on `_saveVersion`. This needs review of the save-commit invariants.
7. **Low.**
    - `world-state` settles and hashes outside its 3 s cache.
    - Every route parses up to 5 MB of JSON before auth (default 256 KB would do).
    - Each PvP stream viewer re-serializes the session.
    - The image-manifest `cachedFor` keys never evict.

**Client:**

8. **High, CONFIRMED: idle vitals regen re-renders the whole App once a second, for up to 30 minutes after any damage** (`App.tsx:3309`). That includes the unmemoized WorldMap, 144 sector tiles and a full save-payload rebuild. **Fix:** move displayed vitals into an external store, and skip the payload rebuild when it is unchanged.
9. **High (network/battery), CONFIRMED: `ContinuousWorldPeers` polls `/api/player/world-move` every 2 s even when the socket is live.** An idle phone in the wild makes 70+ requests a minute. World presence is core, so: keep 2 s without the socket, about 10 s with it. **Needs owner sign-off.**
10. **Medium.**
    - The resource-node POST every 5 s re-renders on every reply.
    - The roster ingest makes new arrays every 60 s (and per heartbeat) even when unchanged.
    - The avatar bucket refetches every 30 s while any listed player has no avatar (suspected).
11. **Low.**
    - The save-preview stringify runs on the tap path.
    - WorldMap re-renders every 5 s for a clock.
    - Per-frame `dataset` writes in two render loops.

## Checked and found sound

- **Token, admin and password core:**
  - HMAC covers name, expiry and epoch, with constant-time compares.
  - Placeholder admin passwords are refused, and missing hash/salt fails closed.
  - Name normalization, reserved prefixes and slug collisions are handled, and the IDOR sweep found every authed handler bound to `identity.name`.
- **Anti-cheat:**
  - The Tebex webhook is signed and receipted.
  - Shop, craft, bank, trade and treasury transfers are sound, and sealed tokens back AI fights and pet battles.
  - The save sanitizer restores every server-owned currency field.
- **Concurrency:**
  - Lease-fenced `withKvLock`, and atomic single-use tokens.
  - The cross-key settlement saga.
  - No raw `save:` writes.
- **Input:**
  - Body-limit routing (50 MB admin-only).
  - Client-IP provenance (Railway / Cloudflare only).
  - Escaped LIKE patterns, prototype-pollution guards, and no SSRF.
- **HTTP:**
  - Strict CSP (`script-src 'self'`, no `unsafe-inline` or `unsafe-eval`), `frame-ancestors 'none'`, HSTS and nosniff.
  - Production errors leak no stack, and Sentry strips PII.
- **Client:**
  - No raw-HTML sinks, and a strict BBCode allowlist.
  - The password is kept in memory only, and the token-less fallback is intact.
  - The service worker never caches private `/api` responses.
- **Polling:** about 80 screen polls go through `visiblePoll`, and WebGL renderers are retired on unmount.

## Tests

- New tests:
  - `api/_text-moderation.redos.test.ts` (1 MB input under 500 ms; redaction still works).
  - `api/_row-growth-cap.test.ts`.
  - Clan notice attribution and moderation cases in `api/_clan-save-validate.test.ts`.
  - The spoofed-level case in `api/player/attack-claim.test.ts`.
- The existing newcomer-floor test now writes the level to the save as well as to presence.
- Round-2 tests:
  - Exchange: a currency lot is charged to the seller's daily send limit (`api/festival/exchange.test.ts`).
  - Google: a link with the wrong nonce writes nothing and does not burn the ticket; a sign-in stamps `lastAuthAt` (`api/auth/google/flow.test.ts`).
  - A Google-only first password is refused when the last Google sign-in is missing or older than 30 minutes, and a password account cannot be deleted with only a token (`api/player-auth.test.ts`).
  - The socket disconnect hook (`api/_realtime/notify-disconnect.test.ts`).
  - World-boss tick coalescing (`api/world-boss-event/_queue.test.ts`).
  - Tile memoization and save snapshot reuse (client).
- Results on 2026-11-05 (Windows):
  - Unit tests: 19,306 passed, 0 failed.
  - `npm run build`, including `verify:dist` and the size check, passed at 9,808,005 B of the 9,810,000 B cap.
  - Client lint: 0 errors.
  - `npm run test:e2e`: 3,407 passed, 1,133 skipped by project, and 5 failed under load. The 5 were firefox and webkit specs for screens this change does not touch (story scene, village preload, inventory tabs, activity guidance). All 16 of their cases passed when re-run alone.
  - `npm run test:e2e:combat-layout` (strict, after phase): 20 passed, 10 skipped by project, 0 failed. It covered chromium at three device pixel ratios, firefox and webkit.
