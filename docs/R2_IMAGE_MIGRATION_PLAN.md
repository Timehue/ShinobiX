# Stage 3 — Move shared images to Cloudflare R2 (plan, not yet executed)

**Goal:** stop random enemy portraits blanking / lagging in PvE combat, and take
image-byte reads off the metered Railway+Supabase path — by serving image bytes
from Cloudflare R2 (object storage, $0 egress) instead of reading them out of
Postgres through the Express `/api/img` handler.

**Status:** CODE BUILT + gated (2026-07-24), NOT yet activated. Everything below
is implemented and inert until the R2 env vars are set. What's left is the
operator/account work (create bucket, set env, run backfill) — see "Operator
steps" at the bottom.

Implemented files:
- `api/_r2.ts` — R2 helpers (gating, `objectKeyForId`, `r2PublicUrl`, `putImage`
  with dependency-free AWS SigV4, `r2ObjectExists` w/ process-local hit cache).
- `api/images.ts` — POST dual-writes decoded bytes to R2 (best-effort, gated on
  write creds) + exported `decodeBase64Image`.
- `api/img.ts` — GET redirects to R2 when `r2ReadEnabled()` AND `r2ObjectExists`,
  else falls through to the existing Postgres path (nothing regresses).
- `api/admin/migrate-images-to-r2.ts` — admin backfill endpoint (registered in
  `server.ts`; `?dry=1` supported; `&limit=N` for resumable batching).
- `api/_r2.test.ts` — unit tests (objectKey/publicUrl/gating/no-op paths). Green,
  plus `server-routes.test.ts` confirms the new handler is wired.
No new npm dependency; server `tsc` build clean.

---

## Why (root cause of the in-game blanks)

- Enemy portraits are the `ai:` image category; they render via `/api/img?id=ai:…`
  (`ai` is in `URL_MODE_CATEGORIES`, `shinobij.client/src/App.tsx:4207`).
- On a **cache miss** (a fresh enemy not currently edge-cached), `/api/img`
  (`api/img.ts:84`) reads the bytes from Postgres with an 8 s timeout. Under a
  cold start / load spike that read can 503; after 2 client retries the image is
  **hidden** (`shinobij.client/src/lib/imageErrorGuard.ts:71`). "Random enemy,
  sometimes" == "whichever portrait was cache-cold at that moment."
- R2 removes the DB read from the hot path: a miss is served from R2 inside
  Cloudflare's own network (tens of ms, no timeout/fail risk) instead of a
  cross-region Postgres round-trip.

**What R2 fixes:** cold-image DB-read 503s/timeouts (the PvE-combat symptom) and
the speed of first/cold image loads. **What it does NOT fix:** stale-manifest
(Cloudflare 4 h browser-cache TTL on `?ids=1`) and client-side hydrate races —
those are separate and unchanged. Cache *hits* are already edge-fast; no change.

## Cost

Fits Cloudflare R2 free tier (10 GB storage, 10 M reads/mo, 1 M writes/mo, $0
egress). Footprint is a few hundred MB of ≤200 KB images → ~$0/mo. Only setup
cost is enabling R2 billing (card on file) on Cloudflare. Net effect: slightly
*cheaper* than today (fewer Railway/Supabase reads + egress).

---

## Target architecture

- **Bucket:** `shinobix-images` (or similar), bound to a public custom domain via
  Cloudflare, e.g. `img.shinobijourney.com`. Cloudflare serves R2 objects at the
  edge and caches them — same network as the site, no app-server hop.
- **Object key = the image id**, path-shaped: `ai/<key>`, `card/<key>`, etc.
  (derive from `categoryFromId` in `api/images.ts`). Store with correct
  `Content-Type`. Extension optional (content-type header is authoritative).
- **Server access from Railway:** S3-compatible API (Railway runs Node, not a
  Worker) via `@aws-sdk/client-s3` pointed at the R2 endpoint.
  - New env vars: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
    `R2_BUCKET`, `R2_PUBLIC_BASE` (= `https://img.shinobijourney.com`).
  - Gate all R2 code on `R2_PUBLIC_BASE` being set, so unset = current behavior
    (Postgres). Keeps the no-token / rollback path trivial.
- **CSP:** no change needed — `img-src` already allows `https:`
  (`api/_http-security.ts:46`).

---

## Phased rollout (each phase independently shippable + reversible)

### Phase 0 (optional interim, cheap, independent of R2) — preload enemy portrait
Warm the enemy image cache when a PvE battle starts, before the portrait needs to
paint, so the cold-fetch latency hides under the battle-intro animation:
`new Image().src = enemyPortraitUrl` at the point combat sets the enemy/opponent.
Does NOT fix cost or fully fix reliability, but masks the symptom with a tiny,
low-risk change. Find the PvE combat enemy-set site (search around opponent
hydration in App.tsx / the PvE combat screen). Can ship before or instead of R2
if we want fast relief.

### Phase A — provision R2 + dual-write new uploads
- Add the R2 client helper (`api/_r2.ts`: `putImage(id, dataUrl)`,
  `r2PublicUrl(id)`), gated on `R2_PUBLIC_BASE`.
- In the `POST` branch of `api/images.ts` (after validation, alongside the
  existing `kv.set('shared:img:'+id, image)` at `api/images.ts:484`), also decode
  and upload the bytes to R2 (best-effort; a failure must not fail the upload —
  Postgres stays authoritative this phase). No read change yet.
