# Hollow Warfront — Kage Tactics

Status: **live specification.** This replaces the retired lane-war, capture-scroll,
relic-run, and relay versions of Hollow Warfront.

Mode fantasy: **deploy four bonded pets onto a shinobi formation board, then watch
their roles, range, terrain reads, and target choices decide a best-of-three Rite.**

## Why this version exists

Earlier Warfront versions repeatedly collapsed into the same failure: every pet
ran at one objective or opponent, producing an unreadable melee pile whose
positioning barely mattered. Adding more map decoration or another objective noun
did not fix that behavior.

Kage Tactics changes the combat grammar instead:

- space is discrete and owned, so pets cannot push or occupy the same resting cell;
- ranged pets preserve distance and fire real travelling projectiles;
- shoji screens block movement and line of sight;
- roof cover reduces ranged damage and smoke disrupts clean aim;
- defenders, strikers, rangers, supports, and shadows use distinct priorities;
- target pressure is distributed so four pets do not automatically dogpile one body;
- the camera stays fixed so the player can read the formation rather than chase it.

## Match rules

- Both sides field **four active pets simultaneously**. There is no reserve.
- Combat uses a deterministic **7 × 5 board** with 35 owned cells.
- Before clash one, the player may place any of their four pets into any four of
  ten legal deployment cells. Roles are never position-locked.
- Two enemy placements are scouted; the other two remain sealed until the clash.
- A clash ends on a wipe or the survival verdict. More bodies standing wins;
  equal body counts fall to total health remaining.
- The first side to win **two clashes** wins the Rite.
- After clash one, the player receives one optional re-form and may move any pet
  to any open deployment cell.
- At 28 seconds, **Kage Verdict** increases damage and suppresses healing so a
  defensive formation cannot stall indefinitely. A 38-second fail-safe guarantees
  resolution.

## Combat model

`runPetSquadDuelCinematic` is the Warfront-only entry into the deterministic
formation simulation in `pet-duel-cinematic.ts`. Existing 1v1 and 2v2 Coliseum
entry points remain unchanged.

Each actor has one stable target at a time. Target selection weighs range,
role priorities, remaining health, line of sight, and how many allies already
pressure the same enemy. Movement uses deterministic breadth-first search over
the board and eight-tick cell interpolation; facing is reconciled after movement
so pets look at the target they are actually fighting.

Signatures require valid range and line of sight. Supports heal or shield real
allies, shadows can open with Shadow Step, and area attacks splash nearby cells.
The event stream records movement, casts, projectiles, impacts, protection,
critical hits, signatures, and knockouts for presentation.

## Authority and settlement

Rewarded AI matches remain server-authoritative:

1. `api/pet/warfront-start.ts` validates the four available pet IDs, snapshots
   both bands, mints the seed, seals the default authoritative replay, and returns
   a one-use battle token.
2. The client renders the sealed bands and seed, then submits only its `RitePlan`:
   order, ten-cell deployment, and optional re-form.
3. `api/pet/battle-result.ts` validates that plan and re-runs the complete Rite
   from the sealed snapshots. Rewards use the server's winner, never a client
   outcome claim.
4. The generated server mirrors under `api/_pet-sim/` stay byte-identical to the
   client simulation; parity tests enforce that boundary.

The existing exact-once receipt, retry, active-battle lease, and account-scope
guards still wrap settlement. PvP and co-op reuse the same `PetWarfrontRite`
presentation; shared spectator replays use the deterministic default plan.

## Presentation

- The playable arena is real 3D geometry: 35 stone/lacquer cells, shoji blockers,
  cover platforms, smoke volumes, clan inlays, lanterns, rails, and torii.
- The distant moonlit fortress is background art only; no gameplay floor is baked
  into it.
- The tactical camera is fixed. It does not orbit, cut, or follow targets.
- Fractional snapshot sampling interpolates position, facing, health, and
  projectiles without low-pass camera or actor smoothing.
- The render loop reads one clock ref, so React does not re-render the full match
  every animation frame.
- Desktop and Galaxy S25+ layouts keep the board, both four-pet rosters, score,
  exit control, and deployment action inside the viewport.

## Measured balance

The current 100-match harness reports:

| Metric | Result |
|---|---:|
| Blue-seat decisive win rate | 42% |
| Drawn matches | 0% |
| Idle fighters | 0% |
| Clashes with projectiles | 100% |
| Split-target openings | 100% |
| Clashes reaching the fail-safe | 0.7% |
| Median clash | 15.7s |
| Median match | 44.8s |
| Same-seed outcomes changed by deployment | 48% |

These are release ratchets, not permanent tuning targets. Re-run
`scripts/warfront-rite-harness.mts` whenever movement, targeting, stats, board
topology, or squad size changes.

## Files

| Piece | Path |
|---|---|
| Formation simulation | `shinobij.client/src/lib/pet-duel-cinematic.ts` |
| Best-of-three match authority | `shinobij.client/src/lib/pet-warfront-rite.ts` |
| Server mirrors | `api/_pet-sim/pet-duel-cinematic.ts`, `api/_pet-sim/pet-warfront-rite.ts` |
| Interpolation and explanations | `shinobij.client/src/lib/pet-warfront-rite-presentation.ts` |
| Deployment, HUD, and results | `shinobij.client/src/components/PetWarfrontRite.tsx` |
| 3D arena and effects | `shinobij.client/src/components/PetWarfrontRiteStage3D.tsx` |
| Responsive styling | `shinobij.client/src/styles/pet-warfront-rite.css` |
| Statistical harness | `scripts/warfront-rite-harness.mts` |
| Browser release suite | `shinobij.client/e2e-warfront/rite.spec.ts` |
| Development preview | `/petvfx.html?rite=1` |

## Retired lane engine

`pet-warfront-sim.ts`, `PetWarfrontMatch.tsx`, and `PetWarfrontStage3D.tsx`
remain only because the Pet Ladder still uses that server-authoritative replay
format. Nothing in the Pet Coliseum launches them as Hollow Warfront. Contract
tests pin the Coliseum and co-op entry points to `PetWarfrontRite` so the retired
mode cannot quietly return.
