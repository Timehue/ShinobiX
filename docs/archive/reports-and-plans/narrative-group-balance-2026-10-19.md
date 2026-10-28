# Narrative group encounter balance audit — 2026-10-19

Fixture qualification: the [later unlock-level audit](../../story-late-balance-2026-10-19.md) found that this older harness did not validate ownership of its four technique natures. These outcomes remain synthetic engine evidence, not acquisition-valid character acceptance. The later audit enforces two acquired natures, free slot capacity and effective gear gates.

Follow-up: the user requested stronger level-65 boss pressure. The Stormveil
factor/results below describe the first pass and are superseded by
[the Stormveil pressure adjustment](stormveil-65-pressure-2026-10-19.md).
The accepted level-35 fight remains unchanged.

Question: can ordinary characters defeat the newly separated story, quest and
world-event groups when those fights become available, particularly the nine-
and thirteen-opponent story battles?

The encounter roster, separate health, independent turns, identity and catalog
abilities remain intact. This pass adjusts outgoing enemy damage on selected
formations. It does not change player stats, reward authority, quest receipts,
story completion, Tower floor scaling or encounter health budgets.

## Authority and evidence

- Roster and formation damage configuration: `shared/narrative-groups.ts`.
- Sealed actor construction: `api/solo-pve/_group-combat.ts`.
- Damage resolution: `api/towers/_engine.ts`, including its existing
  `towerDmgScale` multiplier and status damage context.
- Client damage estimate: `shinobij.client/src/lib/tower-tactical-ui.ts` already
  consumes the same multiplier. A regression compares its estimate to a real hit.
- Encounter sources: `api/story/_authoritative-story-combat.ts`,
  `api/missions/_world-ai-fight.ts`, `api/sector/_questbook.ts`,
  `shared/world-crisis.ts`, and `shared/story-road-fights.ts`.
- Reproduction: `scripts/narrative-group-balance-audit.ts` and
  `scripts/test-fixtures/narrative-group-balance.ts`.
- Numeric evidence: [narrative-group-balance-2026-10-19.json](narrative-group-balance-2026-10-19.json).
- Earlier completion/UI verification:
  [narrative-group-combat-2026-10-19.md](narrative-group-combat-2026-10-19.md).

The requested expectation is that all described opponents participate separately
and an ordinary, correctly leveled character has a practical route to victory.
The primary finding is **implementation drift from that expectation through
tuning**, with high confidence from controlled executions of the production
combat resolver. This is engineering audit evidence, not production telemetry or
a new canonical design specification. No managed KB context/state files change.

## Why stat splitting was insufficient

The previous group implementation conserved total encounter HP and split the
original offensive stats among members. However, damage is not proportional to
those offensive stats. `statFactorFromComposites` clamps the composite stat
factor between 0.35 and 1.85, and general stats also contribute to offense.
Thirteen independent enemies therefore retain substantial base damage even
after their school offense is divided.

Before tuning, every tested level-35 Frostfang build died in round three. The
nine-enemy level-65 Stormveil fight was winnable with the visible-state policy,
but left only 13–29% HP. Shirakawa and the Frostfang crisis also defeated some
ordinary builds; Black Bridge and Cinder had very narrow surviving margins.

The correction seals the existing `towerDmgScale` field on enemies when the
group is created. Actual damage and the existing preview read that same field.
It never reaches the player's character. This avoids changing global combat
formulas or importing Tower floor stat scaling into these encounters.

## Final formation values

| Formation | Outgoing damage factor |
| --- | ---: |
| Tempest Execution, nine enemies | 0.75 |
| Oathbound Recovery, thirteen enemies | 0.50 |
| Black Bridge Raiders | 0.85 |
| Shirakawa's Erasure Team | 0.75 |
| Cinder's Scout Team | 0.85 |
| Frostfang crisis captain and escorts | 0.80 |
| Each of Goro's three waves | 0.50 |
| Road patrol groups | 0.75 |
| Other converted formations | 1.00 |

Both twin fights retain their existing independent tuning. Formation members
still share the original encounter's exact total HP, retain their own turns,
cooldowns, resource pools, defenses and catalog effects, and all must be
defeated. New seals use content version `narrative-groups.2`. Already active
sessions retain their sealed values; start a new encounter to exercise the new
balance values.

## Scenario and acceptance boundary

The primary matrix uses four combat schools (Ninjutsu, Taijutsu, Bukijutsu,
Genjutsu), each with a balanced and a focused allocation. Every allocation
conserves the exact `earnedForLevel` budget and respects the raw stat cap.

Equipment is deliberately modest: the ordinary level-five shop set costing
1,245 ryo in total, or a starter cloth robe below level five. Techniques are real
catalog attacks from the character's own school, one utility and Body Flicker,
with mastery capped at ten or the character's legal cap. There are no pets,
bloodlines, relics, consumables, test-only attacks or HP restoration during a
fight. Basic Heal, Clear and Cleanse are real combat actions with their actual
AP costs and cooldowns.

