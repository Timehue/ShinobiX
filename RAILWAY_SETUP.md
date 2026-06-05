# Deploying ShinobiX on Railway (and other Docker hosts)

This runs the **same Express server** as cPanel (`server.ts` → `dist/server.js`),
serving the API and the React SPA from **one service on one port**. The added
files — `Dockerfile`, `.dockerignore`, `railway.json`, `.env.example` — are
additive; `app.js` and the cPanel path are untouched.

Because the image is a plain `Dockerfile`, the exact same setup also deploys to
**Render, Fly.io, or any VPS with Docker** — that's your portability insurance.

---

## How it works

- **One service, same origin.** Express serves the SPA static build *and* the
  `/api/*` routes. The client calls relative `/api/...` paths
  (`shinobij.client/src/authFetch.ts`), so there are **no CORS issues** and no
  build-time API URL to configure.
- **Database path.** When `DATABASE_URL` is set and the app is *not* on Vercel,
  the server uses the direct Postgres pool (`api/_storage.ts:712`) — the same
  code path cPanel uses. Point it at your existing Supabase Postgres.
- **No `app.js`.** The Dockerfile runs `node dist/server.js` directly. The
  DNS/IPv4 hardcoding in `app.js` is cPanel-only and is skipped here.
- **Health check.** `railway.json` points Railway's health check at `/health`
  (defined in `server.ts:204`).

---

## Database — keep Supabase (locked decision)

Railway runs only *compute*; Supabase stays the database (auth, saves, all
durable data) with its managed backups. Connect via `DATABASE_URL`.

1. In Supabase → **Connect → Session pooler**, copy the URI (IPv4 + persistent-
   server friendly; the app strips `sslmode`/`pgbouncer` automatically).
2. Use it as `DATABASE_URL` below. **Leave SSL on** — do NOT set `PG_SSL`
   (Supabase requires TLS).
3. Deploy Railway in the **same region as your Supabase project** to minimise
   round-trip latency on the still-chatty endpoints (until the realtime layer
   removes them).

---

## Deploy via the Railway dashboard (no CLI needed)

