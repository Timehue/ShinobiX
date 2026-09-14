# Pet Colosseum balance and visual pass — September 7, 2026

The live Colosseum runs the server-owned Showdown engine. This pass adjusts 12 species in that engine, improves combat information, and expands the existing balance audit to all three formats. Camera positions, angles, field of view, framing and the camera director are unchanged.

## Research and approach

- Riot's [balance framework](https://www.leagueoflegends.com/en-us/news/dev/dev-balance-framework-update/) evaluates performance in separate populations and uses results to identify outliers while preserving character identity. Here, the relevant slices are format and progression level. Broad role and element rates were already healthy, so this pass uses small species corrections instead of changing the element wheel or flattening roles.
- Riot's [gameplay clarity principles](https://www.leagueoflegends.com/en-us/news/dev/clarity-in-league/) prioritize readable mechanics, visual hierarchy, and restrained noise. This pass makes the acting pet, signature charge, guard and status effects explicit, and corrects inaccurate target badges.
- [Demonstrating the Feasibility of Automatic Game Balancing](https://arxiv.org/abs/1603.03795) investigates simulation-based balancing in a card game. It supports using simulation as a design tool; it does not establish that bot win rates predict human play. The numbers below are reproducible diagnostics, not player telemetry.

## Measured changes

Corrections multiply the existing Showdown species normalization, leaving move kits, Growth Point allocations and stored pet records intact. The unchanged shared reward rules still determine payouts. Other modes that use the same Showdown engine inherit these species corrections; legacy pet simulators do not.

The comparison below uses the **same** 35,160 level-50 duel matchups, 12 seeds and combat seed offset 104729 before and after. Each lead carries two reserves. Rates describe the lead's team winning, including its reserves.

| Pet | Combat stat correction | Before | After |
|---|---:|---:|---:|
| Red Fox | +6% | 31.0% | 32.3% |
| Scorch Skink | +8% | 30.4% | 52.6% |
| Night Panther | +5% | 34.7% | 43.0% |
| Sky Falcon | +10% | 32.5% | 41.5% |
| Tide Otter | +6% | 35.5% | 45.9% |
| Glacier Wolf | +10% | 32.8% | 52.0% |
| Tidelord Leviathan | +6% | 36.2% | 52.0% |
| Granite Gargoyle | +4% | 36.8% | 40.8% |
| Sand Snake | −6% | 71.8% | 58.2% |
| Granite Wombat | −4% | 69.2% | 51.0% |
| Ironfang Tiger | −5% | 64.9% | 49.1% |
| Solar Stag | −6% | 63.9% | 62.0% |

Solar Stag's stronger signal was team play and level 1, not its duel column. Red Fox remains a weak duel pick; forcing every pet toward 50% would risk its other matchups. Because Red Fox also serves as the shared reserve in this audit, its adjustment affects the environment in which every lead competes. These figures measure the complete patch, not isolated causal effects of each multiplier.

## Validation

The final matrix covers **175,800 matches**, excluding tuning runs and unit-test simulations. All existing analyzer bands pass: roles/elements within 40–60%, species within 25–75%, appropriate pace, and no unresolved games.

| Slice | Matches | Average rounds | Species win-rate range | Judge decisions |
|---|---:|---:|---:|---:|
| 1v1, level 50 | 35,160 | 19.7 | 32.3–68.7% | 1.93% |
| 2v2, level 50 | 35,160 | 12.8 | 30.6–67.6% | 0.00% |
| 3v3, level 50 | 35,160 | 11.0 | 33.3–62.6% | 0.00% |
| 1v1, level 1 | 35,160 | 17.0 | 27.0–73.1% | 0.34% |
| 1v1, level 100 | 35,160 | 21.6 | 28.7–74.0% | 6.81% |

The audit now accepts `--format`, `--seed-offset`, and `--report`; it validates arguments and records actual judge events instead of misclassifying every final-round knockout as a judge decision. CI also checks 2v2 and 3v3 with rotating shared field allies.

```sh
node --import tsx scripts/showdown-balance.mjs --format 2v2 --level 50 --seeds 12 --seed-offset 104729 --report balance.json
node --import tsx --test scripts/showdown-balance.test.ts
```

Full species counts and final matrix inputs are preserved in [the measurement record](pet-colosseum-balance-2026-09-07.json).

Verification: 173 relevant tests pass, including all three balance formats and combat/reward/replay/presentation checks. The full client TypeScript build check and ESLint on the changed client code pass. The Colosseum production preview builds successfully. Its bundler reports the existing large-chunk advisory; this pass does not optimize bundle size.

## Visual changes

- Matchup badges follow the focused/selected attack's element. Neutral Swift Strike no longer falsely displays a Fire pet's resisted matchup. Guard, healing and other support choices clear the attack cue.
- The command deck names the acting pet and shows order progress, such as `ORDER 2/3`.
- Status icons include readable labels and durations; guard and signature charge have explicit badges. Signature meters have accessible names and values.
- Tall phone layouts give move names the full two-column width. A compact Details control expands the move explanation and stats; warnings remain visible when collapsed. Short displays retain their bounded controls.
- The preview serves real portraits and creature models in development and offers `?hudqa&meter` for status/readout inspection.

Browser checks covered desktop 2v2, a 390×844 phone, an 844×390 three-pet layout, neutral versus elemental targeting, command advancement, the Details toggle, guard, statuses and full signature meters. The camera constants and director block were compared against the original source and are identical after newline normalization.

## Limits and next balance decisions

These tests use warrior AI, balanced growth allocations, same-rarity leads and a controlled shared bench. Team-format statistics measure a lead's contribution alongside shared allies, not every possible team composition. Trait/gear combinations, evolved forms, all player skill levels and every mixed-level team are not exhaustively covered. The small cross-rarity sample remains diagnostic only.

After release, compare real win rates and selection rates by species, format, level band and loadout, with sample counts. Watch Red Fox's weak duel results, support-heavy team compositions and high-level match length before making another pass. Preserve useful counters rather than aiming for 50% in every individual pairing.
