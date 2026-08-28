# ShinobiX verified architecture map

Audit snapshot: 2026-08-27, commit `03d433fc90abd6879c242aa59bc24bbe697094ad`, branch `codex/pvp-ci-live-20260826`.

This map was built from executable entrypoints, imports, route registration, storage implementations, tests, and build/deployment configuration. Planning documents were not treated as proof. The working tree contained unrelated user changes while the audit ran; those files were not modified by this phase.

## Runtime topology

```text
Browser
  React 19 / Vite SPA
  shinobij.client/src/main.tsx -> App.tsx
       |                         |
       | HTTP through authFetch | Socket.IO client
       v                         v
Railway Docker container: one Node process today
  server.ts -> dist/server.js
  Express 5 + Socket.IO on the same HTTP server
       |
       | Vercel-shaped api/** handlers mounted on both /path and /api/path
       v
  api/_storage.ts (KvLike abstraction)
       |
       +-- pg Pool -> public.kv_store (preferred on Railway)
       +-- Supabase service-role REST/RPC fallback
       +-- memory backend for tests/QA
       +-- dormant disk/proxy compatibility routing when explicitly configured
```

The live deployment definition is [`railway.json`](railway.json): Dockerfile build, `node dist/server.js`, `/health`, restart on failure, and one replica. [`app.js`](app.js) is a CommonJS compatibility bootstrap for the retired Passenger path and local `npm start`; Railway does not execute it.

Repository scale at this snapshot: 1,297 files under `api/`, 2,316 under `shinobij.client/src/`, 43 under `shared/`, and 1,050 discovered `*.test.*`/`*.spec.*` files.

## Process startup and shutdown

| Stage | Verified implementation | State/effect |
| --- | --- | --- |
| Frontend bootstrap | `shinobij.client/src/main.tsx` | Imports global CSS, installs the image guard, performance telemetry, optional Sentry, device-tier detection, service worker wiring, `ErrorBoundary`, `App`, and live-capability handling. |
| Backend bootstrap | `server.ts` | Creates Express, installs middleware, imports every handler explicitly, creates the HTTP server, attaches Socket.IO, serves the built SPA, and listens on `PORT` (default 3000). |
| HTTP middleware | `server.ts`, `api/_http-security.ts`, `api/_body-limits.ts`, `api/_utils.ts`, `api/_launch-controls.ts` | Security headers, route-aware JSON limits, request IDs/telemetry, shared CORS policy, response compression except SSE, launch-control evaluation, and sliding player-token refresh on unsafe methods only. |
| Realtime startup | `api/_realtime/socket.ts` | Socket.IO shares the HTTP server; allowed origins reuse the HTTP origin predicate and inbound buffers are capped at 64 KiB. |
| Soft-state recovery | `api/_realtime/presence-snapshot.ts` | Restores a bounded identity/sector presence snapshot, then snapshots every 30 seconds. |
| Game loop | `api/_realtime/game-loop.ts` | One-second in-process sweep for stale presence, sleeper materialization callbacks, and live pet-duel invitation/stall cleanup. |
| Scheduled jobs | `api/cron/_scheduler.ts`, `api/cron/_job-lease.ts` | In-process timers acquire distributed `cron:lease:*` KV leases before work. |
| Shutdown | `server.ts` | Stops loop/scheduler/snapshot timer, persists a final presence snapshot, closes Socket.IO, closes the PostgreSQL pool, drains HTTP, and retains a four-second backstop. |

## HTTP request lifecycle

1. Express receives the request and applies the global origin, body-size, request-ID, launch-control, compression, and telemetry policy.
2. `server.ts` calls a manually imported Vercel-shaped handler. The `route()` helper mounts each handler on both its bare and `/api` path while retaining the real Express request object for SSE/disconnect listeners.
3. The handler checks the method, calls `cors()`, parses/bounds input, authenticates with `authedPlayer`, `authedPlayerOrAdmin`, or an admin helper, and applies an in-memory or KV-backed rate limit as selected by that route.
4. Domain code derives authoritative values from saved/session state. Sensitive read-modify-write paths use exact compare-and-set, a per-key lock, an idempotency receipt, or a durable settlement workflow.
5. State is written through `KvLike`; notifications or Socket.IO events are emitted as hints/projections after or around the authoritative write according to the endpoint contract.

