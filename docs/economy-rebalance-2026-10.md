# Economy rebalance, October 2026

The owner asked for a full view of the economy, and for everything given out to be
rebalanced, prices included. This is the record of what was measured, what changed and
why, and which levers exist to tune it after launch. It ships with the planned server
reset. Code comments that say "2026-10 rebalance" point here.

## 1. How it was measured

- **Census.** 18 mappers read every faucet, sink and price in `api/`, `shared/` and the
  client, with file and line, cadence, caps, odds and authority. Four researchers
  surveyed published MMO economy practice (faucet/sink accounting, reward-per-minute
  parity, pacing curves, small-population and PvP-first design, rebalance method).
- **Prices.** About 320 prices were catalogued and expressed in hours and days of
  income for three archetypes: casual (about 30 minutes a day), regular (about 1.5 hours
  a day) and hardcore (about 4 hours a day), at L10, L30, L50, L70 and L90.
- **Live data (prod, read-only, 2026-10-16).** 160 of 181 real accounts never passed L9,
  11 accounts sat at exactly L10, and no organic player was past L29. With no
  mid-game cohort to calibrate against, the rebalance is model-driven.
- **Design.** Three independent frameworks (player experience, economist, endgame/PvP)
  were scored by three judges, merged, turned into 15 per-system specs, checked against
  the owner rulings and the numbers, built, and audited value by value (262 checks).

**Correction to older notes.** Character XP is retired. Level comes from earned stat
points (L10 1,800, L30 6,100, L90 23,704, L100 29,000; all stats max at 29,880).

## 2. What was wrong

| Problem | Before |
|---|---|
| Repeatable hunt and field claims paid the "once a day" stat grant on every claim | up to 135-205 stat points a day against a 45 design |
| Uncapped or level-flat ryo faucets | Endless Tower up to 2.6M per run, milestones re-paid every run; Hollow Gate and Rifts level-flat (an L12 Rift paid 5x the normal rate); bank interest up to 50k a day; Tamer expeditions about 24k a day idle; wanderer favours uncapped; weekly-boss solo MVP 178,750 |
| No endgame ryo sink | after the 5.2M jutsu ladder, income ran 25-32x recurring spend; nothing facing war |
| PvP and war underpaid | about 1% of PvE per minute; ranked paid no currency |
| Rare currencies piled up | Bone Charms and Aura Stones 10-30x their single sink; a 1-per-week Mythic Seal faucet against the zero-faucet ruling |
| Prices flat while income rose 3.5-7x | most recurring prices trivial from L30; 19 dead sinks |
| Items with no use | sell-only gear steps, overflowing materials, strictly dominated items, three dead story relics, an admin-only collar |

## 3. The anchor and the parity rule

`shared/economy-anchor.ts`: **A(L) = min(300, 20 + 4L)** ryo per active minute. It
plateaus at L70, so endgame per-minute pay stops rising.

- Every repeatable activity is sized as a multiple of A(L). Most PvE sits near 1x, the
  hardest content up to about 1.5x, PvP and war at a bounded premium.
- Client-reported AI loops (combat missions, the hunt kill receipt) stay at 0.7x or
  below, because the server does not simulate those fights. Pay rises only on
  server-settled loops.
- Every converter loop (craft-then-sell, Fate Shard keys, the black market) must have a
  rate product below 1.

## 4. Owner rulings that shaped it

- Ships with the reset, single step. No environment variables are needed to go live.
- **One daily stat-point budget of 60** (`DAILY_STAT_POINT_CAP`), shared by hunts, field
  runs, PvE and PvP. Idle training and one-time grants sit outside it. No "first N
  claims" rules.
- **No daily Fate Shard cap and no daily ryo cap.** Hunt and fetch-S claims from L20
  have a 25% chance of 1 Fate Shard; hunts from L50 have a 20% chance of 1 Aura Stone.
  No pity timer.
- **PvP and war pay live at full.** The anti-farm rules are always on.
- **Jutsu mastery Lv40-49 is reachable through PvP**: 60 XP per valid win, 30 per
  engaged loss. The ceiling is unchanged.
- **Every item and material has a use**, through existing systems only. Hunt materials
  stack.
- **Strict save ledger is the code default.**
- **"Established account" = 72 hours old OR level 20.** This lets the week after a
  reset pay PvP and war purses with no environment change. Fate Shard drops gate on
  level 20 alone, with no age branch. Since 2026-10-23 the same rule (one function,
  `pvpAccountOldEnough`) also gates Vanguard Honor Seals and XP, the sleeper KO and
  the legacy PvP-win report, which had kept a 72-hour-only check.
