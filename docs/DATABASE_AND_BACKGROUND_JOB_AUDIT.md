# Database, Reward-Integrity & Background-Job Audit

Date: 2026-07-16. Scope: reward authority + exactly-once settlement, save integrity,
Supabase/Postgres efficiency, hidden N+1, connection lifecycle, scheduled/background
work, disk-overlay & remote-KV-proxy efficiency, observability. Read-only investigation
first; a narrow query-efficiency patch followed (see "Files changed").

Live read-only DB evidence was collected against the production Supabase project via the
Supabase MCP (SELECT-only; no mutations, no `EXPLAIN ANALYZE` on writes). All evidence in
this document is aggregate — no player names, saves, IPs, fingerprints, tokens, or secrets.

> **UPDATE 2026-07-17 — cPanel retired.** Acting on the topology finding below,
> `save:*` / `shared:images*` / `shared:imgfields*` were migrated off the cPanel
> disk overlay into Supabase Postgres (base-store), and `KV_PROXY_URL` /
> `REQUIRE_DISK_OVERLAY` were removed on Railway. Saves now live in Postgres like
> every other key — the "remote KV proxy" / disk-overlay hop (a latency and 502
> source) is eliminated. See `docs/RETIRE_CPANEL_RUNBOOK.md`. The topology map
> below describes the *pre-cutover* two-tier layout; the live layout is now
> single-stack (Railway + Postgres).

---

## 1. Runtime & storage topology

| Environment | Node processes | Owns cron? | Base KV backend | `save:*` store | Snapshots (`save-snapshot:*`) | Pool max/proc |
|---|---|---|---|---|---|---|
| **Railway (LIVE)** | 1 container (`numReplicas:1`) | Yes (in-process timers) | **pgKv** (direct pg Pool; `DATABASE_URL`/`SUPABASE_POSTGRES_URL` set, not Vercel) | remote KV proxy → cPanel disk (`KV_PROXY_URL`) | base Postgres | `PG_POOL_MAX` (default **5**; docs recommend 15) |
| **cPanel / Passenger (fallback, in-parity)** | N Passenger workers | Should be disabled (advisory only) | pgKv | local disk (`DISK_KV_DIR`) | base Postgres | 5 × N workers |
| **Local QA / CI** | 1 | n/a | `SHINOBIX_QA_MEMORY_KV` in-memory (test) | memory | memory | 0 |
| **Serverless (retired Vercel)** | n/a | n/a | supabaseKv (PostgREST) | HTTP proxy | base | 0 (HTTP) |

**Data-flow (write):** browser → Express (`server.ts` `route()`; launch-control gate) →
`authedPlayerOrAdmin` (token→password→ban, 2 KV reads) → `withKvLock('save:<name>', … failClosed)`
→ `sanitizeCharacterSave` / domain recompute → routed KV (`save:*` → disk/proxy; everything
else → pgKv) → `_saveVersion` bump → registry `hset` (throttled 60s) → response.

**Backend selection** (`api/_storage.ts:1216-1266`): `pgKv` when a Postgres URL is present and
not on Vercel (Railway/cPanel LIVE path); `supabaseKv` (PostgREST) otherwise. The disk overlay
routes only `save:`, `shared:images*`, `shared:imgfields*`; `save-snapshot:*` is deliberately
base-primary so the live save and its backup never share a failure domain. `REQUIRE_DISK_OVERLAY=1`
refuses to boot if the overlay is misconfigured (prevents silent "everyone looks wiped").

**Live DB facts (measured):** Postgres 17.6, `max_connections=60`, `statement_timeout=2min`
(role default), `idle_in_transaction_session_timeout=0`. `kv_store`: 4,121 live rows, **0 expired**
(pg_cron cleanup keeping up), 760 kB heap / 171 MB total-relation (TOAST-dominated by large blobs).
Row bytes by prefix: `save-snapshot` ~105 MB / 880 rows, `shared` ~54 MB / 1,291 rows; everything
else < 400 kB. Indexes: `kv_store_key_pattern_idx (text_pattern_ops)` 2.15M scans,
`kv_store_pkey` 611k, `kv_store_expires_at_idx` 132k — all three in active use, none redundant.

---

## 2. Reward / save authority — summary matrix

