# Pet Role-Counter Web (DESIGN DRAFT)

Status: **DESIGN DRAFT — not implemented.** Add an explicit, cyclic role-vs-role
advantage (rock-paper-scissors for the 4 pet roles) so auto-battler team-building
is a real decision, not just a stat check. Deterministic and save-safe (no new
persisted field).

Origin: the 2026-06-21 audit (collector-depth theme):
> "Define a role-counter web for the pet auto-battler: ensure each native
> role/archetype has a clear counter, surface the matchup in the team-picker, and
> add a guard test asserting the counter table is cyclic (no dominant role).
> Counters are why competitive Pokémon stays deep with a fixed roster."

## What already exists (don't rebuild)

- **Native roles** (`lib/pet-roles.ts`): 4 roles / 7 sub-roles, deterministic
  (`derivePetRole` is pure — keeps ranked replays byte-identical).
- **Role stat leans** (`ROLE_STAT_MULT`): roles differ in base-stat tilt only,
  tuned so none *dominates* (assassin nudged down, tracker up). Per the comments +
  `scripts/pet-role-balance.ts`, tracker is intentionally a bit below-average in
  1v1 (it shines in the tactical arena via range/positioning).
- **Element advantage**: a clean `1.15 / 0.85` multiplier
  (`pet-battle-sim.ts:708`, `PET_ELEMENT_BEATS`), also fed to the AI via
  `scorePetMatchup` (`:1756`). 15% edge (was 25%).

## The gap

Roles differ **only in stats**, so there's no rock-paper-scissors — the meta
collapses to "play the highest-stat team." There's no reason a Defender team is a
*decision* rather than a *power level*. Adding a cyclic role edge turns role
selection into a counter-pick puzzle (the thing that keeps a small roster deep).

## Design

### 1. The cycle (`ROLE_BEATS`)

A strict 4-cycle, thematically motivated:

```
 assassin ─beats→ sage      (burst deletes the squishy backline)
 sage     ─beats→ defender  (sustain out-attrits the wall)
 defender ─beats→ tracker   (armor shrugs off ranged poke)
 tracker  ─beats→ assassin  (range/kite kills the melee before it closes)
```

```ts
// lib/pet-roles.ts
export const ROLE_BEATS: Record<PetRole, PetRole> = {
  assassin: 'sage', sage: 'defender', defender: 'tracker', tracker: 'assassin',
};
```

### 2. The multiplier (mirrors `elementMultiplier`)

```ts
export function roleMultiplier(attacker: PetRole, defender: PetRole): number {
  if (attacker === defender) return 1;            // mirror = no edge (position-fair)
  if (ROLE_BEATS[attacker] === defender) return 1 + ROLE_EDGE;   // advantaged
  if (ROLE_BEATS[defender] === attacker) return 1 - ROLE_EDGE;   // countered
  return 1;
}
```

- `ROLE_EDGE ≈ 0.10` — deliberately **smaller than the 15% element edge**, so
  element stays the primary axis and role is the secondary tie-breaker (tunable).
- Pure + deterministic (function of role only) → ranked-replay-safe, both clients
  agree, no new save field.

### 3. Apply at the same hook in all THREE engines

The edge must be applied identically in `pet-battle-sim.ts` (live 1v1),
`pet-duel-sim.ts` (continuous), and `pet-arena-sim.ts` (tactical) — right where
each multiplies in `elementMultiplier` — or the role gate and ranked determinism
diverge between modes. Also fold it into `scorePetMatchup` so the **AI
counter-picks** and plays around the web instead of ignoring it.

### 4. Surface it in the picker

The team-picker already renders role badges (`ROLE_META`). Add a small
**"strong / weak vs"** hint (an up/down arrow + the countered role's icon) so
players can *see* the counter and make the pick deliberately — the difference
between a hidden formula and a real decision.

### 5. Guard test (the cyclic assertion)

```ts
// lib/pet-roles.test.ts — asserts no dominant / dead role
test('ROLE_BEATS is a strict 4-cycle', () => {
  const roles = ['defender','tracker','assassin','sage'];
  for (const r of roles) assert.notEqual(ROLE_BEATS[r], r);        // no self-counter
  // each role beaten by exactly one, beats exactly one
  const beatenBy = roles.filter(r => Object.values(ROLE_BEATS).includes(r));
  assert.equal(new Set(Object.values(ROLE_BEATS)).size, 4);        // covers all four
  // following the cycle visits all 4 before returning (single cycle, not 2+2)
  let cur = 'assassin'; const seen = new Set();
  for (let i=0;i<4;i++){ seen.add(cur); cur = ROLE_BEATS[cur]; }
  assert.equal(seen.size, 4); assert.equal(cur, 'assassin');
});
```

This is the same cyclic guard the **balance-CI-gates** plan reserves a slot for.

## Balance interaction (a feature, not a risk)

The current stat leans leave assassin strongest / tracker weakest in 1v1. The
cycle **raises tracker's 1v1 floor without a stat buff** (tracker now counters
assassin) and gives every role a predator — pushing role win-rates toward the
40–60% band. Verify by running the change through the
`scripts/pet-role-balance.ts` gate (see `docs/balance-ci-gates-plan.md`): expect
the overall role spread to tighten. If `ROLE_EDGE` over-corrects, lower it.

## Anti-cheat / determinism

- `roleMultiplier` is a pure function of roles, which `derivePetRole` derives
  deterministically from the pet's id/element/overrides — **no new persisted
  field, no save migration**, and ranked replays stay byte-identical.

## Wiring

- `lib/pet-roles.ts`: add `ROLE_BEATS`, `ROLE_EDGE`, `roleMultiplier`.
- Call sites: the damage hook in `pet-battle-sim.ts`, `pet-duel-sim.ts`,
  `pet-arena-sim.ts`, plus `scorePetMatchup`.
- `PetArena.tsx` team-picker: the strong/weak-vs hint.
- Tests: the cyclic guard in `pet-roles.test.ts`; re-run the role-balance gate.
- Client-only — **no `dist/` concern**; run `npm run lint` + the pet tests.

## Open questions

- `ROLE_EDGE` magnitude (10%? 12%?) and whether the cycle direction above feels
  right or should swap (e.g. defender↔assassin).
- For 2v2 / tactical team comps: show an **aggregate** team-vs-team hint, or
  per-pet only?
- Show the exact % or just a directional arrow in the picker (arrow is less
  intimidating, % is more legible to theorycrafters).

## Relationship to other work

- Shares the cyclic guard test with `docs/balance-ci-gates-plan.md`.
- Directly addresses the tracker 1v1-floor note in the pet-role-balance tuning
  history (raises it via counters, not stats).
- Collector-depth retention lever (audit research): makes a fixed roster feel deep
  by turning team-building into a counter-pick puzzle.