`server-routes.test.ts` checks both directions of the otherwise manual wiring: API handlers must be registered, and client-called endpoints must be mounted.

## Authentication and identity

| Boundary | Verified owner | Behavior |
| --- | --- | --- |
| Player HTTP authentication | `api/_auth.ts`, `api/player-auth.ts` | Preferred credential is a 24-hour HMAC token binding canonical name, expiry, and session epoch. Epoch rotation revokes sessions. Legacy password verification is the fallback and uses scrypt. Claimed route/header identity must match the token identity. |
| Player rate limiting | `api/_auth.ts`, `api/_ratelimit.ts` | Password failures have an IP window; gameplay routes select in-memory or durable KV limits. Identity is included where required. |
| Admin authentication | `api/_auth.ts`, `api/admin-auth.ts` | Signed full/content admin tokens are supported; configured passwords are constant-time compared. Strict token-only mode is configurable. |
| Socket authentication | `api/_realtime/socket.ts` | Handshake credentials are converted to the same request shape and passed through `authedPlayerOrAdmin`; canonical identity is stored on `socket.data` and cannot be selected by later events. |
| Google/guest entry | `api/auth/google/**`, `api/_google-auth.ts`, `api/_guest-gate.ts` | Additional account-entry mechanisms converge on the same slug-keyed save and session-token model. |

If `SESSION_SECRET` is absent, token issuance is unavailable and the server warns; password fallback remains, while passwordless account creation fails closed.

## Persistence

### Physical schema

The application uses one current application table: `public.kv_store` in [`supabase-schema.sql`](supabase-schema.sql), with columns for key, JSONB value, expiration, and update time. It has expiry and key-pattern indexes and row-level security. `authenticated` has no table grant; a narrow `anon` read policy is retained for explicitly permitted public projections. Service-role-only functions provide atomic operations:

- `public.kv_set_nx`
- `public.kv_compare_set`
- `public.kv_incr`
- `public.kv_hset`
- `public.kv_hdel`
- `public.kv_delete_expired`

`pg_cron` invokes expiry cleanup. The checked-in migrations add the compare-set function and revoke legacy Chronicle anonymous read access.

### Storage implementation

[`api/_storage.ts`](api/_storage.ts) owns `KvLike` and all backend selection. On Railway, a PostgreSQL URL selects the direct `pg` pool. Its default maximum is 15 connections per Railway process (5 otherwise), with 30-second idle timeout, 15-second acquisition timeout, and 30-second statement/client query timeout. `PG_POOL_MAX` and `PG_STATEMENT_TIMEOUT_MS` override these defaults.

The storage layer also contains:

- a bounded 5,000-entry process-local read cache;
- explicit cache exclusions for authoritative/mutable key families;
- atomic set-if-absent, compare-set, increment, hash update/delete, and compare-delete methods;
- expiration enforcement in reads plus database cleanup;
- Supabase service-role fallback and a memory implementation for tests;
- opt-in compatibility overlay/proxy routing that is dormant in the active Railway configuration.

### Logical key families

The table stores typed logical records rather than relational domain tables. Important verified families include:

