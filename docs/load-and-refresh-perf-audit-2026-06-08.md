# Load & Refresh Performance Audit — 2026-06-08

Goal: make initial load (cold start) and browser refresh faster and more
seamless. This document is an **audit + phased plan only** — no code changes are
implied by writing it. File:line references point at the worktree state on
2026-06-08.

Related prior work: this is the natural follow-on to the "image-in-JSON cost
tax" audit (fixes #1 game-state strip and #2 Cloudflare are LIVE; **fix #3
static image serving is still pending** — it's the centerpiece of Phase 2 below)
and the "refresh-restore & battle-lock" work (Phases A/B/C shipped — refresh now
keeps you on-screen and re-enters battles; this audit is about making that
restore *fast*, not *correct*).

---

## Status (updated 2026-06-08 — commit `b4a3e9b`, pushed to `main`)

| Phase | Item | State |
|-------|------|-------|
| 0 | Measurement harness (`/api/perf-beacon` + `lib/perfTelemetry.ts`) | ✅ **SHIPPED** |
| 1.1 | Gate pre-login image preload behind login | ✅ **SHIPPED** |
| 1.3 | Instant hub refresh (hash-gated optimistic paint + overlay) | ✅ **SHIPPED — awaiting live smoke-test** |
| 1.2 | Stop clearing image cache on snapshot | ❌ **dropped** — superseded by Phase 2 (which removes the re-download problem at the root) |
| 1.4 | Cloudflare Brotli/zstd for static JS/CSS | ⏸ **dashboard toggle** (not code) |
| 2 (server) | Image-as-files: per-image serving endpoint + dual-write + lazy migration | ✅ **SHIPPED** (additive, backward-compatible) |
| 2 (client) | Flip client from base64 buckets → `/api/img?id=…` URLs | 🔄 **in progress** — `event` flipped (awaiting verify); `card`/`jutsu`/`item` next; avatars/pets last |
| 3 | Sector PNG → WebP/AVIF; lazy-load AdminPanel/WorldMap/Arena out of the 1.8 MB chunk | 🔭 **future** |

### Phase 2 implementation notes (image-as-files)
The store kept **one JSON blob per category** (`shared:imgfields:<cat>`), so a single
image couldn't be read cheaply. Approved approach: **one KV key per image**
(`shared:img:<cat>:<id>`) — the cPanel disk KV writes each `shared:*` key as its
own file, so this is "files on cPanel disk" using the existing disk-routing /
kv-proxy infra (no new filesystem path or serving stack).

Shipped (server, all additive / backward-compatible — zero client impact):
- **`GET /api/img?id=<cat>:<id>`** (`api/img.ts`) — reads the per-image key, decodes
  the base64, serves a real cacheable binary image (`max-age=300, swr=86400`).
  Falls back to the legacy per-category blob/hash and **lazily migrates** the value
  into a per-image key on first read, so it works before/during/after migration.
- **Dual-write** in `api/images.ts` POST/DELETE — new uploads write both the legacy
  hash *and* the per-image key; deletes clear both. The bulk `GET /api/images`
  keeps working throughout.

Remaining (client flip — the verifiable part):
1. **Prerequisite:** add `/api/img` to the Cloudflare cache rule (so each image
   edge-caches; otherwise every image hits Railway origin). One dashboard line.
2. Switch the client to render `<img src="/api/img?id=cat:id">` instead of hydrating
   base64, **one category at a time**: `event` → `card` → `jutsu` → `item` (pure
   `<img>` consumers, lowest risk), then `avatar`/`ai`/`bloodline`/`pet` last (the
   ~7 combat avatar render-guards that check `startsWith("data:image")` must be
   widened to accept the URL form first). Verify each category in-browser before
   the next. Each flipped category stops downloading its base64 bucket on load.

Verification at ship: client `tsc -b` 0 errors · ESLint 0 errors · tests **484/484**
· `verify:dist` OK. No new npm deps (cPanel auto-deploy safe).

**Phase 1.3 live smoke-test (do before trusting it):**
1. Refresh on Village/shop/profile → game appears instantly (brief "Syncing…"),
   no "Restoring…" wait.
2. Refresh **mid-arena fight** → still forced back into the same fight.
3. Refresh after **clearing localStorage mid-fight** → still takes the loss /
   hospitalized.
4. Refresh with an **expired token / slow server** → bounces to the login form
   with the timeout notice, not stranded.

**Read the telemetry:** grep Railway logs for `[perf]`. `kind:cold-start`
entries should now show `apiImgCount:0` (the 1.1 win); `kind:refresh` `tRestore`
should drop sharply for hub refreshes once 1.3 is exercised.

---

## 1. What was measured (current state)

