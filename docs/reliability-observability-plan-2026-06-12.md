# ShinobiX Reliability & Observability Plan (2026-06-12)

Phased, rollback-safe plan covering the 10 priorities in the consistency/reliability
brief. **No behavior changes land without a feature flag or a behavior-preserving
guarantee.** This is a planning document — nothing here is built yet.

## TL;DR — current state vs. the brief

The brief assumes the PvP/reward/movement core is fragile. The codebase audit shows
**most of that core is already hardened** by prior work. The genuine, high-value gaps
are an **additive observability/metadata layer**: durable receipts, an asset registry,
admin reports, and content-edit audit logging. None of those touch combat balance or
the image-serving path.

| Priority | What exists today | Real gap | Risk to add |
|---|---|---|---|
| 1 PvP authority/concurrency/idempotency | Server-authoritative `move.ts`; per-session `nx` lock; `moveToken` ring buffer; full validation chain; `rejected` response shape; SSE + GET refresh | No explicit `version` field (lock+token already cover corruption/dup) | Low–Med (touches `move.ts`) |
| 2 Tag/status consistency | Canonical `_tags.ts`; deterministic 5-phase resolver; `activeRound` deferral; 5 test files | Minimal applied-status shape (no instanceId/source/creator/hasTriggered); debugging blind spots | Low if metadata is informational-only |
| 3 Combat receipts | In-session `log[]` only, dies with 15-min TTL | No durable, structured per-battle/per-action receipts | None (separate durable record) |
| 4 Reward settlement | Idempotent NX receipts; both saves locked sorted, `failClosed:true`; mint-token pattern | No admin-visible settlement status; no consolidated reward receipt view | None (additive read + write) |
| 5 Sector/movement | Presence-gated; PvP re-reads opponent presence at session create; travel window capped | No compare-and-set on the (ephemeral) open-world move; no movement nonce | Low |
| 6 Asset registry & admin visibility | `shared:img:*` per-id blobs; category manifests; ownership gates | **No metadata registry at all**; no missing/dead/dup reports | None (wraps existing path) |
| 7 Territory overlay | `world:territory:<sector>` authoritative; 30/90-day audit logs | No cacheable read-only overlay endpoint; no admin inspector | None (additive read) |
| 8 Admin action logs | `mod:audit` (5000-cap) + territory audit only | **No audit for content edits** (jutsu/item/image/bloodline/reward) | None (additive logging) |
| 9 Operational | `/health` + `/health/db`; pg_cron cleanup; SSE excluded from gzip | Receipts/audit must stay out of hot paths; Cloudflare cache for new public reads | None if designed flushed-at-end |
| 10 Tests & rollout | node:test via tsx; `server-routes.test.ts` parity guard | Add the brief's focused tests as characterization first | None |

## Implementation status

- **Phase 0 — Foundations: ✅ BUILT (not yet committed/deployed).**
  - `api/_receipts.ts` + `api/_receipts.test.ts` — durable battle receipts (90-day TTL),
    idempotent NX write, injectable KV for tests.
  - `api/_audit.ts` + `api/_audit.test.ts` — generalized capped audit log per domain.
- **Phase 1 — Combat receipts + reward visibility: ✅ BACKEND BUILT (not yet committed/deployed).**
  - `api/pvp/move.ts` flushes a durable receipt once at terminal resolution (best-effort,
    idempotent — never affects combat).
  - `api/pvp/claim-rewards.ts` patches the server-credited settlement (ranked delta + base
    note) onto the receipt.
  - `api/admin/battle-receipts.ts` (+ `server.ts` route) — admin lookup by battleId.
  - **Receipt content this pass:** battle metadata + final fighter snapshots + the full
    durable combat log (the per-action narrative) + settlement. Structured per-action
    `events[]` rows are deliberately **deferred** (kept this pass zero-risk; the log already
    carries the per-action story).
  - **Deferred to a follow-up:** the admin-panel UI surface (client), and the per-action
    structured `events[]` capture.
  - Verified: `npx tsc -p tsconfig.cpanel.json --noEmit` clean; 413 backend + scripts tests
    green (incl. all combat/sanitize/tag/lifesteal/parity suites unchanged).
  - **Deploy note:** backend-only change. Railway self-builds; cPanel needs `npm run build`
    + committed `dist/` before it ships. Not committed yet (awaiting go-ahead).
