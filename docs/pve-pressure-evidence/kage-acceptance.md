# Final story Kage acceptance controls

**Historical baseline:** the [2026-10-19 unlock-level balance pass](../story-late-balance-2026-10-19.md) supersedes the HP/stat values below. The full catalog kits and Apex policy remain current; the older measured outcomes describe their recorded configuration.

The four chapter-nine story bosses use an exclusive apex chooser: five legal
actions at most, beam eight and 192 resolver previews per decision. The seal
requires `story-boss`, `final-kage`, and `masterAi` together. Ordinary level 86+
and other master hosts retain beam six and 128 previews. The emergency planner
rollback still applies. Reused village raid guards retain their prior catalog
kits and defenses.

The authored bosses retain their existing 14,000 HP and .18 raw armor. Their
eight moves contain five damaging signatures, one offensive setup, one guard
and Flicker. All use catalog AP, effective player resource costs, cooldowns and
legal mastery. Keeping the guard gives players an observable Clear decision;
replacing it with a sixth signature would reduce recovery windows and remove
that interaction. This pass retains the guard.

## Winnability controls

`scripts/pve-kage-acceptance.ts` uses one Earth/Wind build for every village,
without reading the boss's hidden loadout or selecting a counterbuild. It fills
the actual twelve-slot endgame capacity with the audited eight-slot acquisition
fixture plus Gen Earth AoE, Gen Wind AoE, Buki Wind 2 and Gen Wind 4. These are
eight damaging moves, three utility moves and Flicker. Equipment exists in the
catalog and meets its effective level requirements; mastery and allocated
stats are recorded in the fixture audit. The maxed control has an explicitly
earned cap-stat ledger and S-rank bloodline; it is not the minimum level 100
progression allocation.

The public own-turn planner control can use only public combat state and legal
actions. It omits weapon actions, and is an approximate strong-play proxy. The
answer heuristic selectively cleanses, clears, maintains setup and uses legal
damage, weapons and movement; it is deliberately imperfect. Neither is an
optimal player solver.

| Fixed build / player policy | Storm | Ashen | Frost | Moon |
| --- | --- | --- | --- | --- |
| S-rank / mastery 50 / planner | win, 14 rounds, 4,783 HP | win, 9 rounds, 4,452 HP | win, 12 rounds, 2,983 HP | win, 12 rounds, 5,162 HP |
| B-rank / mastery 40 / planner | mutual defeat, 20 rounds | win, 14 rounds, 2,023 HP | defeat, 13 rounds | win, 19 rounds, 2,686 HP |
| S-rank / mastery 50 / answer | defeat, 12 rounds | win, 12 rounds, 3,714 HP | win, 15 rounds, 1,232 HP | win, 15 rounds, 4,108 HP |
| B-rank / mastery 40 / answer | defeat, 12 rounds | defeat, 12 rounds | defeat, 12 rounds | defeat, 18 rounds |

These controls establish that all four finales are winnable with one legal,
prepared endgame build and strong play. They do not promise a win for every
build or policy, or prove strict difficulty ordering in every matchup. Ordinary
viability and challenge ordering require their separate matched-fixture audit.
Earlier five-element or rarity-ineligible synthetic matrices are historical
stress evidence and are not acquisition-valid acceptance controls.

Reproduce on the current runtime:

```powershell
node --import tsx scripts/pve-kage-acceptance.ts --output docs/pve-pressure-evidence/kage-acceptance.json
```

The JSON was generated against the integrated runtime. It records source
hashes, full fixture audits, public actions, pressure, healing, resources, final
HP, deaths and round-limit outcomes.

## Matched ordinary ordering control

`kage-ordering.json` compares all four full-HP finales with five standard and
five elite archetypes at the actual highest regional roll, level 98. Every case
uses the exact same twelve-slot S-rank/mastery 50 save and public own-turn
planner. All fourteen cases were won.

| Encounter group | Cases | Mean rounds | Mean minimum HP | Mean ending HP | Mean direct HP + shield pressure per enemy turn | Mean net chakra use | Mean net stamina use |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Standard, level 98 | 5 | 9.20 | 6,953 | 6,964.6 | 393.45 | 1,625 | 140 |
| Elite, level 98 | 5 | 9.20 | 4,640.8 | 4,652 | 602.12 | 1,805 | 140 |
| Final story Kage | 4 | 11.75 | 4,174.25 | 4,345 | 603.32 | 2,156.25 | 270 |

