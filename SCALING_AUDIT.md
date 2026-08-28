# ShinobiX scaling and failure-recovery audit

Audit snapshot: 2026-08-27. The active, intentionally supported topology is one Railway container.

## Current scaling verdict

ShinobiX is structurally sound for a single always-on Node process backed by PostgreSQL/Supabase. The local 100-player HTTP workload passed with low latency and no errors. Horizontal scale is **not safe today** because the realtime world and live pet duels are process-local, even though most rewarded/persisted HTTP workflows already use cross-process storage primitives.

Keep `numReplicas: 1` until the realtime ownership problem is explicitly solved and tested. Adding Redis, another database, or a generic queue is not justified by current measurements.

## State placement

| State class | Location | Examples | Restart behavior | Multi-replica behavior |
| --- | --- | --- | --- | --- |
| Durable authority | PostgreSQL/Supabase `public.kv_store` | Saves, currencies, inventory, PvP/Solo/Tower sessions, wars, clans, bosses, claims, receipts, content | Survives process replacement | Shared, subject to locks/CAS/cache exclusions |
| Process memory | Node maps/sets | Presence roster, Socket.IO server/rooms, live pet-duel sessions/rosters/recent results, local limiter buckets, request metrics, read cache | Lost or best-effort restored | Diverges per replica |
| Socket.IO rooms | Current Node process | `user:<name>`, `sector:<n>`, `petduel:<id>` | Clients reconnect | Player on another replica cannot receive the emit |
| Timers | Every Node process | 1-second game loop, 30-second presence snapshot, scheduled jobs | Restarted on boot | Schedulers lease; game loop/presence do not coordinate |
| Cache | 5,000-entry per-process LRU | Stable content/world/image metadata | Cold after restart | May differ; correctness-sensitive prefixes are excluded |
| Durable leases | KV rows with TTL/owner token | Cron ownership, route locks, travel claims | Expire/recover | Shared; exact release cannot delete a new owner |

## What happens with Server A and Server B

| Interaction | Result today |
| --- | --- |
| Player A and B need HTTP save/economy authority | Generally safe: both replicas read the same uncached save rows and use distributed lock/CAS/receipts. A non-renewing lock that exceeds its TTL remains a risk. |
| Player A should see Player B in a sector | Fails coherence: each `onlineStore` and `sector:<n>` room contains only local connections. |
| A route on Server A emits to Player B connected to Server B | Emit is lost because `user:<name>` is local. HTTP polling eventually repairs some challenge/attack notifications. |
| A and B start a live pet duel | Cannot work reliably across replicas: session/roster and duel room live in one process. Sticky routing alone does not guarantee both players land together. |
| A and B use persisted PvP/Solo/Tower | State and action authority are in KV; HTTP requests can move between replicas if lock/CAS semantics and no-cache prefixes remain correct. Socket/SSE notification latency may differ, but polling/reconnect is the correctness fallback. |
| Clan Boss / village war / scheduled settlement | Durable records are shared. Scheduled jobs use exact-owner distributed leases. Domain operations still depend on route-specific lock/receipt correctness. |
| Rate limiting | KV-backed limits are cross-process; local fast buckets and failed-password/socket limits multiply by replica count. |
| Cache | Correctness-critical namespaces are excluded. Stable cached reads can be up to their 10–60 second TTL behind another replica by design. |

## 100-player evidence

Command: `npm run soak -- --players=100 --seconds=60 --ramp=10`

- 100/100 accounts provisioned in 3 seconds.
- 3,777 measured requests, 46.2 requests/second, zero errors.
- Autosave p95 3 ms; heartbeat p95 3 ms; save-read p95 5 ms; health p99 3 ms.
- 103 version conflicts were expected and repaired by refetch; the harness treats 409/429 as designed outcomes.

Limits of this result:

- in-memory KV, not PostgreSQL;
- generator and server shared the local host;
- no real Socket.IO connection workload;
- no CPU/RSS/event-loop/pool/query metrics;
- modeled HTTP lanes were save/presence/read/reward, not the requested full mix of combat, clans, Card Clash, and creator tools;
- 200/300-player runs were not performed.

Conclusion: 100 modeled HTTP clients are comfortable in the application layer. No supported maximum-player claim can be made.

## Scaling blockers and readiness

