# Chronicle Showdown balance pass (2026-10-14)

This note records a measured balance pass on the Chronicle Showdown card game
(`shared/chronicle-duel.ts`, Keeper AI in `api/card-clash/_ai-engine.ts`).
Every number here comes from `scripts/chronicle-ai-balance-sim.ts`. That script
plays the real engine with the real Keeper AI piloting both sides.

## How it was measured

```bash
node --import tsx scripts/chronicle-ai-balance-sim.ts mirror 2000   # who goes first
node --import tsx scripts/chronicle-ai-balance-sim.ts ladder 2000   # Easy/Medium/Hard
node --import tsx scripts/chronicle-ai-balance-sim.ts cards  800    # 8,000 random-deck games
```

- **mirror** plays the starter deck against itself, both sides on the Hard pilot.
  It isolates turn order, because the decks and pilots are identical.
- **ladder** plays the starter deck against each Keeper deck.
- **cards** plays random legal decks drawn from the whole catalog, with a
  playable curve (15 free, 5 one-Tribute, 3 two-Tribute monsters, 17 support).
  For each card it reports its **drawn delta**: the win rate in games where the
  card was drawn, minus the win rate in games where it sat in the deck undrawn.
  A card that does nothing scores about 0. Single cards are noisy below about
  n=200. The group roll-ups are not.

The Keeper AI is a fixed, simple pilot. It never tributes away a strong
free-summon body, and it walks into face-down Snares. Read the numbers as the
game played by a consistent, unsophisticated player. They are not the exact
experience of a skilled human.

## What the baseline showed

| Finding | Measure |
| --- | --- |
| Going first decides too many games | first player wins **60.1%** of starter mirrors (n=2,000) |
| The Keeper ladder is flat | starter deck wins 50% vs Easy, 45% vs Hard |
| Hard's deck cannot summon | Crimson Tempest holds 5 free bodies against 19 Tribute monsters (its comment says 19 free) |
| Tribute monsters are dead draws | drawn delta: L4 **+13.3**, L5 −1.4, L7 −4.0, L8 −2.7 |
| Rewarded Legendary bodies are the worst group | Legendary two-Tribute **−4.5** (Legacy and Story rewards) |
| Free-summon Epic/Legendary bodies dominate | Epic T0 **+15.6**, Legendary T0 **+15.9** |
| Rarity-scaled conditional ATK on free bodies | tc-146 (L4, "+1,000 vs stronger") **+30.6**, tc-98 +28.6, tc-113 +26.7, tc-135 (L2) +24.9 |
| FLIP effects landed on Tribute bodies | tc-08 "FLIP: destroy their strongest" is Level 5 (−8.8); the L2 flip tc-91 is +14.0 |
| Printed text did not match the engine | ~100 Epic+ effects print the base amount while the engine applies 1.5–2.5×; the default reflect effect printed "400 damage" and dealt the attacker's full ATK |
| Support outliers | Mirror-Shell Counter **+27.0**, Widespread Kunai Line +23.7; healing −8.2, War-Camp Feast −7.4 |

## The plan

Each step is measured before the next one starts, because the steps interact.

1. **Text equals behavior.** Restate rarity-scaled amounts in the printed effect
   text. A reflect effect with a printed amount deals that amount, in the
   engine and in the battle preview. Add guard tests.
2. **Turn order.** The first player skips the turn-one draw. Target: starter
   mirror within 47–53%.
3. **FLIP effects belong on free bodies.** An effect that fires when a Set card
   is flipped must sit on a Level that can be Set without a Tribute. This
   mirrors the existing `TRIBUTE_TRIGGER_IDS` rule. Add a guard test.
4. **Tribute economics.** The rarity premium scales with the Tribute band, so a
   rare free body no longer outclasses a common Tribute body. Rarity-scaled
   effect magnitudes follow the same rule. The strict rarity order at each
   Level is kept, and its test stays. Target: the gap between the best and
   worst Level band shrinks from 17 points to under 8. Within a band, a higher
   rarity must never be the worse draw.
5. **Support outliers.** Retune the cards outside the ±20-point band without
   changing any deck limit, because a lower limit would make saved decks
   illegal.
6. **Keeper ladder.** Rebuild Crimson Tempest to its documented curve with
   today's Levels. Add a curve guard for every Keeper deck. Target: the starter
   deck on the Medium pilot wins at least 50% vs Easy and at most 35% vs Hard,
   and the three rungs are in order.

Out of scope: pack odds, shard prices, rewards and deck limits. Those are
economy and save-compatibility decisions, not card balance.

## What the experiments changed in the plan

Step 4 assumed Tribute Monsters were dead draws because their stats were too
low. The experiments disproved that.

