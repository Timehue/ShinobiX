# Shinobi Journey — Pre-Launch Audit & Fix Plan (2026-06-04)

Whole-game audit from six parallel subsystem audits + direct verification of the
load-bearing claims and a live Supabase inspection (project `soaychxshtbgwujhytsf`).

> **STATUS — Tier 0 (blockers) + Tier 1 (high) IMPLEMENTED 2026-06-04.**
> Code changes verified: backend `tsc` clean, 470/470 tests pass, client `tsc`
> clean, lint 0 errors. Live DB fixes applied to prod Supabase (pg_cron enabled +
> scheduled, 20k expired rows purged → 456 kB / 121 rows, `kv_incr` added,
> function `search_path` hardened → security advisor clean).
>
> **Remaining operator actions (cannot be done from code):**
> 1. Set `REQUIRE_DISK_OVERLAY=1` on Railway **and** cPanel (any instance serving `/api/save/*`).
> 2. Run the full `npm run build` and commit both `dist/` dirs for cPanel (Railway self-builds), then redeploy so the code fixes go live. The live DB fixes are already in effect.
> 3. (Optional) Set `SUPABASE_HARDCODED_IP` on cPanel if Supabase ever rotates the CDN IP.
>
> **Deferred follow-ups (Tier 1-adjacent, scoped out for risk/size):** add a
> `pet-battle-sim.test.ts` regression test locking in the three pet fixes; sweep
> the remaining `App.tsx` `<img>` tags for `onError`; add a boot-time single-replica
> guard. Tier 2/3 below are unchanged.

## Overall verdict

The backend is **genuinely well-hardened**. The economy is server-authoritative
end-to-end — no path was found to mint currency/XP/items/rating from a crafted
client body (every reward recomputes server-side or redeems a sealed single-use
token; shared pools are `failClosed`-locked on the shared key; the save sanitizer
caps every client-writable field). Auth is token-first with constant-time
compares and a working no-secret fallback. CORS is a single shared predicate.

The launch risk is **not the economy** — it's:
1. **Operational/config** (one missing env var can silently wipe saves; 95% DB bloat with no cleanup).
2. **A data-exposure + bandwidth leak** (base64 images on an anon-readable prefix).
3. **Client robustness** (no React error boundary → whole-app white screen on a stale-chunk 404, which happens routinely during deploys).
4. **A few real gameplay correctness bugs** (pet battle + one PvP tag bug).
5. **An unused Cloudflare opportunity** that directly attacks the image-bandwidth cost.

Severity tiers below are ordered for launch.

---

## TIER 0 — Launch blockers (fix before launch)

### 0.1 — Save-overlay split-brain: one missing env var silently serves/clobbers wiped saves
- **Where:** `api/_storage.ts:730-760`. The disk overlay (where live `save:*` actually lives) attaches only when `DISK_KV_DIR` or `KV_PROXY_URL`+`KV_PROXY_TOKEN` are set. If they're missing, `kv` silently becomes the base Supabase store; `save:*` reads return empty (players look logged-out/wiped) and writes go to the wrong store. The fail-closed guard `REQUIRE_DISK_OVERLAY=1` (`:752`) is **opt-in** and is **not listed** in `RAILWAY_SETUP.md`'s env table, so it's almost certainly unset in prod.
- **Compounding doc contradiction:** `RAILWAY_SETUP.md:87-88` and `.env.example:76-84` say "do NOT set `KV_PROXY_*` on Railway; keep all keys on Supabase," which contradicts the live topology (saves on cPanel disk via the proxy). A deploy that follows the docs = split-brain.
- **Fix:**
  1. Set `REQUIRE_DISK_OVERLAY=1` on **every** instance that serves `/api/save/*` (Railway + cPanel) so a missing overlay fails the boot/health check loudly instead of serving the base store.
  2. Reconcile `RAILWAY_SETUP.md` + `.env.example` with the real topology — state unambiguously whether Railway points `KV_PROXY_URL` at cPanel (single source of truth) or saves live on Supabase. They cannot stay ambiguous.
  3. Add a `/health?deep=1` field that reports which store `save:` resolves to (disk-proxy vs base), so an operator can spot a misroute instantly.

