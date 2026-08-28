# ShinobiX performance audit

Audit snapshot: 2026-08-27. Findings distinguish measured local behavior from PostgreSQL/production unknowns.

## Measured baseline

The repository's own 100-player harness booted the real compiled Express graph with the isolated in-memory KV backend and simulated autosaves, heartbeats, save reads, conflict repair, and daily reward claims.

| Result | Measurement |
| --- | --- |
| Provisioning | 100/100 accounts in 3 seconds |
| Measured calls | 3,777 over an 82-second run |
| Throughput | 46.2 requests/second |
| Errors | 0 |
| Autosave | p50 2 ms, p95 3 ms, p99 4 ms, max 6 ms; 103 expected 409 conflicts |
| Heartbeat | p50 1 ms, p95 3 ms, p99 4 ms, max 7 ms |
| Save read | p50 2 ms, p95 5 ms, p99 7 ms, max 10 ms |
| Health | p50 1 ms, p95 2 ms, p99 3 ms |

This proves the Node handler/auth/serialization path carries the modeled 100-player HTTP workload with local headroom. It does **not** measure PostgreSQL latency, pool pressure, Socket.IO connections, combat-heavy CPU, memory, event-loop delay, or production networking.

Build measurements:

- Product JS/CSS: about 7.54 MiB raw / 2.29 MiB gzip.
- Story JSON: about 552.9 KiB raw / 139.8 KiB gzip.
- Initial graph: about 1.38 MiB raw / 373.2 KiB gzip.
- Full client distribution: about 335.6 MiB, dominated by media/model assets; immutable/fixed-media cache rules prevent all of it from becoming one initial transfer.

## Findings

| Issue | File(s) | Evidence | Likely impact | Confidence | Safe fix | Benchmark needed? |
| --- | --- | --- | --- | --- | --- | --- |
| Pre-auth 50 MB JSON parsing | `server.ts`, `api/_body-limits.ts` | Parser runs before handlers; several routes with small legitimate inputs receive the 50 MB parser. | Concurrent unauthenticated bodies can consume memory/CPU and delay every player on the single process. | High | Narrow route limits; pre-parser gate for genuinely large internal/admin payloads. | Yes—body flood on disposable local/staging. |
| Economy telemetry rewrites a capped 5,000-entry JSON list | `api/_economy.ts` | Each recorded delta reads/writes `econ:txns` and one aggregate; list serialization grows to 5,000 records. | Extra DB bytes, JSON parse/serialize, WAL, and row lock pressure on currency-heavy traffic. | High | Chunk/bucket telemetry or append records; keep gameplay write independent and telemetry best effort. | Yes—measure row size and p95 at 1k/5k records. |
| Economy transaction recent index is repeated RMW | `api/_economy-tx.ts` | `rememberRecent` reads the same key twice, filters/re-writes up to 500 IDs; concurrent updates are not CAS/locked. | Extra round trips and possible lost observability index entries; transaction rows themselves remain by ID. | High | One read plus locked/CAS index update, or derive the admin list from a bounded query/index. | Unit race test plus DB latency measurement. |
| Unbounded key scans return full arrays | `api/_storage.ts`, cron/admin/domain scanners | PostgreSQL `keys()` performs indexed `LIKE` but has no limit/cursor; callers then often `mget` all results. Nightly snapshot/ranked jobs scan all saves. | Memory/result growth and long pool occupancy as saves/receipts accumulate. Current ~100-player target is modest; expired rows are purged every two minutes. | High | Add paged scan API for large background/admin jobs; preserve exact all-key semantics for existing callers during migration. | Yes—production row counts and `EXPLAIN (ANALYZE, BUFFERS)` on representative prefixes. |
| PostgreSQL `mget` sends one arbitrary-size `ANY(text[])` and returns whole JSONB rows | `api/_storage.ts` | Direct PG path does not chunk; snapshots/admin lists may retrieve many save blobs in one query. | Burst memory, response size, and pool hold time; fewer round trips than N+1, but a large single batch can still be expensive. | Medium-high | Page/chunk large-job callers, with bounded concurrency and checkpointing. | Yes—real save-size distribution needed. |
| One-second loop can overlap async sleeper materialization | `api/_realtime/game-loop.ts` | The interval does not await `materializeSleeperCamps`; a later tick can start while prior DB work is pending. | Duplicate concurrent background work or pool pressure after a large stale-player sweep. Presence sweep itself is O(players) memory-only. | High | Add a single-flight flag/queue for sleeper materialization and duration telemetry; preserve sweep notifications. | Fault/slow-store test needed. |
| Pet-duel progress and finish events are unthrottled | `api/_realtime/pet-duel-socket.ts` | Each progress event broadcasts cumulative sync; each finish hint runs a full deterministic replay. | Authenticated event flood can consume CPU/fanout. | High | Per-socket coalescing/token bucket plus terminal proof gate after characterization. | Yes—measure replay time and messages/sec. |
| Sector joins snapshot and broadcast current members | `api/_realtime/socket.ts`, `online-store.ts` | Presence is throttled to 1 Hz/socket; join snapshot is O(sector population), movement delta is 80 ms coalesced. Same-sector character change compares serialized slim objects. | Normal 100-player spread is small; one crowded hub or scripted presence churn increases fanout roughly with room size. | Medium | Instrument room size, broadcast counts, and event-loop delay before optimizing; keep delta movement path. | Yes—Socket.IO hub workload missing from current soak. |
| Token fallback can put blocking scrypt on hot authenticated requests | `api/_auth.ts`, `server.ts` | Missing `SESSION_SECRET` disables HMAC token path and logs a warning but does not fail readiness. | Severe event-loop saturation under ordinary authenticated traffic if production config drifts. | High | Production readiness gate for session secret; keep test/local fallback. | Validate in a staging config-drift test. |
| Client asset set is large | client build output, `server.ts` static caching | 335.6 MiB total distribution; initial graph is only 373.2 KiB gzip; hashed assets cache one year, fixed media one week. | Storage/deploy/export and cold media navigation cost, not an all-at-once boot payload. | High | Continue route/media lazy loading, asset budgets, and cache-busting. Optimize only top transferred assets from real analytics. | Real-user transfer/cache-hit data needed. |