- **Phase 2 — Asset registry + reports + content audit: ✅ BUILT (not committed/deployed).**
  - `api/_asset-registry.ts` (+ test) — `asset:meta:<id>` companion records with
    contentHash, type/format/bytes, createdBy, hidden, tags; pure helpers + injectable KV.
  - `api/images.ts` side-writes metadata + content audit on set/delete (best-effort,
    `DISABLE_ASSET_META` flag, image write/serve path untouched).
  - `api/_audit.ts` content-edit logging wired into `images.ts`, `bloodline-review.ts`,
    `item-review.ts`.
  - `api/admin/asset-report.ts` + `api/admin/audit-log.ts` (+ `server.ts` routes).
  - `scripts/backfill-asset-meta.mjs` — one-off, idempotent, NOT auto-run.
- **Phase 3 — Validators / stale-refresh: ❌ REMOVED by decision (2026-06-12).**
  - Was built (PvP `version` field + `expectedVersion` stale check; movement `fromSector`
    compare-and-set), all log-only behind flags. Removed because players don't report
    PvP desyncs / duplicated moves, and the existing turn-gate + per-session lock +
    `moveToken` idempotency + server-authoritative recompute already cover those cases.
    Shipping dormant edits to the combat move path and the per-second heartbeat was net
    risk with no payoff. `move.ts`, `session.ts`, `heartbeat.ts`, `presence-input.ts`
    reverted to original behavior. To rebuild later: re-add a `version` counter bumped in
    `saveSession`, echo it from the client as `expectedVersion`, and gate enforcement.
- **Admin diagnostics panel: ✅ BUILT (client).**
  - `shinobij.client/src/screens/AdminDiagnosticsPanel.tsx` — Assets (registry summary,
    missing images vs built-in catalogs, duplicates, hidden, missing-metadata), Battle
    Receipts lookup, Audit Log viewer. Mounted as a new "Diagnostics" tab in `AdminPanel.tsx`.
- Verified across Phases 1–3: server + client `tsc` clean, client lint 0 errors, **662 tests
  green** (full `npm test`), route parity covers all new endpoints + client calls.
- **Not done:** per-action structured `events[]` rows (the durable log covers the narrative);
  client adoption of `expectedVersion`/`fromSector` (server side is ready, log-only);
  jutsu/item DATA-edit audit via the shared-content path (image + review edits are audited).
- **Deploy note:** backend + client change. Railway self-builds; cPanel needs `npm run build`
  + committed `dist/` (root + client) before shipping. Not committed yet.
- Phases 5–6 (territory overlay, ops pass): planned, not started.

### Storage constraint that shapes every design

Everything is one Supabase table — `kv_store (key, value jsonb, expires_at, updated_at)` —
fronted by `api/_storage.ts` `kv`. **No new tables** (CLAUDE.md hard rule: no schema
changes without approval). So every new durable record is a KV key following the
existing colon-namespace convention, with a TTL. Available primitives: `get`, `set`
(with `ex`/`nx`), `del`, `incr`, `keys(pattern)`, `mget`, and hash ops. The only
compare-and-set primitive is `set(..., {nx:true})`. There is no append; "append" =
read-modify-write under `withKvLock`, or write a fresh per-event key.

---

## Phase 0 — Foundations (additive, zero behavior change)

Two shared helpers everything else builds on. Ship these first, alone, so later phases
are thin.

### 0a. Audit-log helper — `api/_audit.ts` (new)

Generalize the proven `mod:audit` capped-list pattern (`api/admin/moderation.ts:47`).

```ts
// api/_audit.ts
export type AuditDomain = 'content' | 'reward' | 'sector' | 'moderation' | 'combat';
export interface AuditEntry {
  ts: number; actor: string; domain: AuditDomain; action: string;
  entityType?: string; entityId?: string;
  before?: unknown; after?: unknown;   // compact summaries, not full blobs
  reason?: string; meta?: Record<string, unknown>;
}
// Appends under withKvLock to a capped list key `audit:<domain>` (cap ~5000),
// and (optionally) writes a per-event key `audit:<domain>:<ts>:<rand>` with TTL
// for cheap range scans. Best-effort: never throws into the caller's path.
export async function recordAudit(e: AuditEntry): Promise<void>;
export async function readAudit(domain: AuditDomain, opts?): Promise<AuditEntry[]>;
```

- Lock target: `audit:<domain>` (its own key, never a `save:`); `failClosed:false`
  (losing one audit line must never fail a real action).
- `before`/`after` are **summaries** (changed fields only), never whole entities, to
  keep the list small and avoid leaking base64 image blobs into the log.
- Tests: append/trim cap, concurrent appends don't lose entries, oversized payload
  truncation.

### 0b. Receipt helper — `api/_receipts.ts` (new)