- Raising every Tribute baseline (Level 5 by +200 ATK, Level 7 by +250, Level 8
  by +100) and paying two-Tribute bodies 1.5× the rarity premium moved the
  two-Tribute band from −4.6 to −4.2 points. That is inside the noise.
- A pilot experiment settled why. Two copies of the starter deck played each
  other with the Keeper's Tribute valuation set to 0 on one side and 1,850 on
  the other. The tribute-happy side Tribute Summoned **1.22 times a game against
  1.11**, and it won 49.1% of 1,500 games. The Keeper is not refusing to
  tribute. It rarely gets the chance: one Normal Summon a turn plus heavy
  removal means a board seldom holds two bodies at once, so two-Tribute
  Monsters wait in hand. The final mirror records 0.97 Tribute Summons per side
  per game.

Stats cannot fix castability, so this pass leaves the Tribute baselines and the
two-Tribute premium alone. Raising them would only inflate the top of the curve
(a Mythic Fire body would reach 4,100 ATK) for no measured gain. Step 4 now
targets what the numbers do show: free-summon bodies carrying both the rarity
premium and rarity-scaled conditional ATK.

Two more findings reshaped steps 5 and 6.

- **A Health cost does not touch Mirror-Shell Counter.** It drew at +27 with a
  1,000 cost and +27 with 2,000. Its power is the multi-kill, not the price. The
  element requirement that 25 other Snares already use did the job instead.
- **The starter deck is the weakest deck in the game, because of its curve.**
  Rebuilding Crimson Tempest to its documented 19 / 3 / 2 curve made Hard beat
  the starter deck 98.5% of the time. Cutting Hard's removal or its Volcanoes
  barely moved that; its smooth curve was the whole difference. The starter
  holds eight two-Tribute Monsters, and they rarely reach the field. Swapping
  those eight for Shop Level 4s took the same deck from 48% to 88% against Easy.

## What shipped

