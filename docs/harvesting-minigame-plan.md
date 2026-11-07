# Harvesting minigame plan: Kama Reaping

Status: **Phases 1 and 2 done (2026-11-06)**. The art is in the repo
(`shinobij.client/art-source/harvest-kama/`). The owner approved the §6 reward
table on 2026-11-06. Phase 1 added the shared rules (`shared/kama-reaping.ts`,
`shared/harvesting.ts`), the `harvesting` activity type and its save fields, and
the two kama tools in the catalog (not yet for sale). Phase 2 added the 50
meadow nodes and the server settlement. Nothing a player can reach has changed
yet. Phase 3 (the client) is next.

## 1. Why, and what already exists

Mining (Veinbreaking) and fishing (Kunai Fishing) are skilled world-node
activities with their own tool, skill level, daily cap and server-scored
minigame. Harvesting has none of that. Its four materials exist and are used
throughout crafting, but no activity is built around them:

| Material | Id | How it drops today | Main uses |
| --- | --- | --- | --- |
| Field Herb | `gather-field-herb` | Exploration finds (3 per find, or 2 + a trace); pet expeditions | Village supply bundles/crates, herb recipes, building repair "lashings and packing" |
| Binding Fiber | `gather-binding-fiber` | Same as Field Herb | Same rows; fiber recipes |
| Heartwood Bark | `gather-heartwood-bark` | Forest exploration trace (15% of finds); pet expeditions | Forge fuel (`FUEL_IDS`), cooking, bark recipes, building repair |
| Shadow Thread | `gather-shadow-thread` | Shadow-biome exploration trace (15%); pet expeditions | `threadOrPelt` recipes, building repair |

Source files: `shared/gathering-materials.ts`, `shared/gathering.ts`,
`api/world/_gather.ts`, `shared/pet-expedition-materials.ts`,
`shared/crafting-recipes.ts`, `shared/sector-building-content.ts`.

These four are **ungraded**. That is the most important constraint on the design:
mining and fishing pay out a graded item (`resourceItemId(family, grade)` →
`gather-iron-sand-fine`, ...), but no Fine Field Herb exists, and recipes,
supply crates and building repair all count the plain ids. Harvesting must
therefore pay the **existing plain ids**. Skill buys trace chance and node
access, not grades (§6). No new item ids, no recipe edits, no catalog rarity
changes.

Exploration finds and pet expeditions stay exactly as they are. Harvesting nodes
add a skilled source next to the casual one, as fishing nodes did beside
exploration fish.

## 2. The tool: Harvest Kama