| Key family | Owner / purpose |
| --- | --- |
| `save:<player>` | Player save envelope; `api/save/[name].ts`, save locks, versioning, and the state-ownership manifest control generic writes. |
| `pvp:<battleId>` | Authoritative PvP session; exact session mutation, publication fences, pending pointers, receipts, and recovery records live in adjacent `pvp:*` families. |
| `solo-pve:*` | Expiring Solo PvE session, entry, event, and settlement state. |
| `tower:*` and tower party/lease families | Tower, Spire, Clan Boss, 2v2, and party session state. |
| `hollow-gate:*` / `hg-*` | Parent run, combat binding, seals, paid markers, and child combat receipts. |
| `game:village-state:*`, `world:territory:*`, war/clan keys | Shared village, clan, war, territory, treasury, and objective state. |
| `content:*` | Canonical published admin content with a 60-second process cache and dual-read compatibility. |
| `forged-item:<id>` | Permanent recovery registry for named forged gear definitions. |
| `economy-tx:*`, `economy-settlement:*`, `econ:*` | Cross-key transaction state, durable settlement/reconciliation state, and best-effort economy telemetry. |
| `cron:lease:*` | Distributed scheduled-job ownership. |
| `presence:snapshot` | Short-lived identity/sector soft-state restart bridge. |

## Realtime and in-process state

### Presence

`api/_realtime/socket.ts` and `online-store.ts` own current online presence. A connected socket joins `user:<canonical-name>` and a sector room. Client events are `presence`, `presence:move`, and `presence:request`; server projections include `presence:sector`, `presence:join`, `presence:update`, `presence:move`, `presence:leave`, and targeted `presence:kick`.

Presence payloads are slimmed and identity-bound. The server constrains the sector and lets a durable travel lease override client location. Ordinary updates are throttled to one application per second with a trailing coalesced update; moves use an 80 ms gate. Disconnect does not immediately delete presence; the 90-second offline window and sweep provide reconnect tolerance. The persisted snapshot contains identity/sector only and cannot restore a row older than that window.

### Live pet duel

`api/_realtime/pet-duel-socket.ts` and `pet-duel-session.ts` implement the memory-only live cinematic duel. Client events are `petduel:result`, `challenge`, `accept`, `decline`, `input`, `progress`, `finished`, and `resign`. Server events are `sync`, `over`, `declined`, `error`, `invite`, `start`, `rejected`, and `peerGone`.

Challenge and accept both reload an authoritative carried-pet roster from the save. The server binds commands to the authenticated side, enforces sequence/tick bounds, replays the lockstep input log, and provides reconnect synchronization. Live PvP pet duels intentionally pay no rewards. Session and room state are lost on process restart and are not shared across replicas.

### Realtime authority boundary

Sockets carry presence, invitations, lockstep commands, and change hints. HTTP/KV remains authoritative for durable notifications and all persisted rewarded combat. No Socket.IO adapter is configured; rooms and live duel sessions are process-local.

## Background work

| Process | Cadence | Work | Cross-replica control | Persistence/restart behavior |
| --- | --- | --- | --- | --- |
| Realtime game loop | 1 second | Sweep stale presence, invoke sleeper materialization for removals, sweep pet-duel invitations and silent peers. | None; process-local by design. | Presence has a bounded snapshot; socket rooms and live duels do not survive. |
| Presence snapshot | 30 seconds | Serialize current valid identity/sector rows. | None. | Single short-lived `presence:snapshot` record; graceful shutdown writes once more. |
| Settlement reconciliation | 5 minutes | Reconcile stale durable economy settlements. | Local running flag plus four-minute distributed lease. | Durable records survive restart. |
| Clan Boss party sweep | 5 minutes | Repair/discover/remove party registrations and terminal indices. | Local running flag plus four-minute distributed lease. | Operates on KV records. |
| Territory lifecycle | 5 minutes | Recover/release breaches, suspend/resume rewards, release inactive/missing-clan ownership. | Local running flag plus four-minute distributed lease. | Operates on KV records. |
| Mercenary automation | 10 minutes | Advance automatic mercenary work. | Nine-minute distributed lease. | Operates on KV records. |
| Daily scheduler | 03:00 UTC | Save snapshots, ranked rollover, Clan Boss, village-war daily work, Kage inactivity, guest sweep, era work. | Twenty-hour distributed lease per job. | Markers enable a 26-hour boot catch-up check; snapshot job has a five-minute work budget. |
| Clan Boss weekly kick | Startup/scheduled lease | Starts/repairs weekly boss work. | Week-derived distributed lease. | KV-backed boss state. |

