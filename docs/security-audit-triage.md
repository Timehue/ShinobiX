# ShinobiX Security Audit — Triage (read-only verification)

Verification of the 30-item "full audit consolidation" handoff against the
actual code. Each item is classified **REAL / PARTIALLY-REAL / FALSE /
ALREADY-HANDLED** with file:line evidence and a fix direction that preserves
gameplay and player data. No code was changed to produce this doc.

Date: 2026-05-29. Audited at commit `0069b0f`.

Legend: 🔴 Critical · 🟠 High · 🟡 Medium · ⚪ Low · ✅ already fine

---

## Already done this session (handoff P0 #2, #3-partial, #28-partial)

- **#2 cPanel route parity** — DONE (commit `1db7542`). All 28 client-used
  handlers registered in `server.ts`; `server-routes.test.ts` guards it.
- **#3 restart token** — DONE. `/api/restart` now prefers a dedicated
  `RESTART_TOKEN`, constant-time `safeEqual`, array-header safe, rate-limited +
  audit-logged. (KV proxy itself reviewed below.)
- **#1 secrets** — SCRUBBED from working tree (commit `0069b0f`): OpenAI key +
  Postgres password removed, env-only, fail-closed. **Rotation by you is still
  required** (scrub ≠ revoke). History purge deferred (35 worktrees share one
  `.git`; in-place rewrite would break them — do via fresh clone later).

---

## Priority 0

### #3 KV proxy hardening — 🟡 PARTIALLY-REAL
`api/kv-proxy.ts` already: POST-only, `safeEqual` constant-time token compare,
array-header normalized, fails closed if `KV_PROXY_TOKEN` unset (lines 22-37).
**Gaps:** no rate limit, no audit logging, no IP allowlist, no key-prefix
restriction. It's a full get/set/del/keys over the disk overlay gated by one
shared secret.
**Fix:** add `enforceRateLimit`, log denied attempts with IP, optional
`KV_PROXY_IP_ALLOWLIST`. Low risk (server-to-server only). Token rotation is
operational, not code.

---

## Priority 1 — account/admin

### #4 Legacy account takeover — ✅ FALSE
`api/player-auth.ts`: `register` refuses when an auth record OR a save blob
already exists (→ `legacyNeedsAdmin`, ~L174-189). `change` only sets a legacy
password when **both** old+new supplied (L256-265). No name-only overwrite path.
No change needed.

### #6 Admin vs content-admin boundaries — 🟠 REAL
Destructive ops reachable by **content** admin (`isAdmin`) that should be
`isFullAdmin`:
- `api/admin/save-snapshot.ts:63` — snapshot **and restore** any save under
  `isAdmin`. → `isFullAdmin`.
- `api/cron/snapshot-saves.ts:96` — manual-run fallback uses `isAdmin`. →
  `isFullAdmin` (cron-secret path unchanged).
- `api/admin/moderation.ts:~217-247` — bespoke `isAdminAuth()` (checks
  `ADMIN_PASSWORD` in header/body), bypasses the `_auth.ts` role split; also
  reads password from **body** (logging risk). → use `isFullAdmin` from `_auth`.
**Fix:** swap the gates. Pure auth tightening, no gameplay impact. *Confirm Admin
2 isn't currently relied on for restores before shipping.*

### #5 Raw passwords in browser storage — 🟡 PARTIALLY-REAL (design debt)
`authFetch.ts` persists player password in localStorage + admin pw in
sessionStorage (by design; documented). Real but a larger auth-model change
(tokens/sessions). Recommend a separate tracked task, not a drive-by edit.

---

## Priority 2 — PvP / rewards / economy

### #7 Server-authoritative rewards — 🔴 REAL (mixed)
- `api/pvp/claim-rewards.ts` — **fail-open**: catch returns
  `{ ok:true, degraded:true }` (L100-107); only writes an idempotency key, not a
  durable credit (rewards applied client-side via `/api/save`). During a KV
  blip a client can get repeated first-time "ok". 🔴
