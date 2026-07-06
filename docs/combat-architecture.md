# Combat Architecture

Shinobi Journey combat is being migrated toward a shared `api/combat-core/`
without changing live PvP balance. The current rule is incremental extraction:
move pure, deterministic contracts first; leave session, reward, auth, storage,
and deployment behavior in the feature handlers.

## Layers

- `api/combat-core/` owns shared pure primitives: grid geometry, turn-envelope
  constants, status list operations, resource-cost helpers, player-side damage
  formula helpers, tag scaling, status timing helpers, normalized combat types,
  and the `resolveJutsu` phase runner.
- `api/combat-adapters/` converts feature-specific session shapes into
  combat-core shapes. Adapters must stay pure: no KV, auth, receipts, rewards,
  request/response objects, or wall-clock writes.
- `api/pvp/move.ts` remains the live PvP shell. It owns API validation,
  locking/idempotency, AP/action gating, item-charge spending, resource spend,
  receipts, reward hooks, session persistence, PvP-specific status mutation,
  grid displacement, and battle log wording.
- `api/towers/_engine.ts` and clan-boss flows must reuse PvP/core resolver
  helpers for player-side jutsu/tag/status behavior instead of copying the
  resolver phases.
- Mission, village-guard, tower, and clan-boss systems may own encounter rules,
  enemy scaling, AI, objectives, rewards, loot, and settlement. They must not own
  separate copies of player-side jutsu damage, tag resolution, or status timing.
- Pet battle and card battle engines are intentionally excluded; they are separate
  combat games with their own balance models.

## Jutsu Resolution

`api/combat-core/resolveJutsu.ts` owns the load-bearing phase order:

1. Base damage setup reads the formula copies.
2. Tag/status resolution threads mutated fighters and queues heal/shield/pierce.
3. Final damage number reads the original fighters.
4. Post-damage effects run only when damage lands.
5. Pending self heal and shield are applied last.

PvP passes its phase functions into this runner. The phase order is shared, and
the pure formula helpers those phases use live in `api/combat-core/formulas.ts`.
PvP still owns the wrapper shape, alias handling, grid-specific displacement,
and exact log wording for the live API.

## Duplication Rules

- Do not introduce new player-side jutsu damage, tag-scaling, status-timing, or
  formula constants in towers, clan boss, mission, village-guard, or
  server-facing code when the value already exists in combat-core.
- Do not copy `resolveTagStatuses`, `resolvePostDamage`, or the `applyJutsu`
  phase pipeline into tower, clan-boss, mission, or village-guard code. Add an
  adapter and a parity test instead.
- When moving a formula helper from `api/pvp/move.ts`, keep a PvP wrapper or
  export-compatible call site until all direct tests and tower callers are moved.
- Every extraction needs one of: a golden replay, a formula parity assertion, or
  a static guard that proves the old and new call paths are still tied together.

## Current Migration State

- PvP `applyJutsu` delegates phase orchestration to combat-core
  `resolveJutsu`, then maps the result back to the existing
  `{ self, opponent, lines, fx }` return shape.
- `api/combat-core/formulas.ts` now owns the shared numeric helpers for mastery
  scaling, rank caps, offense/defense composites, terrain/weather/home terrain,
  armor raw DR, DR/amp soft caps, bloodline/item multipliers, Pierce, Wound, Heal,
  Shield, Drain, tag percent scaling, aggregate direct-damage setup, final direct
  damage collapse, heal multipliers, and post-damage cap math.
- Non-combat progression endpoints that need rank caps import the combat-core
  helpers instead of copying the tables. Current examples: combat stat growth
  uses `statCapForLevel`, and Honor Seal jutsu training uses
  `jutsuLevelCapForLevel`.
- PvP formula callbacks (`resolveBaseDamage`, `resolveTagStatuses`,
  `resolveDamageNumber`, `resolvePostDamage`) still live in `api/pvp/move.ts`
  because they mutate PvP fighter copies, apply aliases/prevent checks, handle
  grid displacement, preserve battle log wording, and thread PvP fx output. Their
  numeric formula work delegates to combat-core helpers.
- `api/combat-adapters/pvpAdapter.ts` converts `PvpSession` to and from
  normalized combat state.
- `api/combat-adapters/clanBossAdapter.ts` converts tower/clan-boss combatants,
  jutsu, resources, environment, and target defense data into normalized combat
  inputs. Tower/clan-boss jutsu calls go through this adapter before reaching the
  PvP-backed player-combat resolver.
- `api/clan-boss/_assault.test.ts` statically guards adapter usage and checks the
  clan-boss adapter's player-side resolver against PvP. `api/towers/_engine.test.ts`
  verifies a full tower jutsu action against the same PvP resolver plus the tower
  AP/resource/cooldown shell.

## Tower Shell Audit

- Tower spends AP/resources in `applyAction` before calling `runJutsu`: AP is
  deducted from `session.activeAp`, chakra/stamina are deducted from the
  `TowerActor`, and cooldowns are armed on the actor.
- Tower ticks cooldowns during turn handoff/round progression inside
  `startRound`/turn advancement logic, not inside combat-core.
- Intentional differences from PvP remain: N-actor turn queues, board movement,
  encounter AP shell, pylon/ward/enrage/bulwark modifiers, AI, objectives,
  rewards, settlement, boss HP/phases, tower ground zones, and resource handling
  for items/weapons.
- No accidental tower/PvP formula drift is known after this pass: player-side
  jutsu damage/status/tag resolution flows through the tower adapter into the
  PvP-backed combat-core path and is pinned by parity tests. Tower fallback
  `computeDamage` also consumes combat-core direct-damage helpers rather than
  owning copied player-combat constants.
- Safest future migration step: extract shared AP/cooldown/resource helper calls
  for tower jutsu actions while keeping the tower-owned N-actor turn shell and
  cooldown timing tests unchanged.