- Standing rulings kept: no PvP power from money, grind or luck; Mythic Seals have no
  faucet; progression is not more ryo-purchasable; Honor Seals stay Vanguard-exclusive;
  named gear, Echoes 10/day, manual ranked and Weekly Boss untouched.

## 5. What changed, by system

**Progression.** Training sessions are 3 / 9 / 33 / 65 (from 3 / 10 / 38 / 72), which
puts a regular player at L90 in about 86 days (`api/_progression-pacing-replay.test.ts`
holds it inside 80-96). The shared 60 daily budget replaces
the per-claim grant and the old 18/day combat cap. PvP growth no longer multiplies after
the cap. The seal speed-up costs 1 seal per 5 minutes (was 10). Every screen that can
grant stat points shows "Stat points today: X / 60": the Missions chip and the Hunter
Board line (fed by the daily-missions read and every hunt or field claim) and the PvE
and PvP win results (`api/_daily-stat-budget.ts` `dailyStatBudgetReply`).

**Missions and onboarding.** Hunts re-anchored to 280 / 480 / 660 / 1,020 / 1,450 ryo
by tier. Fetch missions: 100 / 540 / 1,320 / 3,050 / 5,630. Combat missions:
40 / 80 / 200 / 380 / 600 / 900. The Academy Trial pays 6,000 ryo and the Checklist
4,000 (were 30 and 120), so a new graduate can afford the Lv3 jutsu goal at the L10
stall point. The login streak counts claim days and never resets. The top tiers pay
fewer Bone Charms: the L50 hunts and the A-rank fetch pay 1 (were 2), the L70 hunts
and the S-rank fetch pay 2 (were 3). Their flat Fate Shard became the 25% chance drop.

**PvE.** The AI purse is min(150, 60 + L) ryo (was 75 flat).

**PvP** (`api/pvp/_valid-fight.ts`). A win pays 13.5 x A(lower level): 810 at L10,
4,050 at L70+. An engaged loss pays 40% of that. The anti-farm rules:
- Pay is keyed to the lower fighter's level.
- A winner more than 20 levels up is paid nothing.
- An account that is not established is paid nothing.
- Each unordered pair of players earns 1 / 1 / 0.5 / 0.25 / 0 credit for its fights in
  one UTC day.
- A KO under 3 rounds or 60 seconds pays half; a flee or AFK under that pays nothing.
- Loss pay needs an engaged loser.

Stronghold multipliers are 1.25 / 1.5 (were 2 / 4). The bounty placement fee is 15%,
burned, and a funder cannot claim their own bounty. Ranked Elo, stat points and the
ranked-win count move only on credited fights.

Ranked V2 pays the same purse, priced from the match's sealed weight row, under the same
pair weights and established-account rule. The level-gap rule does not apply because
ranked combat is equalized. A fresh loser blocks the purse for both sides but not the
Elo, which ranked guards with its own IP and device overlap check. The result screen
shows the ranked purse, and why it paid none.

**War.**
- Village wars pay a purse from contribution points: min(points, 400) x 0.3 x A(L) for
  winners, 0.18 for losers.
- Sector wars pay their first purse (`api/war/_sector-purse.ts`): 20 points per credited
  win (a mercenary repel counts a quarter, a garrison assault half), at least 30, counted
  up to 200, times 0.3 x A(L) for the side that captured or held and 0.12 for the side
  that failed. Only established accounts are paid, and only for wars that ended after
  `WAR_PURSE_EPOCH_MS`. It does not check the defeated opponent's account, so an alt in
  the rival village could feed it; the 200-point cap bounds that at 18,000 ryo per war.
- The War Hall states the village purse's 40-point floor and 400-point cap, and the
  guide states both purses' rules.
- War MVP pays max(10,000, 50 x A).
- Village-war loss consolation is a component-wise support floor of 5,000 ryo,
  50 Honor (Vanguard only), 6 Bone Charms and 1 Fate Shard, not an addition to
  the purse and MVP. Consolation Honor no longer creates extra BC/FS. The full
  earned bundle, including already claimed MVP/purse components, counts toward
  the floor. Existing receipts remain spent; old additive payouts are not clawed
  back. The existing claim-marker array also records the floor policy so later
  staged purse claims subtract support already paid. Crates remain separate.
  Loss support follows the established-account rule (72 hours old OR level 20), as
  the war purse does, so a fresh alt cannot join the losing side for a free floor.
  At L90/400 points, including fixed crate currency, a Vanguard MVP winner gets
  52,000 ryo / 200 Honor / 20 BC / 8 FS; the loser gets
  37,100 / 175 / 19 / 8, replacing the additive 42,100 / 225 / 26 / 11.
