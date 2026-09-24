# Wild pet binding: Explore, battle, seal

## Player journey

1. Daily Explore keeps its existing server hit and rarity rolls and settles the tile. Once rarity is fixed, the sector's current weather favors matching elements within that rarity. The exact pet, trait, and sector are sealed against the Explore receipt.
2. The discovery scene introduces the pet. The player chooses a carried companion and enters a one versus one Pet Showdown battle. A character with no pet borrows the Guild Fox for this fight.
3. The battle shows the wild pet's HP, Resolve, trait, and a short behavior hint. Ordinary attacks lower HP and Resolve. Rest and Guard lower Resolve while exposing the player's companion to the wild pet's turn. The trait changes how quickly each action settles that pet.
4. The player opens the binding panel, checks their seal stock and Resolve thresholds, selects a seal, and commits a capture attempt during the battle's command phase. Selecting a seal alone does not spend it. The battle controls lock during the binding ritual and result.
5. The server consumes one seal and rolls capture. Success grants the pet with the trait shown in the encounter and normal roster or Sanctuary placement. Failure leaves the battle open. Defeating the wild pet or losing the fight ends the discovery without a pet.
6. The world map or Sunscar Caravan resumes after the server resolves the encounter. The Explore receipt remains recoverable across refreshes.

## Screen layout

| Surface | What the player sees |
| --- | --- |
| Discovery card | Wild pet portrait, rarity, short rules, companion selector, Face and Leave actions |
| 3D battle | Existing Showdown arena, pet models, turn playback, HP, attacks, Guard and Rest |
| Collapsible binding panel | Wild HP and Resolve meters, five seal icons, owned counts, eligibility, opportunity bands, bind action |
| First encounter guide | Two short steps teaching HP, Resolve, the gifted Reinforced Seal, and the guaranteed first bind |
| Result | The wild pet is drawn through a binding beam into the chosen seal, followed by a fracture or bond reveal, captured pet name and trait |

The binding panel opens for the first lesson and starts collapsed for later encounters. The collapsed control continues to show the current Resolve. Motion is reduced when the player's OS requests it.

## Acquisition and initial tuning

| Seal | Source | Cost or drop | Max Resolve | Bonus |
| --- | --- | --- | ---: | ---: |
| Worn | Village shop | 80 ryo | 20% | +0 |
| Reinforced | New character gift; village shop | One gifted; 240 ryo thereafter | 35% | +8 |
| Tempered | Ancient Chests found through Explore | 4% of chest rolls, carved from the treat band | 50% | +16 |
| Master | Crafter | Level 30, 450 craft points | 65% | +25 |
| Ancient | Grand Marketplace | 15 Fate Shards | 80% | +30 |

All seals are counted stacks with a 99 item shop carry cap. Tempered and Master have no direct shop purchase path.

Normal capture chance starts from species rarity (standard 32, rare 24, legendary 18, mythic 12), then adds a Resolve advantage, an HP advantage, the seal bonus, and future capped status and progression modifiers. The live result is clamped to 5–95%. The client receives an opportunity label rather than exact odds. The server logs the roll context for tuning without accepting any client supplied combat value.

The first wild bind starts at 35% Resolve with the gifted Reinforced Seal selected and resolves at 100% success. If the player leaves or loses that discovery, the guided guarantee remains available on their next unresolved wild encounter. This avoids losing the onboarding promise through a disconnect or an accidental departure. The guarantee ends with the first successful wild capture.

Pet discovery rates are unchanged: the existing Explore roll yields a wild pet on 5% of searches (4% standard, 0.3% rare, 0.5% legendary, 0.2% mythic), with the existing 150 daily search limit. The tutorial guarantee applies only to binding after a pet has appeared.

## World conditions and trait behavior

The server reads the sector weather when it mints the encounter. Rain favors Water and disfavors Fire; ashfall favors Fire and disfavors Water; thunderstorms favor Lightning and disfavor Wind; tornadoes favor Wind and disfavor Earth; desert haze favors Earth and disfavors Lightning. Clear skies are neutral. A favored template has 2.5 times the selection weight; a disfavored one has 0.75 times the weight. These weights act **only within the rarity already rolled**. Clan-stamped weather uses the same override as the existing sector forecast. The forecast is a practical clue for players choosing where and when to Explore. It does not increase the 5% encounter rate, change the rarity rates, or guarantee an element.

The wild pet rolls its ordinary trait when discovered, shows it before and during battle, uses its existing Showdown trait effect, and keeps the same trait if captured. Existing traitless discoveries retain the old Resolve behavior.