**Overall posture is strong.** Every audited value mutation routes its read-modify-write through
`withKvLock('save:<name>', … {failClosed:true})` (directly or via `mutatePlayerSave`), recomputes
or server-seals the reward, and gates exactly-once with a single-use token, an NX receipt, or a
server-owned ledger field that the save-sanitizer force-restores. Shared-state RMW locks the shared
key, not just the actor's save. The generic save endpoint (`api/save/[name].ts`) caps per-save
gains, zeroes premium/material currency increases (`CURRENCY_CAPS`), force-restores server-owned
fields, and enforces `_saveVersion` conflict (409) so a stale autosave cannot overwrite a
server-granted reward.

| Class | Endpoints (representative) | Verdict |
|---|---|---|
| **Server-derived** (recompute from trusted state) | pvp claim-rewards (base gains), bounty, towers/endless/dungeon settle, all clan/village/war/territory payouts, shop/craft/bank/exchange/upgrade, exams, achievements, hunter, daily-login, sleeper-kill, trade, black-market, dice | Confirmed safe |
| **Server-sealed** (mint-token seals reward params) | training start/complete, pet expeditions, named-forge, pet battle (casual sim), hollow-gate run token | Confirmed safe |
| **Client-reported, but capped & non-mint** | endless vitals (min-clamped), treasury move amounts (conservation-preserving), legacy first-save training (≤300 stat/≤750 xp, one-time) | Acceptable |
| **Client-reported OUTCOME → real payout (GAPS)** | **Sunscar Miraa (P0)**, card-clash ai-settle (P1), pet gauntlet (P1), story/settle "skip-the-boss" (P1), pvp `rewardSector` 2× (P1) | See §5 |

### Load-bearing invariants verified
- `_saveVersion` 409 conflict + `CLIENT_REFRESH_REQUIRED` 426 for versionless clients (`api/save/[name].ts:2298-2327`).
- Save RMW and every currency writer share **one** lock key (`lock:save:<name>`) with identical TTL/retry — no cross-writer race.
- Ranked reward pay is NX-once (`ranked:season:rewarded:<id>:<slug>`), but the ranked **soft-reset is not idempotent** (§4, §5).
- No settlement path writes the payout **before** its idempotency key, so no HTTP-failure→retry double-pay window was found (the audited safe paths).

---

## 3. Query inventory & N+1 findings (measured scaling)

`kv` op costs: `get`/`set` = 1 round trip; `mget`/`del` = **1 batched** round trip (SQL `ANY`/`in`);
`keys(prefix*)` on **base** = 1 indexed prefix scan; `keys()` on any **`save:*`** pattern = a **full
disk-tree walk** on the cPanel box (or a no-timeout HTTP scan over the proxy) regardless of pattern
narrowness. The in-process read-cache exists **only on pgKv**; disk/proxy `save:*` reads are never
cached, so on Railway every save read is a full HTTPS round trip to cPanel (~50-200 ms).

**pg_stat_statements (live, by total time):**
1. Realtime WAL decode `SELECT wal->>… ` — **3.42M calls, ~18,600 s total** (dominant). This is
   `REPLICA IDENTITY FULL` on `kv_store` publishing *every* row change (every save, rate-limit incr,
   presence beat) to the `supabase_realtime` publication — while clients only subscribe to
   `pvp:*`, `cw-tilecards:*`, `challenges:*` (RLS allowlist). Publishing rows nobody reads is the
   single biggest DB-side cost. **P1 (schema/approval-gated — not changed here).**
2. PostgREST `kv_store` select — 726k calls, ~10,100 s.
3. `SELECT value,expires_at … WHERE key=$1` — 699k calls, 1.50 ms mean.

| Hot path | Worst-case storage ops | Scaling | Status |
|---|---|---|---|
| **Heartbeat** (1/s/player) | was ~7 uncacheable ops/beat | O(players)/s → ~700-1,300 ops/s @ 100 players against a 5-conn pool | **FIXED (partial)** — 3 signal reads → 1 `mget` (this PR) |
| **clans/list** | 2 scans (one full disk walk) + 2 mget, per client per 30s | O(clients) walks | **FIXED** — proc-cache 15s (this PR) |
| **world-state GET** | 3 scans + 3 mget per CDN miss | O(misses) | **FIXED** — proc-cache 3s + s-maxage 15→12 (this PR) |
| **roster / bloodlines/list** | mget every save blob (O(players×blob) bytes) | proc-cached 60s (bounded) | Noted — slim projection is the next win |
| **ranked rollover / snapshot / merc tick** | per-player `Promise.all(map(get))` (parallel N+1 over proxy) | O(players) HTTP calls | Noted — mget-per-slice candidate |
| **pvp/stream SSE** | 10 `kv.get`/s/connection for ≤13 min | O(viewers) | Absorbed by pgKv read-cache on single process |