- `report-raid.ts`, `report-pvp-win.ts`, `report-pet-event.ts`,
  `pet/battle-result.ts` — **good**: durable server credit under `withKvLock`,
  fail-closed (500), idempotency keys / daily caps. Honor seals + ranked rating
  for pvp-win are still client-side (acknowledged in-code). 🟡
**Fix:** make claim-rewards fail-closed; move honor-seals/ranked credit
server-side over time (receipts). Don't strip existing data.

### #8 PvP authorization & privacy — 🟡 mostly ALREADY-HANDLED
- session GET / stream SSE intentionally public for spectating (stripped of
  currencies/inventory) — ✅ by design.
- chat GET + spectate GET/POST now require auth (prior unauth hole fixed) — but
  any logged-in player can still read/enumerate by battleId. ⚪ privacy.
- chat POST: on session-lookup failure it **defaults role to spectator**
  silently (L84-99) — should reject on lookup failure. ⚪
**Fix:** reject chat POST when session lookup fails; optionally restrict
spectate reads. Keep reads fast — no change to the move loop.

### #9 PvP/ranked concurrency — ✅ mostly ALREADY-HANDLED
`move.ts` uses atomic `nx` lock (L797-806); ranked queues + join use
`withKvLock` RMW; mutations auth-checked to self; queue peeks intentionally
unauth. IDs flagged under #28. No concurrency bug found.

### #10 Fail-open critical locks — 🟡 REAL (nuanced)
`_lock.ts withKvLock` **falls through and runs `fn()` unlocked** if it can't
acquire (L66-73) — correct for chat, wrong for reward/economy critical sections.
Note: `save/[name].ts` and `claim-rewards` already use their own `nx` locks that
**reject** on contention, so the worst paths are covered.
**Fix:** add an opt-in `failClosed: true` to `withKvLock` and use it for
economy/war writes; leave social paths fall-through.

### #11 KV rate limiting — 🟡 PARTIALLY-REAL
`_ratelimit.ts allowKv` is a fixed-window **get-then-set** (not atomic) and
**fails open** on KV error (L86-89). Fine globally, but auth/save/reward/admin
should fail *closed* (or at least to a strict local bucket).
**Fix:** stricter local fallback for the high-risk buckets; consider atomic
incr if the KV layer supports it. Don't globally fail closed (would lock players
out on a blip).

---

## Priority 3 — save integrity (`api/save/[name].ts`)

### #12 Sanitizer trust gaps — 🟠 REAL (selective)
Good: ryo gain capped 1M/save, bank interest 24h-gated, custom-bloodline numeric
clamps + image strip. **Weak:** `inventory`/`tileCards`/`defeatedAiIds` capped by
**length only** (no entitlement check); `claimedWarCrateIds` and
`warGroundBountyDate` not sanitized at all (arbitrary → repeat bounty claims).
**Fix:** clamp `warGroundBountyDate` to server UTC date (like
`claimedVillageAgendaDate` already is); validate crate/AI ids against receipts
going forward. Preserve veteran data (additive validation only).

### #13 Registry from raw data — 🟡 REAL
Registry entry built from **raw** `incoming.character` (level/village/specialty)
before sanitization (~L1038-1046) → leaderboard/index spoofing.
**Fix:** build `registryEntry` from the sanitized payload. Low risk.

### #14 Multi-tab `_baseSaveVersion` — ⚪ PARTIALLY-REAL (by design)
Optimistic-concurrency exists but is opt-in (skipped if client omits the field,
L1011-1026). Intentional for old-client compat.
**Fix (later):** telemetry → then require it for player saves.

### #15 Save lock release — ✅ FALSE
Per-player `nx` lock, unique key, 2s TTL, released in `finally` (L884-888,
L1056). A foreign caller can't hold/release it. Compare-before-delete is
unnecessary here. No change.

---

## Priority 4 — clan / village / war