| Area | Single process | Multi-process readiness | Required evidence/change before scale-out |
| --- | --- | --- | --- |
| Saves/inventory/economy | Strong | Mostly ready | Measure lock duration; renew/fence long critical sections; staging DB concurrency. |
| Persisted combat | Strong | Mostly ready | Multi-worker fault injection for every session store and notification fallback. |
| Scheduled jobs | Strong | Ready by design | Verify lease TTL exceeds observed job duration; alert on skipped/expired jobs. |
| Presence | Strong for one process | Blocker | Shared presence ownership/index plus cross-node broadcasts, or an explicit single realtime owner. |
| Socket rooms/notifications | Strong for one process | Blocker | Cross-process adapter or equivalent routing; test user/sector room semantics. |
| Live pet duel | Functional/unrewarded | Blocker | Shared/fenced session authority or guaranteed co-location; protocol event budgets; reconnect tests across ownership changes. |
| Local rate limits/metrics/cache | Acceptable | Partial | Decide which must be global; keep caches non-authoritative. |
| Background game loop | Soft-state only | Partial | One realtime owner or partitioned ownership; no duplicate durable mutation from ticks. |

## Failure and recovery matrix

| Failure | Current behavior | Survives? | Risk / required proof |
| --- | --- | --- | --- |
| Graceful deployment/SIGTERM | Stops loop/scheduler/snapshots, queues presence snapshot, closes sockets/pool/HTTP, exits after drain or 4-second backstop | Durable KV state yes; presence best effort | A request/query over four seconds can be cut off. Durable receipts recover selected workflows, not every arbitrary write. |
| Hard process kill/OOM | PostgreSQL state remains; last 30-second presence snapshot may restore rows still within 90-second freshness | Important persisted state yes | Live pet duel and local metrics/limits are lost. Presence can be up to one snapshot interval stale. |
| Database outage | Fail-closed locks/CAS prevent important economic races; strict cost-bearing rate limits fall back locally; public `/health` remains process-live while protected deep health reports 503 | No new authoritative mutations expected on guarded paths | Railway probes only `/health`, so DB-unready service can remain deployment-healthy. Add external deep-readiness alerting; do not make liveness flap on transient DB latency. |
| Temporary network timeout | Pool acquire is 15 seconds; statements/queries 30 seconds; upstream image generation 25 seconds | Depends on route | Exact readback/receipts recover selected lost acknowledgements. Generic handlers rely on retry and route semantics. |
| Duplicate request | Action/request IDs, fingerprints, receipts, versions, and stored terminal proof across major reward paths | Usually yes | Protection is route-specific; no executable global mutation registry proves universal coverage. |
| Partial two-key transfer | Reserve/debit/credit state and receipts support resume or reconciliation | Usually recoverable | Application saga, not atomic SQL transaction. Reconciliation job/admin surface and recent indexes must remain observable. |
| Socket disconnect | Presence ages out at 90 seconds; HTTP reconcile continues; live duel hands dropped pet to standing orders after 15 seconds | Soft state/rewarded HTTP state yes | Live duel process loss is different from peer disconnect and loses the whole session. |
| Backup/restore | Nightly snapshot job with freshness marker; hybrid KV export/drill tooling validates checksums/topology/representative records | Tooling path verified locally | Live export/restore drill against disposable target was not run in this audit. |
| Scheduler restart/multiple instances | Boot catch-up plus exact-owner leases; successful daily jobs retain dedupe lease | Designed to recover | Lease expiry during an overlong job can admit a second owner; observe actual durations. |

## Lock fencing risk

The generic lock defaults to a five-second TTL and does not renew. Exact compare-and-delete makes release safe: an expired holder cannot delete a newer holder's lock. It does not preserve mutual exclusion after expiry. If a slow database, large JSON save, or nested settlement keeps the first callback running beyond five seconds, a second holder may enter while the first still writes.

Several known long operations override TTL to 10–60 seconds or one hour, but `mutatePlayerSave` and `settleCrossKeyTransfer` use the five-second default. This is an architectural integrity risk, not a reproduced duplicate. Instrument hold duration and TTL expiry first; then choose renewal/fencing or larger route-specific TTLs based on observed p99 plus failure bounds.

## Recommended growth path

1. Stay at one replica and validate the real database at 100 players.
2. Add pool/query/lock/event-loop/RSS/Socket.IO metrics to the soak harness.
3. Fix measured single-node bottlenecks before considering replicas.
4. If one node no longer meets the target, choose the smallest coherent realtime design: shared room messaging and presence/session ownership, or a deliberately single realtime owner with horizontally scaled stateless HTTP workers.
5. Run an A/B-worker test where interacting players land on different workers before changing `railway.json`.
6. Keep scheduled jobs leased and durable domains in PostgreSQL. Do not move authoritative economy/combat state into a new cache merely to enable Socket.IO scale-out.