| Step | Change |
| --- | --- |
| 1 | Rarity-scaled amounts are restated in the printed text. A reflect card with a printed amount deals that amount, in the engine and the battle preview (Sky Empress Roc printed 400, carried 600 and dealt the attacker's 2,750). |
| 2 | The first player skips the turn-one draw. |
| 3 | Every FLIP Monster sits on a free-summon Level (`FLIP_TRIGGER_TIERS`), so it can be Set without a Tribute. |
| 4 | Free-summon bodies take two-thirds of the rarity premium (`FREE_SUMMON_PREMIUM_SCALE`). Rarity no longer sharpens effect amounts on them, and conditional ATK effects keep 60% of the authored amount there, rounded to 50s (so 400 keeps 250 and 200 keeps 100). Tribute bodies are unchanged. |
| 5 | Mirror-Shell Counter needs a face-up Water Monster. Widespread Kunai Line only answers a Level 6 or lower attacker. No deck limit changed. |
| 6 | Crimson Tempest is tuned to 16 / 5 / 3 and pinned by a test. The Keeper's battle math now counts "+X ATK vs a stronger Monster", which the player's preview already showed and the Keeper used to attack into. |
| — | Storefront pins keep tc-24 and tc-85 in the Marketplace, and tc-39 and tc-74 in the Shop. The FLIP move would otherwise have swapped them, so a balance change no longer reshuffles what each storefront sells. |

The heal cards were tested at +50% and did not need it. They sat at −8 in the
baseline but about −1 once the rule fixes landed, so they are unchanged.

## Results

All numbers are from the final build. Random-deck rows come from 5,000 games.

| Measure | Baseline | Final |
| --- | --- | --- |
| First player wins, starter mirror (2,000 games) | 60.1% | **48.6%** |
| First player wins, random decks | 54.5% | **49.4%** |
| Cards above +20 points when drawn | 14 | **7** |
| Strongest card | tc-146 +30.6 | tc-131 +29 (E0 control: +35) |
| Mirror-Shell Counter | +27.0 | **+10.6** |
| Widespread Kunai Line | +23.7 | +19.8 |
| Legendary free bodies (group) | +15.9 | **+11.9** |
| Epic free bodies (group) | +15.6 | +14.3 |
| FLIP Monsters moved to free Levels | −8.8 to −16.0 | **−2.6 to +7.7** (tc-08 +19) |
| Two-Tribute band | −4.0 / −2.7 (L7 / L8) | −3.9 / −6.0 (unchanged, see above) |

Keeper ladder, Medium pilot, 1,000 games a cell:

| Player deck | vs Easy | vs Medium | vs Hard |
| --- | --- | --- | --- |
| Starter deck, baseline | 51.2% | 50.3% | 45.0% |
| Starter deck, final | 49.7% | 44.3% | **14.8%** |
| Starter with its eight two-Tribute Monsters swapped for Shop Level 4s | 88.2% | 88.0% | **51.0%** |

The step 6 target (the starter deck at 35% or less against Hard, with the
rungs in order) is met, though Hard sits further down than planned. The miss is
deliberate. Hard is a progression check now: a deck with a few Shop upgrades
plays it even. Easy cannot rise above about 50% for the starter, because Easy
plays the starter list itself. The Keeper is also a weaker pilot than a
practised player, so a human with the starter deck should beat Hard more often
than this.

## Owner rulings (2026-10-14)

1. **The starter deck is meant to be weak.** It is the starting point, and
   upgrading it is the progression. Leave its list alone. (It is also
   load-bearing: `claim-starter` materializes it, save sanitizing uses it as an
   ownership floor, the Exchange treats starter copies as untradeable, and the
   Easy and Medium Keepers borrow it.)
2. **Epic and Legendary cards are meant to be the best.** The remaining top
   cards (tc-131, tc-113, tc-146 at +28 to +29, all Epic or Legendary Level 4s)
   are working as intended. Do not cut the free-summon premium further.

## Two-Tribute castability: the owner's design

Raising stats does not help, because a board rarely holds two bodies. The owner
chose three cards and a keyword (2026-10-14). The first two help a deck cast
big Monsters; the third makes the summon worth its cost.

| Piece | Rule |
| --- | --- |
| **Summoning Calls** (5) | One per element: Call of the Cinderhorn, Rimetide, Ironroot, Galewing and Stormcrown. Pay 1,000 Health to Summon one specific Level 8 Monster from your hand in Attack Position. It uses the Normal Summon, and the Monster cannot attack that turn. |
| **Called Monsters** (5) | Cinderhorn Qilin, Rimetide Leviathan, Ironroot Tortoise, Galewing Tengu and Stormcrown Raiju. Only their own Call can Summon them. Each sits 200 ATK and 200 DEF under the plain Level 8 baseline, so it is weaker than every other Level 8 of its element. |
| **Shadow Clone** | Summons two 0/0 Shadow Doubles in Defense Position. They can pay a Tribute from the next turn, vanish when they leave the field, and can never be owned or put in a Deck. Two copies per Deck. |
| **Warded** | Every other two-Tribute Monster in each rarity (55 of 109). Snares cannot destroy it or return it to the hand during the turn it is Summoned. Snares that only remove that Monster are not offered against it, board-wide Snares spare it, and Jutsu still work. |

All eleven new cards are Legendary and drop only from the Legendary packs
(owner ruling), so a Call and its Monster are two separate lucky pulls. They are
placed in the Grand Marketplace by `STOREFRONT_ADDITIONS` rather than ranked in,
because ranking them would have pushed two existing Rares (tc-29, tc-34) into
the Shop. The Keeper AI casts a Call when it holds both halves, plays Shadow
Clone when a Tribute Monster is waiting for bodies, and pays Tributes with
Shadow Doubles first.

Each Legendary pack slot draws evenly from its pool, so the pool grew from 49
to 60 cards. Every existing Legendary fell from 2.04% to 1.67% per pull, about
18% rarer. One specific Call pair takes luck, as the owner asked: a player owns
both halves after 30 Legendary pulls about 15% of the time, and after 60 pulls
about 40% of the time. The Elite packs roll only Rare and Epic cards, so none of
the new cards appears there.

A Call opens the same "a Jutsu is activated" Snare window as any Jutsu, so a
Jutsu counter can stop it before the Health is paid. Like the existing revival
Jutsu, a Call's summon does not open the "a Monster is Summoned" window. Only a
Normal Summon does.

### Measured

**Do the casting tools help?** The starter deck (eight two-Tribute Monsters)
with a few support cards swapped out, against the plain starter, both on the
Hard pilot (`upgrades` mode, 2,000 games each, about ±1.1%):

| Starter deck plus | Wins | Tribute Summons per game |
| --- | --- | --- |
| nothing (control) | 49.3% | 0.97 |
| 2 Shadow Clone (for 2 Field Medicine) | **62.9%** | **1.42** |
| 1 Call pair (for Guard Stance, Soldier Pill) | 51.9% | 1.02 |
| 2 Call pairs (for 2 Guard Stance, 2 Soldier Pill) | 55.6% | 1.05 |
| 2 Shadow Clone and 2 Call pairs | **67.8%** | 1.44 |

**Is Warded worth it?** Warded alternates within each rarity, so the random-deck
run compares the same kind of cards with and without it (5,000 games):

| Two-Tribute Monsters | Before Warded | After |
| --- | --- | --- |
| The 55 that became Warded | −5.4 | **−1.9** |
| The 54 that did not | −4.0 | −4.4 |
| Level 8 band | −6.0 | **−2.1** |
| Legendary two-Tribute | −4.8 | −2.4 |
| Mythic two-Tribute | −7.8 | −3.8 |

Card by card, Shadow Clone draws at +14, inside the ±20 band, and is the
strongest of the new cards. A Call or called Monster without its pair is a dead
draw in a random deck (−4 to −7), which is the intended cost of needing both
halves. Built as a pair, the Calls add about 6 points per two pairs, which fits
the owner's brief that the called bodies are slightly weaker and the pair takes
luck.

If Shadow Clone proves too strong in live play, the levers are its deck limit
(2) and its two bodies blocking attacks while they wait. Its Tribute help is the
point of the card and should stay.

## Tie-in audit (2026-10-14)

An independent review of the whole change found no state-corrupting bug. It
found these gaps, and each fix has a test that fails without it.

| Gap | Fix |
| --- | --- |
| The duel board offered Summon and Set for a called Monster, and lit fresh Shadow Doubles as Tributes. The server refused both. | The projection now carries `canTribute` for the viewer's own Monsters. The board reads the server's own `callOnlySummonBlocker` and `summoningJutsuBlocker`, so it explains a refusal before the player commits. |
| Call and Shadow Clone always showed an enabled Activate button. | The same `summoningJutsuBlocker` disables it and names the missing piece. |
| Two Wind Shadow Doubles met the requirement of every Wind Snare, in any Deck. | `meetsSnareElementRequirement` skips tokens, for the engine and the Keeper alike. The Doubles stay Wind for the element wheel. |
| Sand-Coffin Counter could flip when every face-up Monster it could destroy was Warded, and do nothing. | It is no longer offered then. |
| Warded survivors of a board-wide Snare left no trace in the log. | The log names each one. Mirror-Shell still ends a Warded attacker's attack, because the card stops the attack (`originatingActionContinues: false`). |
| A Shadow Double leaving the field produced no destroyed event, because no Graveyard received it. | It now produces one. |
| Halden (Echoes floor 10) ran Mirror-Shell with only two Level 7 Water Monsters. | He runs Sand-Coffin Counter instead, which his eight Earth Monsters support. A catalog test now checks every element Snare in an opponent Deck. |
| Warded was assigned by catalog position, so adding a card could flip it on cards players own. | `WARDED_MONSTER_IDS` freezes the list by id. |

Left as they are, by decision:

- `CHRONICLE_RULES_VERSION` stays at 10. It has not moved since release, and a
  bump would void every duel in flight, including clan and sector war duels.
  The first-turn draw only applies when a match is created.
- A Call or Shadow Clone emits `magic-activated`, not `monster-summoned`. The
  board still plays the summon entrance for any new Monster, and the log names
  the Call and its Monster. Emitting a summon event for Jutsu summons would also
  change how the existing revival Jutsu present.
- Eren (Echoes floor 8) runs Windless Edict with three Wind Monsters. That
  predates this pass, and it passes the new catalog test.

## Keeper play fixes (2026-10-26)

A readiness audit found the Keeper misplaying in ways that were bugs, not
balance. No card stat or rule changed.

- It never changed a Monster's position, so anything left in Defense (a revive,
  a Snare-Summoned defender, a Monster that drops to Defense after it attacks)
  sat there for the rest of the duel. Medium and Hard now stand one back up
  before the Battle Phase when the field in front of it is empty or it beats a
  Monster it can see. Easy is unchanged.
