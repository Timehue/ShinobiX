# ADR: Multiplayer backend evolution

- Status: Accepted — no backend migration now
- Date: 2026-08-05
- Deployment constraint: Railway, one replica while realtime presence is process-local

## Context

Express owns the HTTP APIs and server-authoritative battle, settlement, save, auth, and economy logic. Socket.IO is attached to the same HTTP server for authenticated presence, sector rooms, push notifications, lobbies, and pet-duel traffic, with HTTP fallbacks. Supabase/Postgres remains durable storage. `railway.json` and `scripts/check-deployment-config.mjs` intentionally pin one replica; presence snapshots improve restart recovery but do not make live room state horizontally shared.

Socket.IO officially requires both connection routing and an adapter when multiple nodes must share rooms/broadcasts, and lists Redis Streams, MongoDB and other adapter options. Its connection-state recovery can restore rooms/data/missed packets but is explicitly best-effort and adapter support differs, so application-level resynchronization remains required. [Socket.IO multiple-node guidance](https://socket.io/docs/v4/using-multiple-nodes/), [connection-state recovery](https://socket.io/docs/v4/connection-state-recovery)

Colyseus provides server-mutated schema state, automatic room patches, authentication hooks and explicit reconnect lifecycle methods. Nakama provides authoritative match loops plus its own auth, sessions, storage, social and realtime systems. Those capabilities are real, but most overlap systems already implemented here. [Colyseus rooms](https://docs.colyseus.io/room), [state synchronization](https://docs.colyseus.io/state/), [Nakama authoritative multiplayer](https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/), [Nakama authentication](https://heroiclabs.com/docs/nakama/concepts/authentication/)

## Options

| Criterion | Current Socket.IO + Express + Supabase | Current + supported adapter | Isolated Colyseus tactical service | Full Nakama migration | No change now |
|---|---|---|---|---|---|
| Server authority | Already in HTTP/battle engines; realtime is transport/presence plus selected authoritative duel state | Preserved if adapter only distributes events/state references | Good room authority, but engines must be wrapped/ported and ownership boundaries defined | Good match authority, but existing handlers must be ported or bridged | Preserves current proven boundary |
| Room/state model | Hand-authored rooms and process-local online store; durable match/session records where implemented | Same API, but online state, timers, locks, snapshots and broadcasts all need shared semantics | Strong typed room schema/patch model for one isolated mode | Match handlers and Nakama state/storage become a new platform model | Accept current single-instance limit |
| Reconnect/recovery | Existing client reconnect, authoritative refetch, durable receipts/outboxes, presence snapshots; coverage exists | Adapter choice must support recovery and app resync across nodes | `allowReconnection`/room hooks help, but durable crash recovery is still application work | Match lifecycle is built in; persistence and resume still require authored logic | Improve metrics/tests before architecture |
| Current battle engines | Native TypeScript modules already called by Express/Socket.IO | No port | Adapter layer or partial port; risk of two tactical authorities | Broad port into runtime match handlers/RPCs | No churn |
| Authentication | Existing player token/password/admin model | Reuse existing Socket.IO middleware | Must validate existing tokens across service boundary | Nakama requires its own session model or a complex identity bridge | No auth change |
| Supabase/save compatibility | Native | Native if adapter stores only ephemeral realtime data | Must call back to Express/Supabase; never own player saves | High duplication/migration risk across accounts, storage, wallets, groups and saves | Native |
| Horizontal scaling | None for live state; vertically scalable one replica | Best incremental path once a shared presence/timer/lock design and Railway routing are proven | Scales the isolated match class, not the whole app | Broad scaling platform; clustering/edition/operations need separate evaluation | Deliberately deferred |
| Observability/testing | Existing request, battle, economy, beta, Sentry, Playwright and soak evidence | Extend load tests with multi-node routing/failure cases | Second logs/metrics/traces, contract tests, chaos and cross-service correlation | Rebuild dashboards, tests, admin tooling and incident procedures | Lowest operational surface |
| Deployment/rollback | One Railway service, one DB authority | New shared broker/adapter and multi-replica rollout; rollback to one replica must be rehearsed | Second Railway service and deploy ordering; feature-flag routing allows mode-level rollback | New stateful service/database and cutover; rollback/data reconciliation is hardest | Current Railway deploy unchanged |
| Cost/licensing | Existing hosting | Broker/storage plus replicas and on-call complexity | Extra service/instances and framework maintenance | Extra infrastructure; some clustering/managed capabilities may affect edition/vendor cost | No incremental platform cost |
| Staffing burden | Known Node/React/SQL stack | Moderate distributed-systems work | High: service ownership plus engine boundary | Very high migration and long-term platform expertise | Lowest |

## Decision

Choose **no change now**, while treating **current architecture plus a supported Socket.IO adapter** as the first scaling option to investigate after evidence crosses a trigger. Do not add a second authoritative backend in this pass.

Colyseus is deferred, not selected. It may become a focused proof for a new tactical mode only when typed room replication/reconnect semantics solve a measured requirement that cannot be met safely in the current service. Such a proof must own exactly one mode, use existing auth as the identity authority, call existing server-authoritative settlement, never write player saves directly, and be removable by a route flag.

Nakama is rejected for the present problem. A full migration would duplicate or replace auth, sessions, storage, social/presence, matchmaking/queues, wallets/economy, admin APIs, and authoritative handlers without a quantified benefit. Its own documentation confirms these are first-class subsystems, which is precisely why it is not a small transport swap. [Nakama architecture](https://heroiclabs.com/docs/nakama/getting-started/architecture/)

## Measurable reconsideration triggers

Open an architecture investigation only when one or more conditions is reproduced and attributed to the current topology:

- two controlled staging runs at target and 1.5× target concurrency show CPU or memory above 80% for 15 minutes, or event-loop lag p95 above 100 ms, after ordinary optimization;
- release gates breach normal HTTP p95 500 ms, save/reward p95 1,000 ms, Socket.IO reconnect p95 5,000 ms, or reconnect success 99.5% in two runs;
- vertical scaling cannot meet a documented concurrency/SLO target and product availability requires multiple application replicas;
- more than 0.1% of live authoritative matches cannot recover from a reconnect/process restart over a representative week;
- two or more 90-day production incidents have the same root cause in process-local presence/rooms/timers or single-instance deploy unavailability;
- a new mode has continuous room state/bandwidth needs that the existing engine and protocol cannot satisfy within its SLO.

A threshold crossing starts discovery; it does not predetermine a migration.

## Required proof before any change

1. Capture target concurrency, room mix, event rate, p95/p99 latency, event-loop lag, CPU/RSS, reconnect success/p95, match recovery rate, and cost on the current stack.
2. Prototype the smallest candidate in staging with disposable users and the same load/reconnect harness. For an adapter, include multi-node routing, rolling restart, broker loss, recovery support and server-side presence-orphan evidence.
3. Prove auth/token validation, save/settlement idempotency, no dual writes, no client authority, and trace correlation across boundaries.
4. Document Railway topology, secrets, backup/restore, failure modes, on-call ownership, licensing/managed-service cost, phased cutover and a tested rollback.
5. Obtain explicit owner approval for any new service, storage system, auth boundary, migration, or production traffic cutover.

Until all five pass, `numReplicas` remains one and `node dist/server.js` remains the sole production start command.