### 0.2 — Database: 95% bloat, no expired-row cleanup (pg_cron not installed)
- **Live facts:** `kv_store` is **56 MB total for ~2.5 MB live data**. **20,072 of 20,190 rows are expired but never purged.** `kv_delete_expired()` exists but its `cron.schedule()` is commented out (`supabase-schema.sql:225-232`), and `pg_cron` is **not installed**. `ratelimit:` alone is 19,942 rows (≈99%) and will generate tens of thousands of rows/hour at launch scale. Reads filter `expires_at`, so this is **cost/bloat + scan inflation, not a correctness bug** — but it compounds fast.
- **Fix (run in Supabase SQL editor, low-traffic window):**
  ```sql
  create extension if not exists pg_cron;
  select public.kv_delete_expired();                       -- one-time purge
  delete from public.kv_store where key like 'presence:%'; -- orphaned stale rows (no writer remains)
  vacuum (full, analyze) public.kv_store;                  -- reclaim 56MB→~3MB (brief exclusive lock)
  select cron.schedule('kv-cleanup','*/2 * * * *', $$ select public.kv_delete_expired(); $$);
  ```
  Then uncomment the `cron.schedule` block in `supabase-schema.sql:225-232` so a re-provision keeps it.
- **Cut the churn at the source:** on single-replica Railway the in-memory rate-limit tier is already authoritative, so the KV tier-2 write in `_ratelimit.ts` (`allowKv`, ~:93) is the row generator. Gate it behind an env flag so Railway skips the KV write (cPanel no longer serves these routes). Removes ~99% of future row growth.

### 0.3 — No React error boundary anywhere → blank white screen on any render error or stale-chunk 404
- **Where:** `shinobij.client/src/main.tsx:6-10` (no boundary) and `App.tsx:8164` (a `<Suspense>` with a loading fallback but **no error fallback**). Grep for `ErrorBoundary|componentDidCatch|getDerivedStateFromError` = **zero matches**. ~15 screens are lazy-loaded; if any chunk 404s (a client holding stale `index.html` after a deploy — common on launch day) or any screen throws, React unmounts the entire tree to a white screen with no message.
- **Fix:** Add a top-level class `ErrorBoundary` around `<App/>` in `main.tsx` (themed "Something went wrong — Reload" card calling `location.reload()`), and a second around the `<Suspense>` lazy region so one bad screen/chunk degrades gracefully. For chunk-load errors, the boundary should offer reload (fetches the fresh chunk map). **This is the single most likely launch-day "the game is broken" report.**

---

## TIER 1 — High (fix before launch or in the first patch)

### 1.1 — Base64 images leak on the anon-readable `challenges:*` prefix (privacy + bandwidth)
- **Where:** `api/player/challenge.ts:19-29` — `CHALLENGER_PUBLIC_FIELDS` keeps `avatarImage` (2 MB-capped base64 data URL) and `pets` (each pet carries `image`/`bodyImage` base64). `challenges:*` is anon-readable via Supabase Realtime RLS (`supabase-schema.sql:80-83`). This is why `challenges:saint` is 449 KB. Economy fields (ryo/jutsu/stats/equipment) are correctly stripped — so it's an **image + cosmetic-metadata** exposure, not a currency leak.
- **Fix:** Drop `avatarImage` from the projection and strip image fields from `pets` (project pets to `{ id, name, level, ...statsNeededAtAccept }` — accept handlers only need `id`). The recipient already resolves avatars by name from the shared-image cache (exactly as presence does in `presence-input.ts:80-94`). Closes the anon exposure **and** eliminates the 449 KB payload.

