# Economy Telemetry + Transaction Audit Layer (DESIGN DRAFT)

Status: **DESIGN DRAFT — not implemented.** Server-side instrumentation that
makes the soft-economy *visible* (inflation, faucet-vs-sink balance) and gives a
*detect-and-rollback* trail for currency dupes/anomalies. Additive only — no
balance numbers, reward rates, or schema change.

Origin: the 2026-06-21 full-systems audit
(`memory/project_full_systems_audit_2026_06_21.md`). Two research themes converge
on the same artifact:

- **Economy theme gap:** "No economy telemetry — total money supply,
  created-vs-destroyed, wealth concentration, and key item prices are untracked,
  so inflation is only noticed once it's structural and painful to reverse."
- **Anti-cheat theme:** "Add a lightweight append-only transactions/audit log
  keyed by a unique transaction ID, recording the SERVER-computed delta for every
  currency/item/XP change, plus 2–3 threshold anomaly queries. At tens of players,
  detection + rollback is far higher ROI than trying to make the client
  un-cheatable, and it's the only way to unwind a dupe after the fact."

## What already exists (don't rebuild)

- **Sinks are in place:** the 10% **trade burn** (`api/player/_trade-core.ts`
  `TRADE_TAX_PCT = 0.10`, returns `burned`), the **bank-interest 10M principal
  cap**, and the **black-market** server-rolled sink. The economy *mechanics* are
  reasonable; the gap is purely visibility + detection.
- **Audit substrate:** `api/_audit.ts` — capped, lock-serialized, newest-first
  append-only lists per domain (`content`/`reward`/`sector`/`combat`),
  size-clamped summaries, best-effort `recordAudit`/`readAudit`. An admin read
  endpoint (`api/admin/audit-log.ts`) and the **Diagnostics panel**
  (`AdminDiagnosticsPanel.tsx`) already render it.

The gap: that log is **admin-action**-shaped, not a **gameplay currency-delta**
trail, and there is no aggregation (supply, created-vs-destroyed) or anomaly
querying.

## Goals

1. Record the **server-computed delta** of every currency change at the moment
   the server-authoritative path writes it (faucet `+`, sink `−`).
2. Maintain cheap **running aggregates** (created/destroyed per currency) so a
   weekly rollup is O(1), not a full save scan.
3. Provide **2–3 anomaly queries** surfaced in the admin Diagnostics panel.
4. Enable manual **freeze + rollback** of a detected dupe (reuses the existing
   admin reward-correction + `audit:reward` trail).
5. Zero gameplay/balance impact; best-effort so a logging hiccup never fails a
   real reward write.

## Data model

```ts
// api/_economy.ts
type EconCurrency = 'ryo' | 'fateShards' | 'boneCharms' | 'auraStones'
                  | 'auraDust' | 'honorSeals' | 'hollowShards';

type EconTxn = {
  ts: number;
  txnId: string;        // caller-supplied idempotency id (e.g. `claim:<missionId>:<day>`)
  player: string;       // safeName slug
  currency: EconCurrency;
  delta: number;        // server-computed: + faucet, − sink/burn
  source: string;       // 'mission.claim' | 'trade.burn' | 'bank.interest' | 'hollowgate.settle' | ...
  balanceAfter?: number;// optional snapshot for the negative-balance check
};
```

Two stores, both behind the existing best-effort + capped pattern:

- `econ:txns` — a **capped recent list** (newest-first, ~5000 like the audit log)
  for drill-down. NOT the source of truth for totals (it ages out).
- `econ:agg:<currency>` — **running counters** `{ created, destroyed }` bumped on
  every txn via `kv.incr`-style updates, so supply trends survive list rollover.

## Hook points (the server-authoritative reward writers)

`recordEconomyTxn()` is called **inside the existing `withKvLock(save)`** of each
writer, right where it computes the delta — so the logged number is the
server-authored one, never a client figure:

