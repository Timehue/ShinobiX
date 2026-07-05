# Combat Parity Audit

Date: 2026-07-05

Scope: player-facing combat engines in Shinobi Journey. PvP combat is the truth source. Pet battle/autobattler and card battle engines were intentionally excluded.

## Current Implementation Slice

This pass did not rewrite every combat surface. It shipped the safest server-side parity fixes found during discovery:

- Clan Boss endpoints now resolve the boss from the stored weekly event state before using a deterministic fallback for malformed legacy weeks.
- Battle Towers, and therefore Clan Boss assaults, now enforce PvP-style weapon and combat-item cooldown gates.
- Battle Towers weapon attacks now synthesize weapon effect tags when an equipped item has `weaponEffect` but no `weaponTags`, matching the PvP weapon path.
- Battle Towers, and therefore Clan Boss assaults, now track server-recorded consumable/throwable spends and deduct them idempotently during settlement.
- Battle Towers now apply Smoke Bomb-style `weaponEffectTarget: "both"` damage-given debuffs to both the user and hostile side.
- Focused tests were added for Clan Boss boss resolution, tower weapon/item cooldown behavior, item spend settlement, and Smoke Bomb tags.

## 1. Combat Engine Inventory

| System | File path(s) | Combat type | Player combat? | Should follow PvP parity? | Excluded? | Current relationship to PvP logic | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PvP session sealing | `api/pvp/session.ts` | 1v1 PvP setup, stat/equipment/jutsu sealing, item charge sealing | Yes | Truth source | No | Authoritative source for player fighter snapshots, item charge budgets, equipped jutsu, bloodlines, creator jutsu, armor passives, and rank/stat clamps | High |
| PvP move resolver | `api/pvp/move.ts` | 1v1 PvP turn/action resolver | Yes | Truth source | No | Authoritative action rules for AP, actions per turn, movement, jutsu, weapons, throwables, consumables, statuses, DoTs, cooldowns, damage, defense, shield, pierce, reflect, absorb, lifesteal, recoil, wound, cleanse, clear, flee | High |
| PvP reward/item cleanup | `api/pvp/claim-rewards.ts` | PvP settlement and item deduction | Yes | Truth source | No | Verifies finished `pvp:<battleId>`, idempotently settles rewards/rating and deducts server-recorded `itemsUsed` | High |
| PvP helpers/catalogs | `api/pvp/_aoe.ts`, `api/pvp/_tags.ts`, `api/pvp/_multipliers.ts`, `api/pvp/_item-catalog.ts`, `api/pvp/_jutsu-catalog.ts`, `api/pvp/_legacy-jutsu-catalog.ts` | Shared PvP data/helpers | Yes | Truth source/support | No | Used by PvP and partly by tower sealing/resolution | Medium |
| Shared resource costs | `api/_combat-resources.ts`, `shinobij.client/src/lib/jutsu-scaling.ts` | Chakra/stamina v2 costs, regen, poison-on-spend | Yes | Yes | No | Server resource rules are shared by PvP and Battle Towers; client mirror exists for UI | Medium |
| Battle Towers engine | `api/towers/_engine.ts` | N-actor PvE/co-op/tower combat | Yes | Yes for player-side mechanics | No | Adapts `TowerActor` to `PvpFighter` and calls PvP `applyJutsu`, `applyDoTs`, `tickStatuses`, `applyGroundEffectToFighter`, and `tickGroundEffects`; has tower-specific turn scheduling, AI, objectives, board geometry, boss phases | High |
| Battle Towers sealing | `api/towers/_seal.ts`, `api/towers/_encounter.ts`, `api/towers/_tower-session.ts` | Tower fighter/session construction | Yes | Yes | No | `sealTowerFighter` delegates to PvP `hydrateCharacterFromSave`; `sealTowerItemCharges` delegates to PvP `sealItemCharges` | High |
| Battle Towers API/rewards | `api/towers/start.ts`, `api/towers/action.ts`, `api/towers/settle.ts`, `api/towers/_tower-store.ts`, `api/towers/_tower-rewards.ts`, `api/towers/join.ts`, `api/towers/state.ts` | Server-authoritative tower run lifecycle | Yes | Yes for combat; mode-specific for rewards | No | Uses tower engine, idempotent reward receipts, and tower `itemsUsed` deduction for settled runs | High |
| Endless Spire | `api/towers/_spire-catalog.ts`, `api/towers/_spire.test.ts`, `shinobij.client/src/screens/EndlessTowerLobby.tsx` | Tower-derived ascension combat | Yes | Yes for player-side mechanics | No | Runs through the tower engine, with allowed mode-specific modifiers and reward channel | Medium |
| Clan Boss server | `api/clan-boss/get.ts`, `api/clan-boss/assault-start.ts`, `api/clan-boss/assault-settle.ts`, `api/clan-boss/_assault.ts`, `api/clan-boss/_storage.ts`, `api/cron/_clan-boss-weekly.ts` | Weekly clan raid using tower combat | Yes | Yes for player-side mechanics | No | Assaults create `cboss-` tower sessions; damage is extracted from finished server tower session and banked with locks/settled side record | High |
| Clan Boss client | `shinobij.client/src/screens/ClanBoss.tsx`, `shinobij.client/src/lib/clan-boss-api.ts`, `shinobij.client/src/screens/BattleTowerFight.tsx` | UI wrapper around Clan Boss/tower fight | Yes | Yes via server APIs | No | Starts and settles Clan Boss via API; fight screen is the tower UI | Medium |
| Client Battle Tower UI | `shinobij.client/src/screens/BattleTowerFight.tsx`, `shinobij.client/src/lib/towers-api.ts`, `shinobij.client/src/lib/tower-grid.ts` | Tower UI/action submission | Yes | Yes via server APIs | No | Client submits actions; server validates and mutates session | Medium |
| Client Arena/PvE monolith | `shinobij.client/src/screens/Arena.tsx`, `shinobij.client/src/components/ArenaBattlePersister.tsx`, `shinobij.client/src/components/BattleLockKeeper.tsx`, `shinobij.client/src/lib/battle-save.ts` | Client-resolved AI/PvE/story/weekly-boss/hollow-gate/endless legacy combat | Yes | Yes where normal player combat is used | No | Contains a large independent client combat engine with parity comments and local math; does not directly call server PvP resolver | High |
| PvP battle client | `shinobij.client/src/screens/PvpBattleScreen.tsx`, `shinobij.client/src/lib/pvp-session.ts`, `shinobij.client/src/lib/pvp-targeting.test.ts` | UI for server PvP session | Yes | It is the PvP UI | No | Displays server state and submits moves to PvP APIs; some UI-side affordability/targeting mirrors server rules | Medium |
| Arena lobby/co-op pet preview | `api/arena/lobby.ts`, `api/arena/_lobby-core.ts` | Pet co-op preview/lobby | No for normal shinobi combat | No | Pet-adjacent | Separate preview/lobby flow; not part of player shinobi combat parity | Low |
| Weekly world boss | `api/weekly-boss.ts`, `shinobij.client/src/screens/WeeklyBossArena.tsx`, `shinobij.client/src/lib/weekly-boss.ts`, `shinobij.client/src/lib/weekly-boss-roam.ts` | Shared world boss contribution | Yes, when launched into Arena fight | Yes for fight mechanics | No | Server records capped client-reported fight damage; actual fight is client Arena, not server PvP/tower | High |
| Story/VN-triggered combat | `shinobij.client/src/screens/StoryBoss.tsx`, `shinobij.client/src/components/TriggeredVisualNovel.tsx`, `shinobij.client/src/lib/vn.ts`, `shinobij.client/src/data/storylines.ts` | Story-triggered arena fights | Yes | Yes | No | Launches or configures client Arena fights | Medium |
| Missions/combat claims | `api/missions/queue-combat-claim.ts`, `api/missions/claim-mission.ts`, `api/missions/report-ai-fight.ts`, `shinobij.client/src/screens/Missions.tsx`, `shinobij.client/src/lib/claim-mission.ts`, `shinobij.client/src/data/combat-missions.ts` | Mission reward settlement around client AI fights | Yes, combat-adjacent | Yes for underlying fight | No | Rewards are partly server-gated, but AI fight win still comes from client Arena; not a server combat resolver | High |
| Hunt/field mission progress | `api/missions/_mission-catalog.ts`, `api/missions/claim-mission.ts`, `shinobij.client/src/screens/HunterBoard.tsx`, `shinobij.client/src/components/WeeklyBoard.tsx` | Mission/hunt progression and claims | Combat-adjacent | Only if a normal combat fight is launched | No | Server recomputes rewards from catalog; progress remains client-tracked for some mission types | Medium |
| Hollow Gate | `api/hollow-gate/start.ts`, `api/hollow-gate/settle.ts`, `api/hollow-gate/_run-token.ts`, `shinobij.client/src/lib/hollow-gate-run.ts`, `shinobij.client/src/lib/hollow-gate-server.ts`, `shinobij.client/src/screens/Dungeon.tsx` | Dungeon/exploration with arena fight hooks | Yes, when fighting | Yes | No | Uses run tokens/server settlement, but combat appears to route through client Arena for fights | Medium |
| Sector war combat | `api/village/sector-war.ts`, `api/_sector-war.ts`, `api/_sector-war-store.ts`, `api/_war-role.ts`, `api/_war-structures.ts`, `shinobij.client/src/screens/VillageWarMap.tsx`, `shinobij.client/src/screens/VillageWarScreen.tsx` | Sector contest using PvP battle result | Yes | Yes | No | Combat contest resolves from authoritative finished `pvp:<battleId>`; sector control changes under locks | Medium |
| Village guard challenge | `api/village-guard/challenge.ts`, `api/village-guard/list.ts`, `api/village-guard/queue.ts`, `api/player/challenge.ts` | Guard PvP challenge routing | Yes | Yes | No | Creates/queues normal PvP challenge or AI fallback; actual PvP uses server PvP session | Medium |
| Player attack/challenge | `api/player/attack.ts`, `api/player/challenge.ts`, `shinobij.client/src/lib/duel-challenge.ts`, `shinobij.client/src/lib/arena-challenge.ts` | PvP challenge/routing | Yes | Yes | No | Routes players into PvP sessions; combat itself is PvP engine | Medium |
| Ranked PvP | `api/pvp/ranked-queue.ts`, `api/ranked-season.ts`, `api/_ranked-match-token.ts`, `api/cron/_ranked-season.ts` | Matchmaking/reward/rating wrappers | Yes | Yes | No | Uses PvP session/move engine; rating settlement is server-side | High |
| Legacy/player stats | `api/legacy/*`, `api/_legacy-pvp.ts`, `api/_legacy-core.ts` | Legacy stat/evaluation tracking | Combat-adjacent | No direct combat parity | No | Reads or reports combat outcomes; does not resolve main combat | Low |
| Pet battles | `api/pet/*`, `api/pet-ladder/*`, `api/_pet-sim/*`, `shinobij.client/src/lib/pet-*`, `shinobij.client/src/screens/PetArena.tsx`, `shinobij.client/src/components/PetColiseum.tsx` | Pet battle/autobattler | No | No | Yes | Separate pet combat engines, excluded by request | Excluded |
| Card battles | `api/card-clash/*`, `api/clan/war/_card-clash-engine.ts`, `shinobij.client/src/lib/card-clash*`, `shinobij.client/src/screens/CardClashDuel.tsx`, `shinobij.client/src/screens/CardClashFreePlay.tsx`, `shinobij.client/src/screens/SectorWarCardBattle.tsx` | Card combat | No | No | Yes | Separate card engine, excluded by request | Excluded |