- ANBU vault raids pay up to 3,000 at the lower fighter's level.
- Mercenaries and war preparations also cost treasury ryo (250 per War Resource;
  preparations also cost treasury Bone Charms), paid by the Kage. This is the
  war-facing endgame ryo sink.
- A war ended by surrender before 72 hours pays no crates, purses or MVP. One ended by
  agreement later pays its purse, purse honor and MVP raise at the share of the five-day
  campaign that was fought (60% at 72 hours, `api/war/_early-end.ts`).

**Hollow Gate and Rifts.** Ryo is scaled by min(1, 1.04 x A(L) / 312), sealed at run
start, with full pay from L70. The framework's 1.2 ignored the augment every run must
take, which already pays at least 1.2x. Threat ambushes pay 485 x scale, at most 16 per
run. Fate Shard, Bone Charm, Aura Stone and Hollow Shard faucets are trimmed.
Consumables cost 10 / 15 / 25 / 25 / 40 / 60 Hollow Shards, and keys cost 15 FS or
120 Hollow Shards. The village Kage unlock stays as the client gates it today: the owner
chose (2026-10-22) not to add a server-side lock or switch.

**Endless Tower.** The pay factor is capped at wave 20, the level term at L70, and the
whole reward x0.55. Fate Shard milestones pay only on a lifetime-first wave; Bone Charms
pay on the first run of the UTC day.

**Bosses and side modes.** The weekly boss pays on a fixed reference HP of 100,000, with
a per-player cap of 60,000 and an MVP cap of 90,000. The Endless Spire pays a ryo purse
at 1.5 x A per active minute. The Dojo Circuit, public Team Arena, tournaments and the
L80 crisis pay 0.5 x A per active minute. The Pet Gauntlet's ryo scales with A(L) (owner
ruling 2026-10-23, `shared/pet-gauntlet-economy.ts`). From L70 it pays its old schedule:
250 a cleared round and 1,500 for a full clear, on the first three runs a day. Below L70
the round pay, the clear bonus and the paid-entry fee shrink in proportion, so an L10 full
clear pays 800 and a paid entry costs 300. The run seals its schedule at start.

**Bank, trade, shop.** The bank principal cap is 1M (was 10M), so passive interest tops
out at 5,000 a day. The top five hunt-material NPC prices were cut x0.8 (Ember Scale 144,
Shadow Pelt 176). The release audit still found L70+ hunts paying about 1.7 x A through
material sales, so the owner cut the top three again (2026-10-23): Ancient Beast Core and
Titan Bone sell for 200 (were 360) and Legendary Material for 240 (was 480). The lower
tiers carry early-game hunt income and are unchanged. A gear step sells for 150. A
crafted charm sells for at most 0.7x its inputs. The shop route now enforces the same
rarity level ladder as the client. Pet supplies buy in stacks up to 50. The B-rank
bloodline forge costs 200 Bone Charms.

**Pets and professions.** Tamer expedition XP is x0.5. Healer heal XP is x2. Wild-pet
rare odds go from 0.3% to 1.2%, which fixes an inverted tier.

Two pet values in this pass were replaced by newer owner-merged designs on `main`:
- Expedition ryo. Reward version 2 (#446) seals a fixed payout at launch (240 / 360 /
  540 ryo per hour by route, x1.5 for Pet Tamers, times purchased mastery and the bold
  route). The owner chose (2026-10-22) to retain v2 and scale ryo by
  `EXPEDITION_RYO_SCALE` (`shared/pet-expedition-contract.ts`). It shipped at 0.3. The
  release audit then found passive income at or above active income for casual players
  and maxed Tamers, so the owner lowered it to 0.2 (2026-10-23). Twelve safe Ruins
  claims now gross 7,776 ryo for a base Tamer or 5,184 for another profession. A legal
  15% reward mastery, bold route and Caravan Master setup permits 14 claims and
  grosses 11,690 secure ryo; Boonbringer doubles this to 23,380 at return. If every
  investigation succeeds, that setup returns 29,232; its investigation expectation
  is 23,150.4 after per-return integer rounding, not the all-success outcome. These
  require L80 pets, enough available pets/slots, timely restarts and happiness
  upkeep. Feeding and opportunity costs are excluded. The old 26,000 figure was
  not a valid maximum. Pet XP and material odds are not scaled. The older x0.4
  `TAMER_RYO_MULT` applies only to expeditions launched before version 2.