Successful scheduled jobs retain their lease until TTL to deduplicate slightly delayed replicas. Failed jobs compare-delete only their exact owner token; storage failure fails closed. The one-second game loop is timer-based and does not await its async sleeper-materialization callback, so that callback deserves measurement before increasing per-tick database work.

## Domain map

All persisted domains below ultimately use `public.kv_store` and the functions above; the table lists the logical owners and cross-domain dependencies rather than repeating that physical table in every row.

| Domain | Entrypoints and primary files | Verified rule/state owners | Important dependencies |
| --- | --- | --- | --- |
| Shared shinobi combat | `api/combat-core/**` | `formulas.ts`, `grid.ts`, `aoe.ts`, `resources.ts`, `cooldowns.ts`, `statuses.ts`, `resolveJutsu.ts`, `resolve-jutsu-action.ts`, `n-actor.ts`, `cast-reducer.ts`, `events.ts`, `companion.ts` | PvP tags/catalogs; shared resource and turn constants; mode adapters. |
| PvP / challenge / ranked / world PvP | `/pvp/session`, `/pvp/move`, `/pvp/claim-rewards`, `/pvp/ranked-queue`, `/pvp/ranked-2v2`, chat/spectate/stream/history/bounty routes; `api/pvp/**` | `session.ts` constructs and publishes sealed sessions; `move.ts` authoritatively validates/mutates combat through exact session mutation; reward modules settle terminal outcomes. | Saves, challenges, ranked admission, war/clan reservations, pending-session pointers, combat core, realtime hints. |
| Solo PvE / sparring / story combat / AI | `/solo-pve/action`, `/solo-pve/state`, `/missions/ai-fight-start`, story and world combat-start routes; `api/solo-pve/**`, `api/_authoritative-pve.ts` | `_action-service.ts` serializes/idempotently executes commands; `_engine.ts` owns Solo turn/AI policy while reusing PvP jutsu effects and combat-core rules; `_store.ts` owns session persistence. | PVE settlement, AI profiles/difficulty, Hollow Gate directives, saves, combat locks. |
| Towers / Spire / party / Team Arena 2v2 | `/towers/*`; `api/towers/**` | `_engine.ts` owns N-actor scheduler, tactical objects/hazards, basic actions, AI, objectives, and team victory. It calls the shared N-actor reducer and canonical PvP jutsu resolver through `clanBossAdapter.ts`. `_session-mutation.ts` serializes writes. | Saves, entry fees/recovery, party/AFK leases, combat core, realtime kicks. |
| Bosses | `/weekly-boss`, `/world-crisis*`, story boss start; root boss helpers and Solo/Tower entry adapters | Boss admission/reward modules seal context; actual shinobi combat runs through Solo PvE or Tower according to the executable runtime registry. | Authoritative PVE, durable receipts, world state. |
| Clan Boss | `/clan-boss/get`, `/party`, `/assault-start`, `/assault-settle`; `api/clan-boss/**` | Tower session is combat authority; Clan Boss modules own weekly encounter, party, contribution, aggregate state, and settlement. | Tower engine/store, clan membership/roles, distributed scheduler. |
| Hollow Gate | `/hollow-gate/*`; `api/hollow-gate/**`, shared Hollow Gate contracts/director | Parent run ledger owns rooms, augments, consumables, keys, child bindings, and parent settlement. Shinobi children use Solo/Tower; pet children use a sealed cinematic proof. | Saves, village unlock, combat child receipts, pet battle authority. |
| Jutsu and combat content | `api/pvp/_jutsu-catalog.ts`, `_legacy-jutsu-catalog.ts`, `_tags.ts`, `api/_admin-jutsu-catalog.ts`, `api/_content-store.ts` | Built-in/legacy catalogs plus canonical published content/tombstones. `jutsu-parity-inventory.ts` inventories executable behavior. | Combat core, AI profiles, admin publishing, save loadouts. |
| Stats, XP, rank, resources | `api/_xp-engine.ts`, `_stat-growth.ts`, `_jutsu-points.ts`, `_combat-resources.ts`, `combat-core/formulas.ts` | XP/level/stat ledgers and caps are server functions; combat numeric projections live in combat core. | Training, missions, rewards, save sanitizer, client parity tests. |
| Equipment and inventory | Save handler/state-ownership manifest; `api/pvp/_item-catalog.ts`, `api/inventory/**`, `api/_forged-item-registry.ts` | Generic save enforces equipment ownership/slot shape. Dedicated locked settlement routes grant, remove, consume, sell, or open items. Combat seals equipped items into sessions. | Shop catalog, crafting, admin content, economy receipts, saves. |
| Bank and shop | `/bank/transfer`, `/bank/claim-interest`, `/shop/purchase`, `/shop/sell`, `/shop/settle`; `api/bank/**`, `api/shop/**` | Dedicated authenticated handlers and pure settlement functions calculate balance/item effects. Current shop catalog merges built-ins, published custom content, and tombstones. | Save locks/versioning, settlement receipts, economy telemetry, village/clan discounts. |
| Currency and settlements | `api/_economy.ts`, `_economy-tx.ts`, `_economic-receipt.ts`, `_durable-settlement.ts`, `_cross-key-settlement.ts` and domain handlers | Domain endpoints author balances. Receipts/locks/transaction records provide replay and partial-failure control; `recordEconomyTxn` is best-effort telemetry rather than balance authority. | Scheduler reconciliation, admin economy views, saves/shared treasuries. |
| Training and progression | `/training/start`, `/complete`, `/jutsu-ryo`, jutsu speedup/seals, exams, hunter/profession/awakening/achievements routes | Start endpoints seal terms/tokens; completion routes lock the save and derive elapsed reward. XP/stat/rank functions remain server owned. | Save versions, timers, economy sinks, entitlements. |
| Clans and clan missions | `/clans/*`, `/clan/*`, `/clan/mission/claim`, seal-pool, treasury, territory, exchange, chat, mentor, pet escort | Clan records and member saves are cross-validated; permissions are checked in handlers. Shared-resource writes use clan/treasury locks. | Saves, economy, territory, missions, realtime notifications. |
| Village war / sector war | `/village/*`, `/war/*`, `/world-state`; `api/_sector-war*`, `_war-*`, `_territory-*`, village handlers | Server owns declarations, reservations, damage/receipts, daily lifecycle, role evidence, treasury/supply, and territory transitions. Combat is delegated to PvP, Solo, Tower, Chronicle, or Pet Showdown by mode. | Scheduler, clans, villages, multiple combat engines, world projection. |
| Pets | `/pet/*`, `/pet-ladder`, `/arena/lobby`; `api/pet/**`, realtime duel files | Showdown, Warfront, Gauntlet grid, cinematic duel, breeding, sanctuary, evolution, acquisition, and ladders have separate explicit authority engines. | Saves, item/economy rewards, parent modes, Socket.IO for live cinematic PvP only. |
| Crafting | `/craft/forge`, `/craft/named`, elemental-core routes; `api/craft/**`, shared named-forge economy | Pure recipes calculate material consumption/result; authenticated handlers lock/version saves. Named gear is written to the permanent forged-item recovery registry. | Inventory, item catalogs, currencies/materials, equipment. |
| Missions | `/missions/*`; `api/missions/**` | Admission endpoints mint/seal combat or activity proof; report/claim endpoints validate proof and settle idempotently. Daily/weekly state is persisted. | Combat engines, progression, economy, world state. |
| Story | `/story/settle`, `/boss-start`, `/spar-start`, `/interlude`, `/road-event`; story records/content | Server gates starts/settlement and delegates combat to Solo PvE; generated story content is build-checked. | Saves, missions, Solo PvE, authored content. |
| Card Clash | `/card-clash/*`; `api/clan/war/_card-catalog.ts`, Card Clash handlers/client engine | Queue/match state and server AI/war settlement are distinct from shinobi combat. Pack/starter/progression routes bridge owned cards and the main save. | Saves, clan/sector war, shop card catalog, reward receipts. |
| Character/account creation and save | `/player-auth`, `/save/:name`, Google/guest/account status/delete routes; `api/save/**`, `api/_auth.ts` | Account auth records and `save:<slug>` are canonical. `SAVE_FIELD_CONTRACT` classifies each accepted field; dedicated domain endpoints own high-risk mutations. `_saveVersion` provides optimistic concurrency. | Every player domain, content mirrors, elapsed-state settlement. |
| Admin/creator/content | `/admin/*`, `/generate-image`, `api/_content-store.ts`, admin catalog modules | Server admin auth distinguishes full/content scope. Published content is canonical `content:*`; legacy admin save slots remain dual-read mirrors. Review/grant/reset/migration endpoints are explicitly registered. | Saves, R2/images, catalog consumers, audit log. |
| Chat/messages | `/messages`, `/village/chat`, `/clan/chat/*`, `/pvp/chat` | Handlers authenticate/authorize by relevant participant or membership and persist bounded message projections. | Saves/clans/villages/PvP sessions; realtime may notify but is not the durable source. |
| Presence | Socket events plus `/player/heartbeat`, travel/challenge/player interaction routes | Auth-bound `onlineStore` is live soft-state owner; durable travel/battle locks override client claims. | Socket rooms, saves, sleeper camps, world/PvP gating. |