## 2. PvP Truth Source Summary

| Rule area | Truth source | Notes |
| --- | --- | --- |
| Fighter/session sealing | `api/pvp/session.ts` | `hydrateCharacterFromSave`, `sanitizeJutsuList`, `sanitizePvpItems`, `sealItemCharges`, rank/stat clamps, armor passives, bloodline/creator jutsu loadout |
| Turn structure | `api/pvp/move.ts` | 100 AP turn budget, 5 actions, max 25 rounds, active player switching, status/cooldown ticks at turn start |
| AP/action costs | `api/pvp/move.ts`, `api/_combat-resources.ts` | Basic attack, move, heal, clear, cleanse, flee, jutsu AP, v2 chakra/stamina costs and poison-on-spend |
| Movement/range/targeting | `api/pvp/move.ts`, `api/pvp/_aoe.ts` | Hex grid distance, range checks, ground target validation, push/pull movement |
| Jutsu resolution | `api/pvp/move.ts` | `applyJutsu` is the shared 5-phase hit/status/damage/post-damage resolver |
| Bloodline/created jutsu | `api/pvp/session.ts`, `api/pvp/move.ts` | Session sealing resolves saved bloodlines and creator jutsu into combat-safe jutsu lists |
| Weapons/throwables | `api/pvp/move.ts`, `api/pvp/session.ts` | Equipped item lookup, weapon AP/range/EP/tags/effects, thrown charge spend, weapon cooldown default 5 |
| Consumables | `api/pvp/move.ts`, `api/pvp/session.ts` | Item charge spend, potion restore, support item jutsu synthesis, combat-item cooldowns |
| Armor/stats | `api/pvp/session.ts`, `api/pvp/_multipliers.ts`, `api/pvp/move.ts` | Equipment-derived passives, item damage/absorb/reflect/lifesteal/shield, rank stat caps, DR formula |
| Buffs/debuffs/statuses | `api/pvp/move.ts`, `api/pvp/_tags.ts` | Canonical tags, status replacement/stacking, active-round checks, cleanse/clear gates |
| Damage/defense | `api/pvp/move.ts` | `resolveBaseDamage`, rank-capped offense/defense, weather/terrain, armor DR, amplify/debuff pools |
| Healing/shields | `api/pvp/move.ts` | Heal and shield flat ceilings, mastery scaling, heal amplification |
| Post-damage effects | `api/pvp/move.ts` | Shield block, reflect, absorb, armor reflect/absorb/lifesteal, wound, recoil, lifesteal, siphon |
| DoT/round effects | `api/pvp/move.ts` | `applyDoTs`, `tickStatuses`, `applyGroundEffectToFighter`, `tickGroundEffects` |
| Cleanup/rewards | `api/pvp/claim-rewards.ts`, `api/pvp/_vanguard-rewards.ts`, `api/pvp/_reward-farm.ts` | Finished session verification, replay windows, idempotent reward/rating settlement, persistent item deduction |

