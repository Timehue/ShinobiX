# Pet progression release review

Status: implementation and validation in progress. Release approval is pending.

## Accepted scope

Keep Vitality, Power, Guard and Agility as the four allocation attributes.
Automatically earn species abilities at levels 1, 5, 10 and 20, then upgrade
existing utility, advanced offense and signature techniques at 30, 50 and 75.
The last gameplay ability milestone is exactly 75. Levels 76–100 continue stats.
Ownership, XP, level, evolution, Growth Points, saved preferences and gear stay
intact. Existing free growth reset recomputes the earned budget without crediting
extra points. Locked saved preferences use eligible defaults until earned.

The stable identity registry is `shared/pet-ability-progression.ts`. Authored
identity is independent of array order and power tuning. Competitive Tactics
explicitly retains its separate normalized full-library rules. Showdown uses
role-derived special channels and a visible role stamina baseline with a small,
bounded Guard contribution; Agility buys initiative, not damage or extra actions.
Happiness remains relevant to adventure summons and training and does not add a
random failure roll to sealed Showdown fights. Range matters in spatial formats.

## Version and reward boundaries

New progression entries use `progression-v3`. Historical input-only proofs and
sealed sessions retain their prior kits, effect math, AI policy and damage rules.
Exact original-output golden tests cover both previous damage rules. The authored
Dungeon gate deliberately retains `legacy-v2`; its difficulty is not retuned here.
Shared spatial and summon snapshots distinguish retained legacy kits from newly
sealed eligible kits. New summons prepare a signature with two ordinary casts.

Paid Colosseum victories share a total 20 pet XP among server-proven participants
who still belong to the owned roster and can level. Selected but unused benches
do not qualify. The existing 100-win daily limit and ryo amounts stay intact.
XP joins the existing receipt-guarded save transaction. Practice pays nothing.

## Calibration and evidence

The approved damage percentages and round ranges are initial hypotheses for
controlled equal-level fixtures, not percentage-HP damage formulas or scripted
outcomes. Natural damage depends on offense, defense, move power, level, role,
elements, equipment, status, preparation and the seeded roll. Safety compression
applies only beyond ordinary calibrated ranges. Healing, shielding, control,
drain, damage over time and team area attacks share explicit action budgets.

Run `node --import tsx scripts/pet-progression-balance.mts` to regenerate the
matrix in `summary.json`. It records source fingerprints, fixture assumptions,
unlock boundaries, action probes, same-seed swapped-side battles, specialist and
point-transfer scenarios, resource decisions, gear and trait extremes. These are
controlled simulation results, not population win rates or live PvP acceptance.

Full reserve duels contain several sequential health bars. Initial measurements
show a material tension between the proposed 6–10-round reserve hypothesis and
the ordinary 4–7-round duel hypothesis. This requires explicit review of measured
rotation and action use; ordinary damage will not be increased merely to force a
round target. Final measured results and acceptance remain pending below.

## Work state

- Completed: isolated branch `codex/pet-balance-progression`, repository guide
  audit, all-species unlock resolver, new session rules, legal AI and matchup
  construction, participation XP, shared loadout/summon integration, progression
  UI, original-output replay goldens and focused integration tests.
- In progress: spatial support safeguards, independent source review, final
  balance matrix, full local and hosted CI, desktop/mobile and browser suites.
- Open: final reserve pacing decision, any validation findings, and release
  approval after reviewed evidence.
- Excluded: shrine release branch and CI, unrelated pet art, production player
  data, logged-in gameplay, merging and deployment.

## Final validation

Pending completion. Do not interpret partial green suites as release readiness.
