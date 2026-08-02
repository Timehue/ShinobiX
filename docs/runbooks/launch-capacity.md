# Launch Capacity & the Single-Instance Constraint

## The constraint you cannot scale around

ShinobiX is **architecturally single-instance**, on purpose:

- presence lives in process memory (`api/_realtime/online-store.ts`);
- Socket.IO has **no** cross-process adapter (`api/_realtime/socket.ts`);
- `railway.json` pins `numReplicas: 1`, and `scripts/check-deployment-config.mjs`
  **fails CI** if that changes.

`online-store.ts` states the failure mode outright: with a second process,
*"players show offline, 'Target not online', sector-mates vanish."*

**So capacity comes from a bigger container, never more containers.** Raising
`numReplicas` for launch traffic would fragment presence, break Socket.IO
broadcasts, and duplicate the in-process cron jobs. Going multi-instance is a
real project — Redis-backed presence + a Socket.IO Redis adapter + cron leader
election — not a launch-week dial.

## Measured capacity

`npm run soak` boots the real server and drives N virtual players through a
realistic mix (autosave, heartbeat, save read, reward claim), each from its own
source IP.

**500 concurrent players, 90s steady state** (local, in-memory storage):

| endpoint | calls | errors | p50 | p95 | p99 |
|---|---|---|---|---|---|
| autosave | 11,752 | 0 | 4ms | 11ms | 15ms |
| heartbeat | 8,468 | 0 | 7ms | 19ms | 27ms |
| save read | 3,999 | 0 | 6ms | 17ms | 26ms |
| reward claim | 500 | 0 | 2ms | 7ms | 12ms |

24,732 calls, **0 errors**, 213 req/s, **event-loop p99 17ms**.

Event-loop lag is the number that matters for a single-threaded server: once
the loop falls behind, *every* player feels it. At 17ms p99 there is
substantial headroom at 500 players.

Save-version conflicts ran at **0.1%** (13 of 11,752) — the optimistic-
concurrency guard firing only on genuine races, which is exactly right.

## What this measurement does NOT cover

The local run uses the in-memory storage backend, so it measures the event
loop, handler cost, auth CPU and lock contention — **not Postgres**. The
database is the other half and is the more likely first bottleneck at scale.

**Before launch, re-run against staging:**

```bash
npm run soak -- --url=https://your-staging-host --players=500 --seconds=300
```

That exercises real Postgres, the connection pool, and Supabase latency. Watch
for p99 climbing with player count (pool saturation) and any non-zero error
count.

## Reading the output

- **Event-loop p99 > 250ms** → the server is saturating; nothing else matters.
- **429s on autosave** are the `save-burst` limiter (1 write / 3s / player)
  doing its job, not failures.
- **409s** are the version guard; a few percent is healthy, a large fraction
  means clients are not adopting `_saveVersion` from responses.
- **Registration** is limited to 25 per IP per 15 minutes. The harness gives
  each virtual player its own address because 500 real players arrive from 500
  addresses; production validates `CF-Connecting-IP` against Cloudflare ranges,
  so this represents reality rather than bypassing the limit.

## Launch checklist for capacity

1. Keep `numReplicas: 1`. CI enforces it — do not override it in the Railway UI.
2. Size the container vertically (CPU first: the server is single-threaded, and
   `scrypt` password verification is ~100ms of blocking CPU per call — the
   token-first auth path is what keeps that off the hot path).
3. Run the staging soak at your expected peak, then at 1.5× it.
4. Watch event-loop lag and Postgres pool saturation during the first live hours.