## 3. Clan Boss Functionality Audit

### Flow Map

- Page/API load: `shinobij.client/src/screens/ClanBoss.tsx` calls `fetchClanBoss()` in `shinobij.client/src/lib/clan-boss-api.ts`, which calls `GET /api/clan-boss/get`.
- Spawn/reset: `api/cron/_clan-boss-weekly.ts` creates `clan-boss:week:<weekId>` and settles ended weeks when `ENABLE_CLAN_BOSS === '1'`.
- Start fight: `POST /api/clan-boss/assault-start` validates clan membership, reserves host attempt under the clan progress lock, seals fighters with `sealTowerFighter`, creates a `cboss-` tower session, caps the boss HP to the clan pool chunk, writes a side record with `saveAssault`.
- Fight: `BattleTowerFight` submits actions to `api/towers/action.ts`; the tower engine resolves player-side jutsu/weapons/items via PvP helpers.
- Settle: `POST /api/clan-boss/assault-settle` reads the finished tower session, extracts boss damage with `_assault.ts`, locks clan progress, banks the result once, and marks the side record settled.
- Rewards: `api/cron/_clan-boss-weekly.ts` ranks clans at week end and credits treasury rewards with once-only receipts.

### Checklist

| Check | Status | Evidence |
| --- | --- | --- |
| Clan Boss page loads | Needs Manual Testing | Code path exists in `ClanBoss.tsx`; API returns 404 if `ENABLE_CLAN_BOSS` is not enabled |
| Boss can be spawned | Needs Manual Testing | Cron `ensureCurrentWeek` creates week state; not live-tested in this pass |
| Player can enter combat | Needs Manual Testing | `assault-start` creates `cboss-` tower session and client mounts `BattleTowerFight`; focused tests cover lower-level logic, not browser flow |
| Boss has valid HP/state | Partially verified | `assault-start` replaces boss HP with `min(progress.pool, CB_ASSAULT_HP_CAP)` and stores `phaseState.bossId`; manual start needed |
| Player damage applies | Partially verified | Tower engine tests verify damage and boss mechanics; Clan Boss damage extraction uses `boss.maxHp - boss.hp` |
| Jutsu/bloodline/created jutsu work | Partially verified | Tower sealing delegates to PvP hydrator and engine calls PvP `applyJutsu`; no live Clan Boss fixture for all jutsu classes yet |
| Weapons/armor apply | Partially verified | Tower sealing uses PvP hydrator; this pass fixed weapon effect fallback and cooldowns in tower engine |
| Consumables/throwables work | Verified for settled runs | Tower engine spends sealed per-fight charges, records `itemsUsed`, enforces cooldowns, and deducts at Tower/Clan Boss settlement |
| AP/cooldowns respected | Verified by tests for patched paths | `api/towers/_engine.test.ts` covers jutsu cooldowns plus new weapon/item cooldown tests |
| Boss turns/phases working | Existing tests | `api/towers/_engine.test.ts` covers bulwark, regen, summon, enrage |
| Clan contribution saved | Partially verified | `assault-settle` banks server-derived damage under lock; needs live API/browser pass |
| Rewards duplicated? | Partially verified | Side record `settled` and weekly treasury receipts are idempotent; full live retry test still needed |
| Multiple members/cross-clan abuse | Partially verified | Start filters party by clan roster and settle requires caller in party; needs live multi-member test |
| Expired/completed cleanup | Needs Manual Testing | Assault side record TTL and tower session TTL exist; expired route behavior needs live confirmation |