### 1.2 — Cloudflare: edge-cache CDN + TLS + DDoS shield in front of Railway (the "specific purpose")
This is the highest-leverage use of the free tier and directly attacks the
image-bandwidth cost. See the full **Cloudflare Setup Plan** section at the end.
Summary of the required code prerequisites (only these, in `server.ts`):
- **Immutable hashed assets:** serve Vite's content-hashed JS/CSS/img with `Cache-Control: public, max-age=31536000, immutable` (currently `express.static` at `server.ts:551` sends **no** Cache-Control, so edge caching would be a no-op).
- **`index.html` no-cache:** both `express.static` and the SPA fallback (`server.ts:554-556`) must send `Cache-Control: no-cache` so a deploy never pins a stale chunk map (this is also a second line of defense for 0.3).
Then proxy the domain (orange-cloud) → Railway origin, with cache rules that
cache `/assets/*` + `/api/images*` and **bypass** every other `/api/*`,
`/socket.io/*`, and SSE path. DDoS + WAF come free once proxied.

### 1.3 — Pet battle correctness bugs (deterministic but outcome-changing; affect ranked)
The sim's determinism, numeric safety, and ranked plumbing are **sound** (single
seeded RNG, pure AI/animation layers, NaN-guarded). These three change outcomes:
- **Burn erases a positive ATK buff instead of subtracting 2** — `pet-battle-sim.ts:844` (1v1) & `:2034` (2v2): `Math.min(attackBuff, -2)` *replaces* the buff. A +6-ATK pet that gets burned snaps to −2 (loses 8 effective ATK). Fix: `attackBuff: target.attackBuff - 2` and let `tick` decay it.
- **A movement-locked pet still advances in "finisher mode"** — `pet-battle-sim.ts:1118-1121`: `doMove` (`:957`) doesn't check `actor.moveLocked` (the root guard only exists on the fallback path `:1462`). A rooted pet whose foe drops below 25% HP breaks its root. Fix: guard with `&& actor.moveLocked <= 0`.
- **2v2 lifesteal resurrects a thorns-killed attacker** — `pet-battle-sim.ts:2397-2405`: heals from the **pre-hit** snapshot `cdActor`, erasing thorns/recoil damage already written by `applyDmg` (can un-KO the attacker). Fix: heal from the post-hit `fighters[actorSlot]` (the 1v1 path at `:1438-1452` is already correct — mirror it).
- **Add engine tests alongside the fix:** there is **no `pet-battle-sim.test.ts`** for the 2,618-line engine — all three bugs would have been caught by a basic same-seed-replay / DoT-double-KO / status-expiry test set.

### 1.4 — GameAlert modal renders BEHIND the three fixed sidebars on desktop
- **Where:** `components/GameAlert.tsx:76` + `index.css` `.game-alert-backdrop z-index:2000` vs `.right-menu-panel z-index:999999`, `.left-profile-card 10000`, `.sector-banner-panel 9999`. `GameAlertHost` is mounted inside `.app-shell` (`App.tsx:7989`), not portaled to body, so the rails win the z-order. `window.alert` is globally replaced by GameAlert and used for all validation — so on desktop the "modal" only dims the center column while fully-lit sidebars stay clickable over it.
- **Fix:** Portal `GameAlertHost` to `document.body` and raise the backdrop above the rails (e.g. `100000`, matching the session-expired overlay that already does this). Same applies to OnboardingCoach (`zIndex:9000`) and the `.mobile-menu-overlay` (2000, collides with GameAlert).

### 1.5 — Rate limiter is a non-atomic read-modify-write (bypassable under the exact concurrency it guards)
- **Where:** `api/_ratelimit.ts:81-101` (`allowKv` does `get` → check → `set(current+1)`). Concurrent requests read the same value, all pass. This is the "durable cross-instance" tier used by heartbeat, save-burst, pvp-claim-rewards, daily-claim, and the admin/auth brute-force gate. Most reward endpoints have an NX/lock backstop so blast radius is bounded, but the auth gate and cost paths (`generate-image`) are weaker than they look.
- **Fix:** Add an atomic counter — a Postgres `kv_incr` RPC (`INSERT … ON CONFLICT DO UPDATE SET value = value+1 RETURNING value`, mirroring `kv_set_nx`), or wrap strict buckets in `withKvLock`. Also switch `admin-auth` (`api/admin-auth.ts:23`) to the KV-backed limiter with `{strict:true}`.

