# ShinobiX Stabilization — Implementation Roadmap (Phase 0 output, 2026-07-31)

Derived from the Phase 0 audits (`stabilization-baseline.md`,
`state-ownership-audit.md`, `reward-settlement-audit.md`,
`combat-authority-audit.md`, `shared-content-audit.md`,
`concurrency-and-locking-audit.md`). Baseline: `origin/main` @ `de50b3385`.

**Headline:** the current codebase is in far better shape than the historical
failure classes suggest — versioned saves, a sanitizer that re-asserts
server-owned state, failClosed locks on every currency path found, and one
shared fighter hydrator across all server-sealed combat modes. The remaining
work is consolidation, not rescue. Dependency order below.

---

## P0-1 — Central state-ownership contract

**Problem.** Ownership rules exist but are encoded as ~15 scattered freeze lists
and inline clamps inside `api/save/[name].ts` (`ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS:371`,
`SERVER_PAYOUT_CHARACTER_FIELDS:386`, `STRICT_SERVER_LEDGER_CHARACTER_FIELDS:362`,
`SERVER_LEDGER_TOPLEVEL_FIELDS:397`, `LIFETIME_COUNTERS:1207`, plus dozens of
inline blocks). Nothing machine-checks that a new save field gets an ownership
ruling; new fields default to client-owned pass-through silently.

**Evidence.** state-ownership-audit.md (matrix + freeze-list inventory).

**Proposed architecture.** A single declarative ownership manifest module
(`api/save/_ownership-contract.ts`): every known save field → one of
`server`, `server-payout`, `strict-ledger`, `client`, `client-clamped`,
`admin-content`, with the sanitizer consuming the manifest instead of ad-hoc
lists. A characterization test walks a real save shape and fails on any field
without a ruling ("no unclassified fields" ratchet).

**Reuse:** the existing lists become the manifest's initial content; the
sanitizer's enforcement helpers (`enforceRawSaveLedgerBoundary:597`,
`preserveOwnedItems`, `preserveEntitledStringArray`) stay as the engine.
**Files changed:** `api/save/[name].ts` (list extraction only, behavior-neutral),
new `api/save/_ownership-contract.ts`, new test.
**Migration/backfill:** none (pure refactor). **Rollback:** revert commit.
**Tests:** golden-master sanitizer test (same input save → byte-identical
output before/after extraction); unclassified-field ratchet.
**Verification:** run existing `api/save/*.test.ts` suite; no prod behavior change.
**Dependencies:** none — this is first because every later phase cites it.
**Risks:** low; the refactor must be verbatim-move.
**Commits:** (1) golden-master test, (2) extract lists to manifest,
(3) ratchet test + doc.

## P0-2 — Authoritative reward settlement and idempotent receipts

**Problem.** Settlement integrity is good but implemented in at least four
idempotency dialects: in-save receipt lists (`_settlement-receipts.ts`,
`redeemedCrafts`, `redeemedShopPurchases`), single-use sealed tokens
(`_single-use-token.ts` — consume-before-payout window class), NX keys +
economy-tx sagas (`_economy-tx.ts`), and date stamps. Known gaps:
`player/trade.ts:117-119` (P2 — sender debited before recipient credited, no
escrow/journal; retry double-debits), the mission-claim 409-refetch race
(memory `project_combat_mission_claim_persist_race`), and no-nonce retry
double-apply on bank transfer/cafeteria (P3, wealth-conserving).

**Evidence.** reward-settlement-audit.md; concurrency audit §7.

**Proposed architecture.** (a) A documented settlement contract: every payout
endpoint must use one of {in-save receipt in the same write, sealed token whose
consumption is recorded in the payout write, economy-tx saga} — enforced by a
grep-style parity test over `api/**` payout handlers. (b) Convert
`player/trade.ts` to the existing `_economy-tx` reserve→complete pattern
(the one outlier among two-party settlements). (c) Fix the mission-claim
refetch race per its memory file. (d) For token flows, move consumption into
the payout write path (delete-on-payout, not delete-then-pay) or add a
tombstone receipt.