## Runtime-mode authority registry

[`shared/runtime-mode-registry.ts`](shared/runtime-mode-registry.ts) is executable and [`docs/generated/runtime-mode-registry.md`](docs/generated/runtime-mode-registry.md) is generated from it. The audit executed the registry: 61 modes total, 56 `match`, three `surface-gap`, one `defect`, and one `owner-decision`.

- `tactical-arena`: no mounted standalone authority; intended Warfront family.
- retired `pet-arena-ai-1v1` and `pet-arena-ai-2v2`: new admission is absent/fail-closed; intended cinematic-duel family.
- `pet-ranked-legacy-compat`: known defect; retained client presentation uses cinematic replay while settlement replays the legacy engine. Current Pet Ladder admission does not enter this path.
- `hollow-gate-pet-cinematic`: current exact-proof compatibility is coherent, but the long-term replatform owner is an explicit product decision.

These are recorded facts, not a recommendation to merge intentionally separate combat families.

## Build, test, and release path

- Root `npm run build` performs server TypeScript compilation, generated-story validation, client typecheck/Vite build, distribution verification, and build-size checks.
- Docker uses Node `22.23.1`, installs locked root/client dependencies in a builder stage, performs the fresh build, and copies only production dependencies plus `dist/` and the SPA output to the runtime stage.
- `scripts/run-tests.mjs` auto-discovers colocated tests across API, shared, client source/scripts, and an explicit root list.
- CI shards server contracts, runs simulations and operational checks, audits root/client dependencies, builds immutable artifacts, runs release certification and a concurrency smoke, and exercises responsive/accessibility, combat-layout, Warfront, and live village-store browser suites. Separate CodeQL and visual workflows also exist.
- Operational scripts cover deployment/rollback checks, backups, restore drills, release health/certification, data integrity, currency-ledger audit, PvP balance, Clan Boss balance/operation, and configurable load soak.

## Verified architectural constraints

1. One Railway replica is the current deployed topology, but scheduled durable work is already lease-protected.
2. Socket rooms, online presence, live pet-duel sessions, and in-memory rate/cache state are not horizontally shared.
3. Rewarded combat state is KV-backed and uses mode-specific receipts/settlement paths; live Socket.IO pet PvP is intentionally unrewarded and ephemeral.
4. `public.kv_store` provides atomic single-key operations, not relational multi-row transactions. Cross-key invariants are implemented with deterministic locks, receipts, ordered writes, and reconciliation records.
5. `App.tsx` remains a large frontend orchestrator. Its line-budget ratchet is an active CI control and was already failing in this dirty snapshot; this audit did not change it.