Net resource use means starting minus ending pools after regeneration, rather
than the sum of cast costs. Player healing averaged 1,055.2/956.6/1,726.75 HP for
standard/elite/Kage respectively. No case had a cooldown-dry enemy turn.

Finales require longer sustained play, more net resources and lower minimum HP
on average. Elite Rogue was more punishing to HP than some village finales in
this matchup. These observations support the exclusive apex tactical tier and
an overall stronger final encounter package; they do not establish that every
finale beats every elite on every difficulty metric or player build. Ordinary
and final tactical quality remains separate from defense-driven fight length.

```powershell
node --import tsx scripts/pve-kage-acceptance.ts --builds maxed --policies planner --ordinary --load concurrent --output docs/pve-pressure-evidence/kage-ordering.json
```

## Ordinary viability without a bloodline bonus

`ordinary-capacity-probe.json` is a separate bounded control with exactly
29,000 earned stat points, mastery 30, no bloodline bonus, full starting vitals,
and the same acquired Earth/Wind twelve-slot kit. Its actual sealed bloodline
multiplier is asserted to equal 1. The public own-turn planner faced the bruiser
and defender at the low, middle and maximum standard regional rolls.

| Enemy level | Bruiser | Defender |
| --- | --- | --- |
| 90 | win, 11 rounds, 3,290 ending HP | win, 14 rounds, 7,134 ending HP |
| 95 | win, 13 rounds, 2,905 ending HP | win, 17 rounds, 4,176 ending HP |
| 98 | win, 19 rounds, 1,819 ending HP | win, 18 rounds, 4,091 ending HP |

All six cases were won without deaths or round-limit losses. The lowest
observed HP was 1,763. This demonstrates available full-capacity counterplay
without requiring a bloodline bonus for these two representative archetypes.
It does not guarantee ordinary wins for every build, policy or starting HP.

```powershell
node --import tsx scripts/pve-ordinary-capacity-probe.ts
```

## Bounded work and timing

`scripts/pve-kage-policy-benchmark.ts` compares identical cloned story sessions
at range four, after a signature, at low HP in melee, and with every signature
on cooldown. Each of four villages receives three warmups and eight measured
turns for each budget. Source sessions and combat rules are held constant.

The concurrent local QA sample in `kage-policy-budget.json` recorded median
state p50 of 31.1 ms for master and 37.6 ms for apex. The highest state p95 was
162.7 ms for master and 141.5 ms for apex. Maximum observed first-choice work was
72 versus 84 previews, within the deterministic 128/192 budgets. Some dry-turn
choices changed; most initial choices and complete matched fights were
identical. A wider approximate search is not a guaranteed stronger action on
every state. These samples show no material latency regression under that
load. Whole-fight wall timings also include proposal/rejection work and can
spike during parallel builds or test batches.

After the local build, lint, broad tests and matrix jobs completed, the
separate [isolated sample](kage-policy-isolated.json) used the frozen runtime
with 24 measured turns plus three warmups for every state and budget:

| Chooser | Median state p50 | Highest state p95 | Largest observed first-decision previews | Deterministic preview cap |
| --- | --- | --- | --- | --- |
| Master | 20.88 ms | 56.94 ms | 72 | 128 |
| Final Kage apex | 21.23 ms | 68.76 ms | 84 | 192 |

Both met the local sub-100 ms p95 target in this isolated sample. That is
machine-specific evidence, not a universal latency guarantee. The JSON records
current source hashes and `concurrentLoad: false`.

Reproduce the timing sample separately from broad QA for a quieter machine:

```powershell
node --import tsx scripts/pve-kage-policy-benchmark.ts --samples 24 --output docs/pve-pressure-evidence/kage-policy-isolated.json
```

Browser evidence is produced by
`shinobij.client/e2e/progressive-pve-presentation.spec.ts` on desktop 1366x768 and
phone 390x844. It decodes the real WebP portraits, resumes the same sealed
identity after refresh, checks visible difficulty, completes a deterministic
presentation-only victory, downloads its observed log, and opens Kage tells.
The ordinary fixture begins at one HP solely to reach the result UI; balance
measurements above retain full boss HP.

The focused Chromium desktop/phone run passed all four cases after the visible
phone badge and desktop tell containment fixes. Twelve actual screenshots are
saved under `.tmp/progressive-pve-browser` and attached to the Playwright
results. The certified immutable client snapshot manifest was
`8b9eb745d6a3ddcb873f365852e361c501fe7b9ebd7b15690aa4f9f0b620652f`.