- Pet food. Pet growth v2 (`docs/pet-growth-food-redesign.md`) makes Elemental and
  Ancient Treats Crafter-only, prices Treats at 400 ryo and Golden Apples at 40 Fate
  Shards, and caps food XP at 2,000 per pet per day. The rebalance's 200 / 400 shop
  prices for the two premium treats are gone.

**Chronicle.** The Elite pack costs 6 FS and the single Legendary pack 20 FS. Duplicates
beyond a playset convert to Chronicle Points or Fate Shards. The first Echoes win of the
day pays +35 CP. Premium trade-focus discounts round to the nearest Fate Shard:
Elite 6, Legendary 19, Epic Quintet 33, Legendary Quintet 95. Basic packs remain
100 Chronicle Points, without a discount. Server charges and gallery quotes match.

Card battles outside Echoes also pay Chronicle Points (owner request, 2026-10-22), so the
100-CP Basic pack has more than one source. All of it lives in `api/card-clash/_card-cp.ts`,
and there is no daily cap (owner ruling).
- **PvP card duels** pay 20 CP for a win and 8 for the loss. This covers free-play Chronicle
  Showdown (queue and direct challenges), clan-war card duels (campaign queue and legacy
  challenges), sector-war duels between players (the war table and open-world duels), and
  Village War card strongholds held by a player (`api/village/war-campaign.ts`).
- A duel pays only when it would earn the free-play Legacy credit. It must end by play, not
  by a forfeit or the walk-out clock. It must also last 45 s, have three meaningful actions
  from each side, reach turn 3, and not be a reciprocal win. Both sides must have played
  the duel out, so the same rule makes the loss "engaged". Free play reads the free-play
  Legacy reciprocal history under the same receipt, so its Legacy and CP decisions always
  agree. The clan-war and sector-war duels share a separate history, so a war duel never
  changes a free-play Legacy decision.
- One per-pair counter per UTC day, shared by every PvP card mode, scales both shares
  by 1 / 1 / 0.5 / 0.25 / 0. Two accounts therefore mint at most 55 + 22 CP from each other
  a day, however they spread the duels across modes.
- The PvP purse's credited-fight gate applies too (`evaluateCreditedPvpFight`). A winner
  more than 20 levels above the loser earns nobody anything, and a losing account that
  is not established (72 hours old OR level 20) pays nobody. A winner that is not
  established still earns the win, but the loser gets no loss pay. A main cannot farm
  fresh or low-level alts from either seat. The gate reads both saves; a failed read
  leaves the credit pending for the next poll instead of passing it.
- **PvE card wins** pay 10 CP for a won Dungeon Card seal (once per run, with its proof) and
  10 CP for a won Rift card ambush (once per Rift, beside its ryo and Aura Dust). These
  points are not run loot, so a death keeps them. A won sector-war garrison assault pays
  15 CP, at most one assault per two-hour garrison re-form. A won Village War assault on
  an ANBU or Kage deck pays the same 15, bounded by the campaign's personal daily support
  allowance it reserves.
- **Unpaid:** Card Hall practice duels, `externalStakes` encounters with no server seal
  (the flag is set by the client, so it has no access limit), and draws. Echoes of War
  keeps its own table unchanged.
- **Exactly once.** The Dungeon and Rift credits ride their existing receipted terminal
  write. The PvP and garrison credits are an outbox on the duel's session, paid through
  an in-save `serverSettlementReceipts` entry committed with the points, so a retry, a
  lost reply or the second duelist's poll never pays twice. No save field was added.
- Telemetry tags: `card.pvp.win`, `card.pvp.loss`, `card.pve.dungeon`, `card.pve.gate`,
  `card.pve.garrison`.

**World.** Wanderer favours re-anchored to 0.5 x (100 + 16 x min(L, 70)), with no daily
cap. Wanderer quests are validated on the server. Chest duplicates pay their NPC value or
Chronicle Points instead of nothing.