### #16 Clan-save authority — 🟡 PARTIALLY-REAL
`_clan-save-validate.ts` locks down well: activeWar score delta cap 100/write,
warHistory append admin-only (1/write), members self-only, treasury caps. **Gap:**
`treasury.items` accepted with only a 200-cap, no ownership check (L323-326);
same-length warHistory swap allowed (content unvalidated).
**Fix:** validate treasury item ownership server-side (route through an endpoint).

### #17 Atomic treasury — 🟡 REAL
`village/treasury-transfer.ts` Kage path **is** atomic (dual locks, debit after
credit, auth'd). But generic clan/village treasury credits via the save
validators use a **trust-the-debit** model (explicitly noted in-code) — caller
can credit without debiting (capped per call). Honor seals already have an atomic
donate endpoint.
**Fix:** dedicated atomic donate endpoints for ryo/fate/etc; keep caps as
defense-in-depth.

### #18 War score verification — ✅ mostly LOCKED
Clan war (PvP) cross-validates against `PvpSession`; pet mode two-phase confirm;
village war computes damage server-side from HP deltas with per-request caps.
Client can't POST arbitrary deltas. ⚪ minor.

### #19 Clan war outage — ✅ FALSE
`loadAllClanWars` returns `[]` only when there are genuinely no war keys; on KV
throw the `list.ts` outer catch returns **HTTP 500**, not a silent empty. Safe.

### #20 World-state outage — 🟠 PARTIALLY-REAL
**GET** path: `getByPrefix` swallows KV errors → `[]` → returns **200 with empty
territories/wars** (L345-355, 398). Territories/wars silently vanish during an
outage. POST fails closed (500).
**Fix:** on GET prefix-read failure, return `degraded:true` + 503 (or preserve
last-known) instead of a 200 empty.

---

## Priority 5 — gameplay edge cases

### #21 Challenge lifecycle — 🟠 REAL
`api/player/challenge.ts`: the `fromName === identity` gate guards **POST** only
(L143); **DELETE** (L115-128) doesn't verify ownership → any authed player can
delete/clear another player's challenge inbox (omit challengeId → wipes all).
**Fix:** require `identity.admin || identity.name === targetName` before the
DELETE lock.

### #22 Village guard trust/privacy — 🟡 PARTIALLY-REAL
Attacker identity checked and attacker char projected before hitting the
anon-readable `challenges:*` key (good, L49-54/90). **But** the response returns
the guard's **full private save** to the attacker (L106) — pre-battle loadout
scouting leak.
**Fix:** project `guardCharacter` through a combat-only allowlist before
returning.

### #23 Image ownership / caching — 🟡 REAL
`api/images.ts`: pet images writable by any authed player (no per-pet ownership,
L89-95); external `http(s)` URLs stored without allowlist (latent SSRF if later
fetched); error path returns 200 **with** cache headers (L107/144) → caches empty.
**Fix:** verify pet ownership (save read) or restrict; allowlist/deny external
URLs; `no-store` on the error response.

### #24 Roster projection — 🟡 REAL
`api/player/roster.ts` uses a **blacklist** (`ROSTER_STRIP_CHAR_FIELDS`) — any
new character field auto-leaks until added to the set (pets themselves are
whitelisted, OK).
**Fix:** convert to a whitelist of render/matchmaking fields.

### #25 Weekly boss lifecycle — 🔴 REAL
`api/weekly-boss.ts`: `rewardsDistributed:true` is persisted **before** the
per-player credit loop (L202-210 then L216-243), single bulk flag, no per-player
receipts. If the loop crashes mid-way, boss is marked distributed and survivors
never get paid; no retry.
**Fix:** per-player credited receipts; mark distributed only after all credits
(or make the loop resumable/idempotent); block reset while undistributed.

---

## Priority 6 — operational

### #26 Legacy .NET bypass server — 🟠 REAL (latent)
`ShinobiJ.Server/Program.cs` exposes **unauthenticated** mirrors of
guard/heartbeat/attack/clans/`save/{name}` etc. `vite.config.ts` only proxies
`/weatherforecast` to it (dev clients hit the real API), so it's dev-only today —
but nothing prevents accidental production deploy.
**Fix:** `#if DEBUG` / `IsDevelopment` guard around the `/api/*` maps, or isolate
the project so it can't ship. (Confirm it isn't a deployed fallback first.)