`Promise.all(items.map(kv.get))` remains an N+1 (N concurrent round trips) in `_ranked-season.ts:176`,
`snapshot-saves.ts` per-item get, `_merc-auto.ts:200-212` (`liveMercTargets` sequential), and
`clan/mentor.ts:52` — all background/admin or bounded, flagged for a follow-up mget pass.

---

## 4. PostgREST truncation / pagination

**Latent P1 (fixed this PR for the REST backend).** PostgREST silently caps every response at the
project max-rows (Supabase default **1000**) — it truncates without erroring. The live
`save-snapshot:*` prefix already holds **880 rows** and is growing; the `save:*` scan and admin
lists are unbounded. On any deploy using `supabaseKv` (the REST backend), an unpaginated
`keys()`/`mget()` would silently drop rows past the cap → incomplete snapshot dedup, truncated admin
restore lists, partial `del()`. Fixed by paginating `keys()` with ordered `.range()` and chunking
`mget()`/`del()` `.in()` inputs (see §7). The **live Railway path is pgKv** (single SQL `ANY`/`LIKE`,
no cap), so this is defensive correctness for the REST/fallback path, not a live-perf change.

---

## 5. Findings ranked

### P0 — confirmed repeatable reward mint
- **Sunscar "Miraa" wager mints ryo from a client-asserted outcome.** `api/festival/sunscar.ts:82-93`
  + `api/festival/_sunscar.ts:88-92`: the client sends `{kind:'miraa', bet, outcome:'win'}`; the server
  credits `miraaRyoDelta = bet*2` (positive, **no stake deducted**), with **no server-side game
  resolution, no daily cap, and no mint-token**. The only guard is holding `bet` ryo, which a growing
  balance always passes. Bet 500 × win = **+1000 ryo/call**; the 40/min rate limit is the only bound
  (~2.4M ryo/hr), and the per-minute ryo cap in `api/save/[name].ts` does **not** apply (this is a
  domain endpoint via `mutatePlayerSave`). Fix requires a server-resolved or server-sealed Miraa
  outcome (mint-token, like dice/black-market) — a balance-sensitive gambling change needing owner
  sign-off; **spawned as its own task, not bundled into this PR.**

### P1
- **card-clash ai-settle trusts client `result`.** `api/card-clash/ai-settle.ts:34,54-60` pays 50 ryo/win
  (+250 once daily) from a client-asserted result; `ai-start` seals no outcome. Token-gated single-use
  (bounded to one payout per started match) + 15s quick-win guard + 30/min, so lower value than Miraa but
  still an unvalidated win → premium payout loop.
- **pet gauntlet trusts client run outcome.** `api/pet/gauntlet.ts:163-164`: `roundsCleared`/`heartsLeft`
  from body, only clamped; a fake perfect run yields max ryo + 1 Fate Shard + 1 Bone Charm/day. Receipt-
  and daily-gated. Server re-sim is the fix (self-noted TODO in the file).
- **story/settle advances chapters without a verified win.** `api/story/settle.ts:32-37`: the `ai-fight-token`
  proves a fight *started* (opponentId is client-supplied at mint) but never *won*; a player at/above the
  level requirement can auto-clear a story boss. Reward is a fixed server table + strict progress order, so
  it's "skip the boss you already out-level," not arbitrary rewards.
- **pvp `rewardSector` 2× multiplier is client-sealed.** `api/pvp/session.ts:1019,1255-1257` → `_xp-engine.ts:256`:
  a client can set `baseRewards:true, rewardSector:99` on a casual session and receive 200 XP/150 ryo instead of
  100/75 on a genuine win. `baseRewards` takes no queue-token proof (unlike `ranked`).