### 1.6 — Content images have no `onError` fallback → broken-image spread when the host is down
- **Where:** `Shop.tsx:147,190`, `JutsuDropdownList.tsx:76`, `Inventory.tsx` (4 imgs), `ProfessionPicker.tsx` (2), and most of the 79 `<img>` in `App.tsx` (only 13 have `onError`). Avatars/portraits defensively hide on error, but game-content thumbnails don't. The image host going down is a recurring incident (per project history).
- **Fix:** Add the existing `onError` hide/placeholder pattern to content-image sites — ideally a shared `<GameImg>` wrapper with a built-in placeholder to cover all 80+ at once.

### 1.7 — Deployment fragility
- **Hardcoded Supabase IP `172.64.149.246`** (`app.js:17`, `_storage.ts:255-263`) is a Cloudflare anycast IP for `*.supabase.co` (DNS bypass for CageFS). If it rotates, cPanel's KV-proxy + base reads break. **Fix:** make it an env var (`SUPABASE_HARDCODED_IP`) so it's a config change, not a code+rebuild+redeploy; and/or pin it in the cPanel box's `/etc/hosts`. Blast radius is the disk overlay (cPanel), not the game API.
- **Committed-`dist/` staleness + no `npm install` on cPanel auto-deploy** — a forgotten rebuild ships stale frontend; a newly-added dep crash-loops Passenger. The `.cpanel.yml` guard catches a missing bundle but not a missing dependency. **Action:** enforce the "rebuild + commit BOTH dist dirs + Run NPM Install on cPanel after any new dep" checklist for launch. (Railway self-builds, immune.)
- **Single-replica is a hard invariant** (`railway.json:13` + in-memory presence/game-loop/rate-limit). **Do not** scale Railway horizontally without a Redis-backed store first; vertical scaling is the only safe lever. Consider a boot-time assertion that refuses to serve game routes if a replica-count env > 1.

---

## TIER 2 — Medium (first patch window)

### Game logic / PvP
- **Recoil on zero-damage utility jutsu silently does nothing in PvP** — `api/pvp/move.ts:553-602` wraps the post-damage block in `if (damage > 0)`, so a 40-AP utility jutsu's carried `Recoil` never applies in PvP (it does in PvE, `App.tsx:29670-29887`). Affects shipped starter content (`starter-nin-earth-3`, `starter-nin-water-3`, `starter-gen-lightning-3`, `starter-tai-fire-3`, `starter-buki-water-3`). Fix: apply Recoil status outside the damage guard, matching the client's timing.
- **Tag-percent rank cap applied on client but not server** — `lib/tags.ts:94-102` clamps tag % to the rank cap (S=40/A&B=35/else 30); `api/pvp/move.ts:414-417` applies only level scaling, no cap. Not exploitable through current content (all ≤ caps), but any future over-cap content resolves higher server-side. Fix: apply `tagCapForRank` in `scaledTagPercent` / `sanitizeJutsuList`.
- **Weekly-boss `logFight` trusts client damage up to a flat 500k cap** — `api/weekly-boss.ts:435-483` doesn't apply the stat-derived per-actor cap the per-tap `damage` path uses (`:383-403`). Bounded (proportional share of a fixed pool, so no unbounded mint) but a leaderboard/MVP-distribution fairness hole. Fix: reuse the `perActorCap` logic.
- **Casual (non-`baseRewards`) PvP ryo/XP/kills are client-applied** — `api/pvp/claim-rewards.ts:237-258` only writes an idempotency receipt; winner self-credits via save (bounded by sanitizer caps). The server-authoritative path exists but is dormant. Fix (forward-looking): flip the client to `baseRewards:true` to activate `creditPvpWinBase`, then lock the sanitizer's kill-counter deltas to 0.
- **`raid-start` mint daily-cap is a non-atomic RMW** — `api/missions/raid-start.ts:84-94` (read→compare→set, no lock). Bounded by report-raid's locked cap. Fix: apply the `withKvLock` pattern report-raid already uses.