**Reuse:** `_economy-tx.ts`, `_settlement-receipts.ts`, `mutatePlayerSave`.
**Files:** `api/player/trade.ts`, `api/missions/claim-mission.ts`,
`api/_single-use-token.ts` call sites, new contract test.
**Migration:** none (KV shapes already exist). **Rollback:** per-endpoint revert.
**Tests:** partial-failure simulation tests (inject KV failure between writes),
replay tests per endpoint. **Verification:** economy-reconcile admin surface
shows no new stuck records post-deploy.
**Dependencies:** P0-1 (contract vocabulary). **Risks:** trade behavior change
must preserve burn math exactly.
**Commits:** (1) settlement-contract doc + parity test (characterization),
(2) trade → economy-tx, (3) mission-claim race fix, (4) token-consumption
ordering fixes — each independently shippable.

## P0-3 — Single authoritative fighter snapshot/build pipeline

**Problem.** Server-sealed modes already share one builder
(`hydrateCharacterFromSave`, `api/pvp/session.ts:779` via
`sealTowerFighter`). But Hollow Gate combat, Endless Tower (client mode),
generic AI fights, and legacy E/D missions still build fighters **client-side**
(Pipeline C — `Arena.tsx:301`), with different catalogs, no server clamps, no
sealed consumable budgets. Silent-drop hazards: unknown equipped jutsu dropped
with no log (`session.ts:673`); admin-catalog parameter defaults to `null` and
future callers regress silently (`towers/_seal.ts:45-52`); forged named-weapon
definitions live only in the player's own `creatorItems` (`session.ts:712-713`).

**Evidence.** combat-authority-audit.md.

**Proposed architecture.** (a) Make the admin-content argument **required**
(compile-time) on `hydrateCharacterFromSave`/`sealTowerFighter`. (b) Add a log
line for the unknown-jutsu drop. (c) Migrate Hollow Gate combat and AI fights
onto `buildAuthoritativeSoloEncounter` (the machinery exists; Hollow Gate
already has run-bound bindings and server-sealed rewards — only the fighter
build is client-side). (d) Retire `clientTrustedCombatMissionRewardAllowed`
legacy E/D path once mission combat parity is confirmed. (e) Decide named-weapon
resolution fallback (e.g. resolve from inventory-embedded definition snapshot)
BEFORE the `STRICT_RAW_SAVE_LEDGER=1` flip.

**Reuse:** `_authoritative-pve.ts`, `towers/_seal.ts`, existing enemy templates.
**Files:** `api/hollow-gate/combat-start.ts`, `api/endless/_run.ts`,
`api/missions/queue-combat-claim.ts`, `api/pvp/session.ts`, `api/towers/_seal.ts`.
**Migration:** none. **Rollback:** per-mode env kill-switch during rollout.
**Tests:** cross-mode loadout-parity test (same save → same sealed fighter in
every mode); drop-logging test.
**Dependencies:** P0-1 (which fields combat may read), P0-2 (settle contract).
**Risks:** Hollow Gate is desktop-flagship content — needs staged rollout.
**Commits:** (1) required-admin-param + drop logging (tiny, safe),
(2) parity characterization test, (3) Hollow Gate server build behind flag,
(4) AI-fight/Endless Tower migration, (5) legacy E/D retirement.

## P0-4 — Move shared content out of Admin 1/Admin 2 player saves

**Problem.** Global content lives in two playable saves. The `?signal=1`
publish path has **no lock, no version guard, no sanitizer**
(`api/save/[name].ts:2800-2826`) — a stale admin tab or two concurrent editors
silently clobber newer content. Recency merge protects only jutsu +
hollowGateEventConfig; items/cards/AIs/events/missions/raids are
last-writer-wins. At the roadmap baseline, deletion semantics were inconsistent (item tombstones diverged
between combat and shop catalogs; jutsu/cards/AIs have no deletion mechanism).
The strict-ledger flip will freeze admin-slot `creatorItems` on the ordinary
path, making the unguarded path the ONLY publisher.