```ts
// api/_receipts.ts
export interface BattleReceipt {
  battleId: string; version: number; ranked: boolean; rankedKind?: 'player'|'pet';
  startedAt: number; endedAt: number;
  p1: string; p2: string; winner: 'p1'|'p2'|'draw'|null; fleedBy?: 'p1'|'p2';
  rounds: number; actions: ReceiptAction[];      // compact per-action rows
  settlement?: { rewardedAt?: number; ryo?: number; xp?: number; ratingDelta?: number };
}
export interface ReceiptAction {
  round: number; actor: 'p1'|'p2'; type: string; actionId?: string;
  target?: 'self'|'opponent'|'ground'; tile?: number;
  spent: { ap?: number; chakra?: number; stamina?: number };
  hpDelta?: { p1?: number; p2?: number };
  tagsAdded?: string[]; tagsRemoved?: string[];
}
// Durable key: `receipt:battle:<battleId>` with a 30-day TTL (configurable).
export async function writeBattleReceipt(r: BattleReceipt): Promise<void>;
export async function readBattleReceipt(battleId: string): Promise<BattleReceipt | null>;
```

- **Hot-path cost = one extra KV write per battle**, flushed at terminal resolution —
  not per move. Per-action rows are accumulated in-session (see Phase 3) and flushed
  once.
- Flag: `DISABLE_COMBAT_RECEIPTS=1` opts out (default on).

Neither helper is wired into any caller in Phase 0 — they ship with their own tests
and are dormant until later phases call them. Fully reversible.

---

## Phase 1 — Combat receipts (Priority 3) + reward visibility (Priority 4)

The brief's rollout step 1 ("add logs/receipts first"). Pure observability.

### 1a. Accumulate structured combat events in-session

- Extend `PvpSession` (`api/pvp/session.ts`) with an optional `events?: ReceiptAction[]`,
  capped (e.g. last 120) and trimmed in `saveSession` exactly like `log`.
- In `move.ts` `commit()`, alongside the existing `log` append, push one compact
  `ReceiptAction`. This is **additive** — the live `log[]` UI is untouched.
- Optional field ⇒ in-flight sessions without `events` keep working.

### 1b. Flush a durable receipt at battle end