### Initial JS / CSS payload (`shinobij.client/dist/assets`)
- `index-*.js` — **1.81 MB** uncompressed (~420 KB gzipped). The App.tsx
  monolith; nearly the whole game ships in one chunk.
- `index-*.css` — **470 KB**.
- `react-vendor-*.js` — 190 KB (already split out — good).
- Only ~15 small screens are lazy-split (`shinobij.client/src/App.tsx:196-207`,
  `:490-494`). The heaviest code — Arena / PvP battle / WorldMap / Village /
  AdminPanel — all live in the main chunk.

### Static image bytes (sector / landmark / UI PNGs)
- ~15 PNGs at **~0.9–1.9 MB each** (~18 MB total in `dist/assets`).
- **These are on-demand, not eager.** Vite turns the `App.tsx:174-190` imports
  into URL strings; the bytes download only when a screen references them. The
  village background (~1–1.9 MB) + `rightmenu.png` (0.59 MB) + `sectorbanner.png`
  (0.48 MB) are the first *in-game* image cost (~2–3 MB on first village paint).
  World-map PNG (1.24 MB) loads when the map opens; sector backgrounds load
  per-sector.
- They are still **PNG, not WebP/AVIF**. Vite's image optimizer only
  re-compresses PNG quality; it does not convert format
  (`shinobij.client/vite.config.ts:186`).

### The dominant problem — base64-image-in-JSON (memory fix #3, still un-fixed)
- On **every cold landing, before login**, `App.tsx:5576` fires **all 10**
  `/api/images?cat=…` bulk fetches (item, pet, card, jutsu, event, avatar, ai,
  bloodline, shrine, landmark).
- Each returns a single giant JSON object of base64 data-URLs
  (`api/images.ts:231-249`). Last measured (2026-06-04) ~**33 MB** total:
  event 9 MB, card 6.5 MB, jutsu 5.6 MB, item 4.2 MB, avatar 3 MB, … gzip only
  trims base64 ~25% (~25 MB on the wire).
