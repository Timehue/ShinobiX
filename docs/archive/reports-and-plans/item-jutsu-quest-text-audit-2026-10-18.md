# Item, jutsu, and objective text audit

Manual review of the repository-authored catalogs on 2026-10-18, following the tutorial and story dialogue passes.

## Coverage

- Read all 334 built-in item entries, including equipment upgrades, relics, materials, pet equipment, consumables, gathering items, and story keepsakes. Revised descriptions on 215 entries, including generated gear variants.
- Read all 217 built-in shinobi techniques: 101 non-bloodline techniques, 16 bloodline techniques, and 100 Legacy techniques. Revised 216 descriptions; Flicker's existing description was clear and accurate.
- Reviewed the 27 live Pet Showdown move-kind tooltip rules against their resolution branches, including signature effects, weather, shields, protection, healing, and forced rotation.
- Reviewed the 16 Clan Exchange reward descriptions and the generated named-equipment description builders.
- Reviewed the Quest Book's 17 stages and six branch options, ten wandering bounties, 16 emissary bounties, 15 hunt/field contracts, seven combat missions, 32 profession/new-player daily templates, eight clan objectives, and Logbook requirements. Story/rift dialogue was also covered by the preceding story audit.
- Scope is the content checked into this repository. Player-written named-item flavor and remotely authored custom content are not rewritten.

## Examples

| Entry | Before | Revised behavior described |
| --- | --- | --- |
| Nerve Spark Seal | “A precise jolt that scrambles chakra pathways and locks the enemy's kekkei genkai.” | Drains HP and chakra at turn end and applies Poison, starting next round. Deals no direct damage and does not seal bloodlines. |
| Frostfang Oathblade | “Shield 225” | Immediately grants 300 shield, up to the shield cap. |
| Senbon | “Deals 300 damage per round for 2 rounds after impact.” | Wound bleeds for 25% of the damage the throw deals, for two rounds starting next round. |
| Pet battle consumables | “When summoned in PvE instead, the pet spends it to shield you.” | The summon consumes the item to restore 25% of the player's maximum HP. |
| Moonlit Tide Dream | “A serene illusion that lowers the damage the user takes.” | Deals damage and applies Poison; it does not grant damage reduction. |
| Emissary exploration | “Scout 15 open-road tiles before the rain closes in.” | “Use Explore 15 times for Ryn.” There is no rain deadline or required road. |
| Clan training | “Train 100 Hours” | “Build 100 Activity Points.” Progress comes from combined battle, mission, and event contributions. |
| Pet attack tooltip | “62% hit” | “Direct damage: 62% of a normal hit.” The number is a damage multiplier, not accuracy. |

## Mechanics checked

The item/jutsu catalog comparison removes only `description` and `battleDescription`, then checks every remaining field for equality against a snapshot taken before this pass. Combat fields, acquisition costs, rewards, levels, and progression values remain identical across the 334 items and 217 techniques.

Representative checks invoke the actual combat resolver:

- Frostfang Oathblade: 300 shield and a damaging strike.
- Glacier King Cleaver: 400 shield and a damaging strike.
- Senbon: in the verification fixture, 320 direct damage produces 80 Wound damage per turn for two rounds.
- Nerve Spark Seal: no direct HP damage; applies Drain and Poison; applies no Bloodline Seal.
- Buried Memory Field: deals damage and immediately restores HP through Siphon, rather than sealing a bloodline.
- Poison: spending zero resources causes zero Poison damage. At 12% potency, spending 100 causes 144 base damage before mitigation.
- Pet consumables: PvE summon healing is 25% of maximum HP.
- A regression check compares a signature shield's advertised amount with the shield the pet combat engine actually grants.

Quest counters were traced to server progress producers. Ordinary exploration objectives count completed Explore actions, not travel or distinct tiles. The relic survey separately tracks five distinct regions after acceptance. The initial interpretation that unrelated AI victories could satisfy named quest fights was superseded by the [main story, side quest and world event audit](story-quest-world-code-audit-2026-10-19.md): named AI-boss stages require fresh receipts bound to that quest, stage and acceptance. The bell carry stage really has a 30-minute timer. Clan objectives use roster, treasury, and contribution formulas rather than the old advertised defense counts, training hours, or boss counts.

Damage amplification and armor protection feed shared pools with diminishing returns. Descriptions no longer present their nominal strength as an exact final damage multiplier. Direct healing/shielding is distinguished from next-round effects, and Lifesteal is distinguished from immediate Siphon healing.

## Main implementation references

- `shinobij.client/src/data/{starter-items,jutsu,legacy-jutsu,missions}.ts`
- `shinobij.client/src/lib/{jutsu-effects,weapon-effect-display,questbook,wanderers,legacy-emissaries,logbook-objectives}.ts`
- `shinobij.client/src/constants/clan.ts`
- `api/pvp/move.ts`, `api/pvp/_weapon-tags.ts`, `api/combat-core/formulas.ts`
- `api/_pet-showdown/engine.ts`, `api/combat-core/companion.ts`
- `api/sector/{_questbook,_wanderer-quest}.ts`, `api/world/_explore.ts`
- `api/missions/{_mission-catalog,_mission-progress-receipt,_pool}.ts`
- `api/clan/_mission-catalog.ts`, `api/craft/_named.ts`, `shared/gear-steps.ts`

Server jutsu catalogs were regenerated from their canonical client definitions. Story-content assets were checked with the repository generator.

## Validation

- The full root suite ran 15,991 tests: 15,959 passed, 28 skipped, and four failed because they expected the old description wording or assumed every bloodline effect addressed the enemy. Those expectations were corrected while retaining numeric and recipient checks. All 14 tests in the affected files passed on rerun. The full suite was not repeated after those narrow corrections.
- Focused combat, tooltip, item-presentation, quest, and progression checks: 147 passed, including the new signature-shield comparison against combat resolution.
- Gear-description and reward-line checks: 14 passed.
- All 334 item and 217 jutsu mechanical records matched the pre-edit snapshot after removing only prose fields. The representative resolver checks above passed.
- The production build passed. Final backend and client builds also passed after the last wording and test edits. Distribution and Chronicle runtime checks passed.
- Full frontend lint: zero errors, 23 existing warnings. Lint of the changed frontend files passed without warnings.
- Focused Chromium desktop/mobile checks: three passed and one intentionally skipped mobile-only case on desktop. The mobile technique details passed checks for visible description, usable training action, viewport safety, clipped controls, touch-target size, and runtime errors. Inventory/Jutsu workspace selection and keyboard focus passed on both viewports.
- A separate mobile run with screenshot capture enabled passed. Visual inspection at 390 × 844 confirmed that Blood Gaze Rupture's revised description is readable in the scrollable detail panel.