Fights use the real 12-by-10 group deployment and the selected encounter's
biome. The fixtures add no weather modifiers, hazards or extra blocked tiles.

The player policy uses visible distance, HP, effects, cooldowns, AP and resource
availability. It targets accessible enemies, uses ordinary counters, and moves
legally. It does not inspect future enemy turns, search seeds or inject lethal
damage. Failed speculative movement/counter attempts are counted and must fall
back to a legal action. Every reported clear requires positive player HP and
every enemy defeated. The starting sealed fixture remains unchanged by the
simulation.

The matrix covers 27 encounter/level/wave cases: all four converted story
chapters, both twin encounters, Black Bridge, all three Goro waves, Shirakawa,
Kuroban, Cinder, the Frostfang crisis at levels one and 37, and all four village
patrol rosters at levels one, 15 and 35. Quest levels use their configured lower
bands; Debt is conservatively tested at level one. An active crisis and patrols
have no personal level-37/15 gate, which is why the low-level cases are included.

Three seeds (1, 7 and 42) provide reproducibility checks. This resolver's damage
does not randomly roll those seeds, so the repeats are **not independent win-rate
samples**. The meaningful build diversity is eight builds per encounter case.

## Results

All **648/648** runs in the final matrix clear with positive player HP and all
opponents defeated (27 encounter cases × eight builds × three reproducibility
seeds). These are controlled clears, not an estimated population win rate.

| Encounter | Before tuning, eight builds | Final rounds | Final HP remaining |
| --- | --- | ---: | ---: |
| Tempest Execution, level 65, nine enemies | 8/8; 13–29% HP | 12 | 38–46% |
| Oathbound Recovery, level 35, thirteen enemies | 0/8; died round 3 | 9–10 | 22–34% |
| Shirakawa, level 40 | 5/8; 0–13% HP | 10–15 | 21–39% |
| Frostfang crisis, level 37 | 6/8; 0–23% HP | 9–13 | 21–43% |
| Black Bridge, level 52 | 8/8; 8–34% HP | 10–19 | 18–44% |
| Cinder, level 50 | 8/8; 1–36% HP | 13–21 | 15–48% |

Both twin encounters and the remaining converted story groups also clear for
all eight builds. All four hostile patrol rosters clear at levels one, 15 and
35; the low-level crisis case clears as well.

The separate large-fight stress set passes **48/48**. Goro's complete consecutive
sequence passes **8/8**. The server TypeScript build passes. The final complete
`npm run test:ci` run passes: **16,129 passed, 28 skipped, zero failures or
cancellations, 16,157 total tests**. This includes all 30 new balance regression
checks and the existing group lifecycle/settlement tests. The skipped tests
require optional integration environments; they are not claimed as executed.

Large-fight stress scenarios separately remove two damaging techniques, spend
the opening turn waiting, or disable the policy's counters. The thirteen-enemy
fight remains dangerous after a missed opening: its lowest tested finish is
about 5% HP. This is a margin check, not a promise that every sequence of player
actions wins.

Goro is tested both as individual encounters and as a consecutive three-wave
sequence carrying actual remaining HP, chakra and stamina into each next
encounter. It receives no hidden intermission refill. At the original damage
factor none of the eight builds cleared the sequence without outside recovery;
candidate factors 0.70, 0.60 and 0.55 cleared 0, 2 and 5 builds respectively.
The selected 0.50 factor clears all eight, ending with 169–659 of 1,600 HP.

## Limits and revisit triggers

These are controlled production-engine simulations, not a human playthrough or
a statistical player win rate. They establish accessible routes to victory for
the stated unlock-level fixtures, including the two large formations. They do
not establish that unspent stats, arbitrary loadouts or a character arriving
already wounded will succeed.

Additional scaling probes deliberately retained level-five armor and mastery-ten
techniques at levels 65–100. Several encounters then lose or hit the global
combat time limit; training techniques to the legal level cap removes most of
those failures. Those probes do not certify late-game balance for every build.
Their data is retained in the numeric evidence rather than presented as passing
unlock-level results. Revisit with realistic late-game equipment/loadouts or
player telemetry before claiming full-range scaling balance.

Re-run this audit if roster counts, base HP, stat formulas, AI actions, encounter
level offsets, technique effects, mastery scaling, or global turn limits change.
The full repository regression suite continues to cover combat completion,
settlement, proof replay, rewards and the embedded Tower integration.

## Reproduction

In a test environment using the isolated in-memory QA store:

```powershell
$env:NODE_ENV='test'
$env:SHINOBIX_QA_MEMORY_KV='1'
node --import tsx scripts/narrative-group-balance-audit.ts .tmp/group-matrix-final.json --matrix --expanded
node --import tsx scripts/narrative-group-balance-audit.ts .tmp/group-stress-final.json --stress
node --import tsx --test scripts/narrative-group-balance.test.ts api/solo-pve/_group-combat.test.ts api/story/narrative-group-handlers.test.ts
npm run build:server
npm run test:ci
```
