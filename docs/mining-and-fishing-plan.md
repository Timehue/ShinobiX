# Shinobi Outpost mining and fishing plan

Implementation specification dated October 7, 2026, updated October 8 to match the implemented feature. Central's Hunter Guild becomes the Shinobi Outpost, with Hunting, Fishing, and Mining tabs. Fishing schools sit inside bodies of water and mineral veins sit on exposed rock. Fishing uses casting, hooking, and line tension; mining uses Fracture Chain, a puzzle about placing chakra charges along fault lines. Higher activity skill levels improve success rates, improve resource quality, and unlock richer sites. The numeric rules below are the initial implementation balance and can be tuned after playtesting.

## Agreed rules

- Explore, Fishing, and Mining share **100 total actions per UTC day**. There is no additional gathering sublimit. For example, 40 explores, 35 fishing attempts, and 25 mining attempts spend the full allowance.
- Fishing and Mining have separate skill levels. Higher levels improve success rates and the chance of higher quality fish or ore, with the available resource types and maximum quality determined by the site.
- Each resource node has **three attempts**, including failures. Three failed attempts empty a node just as three successful attempts do.
- Central's Hunter Guild becomes **Shinobi Outpost**, containing Hunting, Fishing, and Mining tabs.
- Fishing uses **cast, hook, and reel**. Mining uses **Fracture Chain** with chakra charge placement and cascading cracks.

Hunting retains its existing contract, combat, rank, presentation, and allowance rules while moving into the Outpost. Initial gathering uses three charges per personal node, a ten minute refill, a ninety second attempt expiry, ten XP per success and three per completed failure. Abandonment and expiry award no XP.

Hunting also retains its current presentation. The new minigames and animations apply only to Fishing and Mining.

## Shinobi Outpost in Central

Replace the Hunter Guild facility name, destination header, and navigation copy with Shinobi Outpost. The destination opens a three tab screen:

| Tab | What it contains | What the player does in the world |
| --- | --- | --- |
| Hunting | Existing beast contracts, Hunter Rank, material turn ins, active trails, and weekly Apex contract | Read signs, choose a tracking approach, and fight the beast through the existing combat system. |
| Fishing | Fishing level and progress, attempts made today, known fishing schools and quality ranges, catch uses, and casting guidance | Approach a school from a bank or pier, cast, hook, and reel. |
| Mining | Mining level and progress, attempts made today, known deposits and quality ranges, refining, and Fracture Chain guidance | Approach a deposit, place chakra charges along fault lines, and trigger a controlled fracture. |

Show the shared Explore, Fishing, and Mining allowance clearly, alongside each activity's own progress. Do not display three independent daily allowances or a separate 20 harvest cap. Keep the hunting reward counter within Hunting so it cannot be confused with the shared field allowance.

The Outpost lists known sites by sector and opens the world map; harvesting happens at actual world nodes. Players approach the marked shore or rock base using normal movement. Return visits remember the selected tab, and Hunting remains available alongside Fishing and Mining.

Wrap the existing [HunterBoard](../shinobij.client/src/screens/HunterBoard.tsx) as Hunting content rather than rebuilding its contract and reward logic. Its internal hunting destination can remain compatible while the visible facility becomes the Outpost. Preserve active contracts, Hunter Rank, and Apex progress. Hunting currently has its own 20 plus Hunter Rank daily reward allowance; the Outpost rename does not itself alter it.

Fishing and Mining are available to every player independently of Healer, Vanguard, or Pet Tamer. Neither activity replaces a profession nor consumes a combat equipment slot.

## Tools and equipment

| Tool | Shop | Price | Lifetime |
| --- | --- | --- | --- |
| Basic Fishing Pole | Ryo Shop | 150 Ryo | 50 admitted fishing attempts |
| Basic Pickaxe | Ryo Shop | 150 Ryo | 50 admitted mining attempts |
| Golden Fishing Pole | Grand Marketplace | Exactly 50 Fate Shards | Permanent |
| Golden Pickaxe | Grand Marketplace | Exactly 50 Fate Shards | Permanent |

Inventory's equipped section has separate Fishing Pole and Pickaxe slots. Tools must be equipped to start. Failures, cancellation and expiry spend a use because the use is committed at admission. The fiftieth use breaks and removes a basic tool, while that final attempt can still finish. Unequipping cannot reset durability; replacing a broken basic tool starts a new fifty-use lifetime. Gold tools have the same success and quality rules as basic tools. Their fifty-shard price is fixed, including for accounts with marketplace discounts.