### Clan Boss Issues

#### Fixed: Weekly Boss Definition Desync

- Severity: High
- What was broken: `get.ts` and `assault-start.ts` recomputed the boss with `clanBossPickId(weekId)` instead of honoring the stored `week.bossId`.
- Expected behavior: A spawned week should use the exact boss stored in the week state.
- Actual behavior: Valid stored boss data from cron/admin/legacy migration could be ignored, causing UI/start/floor mismatches.
- Files involved: `api/clan-boss/get.ts`, `api/clan-boss/assault-start.ts`, `api/clan-boss/_storage.ts`
- Likely cause: Endpoints duplicated the deterministic pick logic instead of using the persisted weekly state.
- Fix shipped: Added `resolveClanBossDef(week)` and used it in read/start endpoints, with fallback for malformed legacy weeks.
- Confidence: High. Unit test added.

#### Fixed: Tower/Clan Boss Weapon Cooldown Bypass

- Severity: High
- What was broken: Battle Towers weapon actions, used by Clan Boss, did not enforce equipped weapon/throwable cooldowns the way PvP does.
- Expected behavior: Hand weapons and throwables honor `weaponCooldown`, defaulting missing weapon cooldowns to 5 rounds.
- Actual behavior: A tower/Clan Boss player could use the same weapon action repeatedly as long as AP/actions allowed.
- Files involved: `api/towers/_engine.ts`
- Likely cause: The tower weapon branch implemented EP/range/charge spend but skipped the PvP cooldown gate.
- Fix shipped: Added PvP-style cooldown keying and arming for weapon actions.
- Confidence: High. Unit test added.

