# Relic roster — 20 equippable rewards

Status: release candidate, 2026-10-02. Numeric authority: `shared/relics.ts`; server item data is generated from the client catalogs. This replaces the previous 15-item equippable roster. Crafting materials named “relic” are not equipment and are unchanged.

The owner approved 20 equippable relics and conversion of retired owned relics. Each village awards exactly one relic at its level-58 Reckoning (own story progress 5, one victory). Village relics have identical rarity, equip level, and +3% all PvE damage. Their names and artwork remain village-specific.

## Complete roster

Every bonus below applies only against PvE enemies. “Offense” matches the attack's actual school; “element” matches the actual jutsu or weapon element. Neither changes base stats or PvP damage. Only one relic can be equipped.

| Tier | Relic | Equip level | PvE damage bonus | Source and chance per eligible reward |
|---|---|---:|---|---|
| 1 | Kesa's Storm-Seal | 58 | +3% all | Stormveil Reckoning, guaranteed once |
| 1 | Aren's Struck Name-Plate | 58 | +3% all | Ashen Leaf Reckoning, guaranteed once |
| 1 | A Struck Warmth-Token | 58 | +3% all | Frostfang Reckoning, guaranteed once |
| 1 | A Sealed File | 58 | +3% all | Moonshadow Reckoning, guaranteed once |
| 1 | Chakra Ring | 20 | +1% all | Any Ancient Chest, approximately 0.714% |
| 2 | Ashfall Reliquary | 35 | +6% Fire | Volcano Ancient Chest, 0.30% |
| 2 | Rootbound Effigy | 35 | +6% Earth | Forest Ancient Chest, 0.30% |
| 2 | Rimeglass Lens | 45 | +6% Water | Snow Ancient Chest, 0.30% |
| 2 | Umbral Knot | 45 | +6% Genjutsu | Shadow Ancient Chest, 0.30% |
| 3 | Stormglass Pendulum | 60 | +8% Lightning | Central Ancient Chest, 0.15% |
| 3 | Gravewatch Fang | 60 | +8% Taijutsu | Central Ancient Chest, 0.15% |
| 3 | Drownstone Compass | 70 | +8% Wind | Central Ancient Chest, 0.15% |
| 6 | Duelist's Red Cord | 100 | +14% Bukijutsu | Shared endgame sources below |
| 6 | Mirror-Mask Shard | 100 | +14% Genjutsu | Shared endgame sources below |
| 6 | Conqueror's War Seal | 100 | +14% Taijutsu | Shared endgame sources below |
| 4 | Skybreak Prism | 70 | +12% Wind | Public Battle Tower floor 10+, level 70+, 1.00% |
| 6 | Fivefold Chakra Seal | 100 | +14% Ninjutsu | Shared endgame sources below |
| 5 | Worldroot Heart | 90 | +14% Earth | Public Battle Tower floor 14+, level 90+, 0.40% |
| 6 | Zenith Lotus | 100 | +10% all | Public Battle Tower floor 15, level 100, 0.20% |
| 5 | Hollow-Gate Cinder | 75 | +8% all | Weekly Boss top-10 damage reward, 8.00% |

Primary distribution: 4 village story + 8 Ancient Chest + 7 late Tower + 1 Weekly Boss = 20. Four of the Tower relics also drop from ranked wins and war victory crates. The Tower has 15 floors; its relic unlocks use real floors 10/14/15.

Tier 1 is the accessible foundation; tier 2 introduces biome hunting; tier 3 requires rarer exploration; tiers 4–5 require higher character progression and harder clears; tier 6 is the final-floor chase. Tiers describe the combined gate and rarity, not a promise of a fixed acquisition time. Specialized bonuses are larger because they affect a narrower part of a loadout; all-damage relics remain useful across builds. All relics are unbuyable.

## Equal endgame rewards for all four offenses

The owner requested this follow-up on 2026-10-02: preserve 20 total by adjusting two existing relics, give every offense a +14% option, and make all four available through very late Tower clears, extremely rare PvP wins and rare war victory crate openings. Duelist's Red Cord rises from +10% to +14%; Mirror-Mask Shard rises from +12% to +14%. Their IDs and artwork stay the same. All four offense relics now require level 100 and tier 6; none has an easier acquisition route than the others.

| Eligible source, level 100 | Chance for each specific offense relic | Chance for any of the four |
|---|---:|---:|
| Public Battle Tower floor 15 victory | 0.20% | 0.80% |
| Ranked player victory | 0.025% | 0.10% |
| Legendary War Crate opening | 0.10% | 0.40% |

These are absolute per-attempt chances. Every relic in a source has its own slice of one weighted roll, so at most one equippable relic drops. Neither the player's village nor chosen offense changes the odds. The four schools have equal power, equip level and acquisition requirements. Existing copies retain their identity and receive the revised canonical stats and equip requirement.

## Reward rules and expected effort