### Storage / locks / concurrency
- **Lock TTL (2s default) can expire mid-operation on a slow cPanel disk-proxy round-trip** — `api/_lock.ts:90`; release deletes the lock unconditionally (no fencing token, `:127`). Rare double-credit window on currency paths; bounded by NX receipts. Fix: raise `ttlSec` for `save:`-routed critical sections and/or add a compare-and-delete fencing token.
- **`kv.hset`/`kv.hdel` Supabase fallback is a non-atomic read-merge-write that swallows the RPC error** — `api/_storage.ts:373-395`; the registry is written via `hset` on every save. Fix: don't swallow; lock or surface the failure.
- **Route-parity test misses handler-path↔client-path drift** — `server-routes.test.ts` matches on static prefix + import presence, so a typo'd `route()` string or a dynamic client path can 404 with green tests. Fix: assert exact-match coverage for static call sites and cross-check `route()` paths against client literals.
- **Single-replica assumption only enforced by prose + `numReplicas:1`** — presence/game-loop/rate-limit/restart-throttle all break on scale-up. Fix: boot-time guardrail (see 1.7).

### UI / responsiveness
- **`100vh` still on full-screen shells** (`index.css` `.app-shell:5589`, `.center-game:5604`, `.app-background:7607`, `.game:275`, `.village-screen:6796`, etc.) — the map screens were migrated to `100dvh` but these shells were missed. On mobile with a dynamic URL bar this clips the bottom strip. Fix: `100vh` → `100dvh` (with a `100vh` fallback line) on the shells.
- **Collapsing the desktop Right Menu wastes ~120-180px** — `.right-menu-panel.closed` shrinks to 74px but `.center-game` still reserves the full `--right-menu-w` margin (`index.css:11634`). "Hide Menu" frees no space. Fix: update `--right-menu-w` (or add a `:has(.right-menu-panel.closed)` margin rule).
- **No body-scroll-lock on any modal** (GameAlert, Shop popup, Inventory popup, OnboardingCoach, mobile menu) — background scrolls behind overlays. Fix: a shared `overflow:hidden` toggle hook.
- **Widespread silent fetch-failure swallowing** — `App.tsx` has 53 inline `.catch(()=>…)` + 134 `catch{}` and only 1 `console.error`; e.g. `Messages.tsx:38,41`. Initial loads render empty states indistinguishable from genuine "no data," with no retry. Fix: set an error state + "Couldn't load — Retry" on initial loads and user actions for high-traffic screens (clan, missions, hall of legends, user hub). The Messages *send* path is the right model.
- **Shop item popup: no Escape-to-close / focus trap; 21 native `confirm()`/`prompt()` calls** render unstyled browser dialogs. Fix: mirror GameAlert's Escape+autofocus; optionally theme the high-traffic confirms.