## Implemented crafting costs

The working-tree rebalance reviewed on 2026-10-08 increases bulk ore and binding requirements for permanent equipment while easing scarce regional catalysts. Authoritative quantities live in [crafting recipes](../shared/crafting-recipes.ts) and [ore requirements](../shared/resource-forging.ts). Recipe currency and character level gates still apply. The material picker requires an explicit complete selection; higher grades are eligible alternatives, and the server spends only the selected stacks.

| Craft | Added ore requirement |
| --- | --- |
| Rare weapon | 10 Fine Iron Sand or better |
| Rare armor | 14 Fine Iron Sand for chest, 10 for legs, 8 for head/waist/feet; higher grades eligible |
| Epic weapon | 18 Superior Iron Sand or better |
| Legendary weapon | 24 Pristine Iron Sand |
| Named weapon | 20 Pristine Iron Sand plus its existing 200 Fate Shards |
| Named armor | 16 Pristine Iron Sand plus its existing 200 Fate Shards |

Fine, Superior and Pristine minerals refine into two, three and four units of the same Common mineral respectively. Refining cannot upgrade Common material into a higher grade. Cooking five fish of one grade with one Field Herb, one Heartwood Bark for fuel and 30 Ryo yields five, ten, fifteen or twenty Ration Packs. The existing forty-ration daily cooking allowance is shared with hunting recipes. Crafting consumes actual graded stack IDs; grade is separate from combat item rarity.

### Recipe balance rationale — 2026-10-08

This pass evaluates all thirty supply recipes, twenty forgeable equipment recipes, the six ration recipes and the two Named forge ore requirements. The user confirmed keeping the existing kitchen and fish-to-rations extension. The kitchen predates fishing/mining (Village Stores commit `c3be31d4d`, 2026-08-24); there is no Cooking skill or cooking minigame. Ration output, ingredients and the existing output cap stay unchanged in this balance pass.

Use expected acquisition effort rather than visible ingredient count. At fixed Mining level ten with a perfect minigame, Pristine Iron Sand at a master site averages one per `0.85 × 0.15` attempts. Four Superior-or-better regional catalysts at a rich site average `4 / (0.95 × 0.50 × 0.02)`, about 421 attempts. A forest exploration has a baseline `0.20 × 0.15` chance of Heartwood Bark, about 33 explores per unit. These are model averages, exclude travel and combat, and do not guarantee a player's yield. Regional ore and primary ore are co-drops, so ingredient averages must not simply be summed. Skill growth during acquisition also changes these fixed-level estimates.

Permanent equipment now carries more bulk ore and binding material. Epic and regional Legendary weapons use smaller graded catalyst quantities so their cost is less dominated by the two-percent trace roll. Everyday medicines accept Common Rime Crystal with larger herb quantities; smoke supplies use more herbs/fiber and less rare bark. Pet equipment gets larger structural ingredient requirements, while high-grade catalysts and boss drops remain small distinct requirements. Named forge Fate Shard and ore costs, conversion outputs, recipe output quantities, gathering rates and the shared hundred-action cap are preserved. Pet Treats use less food because eight Beast Meat alone sold for more Ryo than purchasing the finished treat; herbs remain required.

The server purchase path must enforce the same craft-only gear exclusions as the storefront and existing shop settlement. Buying a hidden forged weapon or Rare armor through a direct purchase request cannot bypass material requirements.

