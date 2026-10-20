# Pet growth and food economy v2

Growth v2 grants three points for every level after level 1 (297 at level 100).
Each attribute independently gives 1% of its immutable base per point through
20, 0.5% for points 21–50, and 0.25% thereafter. Agility gives half these rates.
Automatic growth remains 0.75% of base per level. Stats round once after adding
the trait, automatic growth and specialization. Free respec refunds all points;
active battles, uncollected training/expeditions and Hatchery incubation block it.
Agility currently has no combat effect in adventure summons' fixed action phase.

## Preservation and authority

The existing owner-read/save-mutation migration runs under the save lock and
stamps each pet with growthVersion 2. It multiplies existing investments by
three exactly once and derives the tripled unspent remainder from the level.
Levels, XP, immutable bases, ownership, evolution, jutsus, equipment, inventory,
lineage and pending activities are retained. Returning Sanctuary pets migrate
when they re-enter the owned roster. No offline bulk player-data migration is
needed. Old sealed battles keep their snapshots.

Food grants at most 2,000 XP per pet per UTC day across ordinary, Elemental,
Ancient Treats and Golden Apples, regardless of acquisition source. The endpoint
reads time after acquiring the save lock and commits foodXpDay/foodXpUsed with
the item debit and XP in the same versioned compare-and-set. Generic saves cannot
write these fields. Evolution and role changes preserve them. An over-budget or
max-level XP feed is refused before consuming stock; current UI requests carry
settlement receipt IDs for retry protection. Training, expeditions and battle XP
are separate.

Free petting remains available under its existing attention budget. An explicit
ordinary-Treat care action grants up to 10 happiness and **zero XP**, independent
of the food XP budget, including at max level. It rejects premium food and full
happiness before consumption.

## Prices and recipes

| Food | Shop price | XP |
| --- | --- | ---: |
| Treats | 400 ryo (was 80) | 100 |
| Golden Apple | 40 Fate Shards (was 20) | 2,000 |
| Elemental Treats | Crafter only (was 260 ryo) | 250 |
| Ancient Treats | Crafter only (was 520 ryo) | 500 |

Existing shop discounts still apply. The ordinary price increases the daily
20-Treat allowance from 1,600 to 8,000 base ryo. Food-only level 1–100 costs
1,980,000 base ryo and requires at least 248 UTC-day allowances (495,000 XP),
before considering training or battle rewards. This replaces the audited
396,000-ryo unlimited-feeding shortcut. Forty shards prices the premium one-item
daily allowance above its old 20-shard price without bypassing the same XP cap.

Each craft produces one item; existing batches support up to 20 crafts:

There is **no additional ryo fee and no craft-point fee** for any of these food
recipes. The listed ingredients are their complete crafting cost.

- Treats: 4 Beast Meat/River Fish (any fish grade), 2 Field Herbs.
- Elemental Treats: 2 Treats, 4 common-or-better Rime Crystal/Ember Ore/Stormglass
  Shard (any mix), 4 Field Herbs.
- Ancient Treats: 1 Elemental Treat, 8 Beast Meat/River Fish (any fish grade),
  8 Field Herbs, 2 fine-or-better Rime Crystal/Ember Ore/Stormglass Shard (any mix).

These are existing repeatable gathering and hunting materials. Mineral selection
accepts three families and consumes lower grades first unless the player chooses
an exact selection. Fine quality unlocks at mining skill 2 (10% of successful
finds there); fine-or-better reaches 35% at skill 4 and 60% at skill 7. Gathering
has a 90-second attempt and a 100-attempt daily allowance. No scarce one-time
core, relic or trace is required. Ingredients use the current exact-recipe
Crafter, not a newly invented craft-point wallet: Beast Meat retains its existing
5-point donation valuation (20 points of meat for ordinary Treats, 40 additional
points for Ancient Treats when using meat).

Elemental adds 50 XP over its two ordinary Treat inputs for herbs/minerals.
From scratch, Ancient uses 16 meat/fish, 16 herbs, 4 common-or-better and 2
fine-or-better minerals for 500 XP; four ordinary Treats use the same 16 meat/fish
but only 8 herbs for 400 XP. The extra 100 XP therefore requires additional
repeatable materials rather than a trivial food conversion.

Both authoritative purchase paths explicitly reject crafted-only food, including
a stale positive-price settlement item. The shop listings also exclude it.
Ancient chests were the conflicting reward source: future treat rolls now grant
ordinary Treats; previously owned and already sealed stock remains usable.
Purchases, crafted batches and new food rewards use counted stacks. Only pet
food receives the 9,999 technical stack allowance; unique unrelated items retain
their ownership restrictions.

## Balance evidence

The production-engine audit (`node --import tsx scripts/pet-progression-balance.mts
--quick --seeds 2 --output artifacts/pet-growth-balance.json`) covered 13,184
fights and 11,270 sealed fixtures with zero invariant failures. It checks rounded
stats, legal budgets, moves, replay samples, traits, gear, role/counter matchups,
and full specialization, now including levels 10, 50 and 100.

All-in specialists' win rates against a same-species balanced build (64 fights
per cell, two seeds and swapped sides):

| Level | Vitality | Power | Guard | Agility |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 29.69% | 21.88% | 34.38% | 15.63% |
| 50 | 4.69% | 7.81% | 6.25% | 0% |
| 100 | 3.13% | 17.19% | 7.81% | 0% |

This redesign increases available power and is not balance-neutral. Diminishing
returns make these extreme builds inefficient against balanced mirrors; they
remain legal rather than universally competitive. Rounding can make one point
show +0 to a small base stat, which the UI displays honestly. Final damage can
also round unchanged after compression: the level-100 Spark Pup advanced-opening
probe stays at 364 damage after ten additional third-tier Power points, while
twenty points raises it to 366. Strict investment-direction regression checks
therefore use a twenty-point reallocation, preserving their strict assertions.
These controlled
AI samples do not establish complete human PvP balance or every cross-species
matchup. No production player save or live currency data was changed.