- When `checkWinner()` flips `status:'done'`, call `writeBattleReceipt(...)` once
  (guarded by an idempotent `nx` marker `receipt:wrote:<battleId>` so retries/double
  resolution don't double-write).
- Settlement fields filled when `claim-rewards.ts` settles (it already computes ryo/xp/
  rating); it patches the receipt's `settlement` block.

### 1c. Admin reward-settlement + receipt view

- New `GET /api/admin/battle-receipts` (admin-gated): look up a receipt by `battleId`,
  or list recent receipts for a player, plus the settlement-receipt status by scanning
  `pvp:rewarded:*` / `pvp:ranked-rating:*` / `pvp:vanguard-rewarded:*`.
- Admin panel: a small "Battle lookup" tab — paste a `battleId`, see the full receipt,
  settlement state, and whether rewards were paid. Directly serves "fewer reward
  disputes / easier admin debugging."

**Files:** `api/_receipts.ts` (new), `api/pvp/session.ts`, `api/pvp/move.ts`,
`api/pvp/claim-rewards.ts`, `api/admin/battle-receipts.ts` (new) + `server.ts` route,
`shinobij.client/src/screens/AdminPanel.tsx`. **Flag:** `DISABLE_COMBAT_RECEIPTS`.
**Tests:** receipt written once on win/draw/flee; idempotent on double-resolve;
events trim cap; settlement patch; admin endpoint auth + lookup.

---

## Phase 2 — Asset registry + admin reports (Priority 6) + content audit (Priority 8)

The single biggest real gap, and zero gameplay risk. **Wraps** the existing
`shared:img:*` path — never replaces it (hard guardrail).

### 2a. Metadata on write (lazy registry, no backfill required)

- In the upload path (`api/images.ts` POST), after a successful image write, also write
  `asset:meta:<id>` = `{ id, category, type, contentHash, bytes, createdBy, updatedAt,
  hidden:false, tags:[], frames?, animSpeed?, sourceNote? }`.
- `contentHash` (sha256 of the decoded bytes) enables duplicate detection.
- This is additive: images already work without it; the registry fills in as assets are
  (re)saved. A one-off `scripts/backfill-asset-meta.mjs` can populate existing ids from
  the current `shared:img:*` keys (admin-run, idempotent, off the hot path).

### 2b. Admin asset report endpoint

- `GET /api/admin/asset-report` (admin-gated): returns, per category, the set of stored
  image ids (from `shared:img:*` + legacy hash fields) and any `asset:meta:*` records.
- **Catalog cross-reference happens client-side** in the admin panel, which already
  holds every catalog in memory (`data/jutsu.ts`, `starter-items.ts`, `pet-pool.ts`,
  `tile-cards.ts`, bloodlines, events). The panel diffs catalog ⇄ stored ids to render:
  - missing jutsu/item/pet/portrait/tag-icon images
  - dead image references (entity gone, image orphaned)
  - unused assets (stored, referenced by nothing)
  - duplicate assets (same `contentHash`)
  - hidden/inactive assets
  - assets with missing metadata
  - animation assets missing `frames`/`animSpeed`
- Keeping the diff client-side avoids duplicating the client catalogs server-side (only
  the jutsu catalog has a server copy today, via `scripts/jutsu-catalog-gen.mjs`).

### 2c. Content-edit audit

- Call `recordAudit({domain:'content', ...})` from the content-mutating endpoints:
  `api/images.ts` (image set/delete), `api/admin/bloodline-review.ts`,
  `api/admin/item-review.ts`, and jutsu/item editor save paths. Summaries only.
- Admin panel: a read-only "Content audit" list (mirrors the existing Moderation log UI).

**Files:** `api/images.ts`, `api/admin/asset-report.ts` (new) + route, `api/_audit.ts`,
`api/admin/content-audit.ts` (new) + route, `AdminPanel.tsx`,
`scripts/backfill-asset-meta.mjs` (new). **Flag:** none needed (read paths) /
`DISABLE_ASSET_META=1` to skip the write-path metadata if ever needed.
**Tests:** meta written on upload; contentHash stable; report lists ids; ownership
gates unchanged; audit entry shape; image serving (`api/img.ts`) byte-for-byte unchanged.

### 2d. Cloudflare/cPanel delivery note (Priority 9)

- Keep DB records as **pointers/metadata**, blobs stay where they are (do not migrate the
  image store — guardrail). The asset-report and territory-overlay reads are the only new
  cacheable public-ish surfaces; admin endpoints stay `no-store`.

---

## Phase 3 — Validators & stale-refresh, behavior-preserving (Priorities 1, 5)

Brief rollout steps 2–3: "add validators without changing behavior; add server-side
stale rejection with clear client refresh."

### 3a. PvP per-battle version (Priority 1)

- Add `version:number` to `PvpSession`, `++` in `commit()`. Include it in the move
  response (already returns the full session) and the `rejected` block.
- Client sends `expectedVersion`. If it mismatches, server returns the authoritative
  session with `rejected:{reason:'stale', ...}` and the client refreshes — it already
  has the refresh-on-reject path. The existing lock still does the real serialization;
  `version` makes staleness explicit and debuggable.
- **Flag:** `PVP_VERSION_CHECK=1` (default **off** — log mismatches first, enforce later).

### 3b. Movement compare-and-set (Priority 5)

- `api/player/heartbeat.ts` / presence input: accept optional `fromSector` and a
  `movementNonce`; only update the stored sector if the submitted `fromSector` matches
  the stored one (CAS). On mismatch, return the authoritative presence and let the client
  resync. Travel-window capping and the presence eligibility gates are unchanged.
- Re-affirm (already true) that PvP/location-triggered actions re-read both parties'
  presence server-side before committing — add a test pinning it.
- **Flag:** `MOVE_CAS=1` (default off; log-only first).

**Tests:** version increments monotonically; stale move rejected → client gets fresh
state; non-stale move applies; movement CAS rejects stale `fromSector`; PvP target
re-read still blocks traveling/engaged opponents.

---

## Phase 4 — Tag lifecycle metadata + characterization tests (Priority 2)

The riskiest area; treat it as **characterize-then-harden**, never blind rewrite.

### 4a. Informational tag-instance metadata (no resolution change)

- Extend `PvpStatus` with **optional** `instanceId?`, `sourceActionId?`, `creatorId?`,
  `createdRound?`, `firstActiveRound?`, `stackKey?`, `hasTriggered?`. Populate in
  `addStatus`/`addJutsuStatus`. The resolver keeps branching on `name`/`rounds`/
  `activeRound` exactly as today — the new fields feed receipts (Phase 1) and debugging
  only. Optional ⇒ in-flight sessions unaffected.

### 4b. Add the brief's focused tests as characterization

Add tests pinning **current** behavior for: apply-now, apply-next-turn (`activeRound`),
duration expiration, stacking (`STACKABLE_STATUS`), refresh-duration, immune/resist/block
(prevent gates), cleanse/removal, reconnect/reload persistence (session reload round-trips
statuses), duplicate-action retry (`moveToken`). Most have partial coverage in
`_combat-tags.test.ts` / `_lifesteal.test.ts`; fill the gaps.

### 4c. Only if a test surfaces a real bug

Fix the specific case (triggers twice / expires a turn early-late / wrong target / lost
after reload) behind `TAG_LIFECYCLE_V2=1`, with the old path as default until verified.
Do **not** preemptively rewrite the resolver — the brief forbids rebalancing combat, and
the resolver order is load-bearing.

**Flag:** `TAG_LIFECYCLE_V2` (only created if a real fix is needed).

---

## Phase 5 — Territory overlay + admin inspector (Priority 7)

- `GET /api/world/territory-overlay` (public, cacheable): returns sector → display
  metadata `{ sector, ownerClan, ownerVillage, color }` derived from the authoritative
  `world:territory:*` records. `Cache-Control: public, max-age=30` so Cloudflare can edge
  cache it; gameplay authority stays in the existing locked mutation paths.
- Admin: a read-only "Sector ownership" inspector listing each `world:territory:<sector>`
  record and its recent `audit:clan-collect-supply:*` entries (already written).
- Reaffirm ownership-based actions validate server-side (already do under `withKvLock`).

**Tests:** overlay reflects records; color/display metadata never feeds gameplay math;
cache header present; admin inspector auth.

---

## Phase 6 — Operational hardening (Priority 9)

- Verify `/health` + `/health/db` cover the new read paths; no new background work in
  request paths (receipts flush at battle end, audit is best-effort fire-and-forget).
- Indexing: all new keys use the existing `key text_pattern_ops` index for prefix scans;
  keep report scans admin-only and paginated/capped.
- Cloudflare: cache the territory overlay and immutable static assets; never cache
  per-user API or admin endpoints (keep `no-store`).
- Railway: receipts/audit are O(1)-per-battle writes; no new long-running jobs. Existing
  pg_cron `kv_delete_expired` reaps TTL'd receipt/audit keys for free.

---

## Feature-flag summary (all default to the safe/no-op side)

| Flag | Default | Effect when set |
|---|---|---|
| `DISABLE_COMBAT_RECEIPTS=1` | off (receipts on) | Skip receipt accumulation + flush |
| `DISABLE_ASSET_META=1` | off (meta on) | Skip write-path asset metadata |
| `PVP_VERSION_CHECK=1` | off | Enforce stale-version rejection (else log-only) |
| `MOVE_CAS=1` | off | Enforce movement compare-and-set (else log-only) |
| `TAG_LIFECYCLE_V2=1` | off / not created unless needed | Enable a specific verified tag fix |

Flags follow the established `process.env.X === '1'` convention (e.g.
`DISABLE_SNAPSHOT_CRON`, `DISABLE_REALTIME`, `REQUIRE_DISK_OVERLAY`). Risky behavior
changes are **log-only first, enforce second**.

---

## Recommended build order

1. **Phase 0** (helpers + tests, dormant) — fully reversible, unblocks the rest.
2. **Phase 1** (combat receipts + reward view) — highest debugging payoff, zero risk.
3. **Phase 2** (asset registry + reports + content audit) — biggest real gap, zero risk.
4. **Phase 5** (territory overlay/inspector) — small, additive read.
5. **Phase 3** (version + movement CAS, log-only → enforce) — first flagged behavior.
6. **Phase 4** (tag metadata + characterization tests; fixes only if a test fails).
7. **Phase 6** (operational pass) — interleaved/final.

Each phase is independently shippable and revertible. After any `api/`/`server.ts`
change, run `npm test` (repo root) and rebuild+commit `dist/` for cPanel (Railway
self-builds); for client changes run `npm run lint` in `shinobij.client/` and follow the
client-dist image-churn discipline. New endpoints need BOTH the `api/**` handler AND a
`route()` registration in `server.ts` (no auto-routing; `server-routes.test.ts` enforces).

## Explicit non-goals (guardrails)

- No combat rebalancing; resolver order and constants stay pinned by existing tests.
- No replacement of the image-serving path; metadata only.
- No new tables / schema / storage-structure changes (KV keys only).
- No new framework; no large migrations; no durable plaintext-password storage.
- No removal of cPanel/Passenger or Railway support.
- No expensive managed services — everything fits Railway Pro + Supabase Pro +
  Cloudflare free + cPanel that's already in use.

## Open questions for sign-off

1. Receipt retention: 30 days OK, or longer for dispute history?
2. Should the territory overlay be fully public (Cloudflare-cacheable) or admin/auth-only?
3. Asset registry: lazy-on-write only, or also run the one-off backfill now?
4. Phase 3/4 behavior flags: comfortable shipping log-only first, enforcing after a
   soak period?