| Trait | Best approach | Resolve behavior |
| --- | --- | --- |
| Loyal | Rest | Rest removes 30 Resolve; Guard removes 22 |
| Aggressive | Land attacks | Rest removes 10; Guard 12; a landed attack gains 9 extra |
| Guardian | Guard | Guard removes 30; a landed attack removes 5 less |
| Swift | Land attacks | Rest removes 14; a landed attack gains 6 extra |
| Lucky | Time any useful action | Every third successful action removes 8 extra |
| Battleborn | Land attacks | Rest and Guard remove 12; a landed attack gains 10 extra |

These values affect when a seal becomes usable, not the capture chance formula. The first encounter still starts at 35 Resolve and binds at 100% with its gifted Reinforced Seal. A separate track or clue chain can follow later if Explore gains persistent search steps; the current weather forecast already provides a world condition players can plan around.

## Tracker trails

A Tracker wanderer (Ibo the Tracker, Kana Reed-Eyes, Old Pawprint, Shin of the Bent Grass) offers **Follow tracks**. The server seals a trail across two road-connected sectors: the first holds more tracks, and the second holds a wild pet. The tracker waits at each stop as a synthesized sector NPC, and the world map marks the next stop with a paw print. The trail goes cold after 2 hours, and a player follows one trail at a time.

The final sector calls `encounter-start` with the trail id. That roll is **guaranteed**: it is scaled into the Explore hit band, so the rarity mix is exactly an Explore hit's (80% standard, 6% rare, 10% legendary, 4% mythic, owner-approved 2026-09-23). It still counts against the 150 daily wild searches, and it enters the same battle-and-seal capture with the same odds. The tracker's normal encounter cooldown applies, so each tracker gives a player one trail per sighting.

- `shared/tracker-trail.ts` derives the route from the trail id and origin, and holds the tracker's lines.
- `api/sector/_tracker-trail.ts` owns the KV row (`tracker-trail:<player>`). `character.activeTrackerTrail` is only a display mirror.
- `api/sector/wanderer-service.ts` handles `tracker-trail-start`, `tracker-trail-step` and `tracker-trail-abandon`. Abandon is refused while the trail's capture battle is still open.
- The final mint stamps `flushedAt` on the row. `wild-binding` accepts that flushed row as the battle's discovery proof, alongside the Explore receipt and the Caravan trail.

## Implementation ownership

- `api/pet/encounter-start.ts` owns Explore's encounter RNG and its durable token.
- `api/pet/wild-binding.ts` verifies the settled Explore or Caravan proof, starts one sealed battle, advances the existing Showdown engine, tracks Resolve, checks seal ownership, consumes seals, and settles capture under the player save lock.
- `shared/wild-binding.ts` holds thresholds, chance tuning and chest drop probability.
- `shared/sector-weather.ts` supplies the server's live weather and elemental matchups; `api/pet/_encounter.ts` applies weights after the rarity roll and seals the trait.
- `api/world/_chest.ts`, `api/shop/_settlement.ts`, and `api/craft/_forge.ts` own acquisition. The generated item catalog follows `starter-items.ts`.
- `WildPetBinding.tsx` presents server state and animation. It never calculates capture odds or awards a pet.
- Newly minted Explore encounters require battle; legacy and authored Hollow Gate befriend tokens keep their prior compatibility path.

## Verification and next balance pass

The focused tests cover first save gifts, no pet loaner battles, locked thresholds, a guaranteed first capture, repeat request idempotency, chest drops, shop currency and stacking, crafting, and the client receipt path. The Caravan integration test covers a real wild battle, capture, and replayed return after a lost response. Desktop and mobile Chromium playtests cover the first lesson and capture reveal; repeated unmounts also check WebGL retirement and idle work. The server and client production builds, distribution verification, and size gate pass locally. After live data exists, review encounter completion rate, average turns to eligibility, seal use by rarity, failure rate by seal, and time to first companion before changing the central tuning table.

## Rollout plan

1. **Feature integration — complete:** Register the battle endpoint, wire settled Explore and Caravan discoveries, and add all five seals to the catalog, economy, inventory, and shops.
2. **Player presentation — complete:** Add the discovery card, carried companion selection, existing 3D Showdown arena, responsive seal panel, first encounter guide, seal art, and binding result animation.
3. **Release gate — local checks complete, staging pending:** On staging, complete one real Explore discovery through a capture, open an Ancient Chest, purchase an Ancient Seal with Fate Shards, and verify the resulting save after refresh.
4. **Live tuning:** Review capture and acquisition telemetry after launch. Adjust the centralized Resolve thresholds, chance values, chest rate, and currency price only after seeing player outcomes.