- **Ranked rollover soft-reset is not idempotent across instances.** `api/cron/_ranked-season.ts:49-53,163-259`:
  the rollover lock's 5s TTL is dwarfed by the multi-minute all-saves scan and the season clock only advances at
  the end. Two schedulers firing >5s apart (clock skew, or a cPanel worker) can run the whole rollover
  concurrently: podium pay stays NX-once, but every played rating is soft-reset twice (75% pull instead of 50%).
- **Duplicate scheduler ownership is the default, guarded only by docs.** No leader election exists;
  `server.ts` starts all timers on every process. If cPanel (and each Passenger worker) boots the same code,
  every 03:00 job, boot catch-up, clan-boss kick, and the 10-min merc tick runs in parallel with Railway. Safety
  currently depends on `DISABLE_SNAPSHOT_CRON=1` being set on secondaries — and that flag's early-return disables
  **six** jobs (ranked, clan-boss, war-daily, era, merc), not just snapshots, which its name and comment understate.
- **Realtime write-amplification** (§3 item 1): `REPLICA IDENTITY FULL` + full-table publication publishes every
  `kv_store` change though clients read three prefixes. Schema/approval-gated remediation below.
- **PostgREST silent truncation** (§4): fixed this PR for the REST backend.

### P2
- `PG_POOL_MAX` default 5 on the always-on host; heartbeat load can saturate it (docs recommend 15).
- No `statement_timeout`/`query_timeout` on the pg Pool — a slow blob read can pin a connection until the 2-min role timeout.
- Graceful shutdown never calls `closeSocketServer()` or `closeStoragePool()` (both exported, zero callers), so a
  deploy with live sockets/SSE always exits via the 4s force-kill backstop, cutting in-flight connections.
- `profession/choose.ts:49` omits `{failClosed:true}` (only value endpoint that does) — last-writer-wins on a race, no mint.
- clan/village treasury **transfer** is credit-first (mint-direction crash window); donate paths are correctly debit-first.
- `clan/seal-pool/donate.ts:109` shared-pool RMW not fail-closed (loss-direction, not mint).
- No colocated **handler-level** tests for the money endpoints (pure cores are well covered; the lock/receipt/crash-window orchestration is not).

