# Balance-Band CI Gates (DESIGN DRAFT)

Status: **DESIGN DRAFT — not implemented.** Turn the existing print-only balance
harnesses into hard CI assertions, so a balance regression fails `npm test` the
same way `App.size.test.ts` ratchets line count. Test-only — no engine, balance,
or save change.

Origin: the 2026-06-21 audit (balance theme):
> "Simulation harnesses exist but appear to print numbers rather than enforce
> targets, so balance can regress between commits with nothing failing — no
> automated balance gate equivalent to the existing App.size ratchet."

This is the single best balance investment for a solo dev who can't playtest: the
sims already exist and are deterministic; they just need teeth.

## What already exists (don't rebuild)

- **`scripts/pet-role-balance.ts`** — deterministic (fixed `SEEDS`), runs the
  **real** `runPetArenaBattle`, prints a role win-rate matrix + each role's
  overall vs the field. The healthy bands are already written in the header
  comment (≈50% overall, 40–60% per pair).
- **`scripts/pet-duel-balance.ts`** — deterministic, runs the **real** `runPetDuel`
  (the continuous engine), prints: position fairness (mirror player-win ≈50% — the
  "#1 gate"), role matrix, element matrix, match length + 30s-cap-hit %, ultimate
  usage %, and per-pet outliers.
- **Ratchet precedent:** `App.size.test.ts` (fail-the-build-on-regression) and the
  colocated parity tests (`_combat-formula-parity.test.ts`,
  `scripts/pvp-tags-parity.test.mjs`, `scripts/jutsu-catalog.test.mjs`) — scripts
  already carry colocated `*.test.*` files in the `npm test` list.

## The gap

The harnesses `console.log` and exit 0. Nothing asserts a band, so a commit that
makes a role/element/pet dominant (or makes the sim too passive) passes CI
silently.

## ⚠️ Caveat — gate the real-engine sims only

`scripts/pvp-formula-sim.ts` **intentionally diverges** from the live formula
(`EP_MULTIPLIER = 32`, comment: "Real game value in move.ts is still 40") — it's a
tuning sandbox, not a faithful mirror, so it must **not** be CI-gated as-is. The
pet harnesses call the real engines and are the clean gate candidates. A PvP
balance gate, if wanted later, should be built on the real `api/pvp/move.ts` path
(or extend `_combat-formula-parity.test.ts`), not on the sandbox.

## Design

### 1. Refactor each harness: extract a pure report function

Keep the `console.log` output as a thin `main()` wrapper so `node --import tsx
scripts/pet-role-balance.ts` still prints; move the computation into an exported
pure function returning structured numbers.

```ts
// scripts/pet-role-balance.ts
export function roleBalanceReport(opts?: { seeds?: number[]; reps?: number }): {
  matrix: Record<PetRole, Record<PetRole, number>>;   // A-vs-B win fraction
  overall: Record<PetRole, number>;                   // vs-field win fraction
};
// console output becomes: if (isMain) printReport(roleBalanceReport());
```

### 2. Colocated band-assertion tests (node:test via tsx)

```ts
// scripts/pet-role-balance.test.ts
import { test } from 'node:test'; import assert from 'node:assert';
import { roleBalanceReport } from './pet-role-balance.ts';
const r = roleBalanceReport();
test('no role dominates the field', () => {
  for (const role of Object.keys(r.overall))
    assert.ok(r.overall[role] >= 0.40 && r.overall[role] <= 0.60, `${role} ${r.overall[role]}`);
});
test('no role pair is lopsided', () => {
  for (const a of ROLES) for (const b of ROLES) if (a !== b)
    assert.ok(r.matrix[a][b] >= 0.30 && r.matrix[a][b] <= 0.70, `${a} vs ${b}`);
});
```

### 3. The bands (start here, ratchet tighter)

| Gate | Harness | Band | Why |
|---|---|---|---|
| **Position fairness** (mirror) | duel | **48–52%** | #1 gate — any skew = spawn bias rigs every PvE fight |
| Role overall vs field | role + duel | 40–60% | no dominant/dead role |
| Role pair (cell) | role + duel | 30–70% | no hard auto-win matchup |
| Element overall | duel | 40–60% | guards the 15% type edge |
| Match-length cap-hit | duel | **< ~15%** | high timeout rate = sim too passive / damage too low |
| Ultimate usage | duel | **> ~5%** | 0% = ultimates never charge (feel bug) |
| Cross-tier power | role/duel | common pet's neutral win-rate **< rare's** | the "expensive > cheap" collector invariant |

### 4. Ratchet philosophy

Snapshot today's measured values, set each band *slightly wider* than the current
spread, commit that as the gate, then tighten over time — exactly how
`App.size.test` locks in line-count wins. The point is to catch *regressions*, not
to demand perfection on day one.

### 5. Sample size vs CI time

Tighter bands need more samples (less RNG noise) but more wall-clock.
Recommendation: the **test** path uses a modest representative sample (fewer
seeds/reps) with the bands widened to absorb the residual noise; the **script**
path keeps the full sample for manual deep dives. Pick the seed/rep count so each
balance test runs in a couple of seconds (the role harness is `reps×reps×seeds`
per pair; the duel harness is `roster²×seeds` — cap the duel roster sample for CI).

## Targeted guards tied to audit findings

- **Speed→crit dominant-stat** (audit recommendation to audit crit/speed
  conversions): the per-pet / per-role outlier band catches it — if a Speed-stacked
  build's position-neutral win rate escapes the band, the gate fails.
- **Element 15% edge** (the value memory says is good): the element-matrix band
  asserts no type's overall win rate leaves 40–60%.
- **No-dominant-role** doubles as the guard test the **pet role-counter web**
  design will want (cyclic counters, no strictly-best role).

## Wiring

- New: `scripts/pet-role-balance.test.ts`, `scripts/pet-duel-balance.test.ts`
  (+ the harness refactors to export the report fns).
- Add both to the `test` script in the root `package.json` (the runner already
  globs `scripts/*.test.*`).
- No `dist/` impact — these are test/dev-tooling files, not shipped server code.

## Open questions

- Exact band widths and the cap-hit / ultimate-usage thresholds (derive from a
  baseline run, then widen ~5%).
- CI time budget → how many seeds/reps the test path uses.
- Whether to gate the **continuous duel engine** now (still behind `petDuel.v1`,
  Phase D per `docs/pet-combat-redesign-plan.md`) or only the **live arena
  engine** until the duel engine is promoted. Recommendation: gate the live engine
  (`pet-role-balance`) first; add the duel gate when that engine goes
  authoritative.

## Relationship to other work

- The cyclic no-dominant-role assertion is shared with the planned **pet
  role-counter web**.
- Complements the **economy telemetry** plan (`docs/economy-telemetry-plan.md`):
  telemetry watches the *live* economy, these gates watch *combat balance* offline
  — together they cover the two halves the audit said were unmeasured.
- Faithful PvP balance gating is a follow-up that needs a real-formula harness
  (the current `pvp-formula-sim.ts` is a sandbox).