A kama is a Japanese reaping sickle, a farm tool for cutting rice and grasses,
later carried as a weapon and the blade of the kusarigama
([Kama (tool)](https://en.wikipedia.org/wiki/Kama_(tool)),
[Kusarigama](https://www.wikiwand.com/en/articles/Kusarigama)). It is the
harvesting equivalent of the fishing kunai: a ninja's own blade turned to
field work. The art pairs it with a small woven reed gathering satchel on the
ring cord, mirroring the kunai's wrist reel.

| Id | Name | Slot | Cost (authored) | Rarity | Durability | Art |
| --- | --- | --- | --- | --- | --- | --- |
| `tool-basic-harvest-kama` | Basic Harvest Kama | `kama` | 150 (×75 → 11,250 ryo in the Ryo Shop) | common | 125 | `/items/tool-basic-harvest-kama-v1.webp` |
| `tool-golden-harvest-kama` | Golden Harvest Kama | `kama` | 50 (gold, Grand Marketplace) | legendary | permanent | `/items/tool-golden-harvest-kama-v1.webp` |

These numbers copy the pickaxe and fishing kunai exactly (`shared/gathering-tool-items.ts`,
`shared/shop-pricing.ts` 75× tool multiplier). That is parity, not a new price.

**The tool is in the catalog but not for sale yet, on purpose.** A Ryo Shop kama
with no activity to use it on would be a dead purchase. Phase 1 added both tools
to `GATHERING_TOOLS` and the generated catalog, with the `kama` slot wired
everywhere except the two shop allowlists (`SHOP_SLOTS` in
`api/shop/_settlement.ts` and in `Shop.tsx`). Phase 3 adds `kama` to those two
lists once the minigame is usable. (That is a dependency, not a feature flag:
the whole feature ships on by default.)

## 3. The minigame: Kama Reaping

**Fantasy:** a quiet meadow at the forest edge. Five stalks of one plant stand on
the soil and sway in the wind. A ninja harvests with one clean stroke at each
stalk's *cut band*, the node just above the root crown. Cut there and the plant
regrows; cut too low and you tear the roots. The kama allows **three strokes**.

**Research notes.** Published foraging minigames mostly fall into click-to-collect
(Story of Seasons' sickle, Kaitiaki Harvest), match-three (Free Realms'
harvesting game) or method-selection (A Tale in the Desert's herb methods, where
a herb is memorised after seven clean forages). None uses timing plus aim, which
is what makes Veinbreaking and Kunai Fishing feel skilled, so Kama Reaping
borrows *aim + timing* from the kunai, *puzzle planning* (several targets per
action) from Veinbreaking, and the "clean method" idea from the herb games.

### 3.1 Rules

| Rule | Value |
| --- | --- |
| Stalks per field | 5, all the node's plant (§5) |
| Strokes | 3 per attempt |
| Ready delay | 600 ms (matches `KUNAI_READY_MS` feel) |
| Time limit | 15 s from ready, then the attempt resolves with what was cut |
| Cut band | per stalk, centred 34–52% up the stalk (seeded) |
| Clean cut | within ±4% of stalk height of the band centre |
| Rough cut | within ±9% |
| Root tear | below the band by more than 9% |
| Wasted cut | above the band by more than 9%: the stalk is cut but counts as rough-minus (no root damage) |

**Sway.** Each stalk pivots at its base: `angle(t) = A·sin(ω·t + φ)`, with
A, ω and φ seeded per stalk. A seeded **gust schedule** (2–3 gusts of 1.2–2 s)
multiplies A by 2.5. The calm between gusts is the moment to cut. Gusts are
telegraphed 500 ms ahead: the backdrop grass and pollen lean first.

**A stroke** is one straight segment `{ at, x1, y1, x2, y2 }` in field percent
coordinates:

- **Swipe** (pointer/touch): drag across the field; any drag under 320 ms and
  longer than 12% of field width is a stroke. One stroke can cut several stalks:
  a level, well-timed sweep through the bands of three neighbours is the
  high-skill play, the Veinbreaking "one charge, several seams" moment.
- **Guide line** (keyboard, and the tap fallback): a horizontal guide line glides
  up and down over the band area. `←`/`→` (or tapping a stalk) picks a stalk,
  and `Space`/`Enter` (or a 44 px **Slash** button) strokes horizontally across
  that stalk at the guide's current height. The server cannot tell the two input
  styles apart: both produce the same segment, so neither is easier to cheat.

**Scoring** (pure function, `shared/kama-reaping.ts`, run by client preview and server):

```
for each stroke, in time order:
  for each uncut stalk:
    pose the stalk centreline at stroke.at (seeded sway + gusts)
    intersect the segment with the centreline → cut height h (0 = root, 1 = tip)
    classify h against the band: clean | rough | wasted | tear
performance = clamp(2·clean + 1·rough − 2·tear, 0, 10)
failed      = (clean + rough + wasted === 0) || tear ≥ 2
```

`performance` is the same 0–10 scale mining and fishing already feed into
`resourceSuccessRate`, so the relaxed path and the receipt need no new math.

**Relaxed mode** (the existing accessibility path): a 3 s animation of the kama
working along the row, then *Collect result*; it uses the skill's baseline
`resourceSuccessRate`, exactly like Relaxed Mining.

### 3.2 Presentation

All drawn in one canvas over the painted backdrop (as `kunai-fishing-renderer.ts` does):

- Backdrop `/assets/harvesting/kama-meadow.webp`. Plants stand on the soil band,
  about 73–90% of the backdrop height.
- Plant sprite per node family (`/assets/harvesting/plant-*.webp`, base on the bottom
  edge so the sway pivots there).
- The cut band: a thin gold tick on each stalk, brighter during calm, dim in gusts.
- The stroke: a fading white-gold arc along the segment. A cut stalk splits at the
  cut height; the top half tips and falls, with a leaf/petal burst (fiber: seed
  tassels; bark: a curl of bark; thread: violet strands).
- Result tags float up from each stalk: **Clean**, **Rough**, **Torn roots**.
- Header in the existing `gather-game-heading` format: kicker
  `Harvesting · Read · Wait · Reap`, phase `01 / 03`, and three kama pips for
  strokes left.
- Reduce Motion / `html.lite-fx` (the e2e default): sway amplitude is kept,
  because it *is* the game, but the burst, falling halves and pollen are dropped,
  and the stroke arc is a static line for 300 ms.
- Phones: the field fills the panel width at a 3:2 ratio, and the Slash button
  and stalk taps keep the 44 px touch floor. The panel is the existing gathering
  panel; no new panel is added.

## 4. Server authority (unchanged pattern)

Harvesting reuses the resource pipeline end to end; **no new endpoint**.

1. `POST /api/world/resource` `start` with a harvest node id → `mintResourceSeal`
   seals `template` + `hookAt` (the kama seed, `kamaSeed = hookAt + template·997`,
   as `kunaiSeed`), the success/quality/trace draws and the rule snapshot
   (`rules.version`, difficulty, family, trace). It debits one kama use at
   admission (`useGatheringTool` with slot `kama`).
2. The client renders the field from the public attempt (seed), records strokes,
   and sends `resolve` with `events: KamaStroke[]`.
3. `resolveResourceAttempt` re-scores with `scoreKamaReaping(seed, events, elapsed)`.
   It rejects malformed events (over 3 strokes, non-finite coordinates,
   out-of-range `at`, non-monotonic time), and pays from the **sealed** rules
   and draws only, never from the client.

The receipt shape is unchanged: `itemId`, `traceId`, `xp`, `performance`,
`toolBroke`, plus an optional `harvestCuts: { clean, rough, wasted, tear }` for
the result card.

## 5. World nodes

- **Placements**: a new append-only list `HARVEST_PLACEMENTS` in
  `shared/resource-nodes.ts` with durable ids `harvest-N`. It is a separate
  namespace, so the append-only `resource-N` table is never touched.
- **Terrain**: the plant patch sits on a reviewed grass tile from a new
  `RESOURCE_MEADOW_TILES` table (as `RESOURCE_ROCK_TILES` does for seams):
  walkable `.` in the sector mask, more than 1 tile from every site approach and
  more than 2 from the painted workplaces (the same exclusions `harvestGroundTile`
  uses), and never on a road. The approach is an adjacent walkable tile.
  `validResourceNodeTerrain` gains a `harvesting` branch.
- **Families by biome**:

| Biome | Level 1 node | Level 4 / 7 node trace |
| --- | --- | --- |
| forest | Field Herb or Binding Fiber | Heartwood Bark |
| shadow | Field Herb or Binding Fiber | Shadow Thread |
| snow, volcano, central | Field Herb or Binding Fiber | none (those biomes already have mining traces) |

- **Wild blooms** (owner request, 2026-11-06): every half hour
  (`HARVEST_BLOOM_MS`), each meadow spot rolls 50/50 whether anything grows
  there, and 50/50 whether it is a herb patch or fiber reeds (`harvestBloom`).
  Players crossing the world find fresh plants by luck, and about 25 of the 50
  spots are growing at any time. The roll is seeded by spot and half hour, so the
  server and every client agree. A dormant spot refuses admission and should
  draw no marker and no painted patch. A started attempt keeps its sealed plant
  even if the half hour turns mid-harvest. The shared node view carries `family`
  and `dormant` so the map can draw the right patch. The authored herb/fiber in
  `HARVEST_PLACEMENTS` (a packed string, for bundle size) is only the default
  for fixed-level QA fixtures.
- **Levels** rotate with the existing deal (`dealLevels('harvesting', cycle)`:
  half level 1, the rest split between 4 and 7), refill every 10 min, and 3
  attempts per node per refill. All of these are the current constants.
- **Map marker**: the node uses the existing material icons
  (`/items/gather-field-herb-v1.webp`, `/items/gather-binding-fiber-v1.webp`),
  as fishing nodes use the fish icon.
- **Painted meadow patch** (added 2026-11-06, after a mock showed the bare
  marker looked dropped at random): a top-down painted plant decal is laid on the
  sector painting under each meadow. Herb or fiber, with dusk variants in shadow
  sectors (`/assets/harvesting/meadow-patch-*-v1.webp`). It is 1.6 tiles wide,
  centred on the target tile, below the marker layer, and turned per node. The
  marker floats half a tile up (`markerOffset [.5, -.05]`) so its pin points
  into the visible patch. Phase 3 renders this; the details are in
  `shinobij.client/art-source/harvest-kama/README.md`.
- **Count (as built)**: one meadow in every forest, shadow and central wild
  sector, 50 in all (8 forest, 13 shadow, 29 central), alternating Field Herb and
  Binding Fiber. Snow and volcano sectors have none: their ground is ice and ash.
  That is about mining's 48 and above fishing's 36. Each target was taken from the
  open, walkable tiles that clear every marker rule, then checked on the sector
  painting; 10 of the 50 first picks were swapped because they sat on a path, a
  rock edge, rubble or a thin strip beside water.

## 6. Progression and rewards: owner-approved 2026-11-06

The table below is approved as written and lives in `shared/harvesting.ts`
(`harvestPayout`, `HARVEST_TRACE_CHANCE`, `HARVEST_PERFECT_PERFORMANCE`).
Questions 2 and 3 at the end of this section keep the plan's assumptions:
golden kama is permanence only, and harvesting counts toward the weekly board
and profile progress.

Everything that does not touch payouts copies mining and fishing:
`harvestingXp` on the same `RESOURCE_SKILL_XP` ladder, 5 XP per success and
1 per failure, node level gated by skill level, its own 50-attempt daily counter
(`harvestingAttemptsToday`), and `resourceSuccessRate(level, difficulty, performance)`.

The proposed payout, chosen to match one mining or fishing success item for
item:

| Outcome | Pays |
| --- | --- |
| Success | **1** of the node's common material (Field Herb or Binding Fiber) |
| Success with performance 10 (every stroke clean, no tears) | +1 more of the same: the skill reward that grades give mining |
| Trace (level 4 node, forest/shadow) | **8%** chance of +1 Heartwood Bark / Shadow Thread |
| Trace (level 7 node, forest/shadow) | **15%**, the same rate exploration finds give today |
| Failure | nothing; 1 XP |

**Ceiling check:** 50 attempts/day at ~75% success is ~38 commons/day, plus up
to ~19 more for a perfect player. That sits beside exploration finds (3 commons
each). Traces stay at or below today's 15%, so Bark (forge fuel) and Thread do
not get cheaper per hour than they are now.

**Recipe costs (owner, 2026-11-06):** harvesting makes the four harvest goods far
easier to come by, so recipes now charge for them the way they charge for fish
and minerals. `resourceIngredientCount` (`shared/resource-material-cost.ts`)
takes 50% more, rounded up, for any recipe row accepting Field Herb, Binding
Fiber, Heartwood Bark or Shadow Thread, substitutes included. Crafting rows pick
that up automatically. Three hard-coded tables now call the helper too:
- cooking: Field Herb per batch 1 → 2, campaign rations 2 → 3;
- village supply bundle: herb and fiber 3 → 5; crate: 10 → 15;
- building repair "lashings and packing": 4 → 6.
The fishing Outpost footer now quotes the live recipe instead of fixed numbers.

**Decisions for the owner:**

1. Approve or adjust the table above, especially the performance-10 bonus and
   the 8% / 15% trace rates.
2. Should golden-kama owners get anything beyond permanence? The golden pickaxe
   and kunai give nothing else today, so the plan assumes nothing.
3. Should harvesting count toward the weekly board's gathering tasks
   (`api/missions/_weekly-board.ts`) and profile activity progress like mining and
   fishing do? The plan assumes yes.

## 7. Implementation phases

Each phase is one PR. "Activity" means extending `ResourceActivity` from
`'fishing' | 'mining'` to include `'harvesting'`.

**Phase 1: shared rules and the tool** ✅ done 2026-11-06 (no player-visible change).
As built: the herbs stay out of `RESOURCE_FAMILIES`; their ids and the payout
live in `shared/harvesting.ts` (there is no separate `HARVEST_FAMILIES` map).
`ResourceReceipt` also gained an optional `count`, because a perfect harvest pays 2.
`Shop.tsx` and `api/shop/_settlement.ts` `SHOP_SLOTS` deliberately still leave out `kama`.
- `shared/resource-items.ts`: add `'harvesting'` to `ResourceActivity`. Do **not**
  add the herbs to `RESOURCE_FAMILIES`, which would mint graded ids. Add a separate
  `HARVEST_FAMILIES` map of plain ids.
- `shared/resource-gathering.ts`: `harvestingXp`, `harvestingAttemptsToday` in
  `ResourceGatheringState` and `readResourceGathering`. These are additive and
  default 0, so old saves read cleanly. Add `harvestCuts` to `ResourceReceipt`.
- `shared/gathering-tool-items.ts`: the two kama tools; slot `kama` in
  `GatheringToolSlot`, `isGatheringToolSlot`, and therefore `combatEquipment`.
  Add a test that a kama never reaches combat.
- Slot allowlists: `api/shop/_settlement.ts` `SHOP_SLOTS`,
  `api/_equipment-ownership.ts`, `shared/shop-pricing.ts` (75×),
  `shinobij.client/src/lib/item-presentation.ts`,
  `shinobij.client/src/lib/gathering-tool-art.ts` (the two webp paths), and the
  regenerated `api/pvp/_item-catalog.ts`.
- `shared/kama-reaping.ts` + `.test.ts`: seed, sway/gust posing, segment ×
  centreline intersection, classification, `scoreKamaReaping`. It must be
  deterministic, with fixtures for clean/rough/tear/miss, multi-stalk sweeps and
  every malformed-event rejection.

**Phase 2: nodes and server** ✅ done 2026-11-06 (no player-visible change).
As built: the meadows are `HARVEST_NODES`, a separate export that is **not** in
`RESOURCE_NODES`. The client map, Outpost panel, road cast, wanderers and
world-boss placement all read `RESOURCE_NODES`, so Phase 3 must add
`HARVEST_NODES` to each of those readers (and to their placement tests) when the
map starts showing meadows. `resourceNode(id)`, the level deal and
`sharedResourceViews` already include them. `RESOURCE_ACTIVITY_INFO`
(`shared/resource-gathering.ts`) is the per-activity lookup, and the client
should use it too. The success roll stays as in mining: a clean, finished run
still rolls `resourceSuccessRate(level, difficulty, performance)`. Worked-ground
trails stay mining-only.
- `shared/resource-nodes.ts`: `HARVEST_PLACEMENTS`, `RESOURCE_MEADOW_TILES`,
  the harvesting terrain branch, `levelRewards` for harvesting.
- `api/world/_resource-gathering.ts`: replace every `activity === 'mining' ? … : fishing`
  ternary with an explicit per-activity lookup. Today the fall-through means
  anything not mining is treated as fishing, so a new activity would silently
  get the fishing slot and messages. That covers the tool slot, the "Requires X
  skill" and "Equip a …" messages, the daily counters, the `kamaSeed` seal, the
  resolve branch, and the payout from §6.
- `api/world/_shared-resource-nodes.ts`, `api/world/resource.ts`: activity
  plumbing only.
- Tests: admission (skill, cap, tool, terrain), resolve (sealed payout, replay,
  cancel/expiry, interrupted), and tool break on the last use.

**Phase 3: client**
- `components/KamaReaping.tsx` (lazy, like `KunaiFishing`),
  `kama-reaping-renderer.ts`, `kama-reaping.css`; wired in
  `ResourceMinigames.tsx`, including the relaxed variant.
- `ResourceWorld.tsx`, `GatheringResult.tsx`, `OutpostResourcePanel.tsx`,
  `GatheringEquipment.tsx` (third slot), `screens/Inventory.tsx` (Harvesting
  slot), `ShinobiOutpost.tsx`, `LeftProfileCard.tsx`,
  `lib/profile-activity-progress.ts`: the same per-activity lookup as the server,
  plus harvesting labels.
- `data/guides-content.json`: a Harvesting guide entry.
- Put the kama on sale (Ryo Shop / Grand Marketplace) in this PR.

Phase 3 as built (2026-11-06):
- `KamaReaping.tsx` + `kama-reaping-renderer.ts` + `kama-reaping.css` (lazy, like
  the kunai). The field is CSS-locked to 3:2 so the drawing matches the scorer.
  Input is a swipe, or a tap on a stalk plus **Reap at the line** (and Arrows +
  Space), which makes a level stroke at the gliding guide line
  (`kamaGuideStroke` in the shared module, so it is always valid input).
  Relaxed mode animates `kamaDemoStrokes`. In Rich/Master forest and shadow
  meadows the middle stalk is drawn as the rare plant (cosmetic only).
- The public attempt carries `harvest: { family, trace }`: the bloomed plant and
  the rare find its level allows. Both are already public on the map; the reward
  draws stay sealed.
- Map: `ResourceWorld` shows only growing meadows, each over its painted patch
  (`lib/meadow-patch.ts`), with the marker lifted half a tile. A meadow in the
  sector where the world boss stands steps aside: counting meadows in the boss's
  placement would have moved the boss in 30 sectors and broken a patrol test, so
  boss placement is unchanged and `worldBossCrystals.bossSector` hides the meadow
  instead.
- Kama slot: Inventory (centre of the tool row), Outpost tool panel, the Ryo Shop
  and Grand Marketplace (`kama` added to both `SHOP_SLOTS`), and a new Outpost
  **Harvesting** tab, drawn by the shared `OutpostResourcePanel` (a per-activity
  copy table; a separate harvest panel was merged into it to save bundle size). The profile card has a Harvesting attempts cell and a Harvesting skill
  row (appended after Hunting).
- Not done: the weekly board's harvesting missions, which pay ryo and Fate Shards
  and need the owner's numbers.

Wiring audit (2026-11-06), after Phase 3:
- The lifted meadow marker sat 1.45 tiles from a mining or fishing marker in
  sectors 20 and 44, where a phone's 48px touch floor makes them overlap.
  Both meadows moved to reviewed grass (20 → tile 80, 44 → tile 87).
  `HARVEST_MARKER_LIFT` now lives in `shared/resource-nodes.ts`, and
  `shared/harvest-nodes.test.ts` measures clearance from the lifted position.
- The map draws a meadow only when the server's node view reports it. Without a
  view, the client used to guess the bloom from its own clock, so specs whose
  node mock lists only seams and shoals (`resource-surface`, `dock-shipment`,
  `shrine-work`) would have gained a marker in roughly half of all runs.
- Removed the retired cast-and-reel fishing UI (`FishingScene`, `CastAndReel`,
  `RelaxedGathering` and their CSS). Every fishing seal since 2026-10-22 is
  kunai, and an attempt expires after 90 s; the server keeps its scorer so an
  old attempt still closes. This was the first JS/CSS budget trim.
- Known and accepted, as with kunai fishing: `hookAt` and `template` are public,
  so a script can compute perfect strokes. A run of only wasted (too-high) cuts
  still harvests at the baseline roll, since a wasted cut takes the stalk
  without harming the root. Harvesting attempts draw on the same 1,500-a-day
  sector gathering pool as exploring, mining and fishing.

**Phase 4: verification**
- `npm test`, `npm run lint` in `shinobij.client/`, root `npm run build`.
- e2e: extend `e2e/resource-gathering.spec.ts` and `e2e/gathering-tool-loadout.spec.ts`
  (kama slot, equip and unequip, never in fights), and `e2e-live/resource-gathering.spec.ts`
  (start → stroke → resolve → item in inventory). The live spec shares daily
  attempts with the mining and fishing cases, so give harvesting its own counter
  in the fixture. Run the full `test:e2e` and combat-layout suites before pushing;
  this touches Inventory and the loadout.
- Check at a real phone viewport (85% viewport-meta scale) that the field, strokes
  and the Slash button stay reachable.

## 8. Risks

- **Fall-through ternaries** (Phase 2) are the main correctness risk; the
  per-activity lookup and a test for each branch remove it.
- **Saves**: the new state fields are optional and default 0. The tool ids are
  new, so no existing equipment entry changes meaning.
- **Economy**: the only payout change is §6, held for sign-off. Exploration finds,
  pet expeditions and recipes are untouched.
- **Bundle**: the minigame is lazy-loaded like Kunai Fishing, so it adds nothing
  to the startup chunk; the art is in `public/` and outside the JS/CSS gate.