### Supabase usage
- **`PG_POOL_MAX` default is 5** (`_storage.ts:109`) — low for the single Railway instance serving every heartbeat write; the code comment says set 15+. Confirm it's bumped on Railway and that the connection string targets the **Supabase pooler (Supavisor, port 6543)**, not direct 5432.
- **Auth DB connection strategy is absolute (10), not percentage** (Supabase performance advisor) — irrelevant unless you use Supabase Auth (you don't); ignorable.

### Supabase security advisor (low-risk hardening)
- **4 functions have a mutable `search_path`** (`kv_delete_expired`, `kv_hset`, `kv_hdel`, `kv_set_nx`) — set `search_path = ''` (or `pg_catalog, public`) on each via `ALTER FUNCTION … SET search_path = …`. Low risk; quick win.

---

## TIER 3 — Polish & owner decisions

### Decisions that need YOUR call (not auto-fixable)
- **`CHARACTER_XP_GAIN_MULTIPLIER = 3`** (`constants/game.ts:27` + `api/_xp-engine.ts:25`, kept in parity). The old ×45 testing accelerator is now ×3, but ×3 is still a global multiplier on all character XP. If launch intent is "no testing boost," set both to 1. **Tuning value — your decision.**
- **Cloudflare primary purpose** — the plan below assumes CDN/edge-cache + TLS + DDoS. Confirm that's the "specific purpose" you had in mind (vs e.g. Workers, R2 image hosting, or Tunnel).
- **50 MB JSON body limit** (`server.ts:132`) — now that avatars are 2 MB-capped and images route to the disk overlay, this could likely drop to ~10-15 MB to reduce heap-pressure risk from huge POSTs. Verify no legit save approaches the limit first.

### Cosmetic / copy
- **StartScreen Discord/Guides URLs likely wrong** — `StartScreen.tsx:11-12` uses `discord.gg/shinobi-journey` + `shinobi-journey.com/guides` while the rest of the app uses the real invite `discord.gg/bCQGs8r6SK` (`RightMenu.tsx:90`, `MobileNav.tsx:108`). This is the **first screen a launch visitor sees** — confirm both resolve and align them.
- **Shop item popup shows placeholder `Created: 1/21/2026 Updated: 1/21/2026`** for every item (`Shop.tsx:205`). Remove or wire to real data.
- **Drain description mismatch** — `jutsu-effects.ts:58` says "250 HP, chakra, and stamina/round"; impl drains HP+chakra only, 50-300/round (`move.ts:481-490`). Update copy.
- **Stun combat-log line is dropped** (`move.ts:729-745`) — mechanic works, message lost. Cosmetic.
- **`accuracy` is unimplemented** (`pet-moves.ts:37-62` defines it; the sim never rolls against it) — moves never miss. Either implement a consistent (both-engines) `rng() < accuracy/100` gate or remove the field. Currently a silent no-op of a declared stat.
- **`data-vp` doc drift + thin `xxl` styling** (`App.tsx:3188` vs `index.css:19194`), and `data-vp` keys on `innerWidth` only (ignores height/DPR) — verify combat/map vertical fit at short desktop heights.
- **`CombatSideHud` bar math lacks the `maxHp=0` guard** `MobileStatusHUD` has (`CombatSideHud.tsx:45` vs `MobileStatusHUD.tsx:29`) — cosmetic NaN width.

---

## Manual verification still needed (recommend Playwright)

The 34,730-line `App.tsx` screens were sampled, not read line-by-line. Verify at
real viewports — **360×640, 768×1024, 1366×768, 1365×911, 2005×1271** (the last
two are real high-DPR user screens from a past regression):
1. GameAlert-behind-sidebars (1.4) visually.
2. Desktop Village map button crowding at 980-1100px (`Village.tsx:6-22`, absolute %-positioned buttons).
3. Combat/PvP arena, Pet battle, Pet Yard, Clan Hall, Endless Tower, Hollow Gate dungeon, world map, profile page — vertical fit + side-panel overlap.
4. Any screen under a simulated image-host outage (confirm the broken-image spread, 1.6).
5. New-player flow end-to-end (CharacterCreator → village → OnboardingCoach) on a fresh account — verified correct statically, but worth a live pass since it's launch-critical.

---

## CLOUDFLARE SETUP PLAN (detailed)

**Purpose:** caching reverse proxy / CDN + free TLS + free DDoS/WAF in front of
Railway. Offloads the heavy cacheable bytes (SPA bundle + image responses) from
Railway egress; leaves every dynamic/auth/realtime path untouched.

### Phase 0 — Code prerequisites (must ship first; the only code changes needed)
In `server.ts`:
```js
app.use(express.static(staticDir, {
  setHeaders: (res, p) => {
    if (p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    else if (/\.[0-9a-f]{8,}\.(js|css|woff2?|png|jpe?g|webp|gif|svg)$/i.test(p))
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));
```
And set `Cache-Control: no-cache` on the SPA-fallback `index.html` (`server.ts:554`).
`/api/images` already sends `max-age=60, swr=120` — Cloudflare will honor it.

### Phase 1 — DNS (proxied)
1. Add the site to Cloudflare (free); point the registrar at Cloudflare nameservers.
2. App host record: `CNAME → <your>.up.railway.app`, **Proxy: ON (orange)**.
3. Add the Cloudflare hostname as a Railway custom domain.
4. SSL/TLS mode: **Full (strict)** (Railway terminates real TLS). HSTS keeps working — `server.ts:162` gates on `x-forwarded-proto:https`, which Cloudflare sets.
5. Optionally proxy the image host (`theravensark.com`) too, so cached image copies survive a cPanel bounce (kills the "all images vanish on restart" failure mode).

### Phase 2 — Cache Rules (first match wins)
1. Path starts with `/api/` AND not `/api/images` → **Bypass** (protects heartbeat/save/auth/game-state/world-state/SSE).
2. Path starts with `/socket.io/` → **Bypass** (WebSocket/long-poll must never cache).
3. Path starts with `/api/images` → **Eligible**, respect origin Cache-Control.
4. Path starts with `/assets/` → **Eligible**, Edge TTL ~1 year (honors `immutable`).
5. Path `=/` or ends `/index.html` → **Bypass** (no stale chunk maps).
Do **not** enable global "Cache Everything" (would cache authed JSON).

### Phase 3 — Security (free, automatic once proxied)
- DDoS protection: on by default.
- WAF: add rate-limit rules on `/api/player-auth` and `/api/save/*` as a launch-day brute-force/scrape shield (complements the app limiter).
- Bot Fight Mode: enable.
- Keep `isAllowedOrigin` (`api/_utils.ts`) + `server.ts` + Socket.IO CORS in sync with the Cloudflare-fronted hostname (add to the allowlist / `EXTRA_ALLOWED_ORIGINS`).

### Expected impact
SPA bundle + image-category responses serve from edge → Railway static/image
egress drops sharply (kills the historical ~33 MB cold-landing cost). Railway
keeps serving only the small, uncacheable per-player polls. Free TLS + DDoS + WAF
at $0/mo.

---

## What was verified as SOLID (no action)
- Economy is server-authoritative: no client-trusted currency/XP/item/rating mint found. Sealed single-use token pattern is sound (raid/expedition mint→atomic-delete-on-redeem; PvP cross-validates the real session). Shared pools `failClosed`-locked on the shared key with deterministic multi-key lock ordering.
- Save migration is non-destructive (`mergePreservingImages`, level floored at stored value, ranked rating can't be raised client-side, versionless clients rejected with a refresh prompt).
- KV read paths all filter `expires_at`, so NX markers / single-use tokens / locks / daily caps self-heal past TTL even with pg_cron off — the 20k dead rows are bloat, not a logic bug. `kv_set_nx` is atomically correct.
- Auth: token-first, constant-time compares, ban gate on every request, clean no-`SESSION_SECRET` fallback. CORS is a single shared predicate, no `*` on unsafe methods.
- Pet battle determinism: single seeded RNG threaded consistently; pure AI/tactics; animation layer is a pure projection (never feeds back into the sim); NaN/Infinity guarded. Type chart is a complete symmetric 5-cycle.
- Core economy math (bank interest, territory supply, map-control, endless tower), missions (seeded pool, per-day lock, no double-claim), professions, ranked Elo — all verified correct.
- New-player onboarding flow is correct and not blocked by missing data; `normalizeCharacter` backfills every field on load.
- `compression` is well-configured (covers API JSON, skips SSE). Socket.IO is hardened (64 KB buffer cap, presence throttle, auth-reused handshake).