- A refused Main Phase 1 choice ended the turn and threw the Battle Phase away.
  It now tries to start the Battle Phase first.
- Its battle read was its own copy of the formula. It now uses
  `previewChronicleBattle` over its own projection, so it accounts for a
  defender switching to Defense when attacked, a defender that survives, and
  the guard rule that makes other targets illegal, and it still cannot read a
  hidden card.
- Four upside effects (`gainAttackPerOpponentMonster`,
  `drawWhenDestroyedByBattle`, `returnToDeckWhenDestroyed`,
  `weakenAttackerOnFlip`; 28 Monsters, most Epic and up) fell through to the
  150 default in its Summon scoring. They now score 350.

Keeper ladder, starter deck, 2,000 games a row (1,000 a cell), seed 1, same
catalog for both runs. The sim pilots both sides with the Keeper, so the fixes
apply to the player side too.

| Player pilot | Keeper | vs Easy | vs Medium | vs Hard |
| --- | --- | --- | --- | --- |
| Easy | before | 50.4% | 43.5% | 17.1% |
| Easy | after | 50.5% | 42.7% | 16.6% |
| Medium | before | 50.5% | 44.7% | 18.1% |
| Medium | after | 50.9% | 44.7% | 18.0% |
| Hard | before | 50.7% | 43.9% | 18.2% |
| Hard | after | 51.0% | 44.5% | 17.9% |

Every cell moved by 1.5 points or less, and the rungs keep their order. The
"before" row differs from the 2026-10-14 table above because the catalog has
changed since then; both rows here were measured on today's catalog.