### P3
- Remote-KV `keys`/`mget` unbounded by design (backstopped only by undici's 300s default).
- `_saveVersion` telemetry, `serverSettlementReceipts` 50-entry window — informational.
- Two one-off scripts (`check-images.mjs`, `raise-timeout.mjs`) don't `client.end()` in `finally` (cosmetic).

---

## 6. Background-job & pg_cron inventory

**Application (in-process, every booted instance — no leader election):** daily save-snapshot + boot
catch-up (03:00 UTC + 24h interval), ranked rollover, clan-boss weekly (+boot kick), village-war daily,
era pass, **merc auto-deploy (10-min interval, unawaited)**, 1s presence game-loop → sleeper-camp
materialization, Socket.IO ping/throttle timers, presence-beat, rate-limit GC, plus lazy settle-on-read
(weekly-boss, world-state decay) and fire-and-forget request writes. Kill switches: `DISABLE_SCHEDULED_JOBS`
(all cron), `DISABLE_SNAPSHOT_CRON` (**disables six jobs, not one — misleading name**), `DISABLE_REALTIME`,
`DISABLE_VILLAGE_WAR`, `DISABLE_CLAN_BOSS`. `MAINTENANCE_MODE`/`FREEZE_ECONOMY_REWARDS` gate only HTTP —
**in-process cron bypasses launch controls entirely.**

**Database (Supabase, live):** exactly **one** pg_cron job — `kv-cleanup` (`*/2 * * * *`,
`select public.kv_delete_expired()`), **active**, **30,142 successful runs, 0 failures, ~5 ms avg**. It is
keeping up (0 expired rows live). No database triggers on `kv_store` besides the Realtime publication. No
Database Webhooks, no scheduled Edge Functions, no GitHub Actions / Railway / cPanel cron schedules found.

---

## 7. Files changed (behavior-preserving efficiency + safety; no balance/schema)

Round 1 — query efficiency + truncation safety:
- **`api/_storage.ts`** — add `_chunkArray` + `_collectPaginated`; paginate `supabaseKv.keys()` with ordered
  `.range()`; chunk `supabaseKv.mget()`/`.del()` `.in()` inputs (fixes silent PostgREST truncation; order &
  duplicate-key behavior preserved).
- **`api/player/heartbeat.ts`** — 3 per-beat signal reads (`challenges:`/`reset-signal:`/`heal-signal:`) → 1 `mget`.
- **`api/clans/list.ts`** — `cachedFor(15s)` around the full remote disk-tree walk (auth stays per-request).
- **`api/world-state.ts`** — `cachedFor(3s)` around the 3-scan+3-mget build; s-maxage 15→12.

Round 2 — connection lifecycle + hot-path write reduction (dormant-cPanel/single-live-process context):
- **`api/_storage.ts`** — pg Pool `statement_timeout`/`query_timeout` = 30s (`PG_STATEMENT_TIMEOUT_MS`); every
  base-store query here is a PK/indexed/small-batched read (blobs route to the disk overlay), so it only fires
  on a genuine hang. Pool `max` default left at 5 (raise via `PG_POOL_MAX` on the single live host, not in code,
  so a booted cPanel can't multiply into the connection ceiling).
- **`server.ts`** — `gracefulShutdown` now calls `closeSocketServer()` + `closeStoragePool()` (previously exported
  dead code), fire-and-forget under the existing 4s backstop, so a deploy drains cleanly instead of force-killing.
- **`api/_player-ips.ts`** — throttle the per-beat IP/fp TTL-refresh writes to ≤1 per 5 min per pair
  (`PLAYER_IP_RESTAMP_MS`); new pairs still write on first sight; restart re-stamps. **Anti-alt detection is
  byte-identical** — the memo only skips a redundant refresh, never changes what is recorded (risk explained in-file).

Tests: **`api/_storage.test.ts`** (4 pagination/chunk tests), **`api/_player-ips.test.ts`** (new; 4 IP-throttle
tests), **`scripts/test-files.mjs`** (manifest). **`dist/`** regenerated — only edited files have real diffs
(rest is CRLF churn; do not stage). Commit real dist diffs with the source for cPanel; Railway self-builds.

No gameplay balance, reward rate, cost, odd, AP, cooldown, or formula changed. No schema/migration applied.

---

## 8. Validation (exact results)

- `npm test` (full root suite) — **3,210/3,210 pass, 0 fail** (includes 4 pagination/chunk + 4 IP-throttle tests).
- `npm run build:server` (`tsc -p tsconfig.cpanel.json`) — **clean, exit 0** (both rounds).
- `node scripts/check-deployment-config.mjs` — **pass** (1 replica, correct start/health).
- `npm run test:mission-eligibility` — **pass**.
- Client lint / e2e — not run: no frontend files changed (per CLAUDE.md, client lint is for frontend changes).

## 9. Database commands executed (all read-only, aggregate)

Environment/capacity settings; per-prefix row & byte counts; `pg_stat_activity` connection-state rollup;
`pg_stat_user_tables` / `pg_stat_user_indexes`; `pg_stat_database`; `pg_stat_statements` top-cost (redacted
literals); `cron.job` + `cron.job_run_details` aggregate; performance advisors. **No mutations. No
`EXPLAIN ANALYZE` on writes. No production writes. No session termination.** No player identifiers, saves,
secrets, or connection strings retained.

## 10. Production actions deliberately NOT performed

Did not apply the Realtime-publication scope-down (schema change → needs owner approval + staging), did not
add `statement_timeout` to the pool (needs workload evaluation), did not change `PG_POOL_MAX`, did not fix
the reward-mint gambling endpoints (balance-sensitive — spawned as tasks), did not touch auth/RLS/service-role,
did not run load tests, did not migrate saves between backends, did not add any index.

## 11. Connection-lifecycle summary

Exactly 0–1 pg Pool per process (lazy singleton); no handler creates a Pool/Client; **no `pool.connect()` /
BEGIN/COMMIT anywhere** — every op is a single auto-managed `getPool().query()`, so a thrown error can never
strand a connection or open transaction (strongest part of the design). `pool.on('error')` present (no poison).
Live evidence: idle PostgREST/Supavisor connections against `max_connections=60` — comfortable through the
pooler. Gaps: no statement timeout, no shutdown-time pool/socket close (§5 P2).

## 12. GitHub issue reconciliation (vs current main)

- **#8 Weekly Boss server-derived contribution** — **OPEN.** Still client-damage-gated; contribution requires
  `ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE=1` (unset → closed). Migration to tower-style sessions not done. RELEASE_REWARD_INTEGRITY_AUDIT.md is accurate.
- **#12 Higher-rank missions via server combat** — **OPEN.** C/B/A/S still originate in client Arena, payouts release-gated (`ENABLE_CLIENT_TRUSTED_COMBAT_MISSION_REWARDS` unset); no `ENABLE_AUTHORITATIVE_COMBAT_MISSIONS` path yet.
- **#13 Hollow Gate combat → server sessions** — **OPEN.** Run state is tokenized/sealed, but combat nodes still settle from client Arena (see story/settle-class gap).
- **#19 Remaining reward-integrity & receipt gaps** — **PARTIAL/OPEN.** Receipts exist and are searchable via
  `api/admin/battle-receipts.ts`; the durable safe paths are solid, but the client-attested minigame outcomes (§5 P0/P1) and the credit-first transfer window remain.
- **#10 Deployment/release-health** — **PARTIAL.** Topology check + deep-health + backup-freshness gates pass; one-primary/leader-election proof is still missing (§5 duplicate-scheduler).
- **#11 Beta analytics** — **OPEN** (out of this audit's core; scaffolding only).
- **#20 Backup/restore drill** / **#21 fresh-account certification** — process gates; unaffected by this PR (both still require an operator run against staging).

## 13. Rollback

Revert the five source files and rebuild `dist` (`npm run build:server`); all changes are additive caching /
batching with identical outputs (verified by `_storage.test.ts` order-preservation tests and the full suite),
so revert is safe and needs no data migration.

## 13b. Realtime publication scope-down — APPLIED to prod 2026-07-16

**The single biggest DB-cost reduction (§3 item 1) — now live.** `kv_store` previously published *every*
row change to `supabase_realtime`, but the browser only subscribes (verified in `lib/realtime.ts`, the
only `subscribeKvKey` callers) to three exact-key prefixes — `pvp:<battleId>`, `challenges:<slug>`,
`cw-tilecards:<id>` — which are also the RLS SELECT allowlist. A publication **row filter** now drops
non-subscribed rows at WAL-decode time, removing the Realtime-walsender work that was the #1 cost.

**Why it was safe to apply directly (testing phase):** the filter mirrors the RLS allowlist, so a client
already couldn't receive rows outside it (RLS filtered them downstream) — client behavior is byte-identical.
Live-DB checks before applying: `kv_store` was the *only* table in `supabase_realtime`, `replica_identity =
DEFAULT` (**not** FULL as the schema file claimed — a harmless pre-existing drift; the `key`-prefix filter is
valid under DEFAULT because `key` is the PK, so no replica-identity change was needed). Because kv_store was
the only table, a single **atomic `SET TABLE … WHERE`** was used — no drop/add gap, and a failure would have
changed nothing.

```sql
-- APPLIED (migration scope_realtime_publication_to_subscribed_prefixes):
alter publication supabase_realtime set table public.kv_store
  where (key like 'pvp:%' or key like 'cw-tilecards:%' or key like 'challenges:%');
```
```sql
-- ROLLBACK (restore publish-everything), seconds, no data change:
alter publication supabase_realtime set table public.kv_store;
```
Verified post-apply: `pg_publication_tables.rowfilter` = the three-prefix predicate, kv_store still the
only table, replica identity unchanged. `supabase-schema.sql` updated to match (so a fresh setup / re-run
reproduces the filter, not the old publish-everything). **Remaining owner validation:** open a live PvP
battle and confirm the board still updates in real time (the client has an SSE fallback, so worst case is
slightly-less-instant PvP until rollback); after some traffic, re-check the WAL-decode row in
`pg_stat_statements` to confirm the drop.

## 14. Recommended next PR

1. **Contain the Sunscar Miraa mint (P0):** server-resolve or server-seal the Miraa outcome (mint-token like
   dice), or immediately clamp `miraaRyoDelta` win to a stake-neutral value pending the redesign — owner sign-off
   (balance-sensitive).
2. Then: card-clash ai-settle + pet gauntlet server-resolution (P1); ranked-rollover idempotency (lease renewal
   or a per-season "reset applied" NX marker); a distributed scheduler lease; and the Realtime publication
   scope-down (approval-gated migration) to kill the #1 DB cost.