**Village and clan.** The Kage stake is 400k. The clan raid mission pays clan XP instead
of a Mythic Seal, and Mythic Seals can no longer be gifted from a treasury. Clan donation
XP is capped at 2,000 per member per week. Donated items count at their NPC value toward
Village Merit. The Clan Exchange Aura Stone shelves are re-priced (5 for 400, 12 for 900).

## 6. Items and materials

- Overflowing materials substitute in existing recipe slots:
  - any of Ancient Beast Core, Titan Bone and Legendary Material where a core is needed;
  - Shadow Pelt where Shadow Thread is, in the Master Beast Seal, Bloodbond Totem, Phantom
    Charm and Serpent Dust (the Black Lotus Dagger keeps exact thread);
  - Ember Scale as forge and cooking fuel;
  - every grade of river fish in pet treats.
- Out-of-tier gear steps, non-story relics and the weekly-boss core have Village Stores
  donation values.
- Strictly dominated items re-priced or given a horizontal role:
  - Shinobi Vest;
  - Senbon (uncommon, 150 ryo);
  - Avenger's Pendant (4,000);
  - Smoke Pellet (600);
  - Drownstone Compass (now +8% Water);
  - the Sennin set (PvE-leaning: +1.5% PvE damage per piece, nothing in PvP).
- Three retired story relics are taken on turn-in. The Prismatic Collar sells for 400 FS.
- **Hunt materials and the weekly-boss core stack** in `itemStacks`
  (`shared/stacked-materials.ts`). Existing loose copies fold into the stack on every
  save, idempotently and without losing or duplicating a unit. Recipes, the named forge,
  donations, Hunter rank turn-ins, the NPC sale, the Exchange and trades all read both
  stores.
- Item server bugs fixed:
  - Any item could be equipped as a pet battle consumable.
  - Equipped pet PvP gear stayed sellable.
  - Worn-out pet PvE gear never expired.
  - Caravan summons spent a consumable without the heal.
  - A chest step drop overwrote a relic hit.

## 7. Integrity fixes

- Strict save ledger by default: forged jutsu XP and injected pets are refused.
- The jutsu mastery cascade levels only on XP granted this call.
- Ranked win-trading closed, and PvP base farming bounded by the rules in section 5.
- Collusive surrender floor (72 hours).
- Map control counts only war-held sectors.
- The occupation tax is assessed by the server.
- Client-picked wanderer quests are validated.
- No bounty self-laundering.
- 1-unit treasury gifts are taxed (seals stay exempt).
- Clan missions pay from monthly progress.
- Village Merit is server-owned.
- Economy telemetry covers the faucets this pass re-anchored, and the coverage test
  points at the live shop route. Seven touched writers are still on the census's
  pending list (`api/_economy-writer-census.test.ts`): six Hollow Gate routes (attune,
  card settle, combat settle, events, key forging, consumables) and the jutsu seal
  speed-up. The Gate's per-run net is recorded at settlement, but until these record
  their own moves, the faucet:sink watch below cannot see those sinks.

## 8. Tuning dials

Every dial is a server environment variable with a code default, and every default is
the live launch value: nothing has to be set. An out-of-range value falls back to the
default, except `STAT_GAIN_MULTIPLIER`, which clamps to 2.5. Railway restarts the
service when a variable changes.