- Ancient Chest rates are per opened chest. Chakra Ring remains in the existing 10% rare-gear band, split across 14 items. Central relics have separate 0.15% slices, totaling 0.45%; other biome chase bands are 0.30%. Chest gear can drop before its equip level. The existing 23-chest daily cap remains.
- Ranked rolls require a completed, joined, server-authorized player-ranked win at sealed combat level 100. A player gets at most 10 rolls per UTC day, one per distinct opponent. Shared IP/device matches, pets, admin matches, unjoined matches, draws and ordinary spars do not qualify. The four offense relics together give a 0.10% chance of any relic per eligible win. They still provide zero PvP power.
- Tower rolls require a won canonical public Tower run, the required floor and sealed player level. At most 5 eligible clear rolls per player per UTC day, across floors; failed runs, borrowed AI allies, spires and embedded encounters do not qualify. Repeated clears may roll, while ordinary first-clear progression stays once-only. At floor 15/level 100, the combined chance across all seven eligible relics is 2.40% per clear; the four offense relics account for 0.80%.
- Legendary War Crates retain their ordinary Warforged Relic crafting material, 500 ryo, profession payout and independent 35% Dungeon Key chance. At stored level 100, a separate bonus roll can add one of the four offense relics. The existing server-locked transaction consumes one owned crate and grants its whole payout atomically. The opening message names the extra relic or duplicate shards. Crate ownership is required; client-supplied levels, rolls and reward IDs are ignored.
- Each eligible ranked/Tower result gets a server-private keyed roll, preventing players from predicting drops from public battle/run IDs. The outcome and inventory/shard change commit together under the player-save lock. Both wins and misses are recorded. Replays reuse the committed outcome even after a restart or on another server worker. Proofs expire before their three-UTC-day receipt window can be pruned.
- Weekly Boss eligibility and its once-per-week payout cap remain. At most one item comes from each relic roll.
- A duplicate of any relic, including one currently equipped and Chakra Ring, converts to 15 Fate Shards. It never creates a second copy. There is no pity system in this change.

For one specific reward, the mean number of eligible rolls is `1 / chance`, not a guarantee: ring 140 chests; biome relic 333; central relic 667; Skybreak 100 Tower clears; Worldroot 250 clears; Zenith 500 clears; Cinder 12.5 qualifying weekly payouts. Each +14% offense relic averages 500 eligible Tower clears, 4,000 eligible ranked wins, or 1,000 war crates. Any one of those four averages 125 clears, 1,000 wins, or 250 crates. At the daily roll caps, the mean Tower chase is 25 days for any offense relic or 100 days for one specific offense; PvP is deliberately much rarer (100/400 days respectively). These are design targets, not measured live acquisition data, and there is no guaranteed deadline.

## Existing-player conversion

On the first owner save read, a server-owned version stamp applies these conversions once:

| Retired equipment | Replacement |
|---|---|
| True Roll Page (`event-true-roll-page`) | Frostfang's Struck Warmth-Token |
| Unsworn Page (`event-unsworn-page`) | Moonshadow's Sealed File |
| Forged Die (`event-forged-die`) | The player's story-village relic (current village fallback) |

The old IDs become non-equippable quest keepsakes, preserving unfinished story turn-ins. Players retain their earned equipment value through the replacement; existing replacements are not duplicated. Retired equipped objects move to the backpack. Frostfang's Warmth-Token moves from the old waist slot into the backpack for equipping in the relic slot. New quest keepsakes do not repeatedly trigger conversion.

## Audit findings addressed

The original equipped roster contained 15 items, uneven village allocations, mixed stat/PvE effects, and chest/boss duplicate checks that missed equipped ownership. Artwork tests inspected starter items only, missing story event items. The new roster removes flat relic stats and generic PvP passives; school/element percentages run in both authoritative shinobi PvE engines. Tower weapon attacks now preserve their real element for specialist matching. All 20 items and icons are checked across both item catalogs.

Seven new transparent 256×256 WebP icons are under `shinobij.client/public/items/`. Existing art is reused for the other 13. Provider and exact generation prompts: [relic-art-prompts.json](relic-art-prompts.json).

## Validation

The colocated unit tests cover all 20 canonical items, equal village rewards, save conversion, equipped ownership, specialist damage and PvP isolation, source probability boundaries, replay protection, daily caps, and concurrent crate settlement. All four villages have authenticated abandon/restart/turn-in/replay regression journeys.

`scripts/relic-art.test.ts` decodes every relic image, checks Linux filename case, and rejects blank or duplicate artwork. `scripts/verify-relic-art.mjs` produces a gallery and checks image decoding in Chromium, Firefox, and WebKit. The browser suite verifies canonical starter/event artwork and both extra-relic and duplicate-shard crate notices.

Release checks run against an isolated candidate based on current `main`: the full unit runner, server/client compilation, client lint, production asset checks, and the repository's required responsive, strict combat, Warfront, and live Express browser gates.