**Evidence.** shared-content-audit.md findings 1–6.

**Proposed architecture.** Dedicated KV keys per content type
(`content:jutsu`, `content:items`, `content:cards`, …) with per-entry
`updatedAt` + record-level version, written through a locked, version-guarded
`api/admin/content-publish` endpoint. `loadAdminCombatContent` and
`shop/_catalog.ts` become **dual-read** (new keys first, admin-slot fallback)
so no data migration is required upfront; a one-shot admin endpoint copies the
slots into the new keys; the slots become read-only legacy after soak.
Tombstone semantics were unified across the dual-read item catalogs on
2026-08-03; the remaining store/client/slot cutover steps are unchanged.

**Reuse:** `_admin-content.ts` composer as the single read surface;
`withKvLock`; `_save-version.ts` version pattern.
**Files:** new `api/_content-store.ts`, `api/admin/content-publish.ts`;
changed `_admin-jutsu-catalog.ts`, `_admin-item-catalog.ts`,
`shop/_catalog.ts`, client merge in `App.tsx:3756-3799`.
**Migration:** one-shot copy (idempotent, re-runnable); slots retained for
rollback. **Backfill:** none beyond the copy. **Rollback:** flip dual-read
order back to slots.
**Tests:** merge-semantics parity tests (old vs new read path produce identical
catalogs on the same data); tombstone consistency test; concurrent-publish test.
**Dependencies:** P0-1 (admin-content ownership class). **Risks:** client merge
changes touch App.tsx (respect the drain ratchet); stale-client compatibility
during dual-read.
**Commits:** (1) content-store module + tests, (2) publish endpoint (locked +
versioned), (3) dual-read in catalogs, (4) copy endpoint + runbook, (5) client
merge unification, (6) slot freeze after soak.

## P0-5 — Move highest-risk critical state off whole-save writes incrementally

**Problem.** Everything lives in one JSON blob per player; every settlement is
a whole-save `kv.set`. The system compensates well (locks + versions +
sanitizer), but: the 10s in-process `save:` read cache becomes a stale-RMW
hazard if Railway ever scales past one replica (concurrency F8); multi-key
sagas replace what one Postgres transaction could do (F9); and blob size grows
unboundedly (battleHistory capped, but the blob is the unit of every write).

**Evidence.** concurrency audit F8/F9; state-ownership audit (whole-save write
inventory).

**Proposed architecture.** Incremental side-car extraction of the
highest-contention server-owned fields into dedicated rows/keys, starting with
currencies + bank (`character.ryo`, `bankRyo`, premium currencies) as a
`ledger:<name>` record updated transactionally via `pg` (the dependency already
exists), dual-written with the blob during soak. NOT a big-bang schema change —
one domain at a time, blob remains source of truth until each domain's
cutover flag flips.

**Reuse:** `pg` client already in deps; `_economy-tx.ts` journal;
`_ownership-contract.ts` (P0-1) chooses extraction candidates.
**Files:** new `api/_ledger-store.ts`; touched settlement endpoints per domain.
**Migration:** per-domain backfill script (read blob → write ledger),
re-runnable. **Dual-read:** blob wins until flag flip; divergence logged.
**Rollback:** flip flag back; blob never stopped being written.
**Tests:** dual-write divergence test; transaction atomicity test.
**Verification:** divergence telemetry at zero for N days before cutover.
**Dependencies:** P0-1, P0-2 (settlement contract determines write sites).
**Risks:** highest of the P0s — sequencing and soak discipline are the control.
**Commits:** per domain: (1) ledger store + dual-write, (2) backfill script,
(3) divergence telemetry, (4) read cutover behind flag.

## P0-6 — Permanent fresh-account end-to-end release certification

**Problem.** `beta:certify` and QA scripts exist but there is no standing
fresh-account journey that exercises register → play → reward → refresh →
relog → reward-still-there against a real server. The Playwright e2e suite runs
against a **backend-less** vite preview with mocked network (config:
`shinobij.client/playwright.config.ts`, `webServer: vite preview`), so it
certifies UI flows, not settlement.

