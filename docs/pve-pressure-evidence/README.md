# Progressive PvE pressure and viability evidence

The final version-2 comparison uses the immutable production baseline `e2ccccb0d` and the current server builders/resolver. It contains **520 Explore cases (1,040 before/after rows)** and **300 road cases (600 rows)**. All cases completed. Every source hash matches the files used for this report. No live saves or combat were read or changed.

The original matrix remains in `explore-comparison.json`, `road-comparison.json` and `summary.json`, explicitly marked **superseded synthetic stress**. Its old gear/element assumptions do not establish progression balance. The corrected datasets are [v2-explore-comparison.json](v2-explore-comparison.json), [v2-road-comparison.json](v2-road-comparison.json), and [v2-summary.json](v2-summary.json). [The diagnostic audit](viability-diagnostic.md) explains why the fixtures and durability were corrected.

## Controlled progression fixtures

All five player builds are tested at levels10/25/50/75/100. Starter is an intentionally weak gear/mastery10 control. Midgame has trainable mastery30; offense/defense have Seal-trained mastery40; maxed has rank-capped mastery (50 at50+), full capped L100 stats and S-rank1.20. Nonstarter trained fixtures use a moderate B-rank1.10 multiplier without extra bloodline skills. Lower-level mastery and raw stats obey the shared rank caps. Coherent allocation conserves the earned ledger. Equipped catalog gear is owned, slot-compatible and effective-level-gated; one nature is acquired below20 and two from20. Each fixture passes the independent comprehensive validator before any fight.

The Earth/Wind kit uses two Genjutsu Siphon attacks, Earth Ignition, Wind Recoil, Wind Lifesteal, damage/DR setup, Shield/Absorb and Flicker. Exact catalog tags, costs and gates are recorded in the JSON audits. Eight techniques are a conservative bounded loadout below the player’s baseline12 slots. No pets, consumables or premium capacity are assumed. These are synthetic progression fixtures, not copies of live players.

The deterministic `answer` policy reacts to visible harmful statuses, maintains setup, uses equipped weapons, attacks and approaches. It does not inspect hidden loadouts or future input and is not asserted optimal. Separate bounded `planner`/full-vital/75%-vital sensitivity probes are retained in [v2-viability-probes.json](v2-viability-probes.json). Ordinary viability means accessible wins and meaningful counterplay across reasonable builds, not a universal win requirement for every policy or injured entry.

The conservative no-bloodline mastery-30 eight-slot planner control wins two of six standards: both L90 opponents. Its L95/98 bruiser fights end in death and defender fights in living timeouts. That sensitivity and remaining enemy HP are documented in the [diagnostic report](viability-diagnostic.md); the trained matrix's B-rank multiplier and bounded loadout are explicit assumptions.

