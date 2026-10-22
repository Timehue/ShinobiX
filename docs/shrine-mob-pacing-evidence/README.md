# Shrine mob HP and encounter pacing

Follow-up to the hunt/shrine release in #445, based on main `3e9b0d04c93b1d07fd8b460a62371c1143cd33df`. The October 19 request was to lower excessive shrine mob HP and reduce encounters a little. This patch does not change the round cap, result/export wording, bosses, player saves, or the previous release's hunt/road combat work.

## Changes

New ordinary shrine mobs (fixed, ambush, beast, and authored hostile wanderers) use 65% of their former profile HP; elites use 60%. Depth, Rift and augment factors still apply once, followed by the existing PvE difficulty scaling. Attacks, stats, defenses, kits, AP, mastery, EP and heal/support limits are unchanged. Named/final bosses use factor 1. The active-session resume path retains stored HP, damage and resources.

| Actual level-100 session | Before | After |
|---|---:|---:|
| Standard floor 2 ordinary | 16,218 | 10,541 |
| Standard floor 2 elite | 22,323 | 13,394 |
| Rift + Keen Edge floor 2 elite control | 16,742 | 10,045 |
| Standard floor 5 ordinary / beast / elite | 18,972 / 21,817 / 26,114 | 12,331 / 14,181 / 15,668 |
| Standard final boss | 24,360 | 24,360 |

The Rift/Keen Edge control matches the observed HP, not the tester's unknown full build or actual augment. Greedy Pact intentionally retains its disclosed +30% enemy-power risk, including HP above 16,000 on deep floors.

New floors have one fewer ordinary battle node: floors 1-5 change from 5/6/7/8/9 to 4/5/6/7/8. Elite counts remain 1/2/2/3/3. Ordinary placement excludes the Keeper room/door approach and tiles adjacent to elites, including placement top-ups. Reward-node counts, gates and per-encounter rewards are unchanged; no compensation reward is added for removed fights.

After a verified non-boss victory, three accepted steps suppress roaming hunter contact. Replays/rejected steps do not consume or renew relief; descent clears it. An adjacent unspent Medic also suppresses hunter contact until healing is spent. Threat, Chronicle, fixed battles and elite/boss gates remain active. Hunter counts and movement rules are unchanged. Old sealed maps retain their original layout and count, without a save migration; the validator accepts only the exact old or new ordinary count.

## Combat comparison

`hp-baseline.json` captures the pre-change factory, and `hp-final.json` compares the same 347 deterministic cases. All 321 mob cases retain identical non-HP enemy/AI hashes; all 26 boss rows are exactly equal, including outcomes. `hp-rift-baseline.json` / `hp-rift-final.json` add 21 mob and 3 exact boss controls. No sampled prior win becomes a loss.

| Level | Mob wins before / after (cases) | After winning rounds | After winning ending HP |
|---|---:|---:|---:|
| 5 | 48 / 48 (48) | 2-4 | 301-630 |
| 17 | 25 / 46 (48) | 3-6 | 196-1,735 |
| 35 | 1 / 15 (48) | 4-7 | 22-1,753 |
| 60 | 0 / 5 (48) | 7 | 560-997 |
| 100 | 40 / 74 (129) | 8-25 | 255-10,000 |

These are policy/fixture counts, not player win rates. Earned-budget starter B and offense A controls span levels 5/17/35/60/100, floors 1/2/5, four mob kinds, and practical/cautious visible-state policies. Level 100 also includes independently audited additional-earned-training optimized and sustain controls with the bounded legal own-turn planner. All fixtures pass acquisition/progression audits; actions use the real engine and assert nonnegative AP/chakra/stamina.

For a standard floor-2 elite, the full-HP strong sustain planner changes from a 25-round cap loss to a 15-round win with 8,442 HP; strong optimized planner changes from a cap loss to a 16-round win with 3,302 HP. Simpler practical policies still lose both examples. The Rift-matched sustain planner changes from 20 to 12 rounds (full HP), and 21 to 11 rounds starting at 56.4% HP. The explicit round-10 wait control also wins with this planner; some partial-HP practical/cautious controls still die. This does not establish guaranteed whole-dive survival or reconstruct the live custom-jutsu rotation.

Current-forge controls use 27 EP and catalog mastery, not an invented recreation of unknown legacy 33-EP/custom skills. The one missed turn is an explicit diagnostic, not a counterfactual replay. The 25-round cap and timeout behavior remain unchanged and deserve separate result/export explanation work.

Re-run against the captured baseline:

```sh
node --import tsx scripts/shrine-mob-hp-probe.ts --output .tmp/hp.json --compare docs/shrine-mob-pacing-evidence/hp-baseline.json
node --import tsx scripts/shrine-mob-hp-probe.ts --output .tmp/hp-rift.json --compare docs/shrine-mob-pacing-evidence/hp-rift-baseline.json --rift-control
```

## Route comparison and limitations

An independent reviewer compared 600 seeded boards against an unchanged external checkout of the old generator: all 600 matched legacy mode exactly. Across 6,000 paired routes / 12,000 simulations there were zero generation, validation or simulation failures. The committed probe reproduces those route results using legacy mode plus the old hunter-contact policy; five frozen pre-change full-board hashes separately pin its legacy reference. Its per-map self-comparison proves determinism, not 600 additional independent baseline checks.

| Board / route | Mean encounters before / after | Mean successive fight pairs with gap <=1 step |
|---|---:|---:|
| Standard 25x17 stairs | 6.095 / 4.325 | 0.810 / 0.220 |
| Standard via Medic | 5.810 / 4.235 | 0.730 / 0.206 |
| Compact 15x11 stairs | 4.550 / 3.508 | 0.925 / 0.200 |
| Compact 17x13 stairs | 4.738 / 3.475 | 0.875 / 0.312 |

The mean is not a per-map guarantee: 4,560 paired routes have fewer encounters, 358 have more; 2,569 have fewer successive pairs, 241 have more. Threat encounters increase slightly because fewer fights reset threat. Compact shortest paths trigger no Chronicle encounters in either version; a real handler test separately forces threat 96 and verifies Chronicle precedence during relief.

The probe uses actual generated physical blockers and NPC movement, full-known-map shortest paths, instant combat victories, two route policies and five deterministic torch-drain phases. It does not model exploration, HP/attrition, time, keys, wards, torch refills, combat resources, rewards or survival probability. Medic routes report unavailable healers behind optional locked-cache doors rather than drop those samples: 115 old versus 105 new of 3,000 Medic routes; another 5 old / 10 new routes end at a boss before reaching the Medic. Both versions therefore retain healing-access limitations. Boss counts remain equal in every route pair.

```sh
node --import tsx scripts/shrine-pacing-probe.ts --output .tmp/pacing.json
```

`pacing-summary.json` retains source fingerprints, route groups and counts. The full raw route events and independent review manifests accompany the task's release evidence. Focused regressions cover actual HP, old/new manifest security bounds, legacy full-board hashes and real recovery, unchanged stored fights, settlement/step replay, healing contact, threat/Chronicle precedence and descent. Full CI and a final exact-commit review remain required before merging; no production data was edited.