**Evidence.** stabilization-baseline.md (e2e coverage section);
`scripts/beta-certification.mjs`.

**Proposed architecture.** A certification harness that boots the real Express
server (`dist/server.js`) against a scratch Supabase schema (or a local
Postgres with `kv_store`), creates a fresh account via the real API, executes
the reward-critical journeys server-side (API-level, not browser-level, for
determinism), asserts persistence across simulated relog, and runs in CI
nightly + before release tags.

**Reuse:** `scripts/beta-certification.mjs`, `scripts/kv-backup.mjs` (scratch
data seeding), existing route-parity test.
**Files:** new `scripts/release-certification-e2e.mjs` + CI workflow.
**Migration:** none. **Rollback:** n/a (tooling).
**Dependencies:** P0-2 (asserts the settlement contract).
**Risks:** low; needs a scratch DB secret in CI.
**Commits:** (1) local-Postgres harness, (2) fresh-account journey pack,
(3) CI wiring.

---

## P1 / P2 packages (summary)

- **P1-1 Concurrency consolidation:** fix lock-order inconsistency (F1: make
  `clan/kick`/`clan/exchange/purchase` sort like `treasury/transfer`), add a
  lock-order lint/test, decide fencing strategy for >5s operations, add
  `failClosed` to `battle/lock.ts` defeat write. Depends on P0-1/P0-2 only
  loosely; can run in parallel.
- **P1-2 Central feature-readiness manifest:** one server module + one client
  module generated from it, replacing scattered `ENABLE_*`/`.v1` checks; fixes
  the documented force-set drift (`server.ts:435,439`) by making it explicit
  config; adds the missing flags to `.env.example`; retires dead flags
  (`petColiseumCinematic.v1`). Evidence: feature-readiness table in baseline doc.
- **P1-3 Observability:** settlement receipts surfaced in an admin dashboard;
  counters for silent drops (unknown jutsu/items), 409/426 rates, lock
  contention, economy-tx `needs-reconcile` count; alerts on divergence
  telemetry from P0-5.
- **P1-4 Live-data integrity scanner:** read-only script walking all `save:*`
  keys checking: orphaned equipped ids, forged-item definition loss
  (named-weapon risk), duplicate pets, admin-content mirrors diverging from
  slots, claim stamps without receipts; plus a guarded repair mode per finding
  class. This also answers every "REQUIRES LIVE-DATA VERIFICATION" item from
  Phase 0.
- **P2-1 Modular route registration:** split `server.ts`'s ~400 route lines
  into per-domain registrars; the existing `server-routes.test.ts` parity test
  is the safety net.
- **P2-2 Centralized branding configuration:** single branding module consumed
  by client + server strings (title, URLs), replacing scattered literals.

## Dependency-ordered commit sequence (P0)

1. P0-1.1 golden-master sanitizer test → 1.2 manifest extraction → 1.3 ratchet.
2. P0-2.1 settlement-contract parity test → 2.2 trade escrow → 2.3
   mission-claim race → 2.4 token ordering.
3. P0-3.1 required-admin-param + drop logging → 3.2 parity test → 3.3 Hollow
   Gate server build (flagged) → 3.4 Endless Tower/AI fights → 3.5 legacy E/D
   retirement.
4. P0-4.1 content store → 4.2 publish endpoint → 4.3 dual-read → 4.4 copy +
   runbook → 4.5 client merge → 4.6 slot freeze.
5. P0-5 per-domain ledger extraction (currencies first), each domain its own
   4-commit arc.
6. P0-6 certification harness (can start any time after P0-2; gates the
   STRICT_RAW_SAVE_LEDGER flip and every later cutover).

Every commit above is independently revertible and the plan can stop safely
after any completed commit. The `STRICT_RAW_SAVE_LEDGER=1` production flip
should happen only after P0-3.5 (named-weapon resolution) and P0-4 (admin
`creatorItems` publish path) land, since both interact with strict mode.