Research informs the structure, rather than importing another game's numeric costs: [Guild Wars 2 Iron Sword](https://wiki.guildwars2.com/wiki/Iron_Sword) uses a blade, hilt and inscription; its [Iron Ingot](https://wiki.guildwars2.com/wiki/Iron_Ingot) refinement requires three ore, so visible component counts conceal raw material effort. [Albion's official crafting guide](https://albiononline.com/news/guide-crafting) describes resource returns, specialization and a full-loot replacement economy. Those efficiencies and equipment sinks differ from this game's daily action budget and persistent gear, so equal ingredient counts would not imply equal effort.

Status: implemented local tuning, pending release and player telemetry. Revisit after observing actions spent per completed item, ingredient stockpiles, choice of crafting versus purchasing supplies, and regional catalyst completion times. Unit and real-server browser verification establish correct charging and presentation; they do not establish production economic balance.

## World nodes and approach positions

Each node has a stable ID, activity, current sector ID, required skill level, difficulty, resource family, maximum quality grade, resource table, visual position relative to its painting, and one or more reachable approach positions. Mining nodes also select from reviewed Fracture Chain puzzle templates. Bind placement to the reviewed artwork and layout version.

The resource and player positions are separate. A fishing school appears inside water while the player stands on shore or a suitable pier. An ore seam appears on a mountain face while the player stands at its accessible base. Water and rock keep their existing movement boundaries.

The [floor layouts](../shared/sector-floor-layouts.ts) include water and bridge tiles for some paintings. Use that metadata to identify candidate fishing sites, then inspect the painting. Exclude bridge surfaces as water targets, decorative puddles, lava, and inaccessible water. Mining requires an explicitly reviewed rock surface; a blocked tile alone may represent a tree or building.

Choose an approach reachable through the [walk graph](../shared/continuous-world-navigation.ts). The accepted [server world cursor](../shared/world-position.ts) must reach that approach before Start is enabled. Straight line distance to the resource sprite is insufficient because it could allow gathering across cliffs or walls. Avoid building footprints, road mouths, quest markers, and raised crossing routes.

The initial catalog contains 24 nodes across ten eligible sectors: North Docks, Eastern Stilts, Canal Heart, Jade River Bridge, Moonlit Cove Cliffs, Great Bridge Gorge, Far Glacier Shelf, Highpass Peaks, Cinder Foothills and Obsidian Forecourt. It includes twelve water targets and twelve rock targets, each with an adjacent walkable approach. Placement is checked against the painted map as well as the terrain mask. Stable definitions live in `shared/resource-nodes.ts`.

Launch nodes inside authored sector paintings. Defer extended connecting terrain until it has explicit placement metadata. Festival interiors and special sector 99 remain outside the initial catalog.

## Attempts and node depletion

One fishing cast, including its hook and reel stages, is one attempt. Placing all chakra charges and triggering one Fracture Chain is one mining attempt. Charge placement does not spend additional node attempts; the node's three attempts are three complete puzzles.

A successful extraction, escaped fish, failed extraction, or missed committed minigame spends one daily action and one node attempt. After three attempts the node is depleted for that player even if every attempt failed. Personal depletion lets another player use the same site independently.

Selecting, inspecting, and walking toward a node are free. Pressing Start commits the daily action and node attempt on the server before play begins. Moving or cancelling after commitment still spends the attempt, preventing free retries until a favorable outcome appears. Show that cost before Start. Network retries recover the same attempt without spending again.

Propose a 10 minute personal refill timer after the third committed attempt, restoring all three attempts. Daily counters reset at midnight UTC; node cooldowns keep their actual expiry across midnight. An attempt started before midnight belongs to its start day even if the result arrives afterward.

Both Explore admission and resource Start must enforce the same combined count under the player save lock. Keep actual exploration statistics, discoveries, survey progress, and quest credit specific to Explore. Extract only shared admission logic; calling the [exploration reward helper](../api/world/_explore.ts) for mining would incorrectly grant exploration progress.

The existing [shared sector scarcity](../api/world/_sector-pool.ts) remains a separate constraint when Village Stores pools are enabled: one admitted resource attempt spends one shared sector explore slot, including failures and voluntary cancellation. The existing owner village pool advantage and feature flag behavior remain in effect. Personal node depletion, shared sector scarcity, and the 100 action player allowance are separate counters.

## Implemented minigames and animations

Short, distinct interactions support touch, mouse, or keyboard. Fishing uses a primary Hook or Reel button; mining uses large selectable charge sites and a Detonate button. A modal above the world map contains the interaction and blocks map controls while it is open. Neither activity requires rapid clicking or precision dragging.

### Fishing with a bite and line tension

1. **Cast.** The line follows a visible cast arc and the bobber lands in an animated water scene with ripples and a fish shadow.
2. **Hook.** After a short wait, the bobber dips and a visible Hook prompt appears. Press within a generous window to hook the fish. Missing the hook resolves a failed attempt.
3. **Reel.** Hold Reel to increase tension and release it to let tension fall. Keep the marker in the labeled safe band while the catch meter fills. The fish supplies a bounded, varying pull pattern.
4. **Resolve.** Input quality modifies the level based success chance. On success, roll fish quality using skill level and the school's quality ceiling. Lift the catch from the water and show its species or family and quality grade; failure shows an escape or snapped line and the remaining attempts.

The bite arrives 1.8 to 3 seconds after Start, with a 1.2 second hook window. Reeling lasts 6.5 seconds. Higher Fishing level improves extraction chance and quality; it does not change the input windows in this release.

The cast arc, bobber dip, bending rod during reeling, fish shadow, and landing splash make each stage visible. The fish lifts from the water on a catch or swims away on a failed hook or reel. Tension and catch meters give continuous feedback. A parchment field report shows the illustrated catch or the failed outcome, skill XP, node attempts, and remaining shared actions.

### Mining with Fracture Chain

1. **Read the formation.** Show a compact cutaway with an ore core, its surrounding stone shell, branching fault lines, and a small set of clearly marked legal charge sites. Distinguish fracture paths and fragile zones by shape and labels as well as color.
2. **Place the charges.** Choose two sites on beginner formations and up to three on advanced formations. The goal is to break the shell around the core while keeping the core intact. Before detonation, allow charge repositioning without additional attempt costs.
3. **Trigger the chain.** Press Detonate once. Charges fire in their displayed placement order, cracks propagate along the formation's faults, and loosened stone falls away. The server resolves propagation from the sealed template and chosen placements; visual effects replay that result.
4. **Extract.** Evaluate how much shell was cleared and how well the core was preserved. Clean exposure gives the best success bonus. Partial exposure gives a smaller bonus; destruction of the core resolves a failed extraction. A successful extraction then rolls ore quality from Mining level and the deposit's quality ceiling.

Placement has no timing score, reaction test, or speed bonus. Detonation plays a 2.5 second fracture animation. The 90 second attempt expiry retires abandoned attempts. Reduced motion presents the same crack sequence as clear state changes.

Three authored, solvable templates use two or three charges, four or six core faces, and distinct branching paths. Every admitted layout has at least one placement sequence exposing an intact core. Higher Mining level improves extraction chance and quality; it does not replace the player's placement decisions.

Charges fire in order, gold cracks propagate along their faults, stone sections shear away, and numbered core faces become exposed or the core shatters. Iron, frozen, volcanic, and stormglass deposits have distinct stone/core palettes; frozen facets and ember veins reinforce the terrain identity. More formation variants and optional stress hints can follow later.

Display “Node attempts 3/3” separately from “Charges placed 2/3.” After the entire puzzle succeeds or fails, the node has 2/3 attempts left.

### Hunting remains unchanged

Hunting already has a [sign and choice interaction](../shinobij.client/src/components/HuntEncounterCard.tsx), with [tracking quality](../shinobij.client/src/lib/hunt-encounter.ts) influencing the beast's combat opening. Preserve those interactions and the existing combat exactly as they are inside the Hunting tab.

Do not add a hunting minigame, new tracking animation, or new confrontation sequence. Apex keeps its direct confrontation flow. Only the surrounding Outpost navigation changes.

### Animation and accessibility options

A relaxed animation mode takes three seconds and uses the normal level based chance and quality distribution, with the same attempt cost. Active minigames can earn up to ten percentage points of success bonus. The choice is explained before Start. Animation mode receives no optimal placement bonus or extra quality rolls.

Reduced motion keeps the selected interaction and replaces scenery motion and flashes with static cues. Fracture Chain has keyboard selectable labeled charge sites. Fishing supports pointer hold/release and Space or Enter hold/release. Bite, tension, charge, and crack cues have readable labels. Wider fishing windows and sound are future options, not shipped settings. The active or relaxed mode is sealed at Start.

## Skill progression and success

Give Fishing and Mining independent skill levels starting at 1. Character level continues to govern existing combat. Use distinct labels so Fishing Level, Mining Level, and Hunter Rank cannot be confused.

Levels 1 through 10 have basic, rich, and master node tiers. Basic sites require level 1, rich sites level 4, and master sites level 7 in the relevant skill. Advanced sites are gated explicitly; players can still discover and inspect them before unlocking them. Required level, baseline chance, resource family, and maximum quality appear before commitment.

Success is 60 percent plus five percentage points per skill level above the site's difficulty level, plus up to ten percentage points from active play, bounded between 15 and 95 percent. Required skill and difficulty are authored separately. A locked site cannot be admitted just because the chance formula returns a number.

| Player skill and node | Baseline chance | Best active play chance |
| --- | --- | --- |
| Level 1 at a difficulty level 1 node | 60 percent | 70 percent |
| Level 5 at that same node | 80 percent | 90 percent |
| Level 10 at that same node | 95 percent | 95 percent |
| Level 7 at an unlocked difficulty level 7 master site | 60 percent | 70 percent |
| Level 10 at that same master site | 75 percent | 85 percent |

Missing the mandatory Hook input or destroying the ore core fails the attempt. Otherwise active play adjusts the success roll rather than allowing the client to declare success. A clean minigame can still fail at a difficult site, so explain that relationship before Start. Compare success at the same site when assessing progression; unlocking a harder site does not make an earlier site harder.

Success awards ten skill XP and a completed failure awards three, with none for voluntary abandonment or expiry. Resource grade does not multiply skill XP. Skill level, difficulty, and reward parameters are frozen at Start. Progress is awarded once and cannot be earned by repeatedly starting and cancelling. Cumulative level thresholds are 0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, and 3200 XP.

## Resource quality progression

Separate resource family from quality. Iron Sand and Ember Ore are different material families. Common, Fine, Superior, and Pristine are grades within a family. Existing catalog rarity remains a separate concept: a common grade of Ember Ore still belongs to its existing rare resource family.

| Skill milestone | Quality available | Site progression |
| --- | --- | --- |
| Level 1 | Common | Basic fishing schools and ordinary seams; learn the minigame. |
| Level 2 | Fine | Better grade chances at familiar sites. |
| Level 4 | Superior | Rich schools and deposits unlock. |
| Level 7 | Pristine | Master schools and deposits unlock. |
| Level 10 | Improved odds of Superior and Pristine | Better reliability and quality at the same eligible sites. |

Basic sites allow up to Fine, rich sites up to Superior, and master sites up to Pristine. A veteran still gets better success and more Fine resources at a starter site, but must visit a suitable advanced site to obtain Superior or Pristine resources. A forest pond does not produce a fish native to another habitat, and skill cannot turn ordinary stone into Ember Ore.

Use one success roll followed, on success, by one separate quality roll. Level improves both distributions. Good play affects success in the first release; it does not add another quality multiplier. This keeps learning the skill meaningful and avoids stacking several reward bonuses at once.

The following implemented quality weights sum to 100 percent. Apply the player's grade unlocks and the site's quality ceiling; weight above the allowed ceiling becomes weight for the highest allowed grade. Interpolate weights between the listed levels, then apply those caps. No high roll is discarded or rerolled.

| Skill level | Common | Fine | Superior | Pristine |
| --- | --- | --- | --- | --- |
| 1 | 100 percent | 0 percent | 0 percent | 0 percent |
| 2 | 90 percent | 10 percent | 0 percent | 0 percent |
| 4 | 65 percent | 25 percent | 10 percent | 0 percent |
| 7 | 40 percent | 35 percent | 20 percent | 5 percent |
| 10 | 15 percent | 35 percent | 35 percent | 15 percent |

For example, at the same master site, level 7 has a 25 percent combined chance of Superior or Pristine on success, rising to 50 percent at level 10. At a basic site, the level 10 distribution is capped to 15 percent Common and 85 percent Fine. Higher levels improve quality without guaranteeing the best grade.

Show grade in the result name, icon treatment, and item details, such as Fine Ember Ore or Pristine Fish. List what the grade does. Do not rely only on color or silently merge different grades into one stack.

Use the existing item ID for the Common grade of an existing material and distinct canonical IDs for its higher grades. New fish receive one ID per grade. Continue using the existing item stack shape of item ID and count rather than placing unsupported quality metadata in a stack. Reuse a small set of art assets with clear grade markers.

## Rewards and useful consumption

| Resource site | Initial output on success | Use |
| --- | --- | --- |
| Ordinary rock seam | Iron Sand in an eligible grade | Existing shuriken, weapon, and village supply ingredients; higher grades refine into more base ingredients. |
| Authored frozen deposit | Graded Iron Sand and a small chance of graded Rime Crystal | Existing Frostfang weapon ingredients. |
| Authored volcanic deposit | Graded Iron Sand and a small chance of graded Ember Ore | Existing Embercoil weapon ingredients. |
| Suitable central crystal deposit | Graded Iron Sand and a small chance of graded Stormglass Shard | Existing Tempest weapon ingredients. |
| Fishing school | Fresh Fish in an eligible grade | Higher grades produce more Ration Packs in the fish cooking recipe. |

Follow the visible deposit and existing biome identity. Heartwood Bark and Shadow Thread remain exploration resources. Use the existing [material registry and exact recipes](../shared/gathering-materials.ts); mined ingredients are not automatically generic craft points. Existing saved exploration finds retain their current choices and claim behavior.

Every grade has a consumer. Refining values are Common 1, Fine 2, Superior 3, and Pristine 4.

For ore, add explicit refining in the Mining tab: one higher grade item becomes its grade value in the existing base material. One Fine Ember Ore would yield two existing Ember Ore; one Pristine Iron Sand would yield four existing Iron Sand. Refining consumes and grants in one server settlement with a receipt. Show the exact preview and require an intentional refine action; recipes do not silently consume high grade items. Exact recipe quantities are owned by the shared recipe modules, and ore remains outside the generic craft point pool.

Fish Rations is a separate recipe at the [Cafeteria](../api/player/_cafeteria.ts). It consumes five fish of the selected grade, one Field Herb, one Heartwood Bark for fuel, and 30 Ryo, producing five Ration Packs for Common fish, ten for Fine, fifteen for Superior, or twenty for Pristine. The chosen grade and result appear before cooking. Complete batches preserve fish value. Produced rations count against the existing shared 40 ration daily cooking cap; a batch that will not fit is refused before spending ingredients. Existing meat recipes remain available.

This makes higher quality ore more useful for crafting and higher quality fish more efficient for food. It does not introduce a new direct combat stat bonus. Species and additional ore families can follow when they have a distinct habitat and consumer; the first release gives quality grades to the existing mineral families and the new fish family.

Successful extraction grants one item in the rolled grade. Eligible advanced mining attempts have a two percent regional trace chance on success. A trace uses the same resolved grade, within its authored quality ceiling, rather than another quality roll. Failure yields no item. Higher grade regional ingredients refine to multiple units of an existing recipe ingredient.

Resource attempts give skill XP and materials rather than character XP or automatic Ryo. Compare novice and expert success, grade distributions, expected refined ingredient units, food output, the maximum 100 attempt day, node routes, and time to acquire regional ingredients. Recipe tuning must account for these sources while preserving the accepted shared allowance and exploration odds. Spending every daily action should remain optional.

## Server authority and recovery

Use shared resource definitions and rules, a dedicated server service, client node and minigame components, and an Outpost shell. Extend ContinuousWorldSector and the existing movement authority. Keep new logic out of App.tsx and avoid a second movement controller.

The registered `/api/world/resource` operations are status, start, resolve, cancel, equip, and refine. Resolve carries the bounded interaction events or charge placements. Route and settlement contract tests cover registration. Existing authentication, save mutation, and movement helpers are reused.

At Start, validate the node, layout, accepted approach, sector, required skill, remaining node attempts, combined daily allowance, and battle or travel restrictions. Reserve the shared sector slot, then persist the attempt and debit the player's daily and node counters. Seal the rules version, starting skill level, success and quality random values, difficulty, reward table, grade unlocks and ceiling, input mode, and expiry in the server economy journal. The character save and API responses hold only public attempt details and interaction timing, without reward draws. Seal the fishing cue schedule or Fracture Chain template and variant. An identical Start request recovers the original attempt and counters.

The shared pool and player save are separate records. Implement an idempotent reservation and economy journal consistent with the settlement contract, so failed admission releases an uncommitted reservation and retrying an admitted attempt never reserves or spends again. Do not claim two writes are atomic. Once Start is accepted, normal failure or cancellation retains the spent action and sector slot.

Only one resource attempt is active per character. Movement, travel, and battle entry cancel it through authority boundaries serialized against resolution, with a documented lock order. Gathering grants no PvP protection.

For fishing, accept bounded interaction events against the server admitted timeline and validate order, counts, timing, and hold durations with measured latency tolerance. For Fracture Chain, validate legal charge sites, charge count, placement order, and a single detonation; solve the crack propagation from the sealed formation. Placement speed earns no bonus. Recompute performance on the server in both activities; never accept client supplied success, score, grade, items, or random outcomes. Validation cannot prove human play, so attempts and output remain bounded.

At resolution, verify the attempt, position, server time, events, and cancellation state. Resolve success first; on success derive one resource grade from the sealed skill, quality draw, and ceiling. Co-write the result, exact graded item IDs if successful, skill XP, and receipt while clearing the attempt. Award any new skill level after resolving this attempt with its starting level; it affects the next attempt. A failed outcome also has a durable receipt. Start already spent the counters; resolution does not spend again.

Retries return the recorded result and current save version. Reconnect restores the same unfinished attempt if its window remains valid; it cannot rewind play or reroll failure. Expiry closes without items or abandonment XP. Never start offline. Technical failures recover the stored attempt; compensation, when needed, uses an idempotent server receipt.

Use existing item stacks and inventory rules. Graded item IDs belong to both catalogs and explicit cooking and refining input allowlists. Refining and fish cooking use server computed quantities and idempotent receipts. Optional `resourceGathering` and `gatheringToolUses` character fields hold independent skill progress, daily counters, node states, the active attempt, bounded receipts and tool durability. They are pinned as server owned fields in generic saves and stripped from submitted combat snapshots. Old saves start at skill level 1 with no resource usage and full node attempts. No SQL or schema migration is required.

## Implementation and verification

1. **Interaction and accessibility.** Cast, hook, and reel plus Fracture Chain support touch, keyboard, relaxed mode, and reduced motion. Tests cover puzzle solvability, core destruction, quality, level ups, repeat gathering, depletion, and the 50th basic tool use.
2. **Outpost and shared allowance.** The shell reuses Hunting content and adds Fishing and Mining tabs. The world HUD, Outpost, desktop profile, and mobile You sheet report the combined 100 action allowance; hunting keeps its own counter.
3. **Authoritative settlement.** Admission spends the action, node attempt, and tool use once. Tests cover position authority, failure, cancellation, expiry, duplicate requests, reservation recovery, and persistence of cleared attempts and broken equipment.
4. **Resource consumers.** Separate skills, grade unlocks, higher tier weapon costs, refining, Fish Rations, and Crafter/Cafeteria links are implemented. Unit, handler, source-browser, and real-server journeys verify the consumers.
5. **Reviewed world placements.** The initial network has 24 nodes across ten sectors. Fishing targets and mineral targets were checked against the painted terrain and accessible adjacent approach tiles. Availability is registered together on client and server; there is no separate gathering release flag.

The gathering field reports use the game's charcoal and muted gold palette with warm parchment, bronze accents, illustrated ore, and a neutral silver fish. They show useful outcome details without a large generic success banner.

Required checks include mixed actions reaching exactly 100; failed attempts spending allowance; three failures depleting a node; no free cancellation rerolls; midnight and refill boundaries; duplicate starts and resolves; cross device attempts; forged levels, grades, and scores; fishing input scoring and latency; Fracture Chain solvability and server propagation; movement and combat races; shared pool reservation failures; old saves; autosave injection; and existing exploration find recovery.

For progression, verify that higher level never lowers success at the same site or worsens the cumulative quality distribution. Check every level and ceiling, interpolation summing to 100 percent, locked grade folding, advanced site admission, one quality draw, and starting level ownership across a level up. Verify all graded items have a consumer, refining conserves configured ingredient value, retries cannot duplicate conversion, and high grade cooking counts actual output against the 40 ration cap before spending.

Run relevant unit and handler tests, the backend suite, frontend lint, production build and size checks, route and settlement contract checks, and required responsive and strict combat layout suites. Add real server journeys for Outpost tabs, both node types, and their resource consumers. Include phone input, HTTP movement fallback, full and reduced motion, and repeated sector changes. Check sprites, timers, listeners, frame time, and memory; avoid a poll or render loop per idle node.

The release is complete when players can use all three Outpost tabs, play cast and reel fishing and Fracture Chain mining at appropriate terrain, spend three node attempts even when they fail, improve both success and resource quality through the relevant skill, and consume every resource grade while Explore, Fishing, and Mining correctly share 100 total daily actions. Hunting gameplay and presentation remain unchanged.
