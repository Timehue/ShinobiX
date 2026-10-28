# PvP Level Balance Certification — 2026-08-26

## Verdict

- **Combat/tag wiring:** PASS.
- **A-rank vs B-rank authority:** PASS when isolated with identical 12-button loadouts.
- **Paid combat entitlement:** PASS; supporter- and base-origin fighters are both sealed to 12 regular human-PvP techniques and scored exactly 50/50.
- **Official Bloodline Maker template balance:** REVIEW. Fully capped play is inside the 40–60% role band, but Control is below the band at levels 10, 25, 50, and 80 (especially 10 and 80), Prevention is strong at levels 10 and 25, and the deterministic policy favors the round closer at higher levels.
- **Overall claim:** the engine is coherent and account-side fairness is intact, but the current evidence does **not** justify calling every PvP bracket fully balanced.

## Ranked PvP scope

The population certification mirrors live ranked human PvP:

- live server damage/tag resolver and action planner;
- central neutral biome, with ranked weather and home-terrain bonuses sealed off server-side;
- real ranked consumable/throwable charges pinned to zero;
- normal 12-technique human-PvP loadout;
- no Legacy signature in this matrix, so A/B bloodline effects remain isolated;
- creator-legal A- and B-rank bloodlines, schema normalization, rank point budgets, and live rank multipliers;
- level-legal armor, weapon, relic, stat allocation, resource pools, mastery caps, cooldowns, AP, movement, zones, wards, cleanup, DoTs, shields, healing, timeouts, and both opening orders.

Every official template was rotated through all eight legal construction profiles: two each for Ninjutsu, Genjutsu, Taijutsu, and Bukijutsu. Tournaments compare fighters only inside the same profile, preventing gear/stat construction from masquerading as bloodline-template strength.

## Official-template results

The final matrix contains **5,120 fights**: 4,480 official-template fights plus 640 identical-button A/B rank controls.

| Bracket | Avg rounds | Early KO | Timeout | Opener | A rank, identical buttons | Burst | Sustain | Control | Prevention |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Level 10 | 3.94 | 0.9% | 0.0% | 48.5% | 59.4% | 48.9% | 50.7% | **32.6%** | **67.9%** |
| Level 25 | 4.76 | 0.0% | 0.0% | **40.8%** | 59.4% | 53.1% | 44.6% | **39.3%** | **62.9%** |
| Level 50 | 6.02 | 0.0% | 0.0% | **38.2%** | 54.7% | 50.0% | 51.8% | **39.3%** | 58.9% |
| Level 80 | 11.39 | 0.0% | 1.8% | **36.7%** | 60.9% | 57.8% | 53.6% | **34.2%** | 54.5% |
| Fully capped | 13.52 | 0.0% | 5.6% | **32.9%** | 55.5% | 52.2% | 41.7% | 48.2% | 57.8% |

Rates use a draw as half a win. Bold values fall outside the certification bands: 40–60% for a template, 45–55% for opening order, and 50–70% for A rank with identical buttons.

### Interpretation

- Level 10's short 3–5-round fights front-load Prevention: mastery-10 Heal and Shield each create an immediate 330-HP swing on a 2,100-HP PvP bar, while Control's Seal, Drain, damage reduction, and Poison begin next round.
- Level 80 Control at 34.2% is the clearest remaining template weakness. Level 25/50 Control at 39.3% is just outside the selected band but remains a review item.
- Fully capped role rates all land inside 40–60%; timeout rate stays low at 5.6%.
- The closer advantage is conditional on template/profile and the deterministic greedy policy. The live opener is a cryptographic 50/50 coin flip, the tournament crosses both openers and seats, and P1 remains neutral. It is therefore not an account-side bias, but it is a match-variance risk requiring multiple policies or live telemetry before changing status lifecycles.
- A/B wiring is healthy. With the same 12 buttons, A rank scores 54.7–60.9% across the five brackets. The misleading low/mid A result from forced official loadouts came from B receiving one extra common technique while A was forced to equip all five customs; real players may omit a custom technique.

## Adversarial tag stress

The supplemental audit ran **3,200 fights**: 2,880 fights with 16 deliberately adversarial but legal builds (2,400 across the five requested brackets plus 480 catalog-cap gear-sensitivity fights), and 320 entitlement-seal comparisons. The adversarial portion is mechanics/hard-counter coverage, not a population estimate.

- At level 80 and catalog-gear cap, all 33 tag types authored by the stress roster were attempted and successfully applied.
- Barrier and Increase Discipline—the two canonical tags not authored by that roster—have dedicated forced-policy checks.
- The AI registry is exact and fail-fast against all 35 canonical live tags.
- Copy and Mirror use the live resolver: Copy excludes only Absorb/Lifesteal, Buff Prevent blocks Copy, Debuff Prevent blocks Mirror, and copied/mirrored effects begin next round for a fresh two-round window.
- The stress matrix produced many extreme matchups and 150 flags. Those flags show that intentionally awkward legal kits can create hard counters; they must not be reported as 150 independent engine defects or as expected player win rates.
- Catalog endgame gear attempted/applied all 33 stress-roster tag types. Named and catalog cap runs both stayed below 8% timeouts.
- Supporter-origin versus base-origin loadouts scored exactly 50/50 at levels 10, 25, 50, 80, and cap after the live 12-button seal.

## Changes retained

- Human-vs-human PvP now seals both players to 12 regular techniques while preserving one earned Legacy signature; PvE and human-vs-NPC behavior are unchanged.
- Human PvP receives an ephemeral low-level HP correction: +50% through level 10, fading linearly to zero at level 25. Saved/canonical HP is unchanged.
- Official templates now use:
  - Burst Searing Barrage: Ignition + Wound.
  - Bruiser Rending Strike: Wound + Decrease Damage Given.
  - Controller Bloodline Sever: Bloodline Seal + Drain.
  - Support Reflective Guard: Reflect only.
- The simulator now uses all eight legal construction profiles instead of duplicating Genjutsu and omitting Bukijutsu.
- Rank certification now uses an identical-button A/B control instead of confusing forced template composition with the rank multiplier.
- AI tactical valuation covers all canonical tags, prevention-specific wards, Copy/Mirror payloads, direct Push/Pull, zones, resources, cleanup actions, and next-round timing.

## Rejected overfits

- Increasing low-level HP further made Control weaker and Prevention stronger.
- Adding Pull to Control and removing Aegis damage reduction passed level 10 but severely regressed level 25.
- Cleanse-lock and split-Aegis variants merely moved the imbalance between brackets.
- Making statuses active on the cast boundary worsened opening-order balance and contradicted the required next-round contract.
- Global Absorb/Reflect nerfs and rank-multiplier changes were not supported by isolation tests.

## Required follow-up before a full balance PASS

1. Run the same matrix with several reproducible strategies (aggressive, control-preserving, defensive, and resource-conserving), not only one greedy policy.
2. Collect anonymized live action/win telemetry by level, construction profile, template tags, and opening order.
3. Tune Control/Prevention only if the level-10 and level-80 findings persist across those policies and live players.
4. Keep initiative as a warning until the closer edge is either reproduced in human data or ruled policy-specific.

## Commands

```text
npm run audit:pvp-competitive
npm run audit:pvp-balance
node --import tsx --test scripts/pvp-level-balance-sim.test.ts api/pvp/_low-level-hp.test.ts api/pvp/_human-pvp-loadout.test.ts shinobij.client/src/lib/bloodline-templates.test.ts
```