- They run *after* the JS bundle (so they don't block first paint), but they
  saturate bandwidth, burn CPU parsing 33 MB of base64 into memory, and the big
  categories **exceed sessionStorage quota** (`App.tsx:5563` silently drops the
  write) — so they re-download on most refreshes.
- A logged-out visitor who never signs in still pulls all 33 MB.
- The endpoint has **no per-image route** — it is all-or-nothing per category.

### Already in place (do NOT redo)
- gzip compression on API + bundle (`server.ts:180`).
- Immutable 1-yr cache on hashed assets, no-cache `index.html` (`server.ts:573-587`).
- Cloudflare edge-caching the public GETs.
- game-state stripped of village-leadership portraits (they ride a 5-min
  `?images=1` poll, `App.tsx:3389-3415`).
- Refresh restore-gate + server battle-lock (refresh keeps you on-screen and
  re-enters fights).

---

## 2. The two highest-leverage findings

**Finding 1 — Cold start: 33 MB of base64 images fetched eagerly, pre-login,
all-or-nothing.** This is the single biggest load-time tax and is exactly the
"fix #3" the cost-tax audit flagged as still pending.

**Finding 2 — Refresh: the restore gate *blocks* on the network instead of
painting from the local save.** On refresh, `App.tsx:4919-4923` does
`Promise.all([pullSaveFromServer, fetchBattleLockStatus])` and only calls
`applySnapshot` **after the server responds** (or a 12 s timeout, `App.tsx:4912`).
The *login* path already does an optimistic instant-paint from a local save
preview (`App.tsx:6186`) — but **refresh does not**. So an honest refresh stares
at "Restoring…" for a full server round-trip (up to 12 s if Supabase/cPanel is
cold).

---

## 3. The Plan

### Phase 0 — Measure first (~½ day)
There is no real load-time telemetry (no Sentry/RUM per the launch audit), and
in-app manual testing is limited. Add a lightweight timing beacon before
optimizing so each change is verifiable and regressions are caught:
- Capture Web Vitals (TTFB, FCP, LCP) + total transfer + custom marks for
  "time-to-village" and "time-to-restore"; POST to a tiny endpoint or log.
- Re-measure the real current `/api/images?cat=*` payload sizes (the 33 MB
  figure is from 2026-06-04 — confirm it still holds).
- **Why first:** turns "feels faster" into numbers; protects against regressions
  that can't be caught by manual testing.

### Phase 1 — Quick wins, low risk (1–2 days, big perceived gain)

1. **Don't fetch image categories pre-login, and don't fetch all 10 up front.**
   (`App.tsx:5576`)
   - Gate the bulk loads behind login — the landing/login screen needs none of
     item/jutsu/card/event/pet art.
   - After login, load **only what the current screen needs** (e.g. avatar+ai
     for combat, item for inventory), lazily as screens open, instead of all 10
     eagerly. Removes ~33 MB from the cold-landing path; defers the rest.
   - *Risk:* low — images already hydrate into a per-category cache; this changes
     *when*, not *how*.

2. **Stop blowing away the image cache on every snapshot apply.**
   `App.tsx:4871` and `App.tsx:6066` clear `loadedCatsRef` + sessionStorage and
   re-pull 8 categories on *every* login/refresh, defeating the 10-min cache.
   Only refresh categories when admin content actually changes (version/hash
   bump). *Risk:* low.

3. **Make refresh paint instantly from the local save** (the big refresh win).
   Mirror the login fast-path (`App.tsx:6186`) in the refresh effect
   (`App.tsx:4919`): render the cached save immediately, then reconcile
   `pullSaveFromServer` + battle-lock in the background. If the server reports a
   battle lock, *then* force re-entry routing. Honest refreshes (the common case)
   become instant; the 12 s gate becomes an invisible background reconcile.
   - *Risk:* **medium — touches the anti-cheat path.** Must preserve the
     battle-lock invariant (a refresh must not let a player flee a fight).
     Mitigation: keep routing **pessimistic** — paint optimistically, but do not
     let the player *act* in a resumed battle screen until the lock status
     returns. Only the *paint* is optimistic. Warrants a careful design pass.

4. **Confirm Cloudflare Brotli/zstd is enabled** for static JS/CSS (free,
   dashboard toggle). 1.81 MB JS → ~420 KB gzip → ~350 KB brotli. Small but free.

### Phase 2 — Image architecture: serve images as files, not base64 JSON (~3–5 days)
The structural cure for the cold-start tax (memory fix #3).
- Move the shared image bucket from base64-in-KV to **individual files** — cPanel
  disk (free/unlimited bandwidth per the hosting routing rules) or a static
  `/images/` dir Cloudflare caches per-file.
- Change `/api/images?cat=…` to return a **lightweight manifest of URLs**
  (ids → URLs), not inline base64. The client renders `<img src=url
  loading="lazy">`, so the browser fetches only on-screen images, caches each
  independently, and Cloudflare edge-caches each file.
- *Payoff:* the 33 MB all-or-nothing download collapses to "fetch the dozen
  images this screen shows," each cached forever. Fixes both cold-start AND every
  subsequent refresh.
- *Risk:* medium — touches the upload path (`api/images.ts` POST/DELETE), the
  admin tooling that publishes images, and the client hydration layer. Needs a
  migration of existing base64 blobs → files with backward-compat reads during
  transition.
- **Guardrail: do not touch the avatar storage path** (standing rule) — migrate
  avatars last and carefully, or leave them on the current path.
- **Open decision (needs user input before building):** storage target — cPanel
  disk vs. a dedicated static dir/CDN.

### Phase 3 — Bundle splitting (ongoing, medium risk, incremental)
- **Convert the ~15 sector/landmark PNGs to WebP/AVIF** (each ~70% smaller).
  Improves first in-game paint. Enable webp sidecar emission in the Vite image
  pipeline or pre-convert source assets. *Risk:* low-ish (visual check on
  decorative art).
- **Lazy-load heavy non-initial subsystems** out of the 1.81 MB main chunk —
  AdminPanel first (admin-only, pure win), then WorldMap, then Arena/PvP battle.
  Rides on the existing App.tsx-drain refactor + the `lazy(() => import())`
  pattern. *Risk:* medium and slow — the monolith's closure-coupling makes
  extraction the hard part (per the refactor notes, AdminPanel reassigns
  module-level `let`s and is not a clean move yet). Treat as incremental, not one
  push.
- **Investigate the 470 KB CSS** — likely splittable/purgeable, but lower
  priority and easy to break styling. Last.

---

## 4. Guardrails (from hard rules / project memory)
- **Keep Railway responses thin; push bytes to cPanel/Cloudflare.** The
  image-file migration aligns with this — don't move image bytes onto Railway or
  Supabase egress.
- **Never cache per-player/auth/SSE at the edge.** The new image-manifest
  endpoint is public/shared (edge-cacheable); keep `/api/save/*` dynamic.
- **Don't break the battle-lock invariant** when making refresh optimistic
  (Phase 1.3) — paint optimistically, gate *actions* on the server lock.
- **Don't touch the avatar storage path** — migrate last or not at all.
- **Token-first auth untouched.** After any `api/`/`server.ts` change, rebuild +
  commit both `dist/`s for cPanel (Railway self-builds).
- No balance/reward/cooldown changes — this is pure perf.

---

## 5. Recommended starting point
Phase 0 (measure) + Phase 1.1 and 1.3 give the biggest felt improvement for the
least risk: defer/gate the image loads (kills the cold-start tax) and make
refresh paint instantly from cache (kills the "Restoring…" stare). Phase 2 is the
durable structural fix and the natural follow-up.
