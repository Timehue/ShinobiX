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

## Superseded historical measurement (do not use for launch)

The figures below predate the 2026-08-05 harness correction. The old clock
started before provisioning, so large runs received less traffic time than
requested, and its “event-loop” sampler measured the load-generator process,
not the separately spawned game server. Keep the endpoint figures only as
historical context; they are not current launch evidence.

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

## 2026-08-19 local measurement — 200/300 players, incl. worst-case single-sector

Run with the corrected (post-2026-08-05) harness: `npm run soak -- --players=N
--seconds=90 [--sectors=1]`. Same in-memory-storage caveat as above applies —
this measures the server process (handlers, auth, lock contention, presence
broadcast), not Postgres or the Railway container.

| run | accounts | calls | errors | health p99 | worst endpoint p99 |
|---|---|---|---|---|---|
| 200 players, spread across 40 sectors | 200/200 | 10,763 | 0 | 5ms | 7ms (heartbeat) |
| 300 players, spread across 40 sectors (1.5×) | 300/300 | 16,497 | 0 | 7ms | 11ms (heartbeat/save read) |
| 200 players, **all in one sector** (`--sectors=1`, the hub-crush case) | 200/200 | 10,751 | 0 | 4ms | 9ms (heartbeat/save read) |

All three passed the harness's own gate (health p99 > 250ms or gameplay p99 >
2s fails) with roughly 30-50× margin. The single-sector run — the specific
"dense-sector broadcast" scenario SX-007 called unverified — showed **no
degradation** versus the spread-out run; full-roster broadcast fan-out to 200
sector-mates did not measurably cost more than normal.

**What this changes:** the server-side code (handlers, presence, locking) is
no longer the open question at 100-200 concurrent — it held with large margin,
including the specific worst case that was previously flagged as unknown.

**What this does NOT change:** this is still a local, in-memory run. Real
Postgres connection-pool behavior, Railway↔Supabase network latency, and
actual Railway container CPU/RSS remain unmeasured. The 15-connection pool
(`PG_POOL_MAX`, `api/_storage.ts`) has not been load-tested against real
traffic. Back-of-envelope math (simple indexed KV point reads/writes, pool of
15, even a pessimistic 50ms/query) suggests ~300 qps of headroom against a
real 100-200-player traffic rate far below the 96-141 req/s already cleared
locally with an accelerated test cadence — but that is an estimate, not a
measurement. Re-run `npm run soak -- --url=https://your-staging-host
--players=200` against a real staging Postgres before treating 100-200 as
certified; no staging host currently exists in this repo's configuration.

The formal `release-audit/RELEASE_AUDIT.md` verdict (25 invited concurrent
players, one replica) predates this measurement and was set because this
exact test hadn't been run yet, not because a problem was found. This section
does not itself re-certify a higher number — that requires the staging run
above plus an owner decision — but the server-code portion of the open
question is now answered with evidence.

## Corrected automated local gate

`npm run soak:smoke` now runs in CI after the built-server certification. The
steady-state clock starts only after every requested account is provisioned,
and an uncached `/health` probe measures responsiveness of the game process
throughout the run. The corrected 2026-08-05 local baseline carried all 24/24
players through 176 measured gameplay calls with zero unexpected errors;
gameplay endpoint p99 was at most 24ms and server-health p99 was 6ms.

The harness fails on incomplete provisioning, zero measured traffic, failed
health probes, server-health p99 above 250ms, gameplay endpoint p99 above 2s,
or unexpected HTTP errors. This is a regression gate, not a production
capacity claim.

## What this measurement does NOT cover

The local run uses the in-memory storage backend, so it measures server
responsiveness, handler cost, auth CPU and lock contention — **not Postgres,
Railway CPU/RSS, or server-side event-loop delay**. The database and hosting
container are the other half and are the more likely first bottlenecks at scale.

**Before launch, re-run against staging:**

```bash
npm run soak -- --url=https://your-staging-host --players=500 --seconds=300
```

That exercises real Postgres, the connection pool, and Supabase latency. Watch
for p99 climbing with player count (pool saturation) and any non-zero error
count.

## Reading the output

- **Server `/health` p99 > 250ms** → the game process is not responsive enough
  under the requested traffic; the harness fails.
- **Worst gameplay endpoint p99 > 2s** → a route is saturated even if shallow
  health remains responsive; the harness fails.
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
4. Watch Railway CPU/RSS, server event-loop lag, and Postgres pool saturation
   during the first live hours; those host-side signals are not exposed publicly.