## Positive performance controls

- PostgreSQL pool defaults to 15 on Railway, with 15-second acquisition and 30-second statement/query timeouts.
- Save and other correctness-critical namespaces bypass the process cache; comparatively stable data uses a 5,000-entry LRU with short TTLs.
- Supabase REST fallback paginates `keys()` and chunks `mget`/bulk delete to avoid silent 1,000-row truncation.
- Clan lists, static index HTML, deep health, and request telemetry are cached/bounded. Request latency aggregation is evaluated only every 15 seconds rather than sorting percentiles after each request.
- Response compression is before API routes and excludes SSE. Hashed bundles are immutable; fixed media gets edge-cache directives.
- Presence snapshots contain identity/sector only, occur every 30 seconds, and expire shortly after the 90-second offline window.
- Tile movement uses a small delta event rather than rebuilding the whole sector roster.
- Background schedules have local single-flight flags for settlement, party, and territory sweeps plus distributed job leases.

## Database pressure model

At the current topology, the first likely production bottleneck is not the in-memory HTTP router. It is the combination of:

1. whole-save JSONB reads/writes for autosave and rewards;
2. a 15-connection shared pool;
3. cross-key saga round trips and lock waits;
4. economy/ledger/receipt side writes; and
5. scheduled all-save scans.

The local soak deliberately replaces PostgreSQL and cannot validate this model. A staging run should record pool wait, statement latency, row bytes, lock duration, event-loop delay, RSS, and request percentiles together.

## Required next measurements

1. Repeat the 100-player workload against disposable Railway/Supabase staging, never production accounts.
2. Add workload lanes for Socket.IO presence/hub churn, Solo/PvP combat, shop/bank, Clan Boss, and Card Clash.
3. Record 100/200/300-player results separately, stopping when SLO/error/pool thresholds fail; do not infer a maximum from the local pass.
4. Add process RSS, CPU, event-loop delay, Socket.IO connection/event counts, pool wait, and query counts to the harness.
5. Capture `EXPLAIN` for `save:*`, `save-snapshot:*`, and large receipt-prefix scans on representative staging volume.