#### Fixed: Tower/Clan Boss Combat-Item Cooldown Bypass

- Severity: Medium/High
- What was broken: Battle Towers consumable actions spent charges but ignored combat item `weaponCooldown` values.
- Expected behavior: Attack Pill, Defense Pill, Smoke Bomb, and custom combat items with cooldowns cannot be spammed.
- Actual behavior: Items could be reused until charge/AP exhaustion.
- Files involved: `api/towers/_engine.ts`
- Likely cause: The tower item branch predated the PvP combat item cooldown enforcement.
- Fix shipped: Added pre-spend cooldown gate and post-use cooldown arming for item actions.
- Confidence: High. Unit test added.

#### Fixed: Tower Weapon Effect Fallback

- Severity: Medium
- What was broken: Tower weapon synthesis only forwarded `weaponTags`, while PvP also synthesizes a tag from `weaponEffect`/`weaponEffectValue` when needed.
- Expected behavior: Named/custom weapons with `weaponEffect` should apply that effect in tower/Clan Boss combat.
- Actual behavior: A weapon with only `weaponEffect` could strike for EP but lose the rider effect.
- Files involved: `api/towers/_engine.ts`
- Likely cause: Tower subset type/branch did not mirror the PvP weapon tag fallback.
- Fix shipped: Tower weapon synthesis now appends the `weaponEffect` tag when it is not already present.
- Confidence: Medium/High. Covered indirectly by shared resolver; a dedicated effect assertion would be useful.

#### Fixed: Persistent Item Deduction For Settled Towers/Clan Boss