| Dial | Default | Range / kill value | File |
|---|---|---|---|
| `DAILY_STAT_POINT_CAP` | 60 | 0-300 | `api/_stat-growth.ts` |
| `STAT_GAIN_MULTIPLIER` | 1 | (0, 2.5] | `api/_stat-growth.ts` |
| `TRAINING_RATE_TABLE` | v2 | `legacy` = 3/10/38/72 | `api/_training-config.ts` |
| `STRICT_RAW_SAVE_LEDGER` | strict | only `0` turns it off | `api/save/_sanitize-ledger.ts` |
| `HUNT_FS_CHANCE` / `HUNT_AS_CHANCE` | 0.25 / 0.2 | 0-1 | `api/missions/_mission-catalog.ts` |
| `ACADEMY_TRIAL_RYO` / `ACADEMY_CHECKLIST_RYO` | 6,000 / 4,000 | 0-20,000 | `api/missions/_mission-catalog.ts` |
| `AI_FIGHT_PURSE_BASE` / `_PER_LEVEL` | 60 / 1 | 0-150 / 0-3 | `api/missions/_ai-fight-reward.ts` |
| `PVP_PURSE_SCALE` | 1 | 0-1; 0 = the old 75 flat | `api/pvp/_valid-fight.ts` |
| `PVP_LOSS_FRAC` | 0.4 | 0-0.4 | `api/pvp/_valid-fight.ts` |
| `PVP_MIN_ROUNDS` / `PVP_MIN_FIGHT_MS` / `PVP_SHORT_FIGHT_MULT` | 3 / 60,000 / 0.5 | 0-25 / 0-600,000 / 0-1 | `api/pvp/_valid-fight.ts` |
| `PVP_LOSER_MIN_AGE_MS` | 72 h | 0-72 h; L20+ always passes | `api/pvp/_valid-fight.ts` |
| `PVP_MASTERY_40_49` | on | switch | `api/pvp/_valid-fight.ts` |
| `WAR_PURSE_SCALE` | 1 | 0-1 | `api/war/_war-pay-scale.ts` |
| `WAR_PURSE_WIN_K` / `WAR_PURSE_LOSE_K` | 0.3 / 0.18 | 0-0.6 / 0-0.36 | `api/war/_reward.ts` |
| `WAR_PURSE_EPOCH_MS` | 2026-10-22 UTC | any epoch ms; wars that ended earlier pay no village or sector purse | `api/war/_reward.ts` |
| `WAR_MIN_DURATION_HOURS` | 72 | 0-120 | `api/war/_early-end.ts` |
| `WAR_RYO_PER_WR` | 250 | 0-2,000 | `api/_war-economy.ts` |
| `GATE_RYO_K` | 1.04 | 1.0-1.4, or 99 = flat | `api/hollow-gate/_gate-scale.ts` |
| `ENDLESS_REWARD_MULT` / `_FACTOR_CAP_WAVE` / `_LEVEL_CAP` | 0.55 / 20 / 70 | kill 1 / 200 / 1,000 | `api/endless/_run.ts` |
| `ENDLESS_FS_LIFETIME_FIRST` / `ENDLESS_BC_FIRST_RUN_OF_DAY` | on / on | switches | `api/endless/_run.ts` |
| `WB_REWARD_REF_HP` / `WB_PLAYER_CAP` / `WB_MVP_CAP` | 100,000 / 60,000 / 90,000 | 10,000-1,000,000 / 1,000-1,000,000 / 1,000-1,000,000 | `api/weekly-boss.ts` |
| `SPIRE_PURSE_SCALE` / `SIDE_MODE_PURSE_SCALE` | 1 / 1 | 0-2 | `api/_activity-purse.ts` |
| `BANK_INTEREST_PRINCIPAL_CAP` | 1,000,000 | 100,000-10,000,000 | `api/_bank-interest.ts` |
| `EXPEDITION_RYO_SCALE` | 0.2 | 0-1; kill value 1 | `api/missions/expedition-start.ts` (default in `shared/pet-expedition-contract.ts`) |
| `TAMER_RYO_MULT` / `TAMER_XP_MULT` | 0.4 (pre-v2 expeditions only) / 0.5 | 0-1 | `api/missions/report-pet-event.ts` |
| `HEALER_HEAL_XP_MULT` | 2 | 1-2 | `api/player/_healer-heal-xp.ts` |
| `CARD_PVP_WIN_CP` / `CARD_PVP_LOSS_CP` | 20 / 8 | 0-100 each (before the pair weight) | `api/card-clash/_card-cp.ts` |
| `CARD_PVE_DUNGEON_CP` / `CARD_PVE_GATE_CP` / `CARD_PVE_GARRISON_CP` | 10 / 10 / 15 | 0-100 each | `api/card-clash/_card-cp.ts` |

The black-market pull stays a 75,000 constant on both sides, so the quoted and charged
prices can never split. The Exchange resale-product signal describes private market
incentives, not global ryo creation. A paid pull returns 24,100 expected ryo and
therefore destroys 50,900 before Exchange fees. A Broker certificate covers half the
stake (owner ruling 2026-10-23), so a certificate pull costs 37,500 ryo
(`BLACK_MARKET_CERTIFICATE_COST`, mirrored in the client) and destroys about 13,400.
Before the ruling it was free and created 24,100. First place in the daily Rally
awards two certificates and a successful daily Caravan one. Those three were worth a
conditional 72,300 expected ryo on redemption at any level; redeeming them now removes
about 40,200. These certificate sources predate this rebalance. A certificate pull
without the other half is refused, and the certificate is kept. Earning certificates
is not immediate ryo; redemption consumes the existing daily Broker pull allowance.
Reselling resources transfers existing money and burns the fee. Expected net Broker
cash is −13,400 × certificate pulls − 50,900 × paid pulls, less actual Exchange fees.
The existing 0.93/seven-day/90,000 review constants are unchanged; they do not
establish inflation or authorize an automatic price rise.