- Verify: upload an image via admin, confirm the object appears in R2.

### Phase B — backfill existing images into R2
- Mirror the cPanel-retirement pattern: add
  `POST /api/admin/migrate-images-to-r2` (model on `api/admin/migrate-to-base.ts`
  + `copyDiskRoutedKeysToBase` in `api/_storage.ts`). Walk all `shared:img:*`
  keys (paginated — reuse `_collectPaginated`), decode, `putImage`, read back a
  sample to verify byte-identical. Copy-only; never delete Postgres copies.
- Idempotent + resumable (skip objects already present). Safe to run live;
  images are immutable-ish and reads still hit Postgres until Phase C.

### Phase C — read from R2, fall back to Postgres (the reliability + speed win)
- Change `/api/img` (`api/img.ts`): when `R2_PUBLIC_BASE` is set, `302` redirect
  to `r2PublicUrl(id)` (or HEAD-check R2 then redirect). On any R2 miss, fall
  back to the existing Postgres read path (self-healing: also enqueue a
  best-effort `putImage` so the object exists next time). Keep the same
  `Cache-Control`.
- This is the phase that stops the combat blanks — cold reads now serve from R2,
  not a DB round-trip. Still fully reversible (unset `R2_PUBLIC_BASE` → back to
  Postgres).
- Verify in-browser: trigger PvE combat with a cold enemy, watch Network — the
  `/api/img` request should redirect to `img.shinobijourney.com` and return 200
  fast, never 503.

### Phase D (optional, best perf) — manifest returns direct R2 URLs
- Have `loadCategory` (App.tsx:4258) build `entries[id] = r2PublicUrl(id)` instead
  of `/api/img?id=…` when a category is R2-backed (or have the `?ids=1` endpoint
  emit full URLs). Then `<img src>` hits R2/Cloudflare **directly** — zero app
  server involvement on image reads. `/api/img` stays as the legacy fallback.
- Only do this after Phase C has soaked; it's the last few percent.

---

## Manifest note (separate problem, don't conflate)
`/api/images?cat=X&ids=1` still lists ids from Postgres (`hkeys`) — cheap (keys,
not bytes) and edge-cached. R2 doesn't change this. The **stale-manifest** issue
(Cloudflare rewrites its 60 s max-age to ~4 h; mitigated by the 5-min `cb`
cache-buster at App.tsx:4247) is orthogonal. If newly published images are the
complaint (vs. random cold ones), that's the lever — not R2. Optionally, a later
phase could write a per-category `manifest.json` to R2 on each publish and read
that, killing the DB manifest read too.

## Rollback
- Unset `R2_PUBLIC_BASE` on Railway → `/api/img` and the manifest revert to
  Postgres (bytes were copy-only, never deleted). Force a fresh Railway deploy so
  the env change lands (bump `FORCE_DEPLOY`; see the cPanel-retirement gotcha).

## Verification checklist
- Phase A: admin upload → object in R2.
- Phase B: `shared:img:*` count == R2 object count; sampled bytes identical.
- Phase C: PvE combat cold enemy → `/api/img` redirects to R2, 200, fast, no 503.
- Root build green (`npm run build` at repo root — chains sizecheck), `npm test`,
  client `npm run lint`.

## Operator steps to ACTIVATE (the remaining work — needs your accounts)
1. **Cloudflare:** create an R2 bucket (e.g. `shinobix-images`), enable R2 billing
   (card on file; usage stays in the free tier). Bind a public custom domain to
   the bucket, e.g. `img.shinobijourney.com`.
2. **Cloudflare:** create an R2 API token → gives Account ID + Access Key ID +
   Secret Access Key.
3. **Railway (write phase):** set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Force a fresh deploy (bump `FORCE_DEPLOY`).
   New uploads now dual-write to R2. Reads still come from Postgres.
4. **Backfill:** `POST /api/admin/migrate-images-to-r2?dry=1` (x-admin-password) to
   preview counts, then without `?dry=1` to copy. Re-run until `failed:0`.
5. **Railway (read phase):** set `R2_PUBLIC_BASE=https://img.shinobijourney.com`,
   fresh deploy. `/api/img` now redirects cold reads to R2 (Postgres fallback stays).
6. **Verify:** PvE combat with a cold enemy → `/api/img` returns 302 → R2, 200,
   fast, no 503.
Rollback at any time: unset `R2_PUBLIC_BASE` (+ fresh deploy) → reads revert to
Postgres. Bytes are copy-only, never deleted.

## Anchors (verify before editing — these are point-in-time)
- Read handler: `api/img.ts` (`perImageKey`, Postgres read + legacy fallback).
- Upload handler: `api/images.ts` POST (`api/images.ts:484` per-image write).
- Client loader / manifest: `shinobij.client/src/App.tsx:4207` (`URL_MODE_CATEGORIES`),
  `:4258` (id → `/api/img` URL mapping).
- Image failure guard (the hide-after-retry): `shinobij.client/src/lib/imageErrorGuard.ts:71`.
- Migration precedent: `api/admin/migrate-to-base.ts`, `copyDiskRoutedKeysToBase`
  in `api/_storage.ts`.
- CSP (no change needed): `api/_http-security.ts:46`.