- Severity: High for economy parity, Medium for immediate combat outcome
- What was broken: Tower/Clan Boss fights spent sealed per-fight charges in the session, but persistent inventory deduction was not wired to PvP's `itemsUsed` settlement model.
- Expected behavior: A throwable/consumable used in a player combat mode should be removed from inventory exactly once when the fight is settled or otherwise cleaned up.
- Actual behavior after this pass: Tower actors now record `itemsUsed`; `/api/towers/settle` and `/api/clan-boss/assault-settle` deduct those items from `itemStacks` first, then legacy `inventory[]`, behind a per-run/player receipt.
- Follow-up fix: the normal story Tower client now auto-calls `/api/towers/settle` on any completed run, so wipes finalize spent items while the server still refuses clear rewards unless `winner === "squad"`.
- Files involved: `api/towers/_engine.ts`, `api/towers/_tower-session.ts`, `api/towers/_tower-store.ts`, `api/towers/settle.ts`, `api/clan-boss/assault-settle.ts`, `api/pvp/claim-rewards.ts`, `shinobij.client/src/screens/BattleTowers.tsx`, `shinobij.client/src/screens/BattleTowerFight.tsx`
- Confidence: High. Unit test added.

#### Fixed: Smoke Bomb/Both-Target Consumable Tags In Towers

- Severity: Medium
- What was broken: Tower item actions are self-use actions, so `Decrease Damage Given` support items could lose their enemy-side debuff in the N-actor engine.
- Expected behavior: Smoke Bomb should weaken the user and hostile side, spend one charge, and arm its cooldown.
- Actual behavior after this pass: Tower item handling applies Smoke Bomb-style `weaponEffectTarget: "both"` debuffs to the user and living hostiles, while respecting Debuff Prevent on hostiles.
- Files involved: `api/towers/_engine.ts`
- Confidence: High. Unit test added.

#### Remaining: Live Clan Boss End-To-End Not Verified

- Severity: Medium
- What is broken: Not a proven code bug in this pass, but live readiness is unverified.
- Expected behavior: With `ENABLE_CLAN_BOSS=1`, page loads, week exists, start succeeds, fight completes, settle banks damage, standings update, and weekly rewards are once-only.
- Actual behavior: Code inspection supports the path; browser/API live flow was not run here.
- Files involved: `api/clan-boss/*`, `api/towers/*`, `shinobij.client/src/screens/ClanBoss.tsx`
- Suggested fix: Run the manual checklist below against a local or staging environment with a seeded clan and `ENABLE_CLAN_BOSS=1`.
- Confidence: High that manual testing is still needed.

## 4. Parity Gaps

| System | File path | Difference from PvP | Player impact | Suggested fix | Severity | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| Client Arena/PvE | `shinobij.client/src/screens/Arena.tsx` | Large client-side resolver duplicates PvP/tower action math instead of using server PvP/tower rules | AI, mission, story, weekly boss, and some event fights can drift from PvP | Move these modes onto the server tower engine or extract a shared combat reducer used by both server PvP and PvE. Start with one mode and keep compatibility gates | High | High |
| Weekly world boss | `api/weekly-boss.ts`, `shinobij.client/src/screens/WeeklyBossArena.tsx` | Server trusts capped client-reported fight damage from a client Arena fight | Damage contribution can differ from PvP/tower truth and needs anti-replay/manual cap review | Launch weekly boss as a tower/Clan Boss style server session and bank server-derived boss damage | High | High |
| Mission combat claims | `api/missions/queue-combat-claim.ts`, `api/missions/claim-mission.ts`, `shinobij.client/src/screens/Missions.tsx` | Server queues/claims reward, but AI fight win remains client-resolved | Combat outcome/reward gate is weaker than PvP/tower | Route built-in combat missions through server tower encounters or a shared server combat session token | High | High |
| Tower consumable enemy-target items beyond Smoke Bomb | `api/towers/_engine.ts` | Smoke Bomb/both-target DDG is handled; future targeted enemy consumables still need an N-actor target contract | Future items with opponent-only semantics may need explicit target selection/all-hostile design | Extend the item action schema if new enemy-target consumables are added | Low | Medium |
| Tower comment/docs drift | `api/towers/_engine.ts`, `api/towers/_sim.ts` | Some older comments describe tag/status layers as deferred even though `_engine.ts` now reuses PvP `applyJutsu` for many layers | Developer confusion, not direct gameplay | Refresh comments in a documentation-only pass | Low | High |
| Sector war combat | `api/village/sector-war.ts` | Uses PvP battle result, but sector-specific control damage is separate from combat damage | Allowed mode-specific territory outcome; combat itself is PvP | Keep as is, but add integration tests proving resolve only accepts finished authoritative PvP sessions | Medium | Medium |
| Village guard AI fallback | `api/village-guard/challenge.ts` | Missing guard save falls back to AI instead of PvP fighter | Fallback combat may not match PvP player-side rules | Prefer server tower/PvP-style AI fighter or document as fallback-only | Medium | Medium |
| Hollow Gate fights | `api/hollow-gate/*`, `shinobij.client/src/lib/hollow-gate-*`, `shinobij.client/src/screens/Dungeon.tsx` | Dungeon state is server-tokenized, but fights appear to route through client Arena | Potential PvP/PvE drift | Route combat encounters through tower engine with sealed run tokens | Medium | Medium |
| Client affordability/targeting mirrors | `shinobij.client/src/screens/PvpBattleScreen.tsx`, `shinobij.client/src/screens/BattleTowerFight.tsx`, `shinobij.client/src/lib/combat-affordability.ts` | Client mirrors rules for UI enablement | UI can drift from server, but server is authoritative where API-backed | Keep client mirrors display-only and add tests whenever server rules change | Medium | High |