A separate [full-capacity control](ordinary-capacity-probe.json) keeps the same 29,000 earned points, mastery 30, no bloodline bonus, Earth/Wind ownership and public planner, while filling the baseline twelve slots. It wins all six bruiser/defender standards at levels 90/95/98, in at most 19 rounds with minimum observed HP 1,763. This bounded result demonstrates available counterplay for those representative cases, without erasing the eight-slot failures or promising wins for every build. See the [comparison table](kage-acceptance.md#ordinary-viability-without-a-bloodline-bonus).

## Actual encounter levels and paths

Progression regions are sectors3/14/32/50/66 at player levels10/25/50/75/100. Explore seeds0–4 cover bruiser/skirmisher/assassin/elementalist/defender and fractions0/.25/.5/.75/.999999. Road seeds0–2 cover bandit/nightblade/miner and fractions0/.5/.999999. The shared roll helper supplies every after-level. At100, standards span90–98 and weaker rolls65–84; the current highest region caps ordinary enemies at98. Regional danger/onboarding caps remain authoritative.

Before Explore uses the original authored-profile plus weighted builder-scaling constructor. Before road uses its original player+1 capped100/generic-stat construction and old template mapping. At player levels 10 and 25, before Explore deliberately relevels all five fixed role templates: the original eligible pool excluded authored Rogue Ninja 47, Shadow Weaver 48 and Frost Sealer 32. Those rows are controlled role comparisons, not a reconstruction of the old random population. All five templates were eligible from level 50, so the high-level pressure comparisons are unaffected. Tier-before rows reuse identical original fights; no artificial weaker baseline is invented.

## Legal mastery, resources and ordinary durability

| Enemy level | Weaker | Standard | Dangerous | Elite | Final Kage |
| --- | ---: | ---: | ---: | ---: | ---: |
|10|7|10|10|10|–|
|25|14|20|20|20|–|
|50/75/100|21|30|40|50|50 at100|

Rank caps and the enemy’s actual rolled level apply. Shared damaging EP is `(authoredEP+10)*(0.3+0.7*mastery/50)`: catalog EP36 becomes33.12/39.56/46 at mastery30/40/50. Zero-damage40AP setups remain zero-damage. Classified NPCs use the same v2 one-bar costs and level pools as players; universal Any techniques route to each caster’s specialty. At100 a60AP cast costs350, a40AP setup175, Flicker90, with10,000-point maximum pools. No arbitrary EP or damage multiplier is added.

Ordinary enemies from36 use shared player HP at their sealed level and raw armor capped0.25 below65/0.35 from65. Existing lower armor remains lower. Six existing damaging techniques remain available at high levels; offense, resource rules and tactical planning are retained. Low-level/protected rivals, patrols and reused raid profiles keep their own balance. Final story Kage retains14,000HP/0.18raw armor and has the exclusive192-preview/8-beam apex chooser; the ordinary planner remains bounded at128/6. No PvP formula changed.

## Offensive pressure

Direct pressure below is mean observed enemy HP damage plus shield damage per enemy turn, excluding Clear. Before is the actual original same-player constructor. All25 Explore or15 road cases at each tier/level are included, including the weak starter control.

| Path | Player level | Before | Weaker | Standard | Dangerous | Elite |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
|explore|10|142.1|141.9|146.5|142.1|142.1|
|explore|25|300.6|278.2|387.1|403.1|403.1|
|explore|50|676.0|428.3|794.4|1065.8|1111.6|
|explore|75|629.8|372.8|711.0|963.9|1090.7|
|explore|100|513.5|289.6|566.0|746.7|895.3|
|road|10|129.7|103.4|128.7|119.9|119.9|
|road|25|257.7|293.5|392.0|416.5|416.5|
|road|50|598.1|375.9|774.8|1049.1|1078.4|
|road|75|574.9|330.3|663.5|931.9|1069.7|
|road|100|527.3|273.7|557.6|759.1|868.9|

The same calculation restricted to the four trained fixtures excludes the deliberately weak starter control:

| Path | Level | Before | Standard | Change | Dangerous | Elite |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
|explore|50|607.8|701.8|15.5%|999.2|1042.8|
|explore|75|507.3|596.0|17.5%|781.2|915.5|
|explore|100|412.9|463.9|12.3%|616.8|730.7|
|road|50|493.8|685.9|38.9%|980.7|1015.1|
|road|75|445.4|572.0|28.4%|759.6|919.3|
|road|100|437.1|454.6|4.0%|624.8|716.6|

## Viability by build

Entries are **wins / HP-zero endings / living round-limit losses**, out of five Explore or three road cases. These are independent counts: a mutual finish can produce an engine win while both fighters reach zero HP, so the first two counts can overlap. Exact outcomes and HP remain in JSON. Full resources are used here; the separate depleted-vital probes remain harder. The reported trained standard wins have no HP-zero overlap.

| Path | Level | Build | Weaker | Standard | Dangerous | Elite |
| --- | ---: | --- | --- | --- | --- | --- |
|explore|50|starter|3/2/0|0/5/0|0/5/0|0/5/0|
|explore|50|midgame|5/0/0|5/0/0|0/5/0|0/5/0|
|explore|50|offense|5/0/0|5/0/0|2/4/0|0/5/0|
|explore|50|defense|5/0/0|5/0/0|2/4/0|0/5/0|
|explore|50|maxed|5/0/0|5/0/0|2/3/0|0/5/0|
|explore|75|starter|3/2/0|0/5/0|0/5/0|0/5/0|
|explore|75|midgame|5/0/0|5/0/0|0/5/0|0/5/0|
|explore|75|offense|5/0/0|5/0/0|3/2/0|0/5/0|
|explore|75|defense|5/0/0|5/0/0|1/4/0|0/5/0|
|explore|75|maxed|5/0/0|5/0/0|2/4/0|0/5/0|
|explore|100|starter|2/2/1|0/5/0|0/5/0|0/5/0|
|explore|100|midgame|5/0/0|5/0/0|3/2/0|1/4/0|
|explore|100|offense|5/0/0|5/0/0|4/1/0|2/3/0|
|explore|100|defense|5/0/0|5/0/0|4/1/0|3/2/0|
|explore|100|maxed|5/0/0|5/0/0|5/0/0|5/0/0|
|road|50|starter|2/1/0|0/3/0|0/3/0|0/3/0|
|road|50|midgame|3/0/0|3/0/0|1/2/0|0/3/0|
|road|50|offense|3/0/0|3/0/0|2/2/0|0/3/0|
|road|50|defense|3/0/0|3/0/0|2/2/0|0/3/0|
|road|50|maxed|3/0/0|3/0/0|2/1/0|0/3/0|
|road|75|starter|2/1/0|0/3/0|0/3/0|0/3/0|
|road|75|midgame|3/0/0|3/0/0|0/3/0|0/3/0|
|road|75|offense|3/0/0|3/0/0|2/1/0|1/2/0|
|road|75|defense|3/0/0|3/0/0|1/2/0|0/3/0|
|road|75|maxed|3/0/0|3/0/0|2/2/0|0/3/0|
|road|100|starter|1/0/2|0/3/0|0/3/0|0/3/0|
|road|100|midgame|3/0/0|3/0/0|2/1/0|2/1/0|
|road|100|offense|3/0/0|3/0/0|2/1/0|2/1/0|
|road|100|defense|3/0/0|3/0/0|2/1/0|2/1/0|
|road|100|maxed|3/0/0|3/0/0|3/0/0|3/0/0|

## Final story Kage controls

All four finales at100 are included with the same five bounded player fixtures and policy; the final rows are never mixed into ordinary aggregates.

| Build | Before wins/4 | After wins/4 | After HP-zero | After living limits |
| --- | ---: | ---: | ---: | ---: |
|starter|0|0|4|0|
|midgame|4|0|4|0|
|offense|4|0|4|0|
|defense|4|0|4|0|
|maxed|4|3|1|0|

The conservative eight-slot policy is not a proof of unwinnability. The separate [legal12-slot apex controls](kage-acceptance.md) establish a winning route for every village with the maxed fixture; build/policy sensitivity and remaining risks are described with that evidence and its [complete JSON](kage-acceptance.json). Narrative, rewards, retry handling and HP were not increased to create difficulty.

## Interpreting measurements and reproducing

`rawAfterMitigation` means post-DR/amplifier and pre-encounter-guard, not pre-DR damage. Immutable baseline events do not expose formula base; current casts expose base/effectiveDR where available. HP-damage includes observed DOT/recoil losses; direct enemy damage is separate. Shield damage, guard prevention, applied healing, final/minimum HP, net loss, AP, cooldown-dry turns and final resources are retained separately. Healing can net within an event; net resource spend includes regeneration. These limitations prevent assigning unobserved prevention/healing to a formula. Timings include script proposal/rejection overhead under load and are not pure planner latency.

Run on a clean checkout of the measured head with Node matching `.nvmrc`; recorded local Node is24.15.0. Extract baselineapi/shared/scripts from the immutable SHA to a separate directory and expose the repository node_modules via NODE_PATH if needed. Then run:

```powershell
$env:NODE_PATH = Join-Path (Get-Location) "node_modules"
node --import tsx scripts/pve-viability-comparison.ts --baseline-root ../pve-baseline --path explore --output explore.json
node --import tsx scripts/pve-viability-comparison.ts --baseline-root ../pve-baseline --path natural --output road.json
```

The comparison rejects illegal or current-UI-inaccessible fixtures before combat, captures13 source SHA256 hashes and writes every case with its exact seed, level, gear audit and outcome. Historical stress evidence remains labeled and is not reused as the corrected baseline.
