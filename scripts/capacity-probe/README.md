# Capacity probe

Answers one question with measurements: **how many concurrently active players does
the current setup hold?** The setup is one Railway replica (single-threaded Node; presence
in memory) on Supabase Micro (1 GB, shared CPU, 60 connections, 8 GB spend-capped
disk) behind Cloudflare.

It steps the number of active virtual players up a plan, measures every step from both
sides, and stops at the first size that breaks an SLO twice in a row, or immediately when
a safety guard trips.

## What a virtual player does

The traffic mirrors the real signed-in client, as mapped from `shinobij.client/src` on
2026-10-12:

- **Socket.IO presence.** It sends the client's auth (`presenceBatch: 1`), a `presence`
  frame every 20 s, and `presence:request` on connect.
- **Heartbeat.** It posts `POST /api/player/heartbeat` every 20 s. Once it holds a sector
  roster it sends `socketLive`, and it drops that flag once a minute to refresh the roster.
- **Polls at the client's cadence:**

  | Interval | Endpoints |
  |---|---|
  | 10 s | `game-state` |
  | 15 s | `world-state`, `world-crisis`, `world-crisis-80` |
  | 30 s | `capabilities`, `messages`, `sector/chat` |
  | 50 s | `village/intel` |
  | 60 s | `weekly-boss`, `roster` |

  On top of these, it loads the image manifests once per session.
- **Active players** (`CAPACITY_ACTIVE_FRACTION`, default 0.5) also:
  - autosave: about 70% of 15-second ticks carry a change, a 409 triggers a refetch;
  - take a map trip every few minutes.
- **No chat.** Virtual players never post chat, because test lines would be visible to
  real testers.

**The simulated Cloudflare cache.** Each worker process is one simulated Cloudflare POP
(`CAPACITY_WORKERS`, default 6), and its players share one edge cache. That cache covers
the routes verified as cached at Cloudflare: `game-state`, `world-state`, `world-crisis`,
`world-crisis-80`, `weekly-boss`, `player/roster` and `images`. Hits never reach the
origin, just as in production. Every other route always reaches the origin.

**Known limits:**
- Accounts are fresh level-1 characters, so their saves are smaller than a veteran's
  (about 80 kB stored in production). Saves cost less than they will at launch.
- Combat, PvP, raids and chat writes are not driven.

## What it measures

| Source | Signals |
|---|---|
| Client side | p50/p95/p99 and status counts per endpoint, socket connects and unexpected disconnects, and edge hit rate |
| `/health/runtime` (needs `HEALTH_DEEP_TOKEN`) | main-thread utilization and event-loop delay, process CPU and RSS, DB pool `waiting`, sockets, and online players |
| Postgres (`DATABASE_URL`, read-only) | database size, backends, lock waits, WAL rate, and `kv_store` dead tuples |
| Supabase host (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, optional) | CPU busy and memory used, from the project's privileged metrics endpoint. This is the Micro instance, the expected first limit, and SQL cannot see it. |

**A step is broken** when any of these holds:
- the error rate is over 1% (409 and 429 are designed answers, not errors);
- a save or travel p95 is over 1 s, or any other endpoint's p95 is over 500 ms;
- the `/health/runtime` round trip takes over 250 ms;
- the event loop is more than 90% busy;
- any request is waiting for a DB connection.

## Safety

- **Target gate.** The probe refuses any non-loopback target unless
  `CAPACITY_CONFIRM_HOST` names the exact host. A production host additionally needs
  `CAPACITY_ALLOW_PRODUCTION=1`.
- **Disk guards.** The Supabase disk is spend-capped at 8 GB, and a full disk makes the
  database read-only. The run aborts when either of these happens:
  - the database grows more than `CAPACITY_MAX_DB_GROWTH_MB` (default 600) over its
    baseline;
  - more than `CAPACITY_MAX_WAL_MB` (default 2,500) of WAL is generated.
- **Test accounts.** They are named `lt<run><nnnnn>` and come from RFC 2544 benchmark
  addresses (198.18.0.0/15), so anti-alt evidence ignores them.
  - `CAPACITY_CLEANUP=1` with `ADMIN_PASSWORD` deletes the run's accounts at the end,
    through the game's own admin path. It is paced, because each deletion rewrites the
    shared player registry row.
  - Without cleanup, the server reset removes them.

## Run it locally (no database touched)

```bash
npm run build:server
```

```bash
node scripts/capacity-probe/local-smoke.mjs
```

This boots `dist/server.js` with the isolated in-memory store and runs a tiny plan,
cleanup included. It proves the harness wiring, not capacity.

## Run it on Railway

Deploy this folder as its own service **in the game's project** so it reaches the game
server over Railway's private network. Over that network the game trusts `X-Real-IP`, so
each virtual player keeps its own rate-limit bucket, as real players do.

1. **Create the service.**
   - source: this repository
   - root directory: `scripts/capacity-probe`
   - config file: `scripts/capacity-probe/railway.json`
   - It builds with Railpack, runs `node probe.mjs` once, and never restarts.
2. **Set its variables.** The `${{ShinobiX.*}}` references keep the secrets inside
   Railway.

   ```text
   CAPACITY_TARGET=http://shinobix.railway.internal:8080
   CAPACITY_CONFIRM_HOST=shinobix.railway.internal
   CAPACITY_ALLOW_PRODUCTION=1
   CAPACITY_STEPS=100-1500/100@180
   HEALTH_DEEP_TOKEN=${{ShinobiX.HEALTH_DEEP_TOKEN}}
   DATABASE_URL=${{ShinobiX.DATABASE_URL}}
   SUPABASE_URL=${{ShinobiX.SUPABASE_URL}}
   SUPABASE_SERVICE_ROLE_KEY=${{ShinobiX.SUPABASE_SERVICE_ROLE_KEY}}
   CAPACITY_CLEANUP=1
   ADMIN_PASSWORD=${{ShinobiX.ADMIN_PASSWORD}}
   ```

3. **Read the deploy logs.**
   - one `[capacity-step]` line per step;
   - one `[capacity-sample]` line every 15 s;
   - a final `[capacity-result]` line.
4. **Delete the service afterwards.**

**Reading a result.** `lastHealthyPlayers` is the largest step with no breach. Plan
around about 70% of it. Each step's `breaches`, together with its `resources` figures,
names the resource that ran out:
- `eluMax` near 1 means the game server's main thread is saturated;
- `poolWaitingMax` above 0 means the 15-connection pool is the limit;
- `supabaseCpuMax` near 1 means the Micro database is the limit.