## 5. Excluded Systems

These were discovered but intentionally excluded per the request:

- Pet battle/autobattler:
  - `api/pet/*`
  - `api/pet-ladder/*`
  - `api/_pet-sim/*`
  - `shinobij.client/src/lib/pet-*`
  - `shinobij.client/src/screens/PetArena.tsx`
  - `shinobij.client/src/screens/PetLadder.tsx`
  - `shinobij.client/src/components/PetColiseum.tsx`
  - `shinobij.client/src/components/PetGauntlet.tsx`
- Card battle:
  - `api/card-clash/*`
  - `api/clan/war/_card-clash-engine.ts`
  - `shinobij.client/src/lib/card-clash*`
  - `shinobij.client/src/screens/CardClashDuel.tsx`
  - `shinobij.client/src/screens/CardClashFreePlay.tsx`
  - `shinobij.client/src/screens/SectorWarCardBattle.tsx`
  - `shinobij.client/src/components/CardClashBoard.tsx`

## Manual Test Checklist

### Clan Boss

- Set `ENABLE_CLAN_BOSS=1`.
- Ensure the scheduler or a setup script creates `clan-boss:week:<currentWeek>`.
- Log in as a clan member and open the Clan Boss tab.
- Confirm `/api/clan-boss/get` returns `active: true`, a non-null boss, and the correct stored boss id.
- Start an assault with no allies.
- Start an assault with one or two clanmates.
- Use a normal jutsu, bloodline jutsu, created/custom jutsu, hand weapon, throwable, potion, and combat item.
- Confirm AP, range, cooldowns, charges, statuses, damage, and boss phases behave like PvP/tower expectations.
- Confirm used throwables, potions, and combat items are removed from inventory exactly once after settle.
- Finish by win, wipe, and timeout/round cap if feasible.
- Call settle twice for the same run and confirm damage banks once.
- Confirm clan progress pool decreases by server-read boss damage only.
- Confirm a non-party member and a different-clan member cannot settle or benefit from the run.
- Expire a side record/session and confirm the UI fails safely.
- Advance past week end and confirm treasury rewards are credited once.

### Broader Parity

- Run a normal PvP fight with weapon, throwable, potion, combat item, and custom jutsu.
- Run the same loadout in a Battle Tower fight and compare AP/cooldown/status/damage behavior.
- In a Battle Tower loss, use a throwable/consumable before wiping and confirm it is removed from inventory exactly once with no floor reward paid.
- Run the same loadout in Clan Boss and compare the player-side behavior to Battle Towers.
- Run client Arena AI/story/mission fights and record any difference from PvP/tower; these remain the largest parity gap.

## Validation Notes

Validation run during this pass:

- `npx tsx --test api/towers/_engine.test.ts api/towers/_tower-store.test.ts` - passed, 71 tests.
- `npx tsx --test scripts/pvp-tags-parity.test.mjs api/pvp/_tags.test.ts api/pvp/_combat-tags.test.ts` - passed, 40 tests.
- `npm test` - passed, 2266 tests.
- `npm run lint` inside `shinobij.client/` - passed.
- `npm run build` - passed, including server compile, client type-check/bundle, and `verify:dist`.