| Source | File | Sign |
|---|---|---|
| `mission.claim` | `api/missions/claim-mission.ts` | + |
| `pet.expedition` | `api/missions/report-pet-event.ts` | + |
| `raid.report` | `api/missions/report-raid.ts` | + |
| `pvp.win` | `api/missions/report-pvp-win.ts` | + |
| `bank.interest` | `api/bank/claim-interest.ts` | + |
| `trade.credit` / `trade.burn` | `api/player/trade.ts` | + / **−** |
| `blackmarket.spend` | `api/festival/black-market.ts` | **−** |
| `treasury.*` | `api/clan/**`, `api/village/**` | ± |
| `hollowgate.settle` | (planned `api/hollow-gate/settle.ts`) | + |
| `tower.settle` | `api/towers/_tower-store.ts` | + |

The 10% trade burn and black-market spend are your first real **"currency
destroyed"** signals; missions/pets/raids/interest are the **"created"** side.

## Anomaly queries (surfaced in Diagnostics)

1. **Wealth-vs-level baseline** — flag `ryo (+ bankRyo) > k × expected(level)`;
   catches "level 5 with 50M" (the audit's bankRyo finding #11 is exactly this
   shape).
2. **Negative / impossible balance** — any `balanceAfter < 0` or a currency above
   a sane ceiling.
3. **Duplicate txnId** — same `txnId` seen twice = a replay/dup that slipped a
   guard.
4. **Faucet ≫ sink alert** — weekly `created` vs `destroyed` ratio past a
   threshold = inflation building.

## Surfacing + rollback

- New admin read endpoint `api/admin/economy.ts` (admin-gated, rate-limited):
  returns the running aggregates, the weekly rollup, top-10 wealth, and the
  current anomaly flags. **Register in `server.ts`** (bare + `/api`).
- Extend `AdminDiagnosticsPanel.tsx` with an **Economy tab**: total supply per
  currency, created-vs-destroyed/week (with the trade-burn line), top-10 wealth
  share, and the flag list.
- A weekly **cron rollup** (`api/cron/_scheduler.ts`) snapshots
  `econ:weekly:<isoWeek>` from the running counters so trends persist.
- **Rollback:** a flagged dupe → admin freezes the account (existing ban/admin
  tooling) and reverses the delta via the existing reward-correction path, which
  already writes to `audit:reward`. The `econ:txns` entry gives the exact amount +
  source to reverse.

## Anti-cheat framing

This is the "**detect-and-rollback > un-cheatable client**" recommendation. It
pairs with the Phase A per-save clamps (defense-in-depth): clamps stop the easy
forgeries at write time; the telemetry catches whatever slips through and makes it
reversible. It also gives the first objective signal to **tune** balance instead
of guessing.

## Wiring

- New: `api/_economy.ts` (`recordEconomyTxn`, aggregate helpers, anomaly checks),
  `api/admin/economy.ts` (read endpoint).
- Hook `recordEconomyTxn()` into the ~10 reward writers above (one line each,
  inside the existing lock).
- Cron rollup in `api/cron/_scheduler.ts`; Economy tab in
  `AdminDiagnosticsPanel.tsx`.
- Tests: `api/_economy.test.ts` — delta sign per source, aggregate
  created/destroyed accounting, duplicate-txnId detection, and the
  wealth-vs-level / negative-balance thresholds.
- After the `api/` change: `npm run build` + commit `dist/` (cPanel serves
  committed `dist/`; Railway self-builds).

## Performance / cost

- One extra best-effort KV write per reward (or folded into the writer's existing
  lock) — negligible at tens of players.
- `econ:txns` capped to ~5000 (months of history); aggregates are O(1) counters;
  the weekly cron is the only scan and it reads counters, not saves.
- Strictly additive: if the log fails, the reward still applies (best-effort, like
  `recordAudit`).

## Open questions

- Recent-list retention length vs. drill-down needs (5000? 10000?).
- Whether "total supply" should be the sum of running counters (`created −
  destroyed`) or a periodic full-save reconciliation (catches drift from
  un-instrumented paths — a good audit-of-the-audit).
- Anomaly thresholds (the wealth-vs-level `k`, the faucet/sink ratio alert) —
  start loose, tighten once a baseline week of data exists.

## Relationship to other work

- Companion to the **Phase A clamps** (write-time prevention) and the
  **Hollow Gate settle endpoint** (`docs/hollow-gate-augments.md`, a new
  instrumented faucet).
- Extends the reliability/observability layer
  (`docs/reliability-observability-plan-2026-06-12.md`) and reuses `_audit.ts` +
  the Diagnostics panel.