### #27 Supabase RLS exposure — ⚪ LOW → ✅ VERIFIED-AND-DOCUMENTED (`<this run>`)
`supabase-schema.sql`: anon SELECT limited to `pvp:%`, `cw-tilecards:%`,
`challenges:%` (intended for Realtime).
**Correction to the original note:** the `authenticated` role does NOT have an
effective broad SELECT. It carries a `grant select`, but with RLS enabled and
**no policy for `authenticated`**, deny-by-default returns it zero rows. `save:%`
(and auth / IP / fingerprint rows) are therefore service-role-only — invisible to
both anon and authenticated.
**Re the proposed "per-player RLS on `save:%`":** N/A for this app — players use
the game's own session-token auth, not Supabase Auth, so there is no `auth.uid()`
to scope an owner policy on (browser is always `anon`, Realtime only).
**Outcome:** verified + documented in the `supabase-schema.sql` header; no schema
change. Latent footgun noted there (`grant select to authenticated` would expose
rows only if RLS were ever disabled; `revoke` available as future hardening).
Field redaction of the anon-readable prefixes stays app-layer (RLS is row-level).

### #28 Math.random security IDs — 🟠 REAL (selective)
Auth-relevant (knowing the id grants access) → must be crypto:
- `pvp/session.ts:551` battleId `pvp-<now>-<rand5>` 🔴 (grants session/stream/
  chat read; brute-forceable).
- `ranked-queue/join.ts:83` challenge id 🟡.
Not auth tokens (cosmetic/dedup, fine): `move.ts` lock token + ground-effect id,
`clan/war/challenge.ts` id (participant check enforces access).
**Fix:** `crypto.randomUUID()` for battleId + ranked challenge id. Zero latency.

### #29 Full KV scans — 🟠 REAL (scaling)
`kv.keys('save:*')` + mget over all players in `admin/players.ts:57`,
`roster.ts` (**twice**, L155/186, second loops individual gets),
`bloodlines/list.ts:42`, `injured-villagers.ts:59`; `village-guard/list.ts:23`
small. O(n), worsens with growth.
**Fix:** registry/index + pagination; at minimum batch roster's second pass into
one mget. No behavior change, just scaling.

### #30 Route/deploy smoke tests — ✅ DONE (this session)
`server-routes.test.ts` already verifies every client `/api` path is registered
for cPanel. Could extend with a Vercel-structure check.

---

## Suggested action order (low-risk → high-risk)

1. **Pure auth tightening** (no gameplay change): #6 admin gates, #21 challenge
   DELETE check, #28 crypto battleId/challenge id.
2. **Outage fail-safe + leaks** (read-path): #20 world-state GET degraded, #22
   guard projection, #23 image error cache + external URL, #24 roster whitelist.
3. **Reward/economy hardening** (test carefully, balance-sensitive): #7
   claim-rewards fail-closed, #25 weekly-boss receipts, #10 failClosed lock opt,
   #12 warGroundBountyDate clamp, #13 registry from sanitized.
4. **Infra**: #3 KV proxy rate-limit+audit, #11 rate-limit strict fallback, #29
   pagination, #26 .NET dev guard.
5. **Larger/needs rollout**: #5 token auth, #14 mandatory save-version, #17
   atomic donate endpoints, #16 treasury item ownership, #27 RLS.

Each batch should ship with its own tests (`npm test`) and, for client changes,
`npm run lint`. Reward/balance items per the hard rules need explicit sign-off
since they touch currency/PvP.