1. **New Project → Deploy from GitHub repo** → pick this repo/branch.
2. Railway detects `railway.json` and builds with the `Dockerfile` automatically.
3. Open the service → **Variables** → add the env vars from the list below
   (Railway injects `PORT` itself — don't add it).
4. **Settings → Networking → Generate Domain** to get a public
   `*.up.railway.app` URL (or attach a custom domain — see below).
5. Deploy. Watch the build logs; once live, hit `https://<domain>/health` →
   expect `ok`.

## Deploy via the Railway CLI

```bash
npm i -g @railway/cli
railway login
railway init                      # or: railway link  (to an existing project)
railway up                        # builds the Dockerfile and deploys
railway variables --set SESSION_SECRET=... --set DATABASE_URL=...   # etc.
railway domain                    # generate a public domain
```

---

## Environment variables to set

See `.env.example` for the annotated list. Minimum to boot:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Supabase **Session pooler** URI. Leave SSL on (don't set `PG_SSL`). |
| `SESSION_SECRET` | ✅ | Long random string. Without it, every request pays ~100ms scrypt. |
| `ADMIN_PASSWORD` | ✅ | Admin panel. |
| `ADMIN_CONTENT_PASSWORD` | ✅ | Content moderation admin. |
| `VITE_SUPABASE_URL` | ✅ (build) | `https://<ref>.supabase.co` — baked into the client at build for Realtime. |
| `VITE_SUPABASE_ANON_KEY` | ✅ (build) | Supabase anon (public) key — build-time, for client Realtime. |
| `SUPABASE_URL` | ▲ | Server-side Supabase REST/Storage base (if used). |
| `SUPABASE_SERVICE_ROLE_KEY` | ▲ | Server-side service role — NEVER exposed to the client. |
| `PG_POOL_MAX` | ▲ | Pool size; `15` recommended for the single always-on instance. |
| `CRON_SECRET` | ▲ | Guards the daily snapshot job (set if you use Railway Cron). |
| `RESTART_TOKEN` | ▲ | Guards `POST /restart`. |
| `KV_PROXY_URL` | ▲▲ | **Production uses this.** Points Railway's save/image keys at the cPanel disk overlay (e.g. `https://theravensark.com/api/kv`). See "Storage topology" below. |
| `KV_PROXY_TOKEN` | ▲▲ | Shared secret for the proxy; must equal the cPanel box's KV token. Required whenever `KV_PROXY_URL` is set. |
| `REQUIRE_DISK_OVERLAY` | ▲▲ | Set to `1` on any instance that serves `/api/save/*` from the overlay — refuses to boot if the overlay env is missing instead of silently serving wiped saves. |
| `OPENAI_API_KEY` | ○ | Only if the AI image endpoint is used. |

Do **not** set `PORT`, `STATIC_DIR`, `PG_SSL`, or `DISK_KV_DIR` on Railway
(containers have an ephemeral filesystem; reach the cPanel disk via `KV_PROXY_*`
instead). See "Storage topology" below for the `KV_PROXY_*` decision.

---

## Daily save-snapshot cron

This now runs **in-process** on the always-on server (`startSnapshotCron`,
`api/cron/_scheduler.ts`) at 03:00 UTC — no external scheduler needed. It was a
Vercel cron before the migration; the always-on Railway/cPanel process schedules
it itself. Set `DISABLE_SNAPSHOT_CRON=1` on any *secondary* instance so only the
primary runs the nightly pass (a double run is a harmless no-op either way — the
20h dedup window covers it).

The HTTP endpoint `GET /api/cron/snapshot-saves` stays as an **optional manual
trigger** (auth: `CRON_SECRET` bearer or full-admin password). You do not need to
wire a Railway Cron to it, but you can force a run with:

```
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/snapshot-saves
```

(Supabase keeps its own managed backups; this snapshot is an extra safety net.)

---

## Custom domain

If you point `theravensark.com` at Railway, no code change is needed — it's
already in the CORS allowlist (`server.ts:120`, `api/_utils.ts`).

**Only** if you ever serve the client from a *different* origin than the API,
add that origin to `ALLOWED_ORIGINS` in **both** `server.ts` **and**
`api/_utils.ts` (keep them in sync — see CLAUDE.md).

---

## Migration considerations (read before cutting over)

- **Storage topology (read carefully — getting this wrong wipes saves).** The
  server runs in one of two modes:
  - **Mode A — Supabase-only.** Every key, including `save:*`, lives on the base
    Postgres store. Leave `DISK_KV_DIR` and `KV_PROXY_*` unset, and leave
    `REQUIRE_DISK_OVERLAY` unset.
  - **Mode B — cPanel disk overlay (what production runs).** `save:` /
    `save-snapshot:` / `shared:images` / `shared:imgfields` keys route to the
    free cPanel disk (unlimited bandwidth — keeps heavy save/image blobs off
    metered Railway egress and off Supabase). Railway reaches it via the KV proxy
    (`api/_storage.ts`, `kv-proxy.ts`): set `KV_PROXY_URL` (e.g.
    `https://theravensark.com/api/kv`) **and** `KV_PROXY_TOKEN`. The cPanel box
    itself uses `DISK_KV_DIR=/home/<user>/kv-storage` to read the disk directly.
  - **Always, in mode B: set `REQUIRE_DISK_OVERLAY=1`** on every instance that
    serves `/api/save/*`. Without it, a missing/typo'd proxy env makes `kv`
    silently fall back to the (empty) base store — every player looks
    logged-out/wiped and new progress is written to the wrong place. With it, the
    server refuses to boot loudly instead.
  - **Verify after every deploy:** `GET /api/health?deep=1` returns a `saveStore`
    field (`disk` / `remote-proxy` / `base-store`). On a save-serving host it must
    NOT be `base-store`.
- **Ephemeral filesystem.** Railway containers reset their disk on every deploy,
  so never use `DISK_KV_DIR` there — reach the cPanel disk via `KV_PROXY_*`
  (mode B) instead. `DISK_KV_DIR` is correct only on the cPanel box, whose disk
  is persistent.
- **Cross-provider DB traffic.** Railway↔Supabase round trips cost latency +
  egress on both sides, and the 1-second heartbeat write is the worst offender.
  The realtime layer (in-memory presence + WebSocket) removes it — that's the
  actual cost fix. Until then, same-region deployment keeps it tolerable.
- **cPanel/Vercel untouched by these files.** Nothing here changes `app.js`, the
  Passenger setup, or the handlers. Run Railway alongside the old stack during
  cutover, flip DNS when ready, then retire Vercel.

---

## Local sanity check (optional, needs Docker)

```bash
docker build -t shinobix .
docker run --rm -p 3000:3000 --env-file .env shinobix
# → open http://localhost:3000  and  http://localhost:3000/health
```