Reproducible code-default scenarios live in
`scripts/_economy-income-forecasts.ts` and are generated into
`docs/generated/economy-model.json`, alongside separate gross faucet/debit rows.
Run `npm run export:tooling-handoffs` and `npm run check:tooling-handoffs`.
At L90 the anchor is 300 ryo per active minute, or 27,000 for 90 standard active
minutes. Login, passive income and activity-specific bonuses must be shown
separately; a 43,000 all-source routine is not 43,000 anchor-only active income.
Conditional daily maxima cannot all be added to one player's 90-minute routine.
No prototype mastery, Arena, Gate, crafting, hunt or monitoring rates are changed
by these corrections.

## 9. Rollout

- **Shipped 2026-10-23 without the reset** (PR #482, merge `2ece3f9f5`). Nothing has to be
  set on Railway.
- **Named (forged) gear needs no pre-deploy step.** Strict mode never reads the
  forged-item registry. It keeps every item the stored save holds and the stored forged
  definitions, exactly as the non-strict path does (pinned by
  `api/save/_forged-item-preservation.test.ts`). `npm run scan:data -- --repair` still
  backfills the registry, which lets a fight recover an equipped definition a save lost,
  but it gates nothing. It never edits a save, though `--repair` also reconciles each
  save's currency ledger row (writing missing rows and deleting orphaned ones) and
  publishes authored admin content that was never published.
- **Endless runs in flight** at the deploy switched to the new formula at once.
- **Watch after launch** (weekly):
  - median days at exactly L10 after graduation;
  - regular days to L90 (target 86, inside 80-96);
  - the PvP purse p99;
  - the Exchange Fate Shard median;
  - the faucet:sink ratio for war-active L90 players (alert above 20).
- **Tuning rule.** Change one lever per currency per release, by about 15% at a time.
- **Rollback is one-way for hunt materials.** They fold into `itemStacks` on every save,
  and an older build reads them only from `inventory[]`, so a rollback would hide them.
  Roll forward instead.

## 10. Open owner questions and follow-ups

- Whether war purses should be priced at the level a player fought at. Today they use
  the level at claim time, because battle receipts carry no level.
- Whether Elders may spend treasury ryo on mercenaries. Today only the Kage can.
- A PvP detection report for the owner (pair concentration, fight length, flee and AFK
  share) needs an admin route and is not built.
- `claimedWarCrateIds` has no pruning, and purse markers now add to it.
- Ranked pays the PvP purse from launch (owner 2026-10-22, no switch). If the
  valid-fight share or pair-concentration telemetry shows farming, tune it in code.

Raised by the 2026-10-22 tie-in audit, for the owner:
- Clan missions claim weekly against monthly progress, and a claim consumes nothing,
  so a clan that meets a target in week 1 can claim it again in weeks 2-5 with no new
  play (`api/clan/mission/claim.ts`). This predates the pass, which only narrowed
  lifetime counters to monthly ones. Fixing it means each claim consumes its target
  from the month's progress.
- The AI-fight ryo taper (full pay for 50 wins a day, a quarter to 100, then none) is
  a daily ryo limit, which the no-daily-ryo-cap ruling may or may not cover. It
  predates the pass, and the win result says when it applied.
- Mythic Seals have no source (standing ruling), but S-rank Awakening still shows a
  100-seal progress bar, the hidden "Hold 10 Mythic Seals" achievement cannot be
  earned. (The clan and village donate buttons no longer accept a seal: see the
  2026-10-29 hall split in `shared/treasury-donation-split.ts`.)
- Flat faucets this pass did not re-anchor to A(L): the world boss event (2,500), map
  control (100 per held sector a day), the pet arena and Rift quest completion. The Pet
  Gauntlet was re-anchored on 2026-10-23 (section 5).
- Card duels ended by a forfeit or the turn clock pay neither player, so a losing
  player can deny the winner's 20 CP by conceding. The PvP ryo purse pays the winner
  after a fight that met its length floor.
- The sector-war purse does not check the defeated opponent's account (see section 5).
