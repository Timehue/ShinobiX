# Stormveil level-65 boss pressure adjustment — 2026-10-19

Fixture qualification: this historical comparison used the older four-nature synthetic harness. The [later unlock-level audit](../../story-late-balance-2026-10-19.md) enforces acquired two-nature loadouts. The outcomes below are preserved, with that preparation limit; the level-65 production values are unchanged by the later pass.

The user clarified that routinely finishing a level-65 story boss with over
40% HP was too forgiving. The level-35 Frostfang fight was accepted and is
explicitly outside this adjustment.

Only Tempest Execution's outgoing damage changes: its formation factor goes
from 0.75 to 1.00, increasing damage by one third relative to the previous pass.
All nine enemies retain the same HP, stats, individual turns, catalog abilities,
positions and cooldown rules. Player stats, damage previews, rewards and
completion logic do not change. Oathbound Recovery remains at 0.50.

This supersedes the Stormveil factor and results in
[the first group balance audit](narrative-group-balance-2026-10-19.md).
The original audit and numeric evidence remain as the prior baseline.

## Evidence and selection

The same legal level-65 fixtures, ordinary shop armor, mastery-ten techniques,
four combat schools, balanced/focused allocations and visible-state policy
were retained. These are executions of the production combat resolver, not
human playtest win rates. Seeds are reproducibility checks rather than
independent random damage samples.

Six damage factors were compared across eight builds and four scenarios:
standard play, two damaging techniques equipped, a missed opening turn, and
disabled policy counters (192 candidate simulations). Only the selected
formation's outgoing damage was overridden in those experiments.

| Damage factor | Standard clears | HP left after standard clears | Missed-opening clears |
| --- | ---: | ---: | ---: |
| 0.75, previous | 8/8 | 38–46% | 8/8 |
| 0.85 | 8/8 | 25–36% | 8/8 |
| 0.90 | 8/8 | 22–35% | 8/8 |
| 0.95 | 8/8 | 21–32% | 8/8 |
| **1.00, selected** | **8/8** | **13–29%** | **5/8** |
| 1.05 | 8/8 | 8–24% | 4/8 |

The selected setting provides stronger boss pressure while all eight standard
builds retain a clear. It also clears for all eight two-attack builds (4–25% HP)
and all eight builds with policy counters disabled (16–29% HP). It intentionally
does not guarantee survival after wasting the opening turn. The primary
regression now requires ordinary standard clears to end at no more than 35% HP,
so a future accidental reduction in pressure is caught.

This is a user-directed balance target adjustment, not a change to AI decision
logic or a repair to encounter health scaling. It does not certify all builds,
equipment, weather, terrain or sequences of player actions.

## Verification

The final matrix clears **648/648** runs. Stormveil's standard clears take
13–14 rounds and leave 13–29% HP. The level-35 Frostfang clears remain exactly
9–10 rounds and 22–34% HP. All **624 non-Stormveil runs** retain identical
outcomes, remaining vitals, rounds, actions and command counts to the previous
audit. Every encounter also retains its original total enemy HP and roster size.

All **88 focused regressions** pass, including the new boss-pressure bound,
authoritative health/stat sealing, group completion, settlement and damage
preview parity. The server TypeScript build passes. Numeric evidence is saved in
[stormveil-65-pressure-2026-10-19.json](stormveil-65-pressure-2026-10-19.json).

The full repository suite is run across both supported file shards. Together
they cover the complete file list; neither shard is presented as the full suite
on its own.

An initial concurrent run exposed a load-sensitive failure in
`api/player/heartbeat-battle-authority.test.ts`. Its five-second background
settlement wait included lazy loading the settlement dependency graph. The
unchanged case passed in isolation; the fixture now loads those modules in its
`before` hook. All five heartbeat tests pass again, retaining the same deadline
and terminal-status, HP, save and projection assertions. The production
heartbeat/reconciliation code is unchanged. The affected full-suite shard is
rerun after that setup adjustment; its interrupted first attempt is excluded
from the final totals.

A separate live scheduling probe in `api/_runtime-metrics.test.ts` failed under
the parallel run and passed both tests on isolated rerun. Its checks compare
CPU utilization, event-loop delay and an idle window against wall-clock bounds.
No metrics code or assertions were changed. The final full-suite summary
records this result explicitly; an isolated pass is not presented as a clean
full-suite pass. The exact failed assertion was measured CPU cores `0.146`
against a required value greater than `0.3` during the synthetic spin window.

The complete final file coverage (both shards) reports **16,128 passed,
28 skipped, one failed, zero cancelled; 16,157 total tests**. Shard one passes
8,293/8,293. Shard two reports 7,835 passed, 28 skipped and the single live
CPU-probe failure out of 7,864. This is **not a fully green suite**. All focused
combat checks and the balance matrix pass; the separate timing probe also
passes both tests when rerun alone.

## Reproduction

```powershell
$env:NODE_ENV='test'
$env:SHINOBIX_QA_MEMORY_KV='1'
node --import tsx scripts/narrative-group-balance-audit.ts .tmp/stormveil-pressure-candidates.json --stormveil-candidates
node --import tsx scripts/narrative-group-balance-audit.ts .tmp/stormveil-pressure-final-matrix.json --matrix --expanded
node --import tsx --test scripts/narrative-group-balance.test.ts api/solo-pve/_group-combat.test.ts api/story/narrative-group-handlers.test.ts
npm run build:server
```

Run `npm run test:ci` with `TEST_SHARD_TOTAL=2` and `TEST_SHARD_INDEX=1`, then
index `2`, or run without sharding. Source ownership remains
`shared/narrative-groups.ts`; actor sealing and actual damage resolution remain
in `api/solo-pve/_group-combat.ts` and `api/towers/_engine.ts`.
