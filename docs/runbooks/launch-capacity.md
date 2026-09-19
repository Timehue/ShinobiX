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

## 2026-09-18 stepped load probe — the real ceiling, and what moved it

A local stepped probe drove a realistic client mix — Socket.IO presence, 90 KB
saves, heartbeats, reads, claims — in 50-player steps until the server
failed. Local CPU was scaled by ×0.75 for Railway's slower cores. The database
side came from production `pg_stat_statements` means (aggregates only).

**Before the fixes:**

- **Crowded** (every new character enters sector 40; 25% of presence frames
  change): healthy to about 400-450 players and failing at about 550. The
  cause was the O(N²) `presence:update` fan-out: regen ticks changed the stored
  character every second, so unchanged-looking records went to the whole
  sector.
- **Spread out:** about 700.
- **Database:** 2.72 DB calls/s per active player. Supabase Micro (2 shared
  burstable cores, `max_connections` 60) saturates at about 550 active
  players.

**The fixes** (branch `claude/game-player-capacity-7d34e5`):

- Presence changes go out only when a field peers can see changes
  (`presenceBroadcastSignature`).
- Changes are batched per sector every 500 ms as `presence:updates`. Clients
  send `presenceBatch: 1`; older tabs still get per-player frames.
- The heartbeat skips the full sector roster for clients whose socket already
  keeps it current (`lib/heartbeat-roster.ts`).
- The PvP SSE stream sleeps until its session key is written.
- Autosave reads its guard keys in one `mget`.
- The heartbeat and autosave rate windows are counted in memory.
- The heartbeat no longer rewrites the shared sleeper-camp row on every
  beat. The sweep clears the camp of anyone it does not camp.
- Beta telemetry is batched.
- Injured-villagers reads only saves whose village can match.
- The public crisis polls are cached for 5 s at the edge (Cloudflare rule
  "Cache shared API endpoints").

**After the fixes:**

- **Crowded:** 30% CPU at 600 players and 51% at 1,000; failing at 1,500.
  On Railway that means healthy to about 1,000 and failing at about 1,200.
- **Database:** 2.34 calls/s per active player.
- **Order of limits:** Supabase Micro CPU first (about 450-650 active players,
  estimated), then the 15-connection pool (about 900-1,280), then game-server
  CPU (about 1,000-1,200).
- The process never crashed. Overload shows up as 15 s pool waits, timeouts
  and dropped connections.

**Presence audit on the same branch (2026-09-18).** Skipping the roster
exposed pushes that had never been sent, so the old per-beat roster had been
hiding them. All are fixed and tested (`online-store.observer.test.ts`,
`presence-store-broadcast.test.ts` and `presence-broadcast.integration.test.ts`
server-side; `presence-store.test.ts` and `heartbeat-roster.test.ts` client-side):

- **Fight start and end.** Fight hosts flip `inBattle` between beats. The
  store now reports every change to that flag.
- **Store-side changes.** Trips that settle on a plain read, admin kicks and
  bans, and restored boot rows whose owner comes back in another sector now
  all announce the move or removal.
- **Stronghold entry and exit** are pushed.
- **Leaves use the account slug.** The server names departures by slug, and
  the client used to compare that against the display name. A "Shadow Fox"
  never left anyone's list until a roster refresh.
- **Leaves for other sectors.** A leave for a sector the client has already
  moved on from is ignored.
- **A player missing from a roster** drops 2.5 s later on a timer.
- **Stale rosters.** A roster that predates a socket event neither brings back
  a player who just left nor drops one who just arrived.
- **When the roster is requested:** on the first beat after any sector change,
  and at least once a minute while the tab is visible.

The crowded measurement above used a roster refresh every sixth beat
(about 2 minutes). The shipped once-a-minute rule is still about a third of
the old every-beat cost. The first limit is the database, so the headline
numbers stand.

**Not yet measured:** combat traffic, the PvP SSE fallback, and real Railway
and Supabase CPU.

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
