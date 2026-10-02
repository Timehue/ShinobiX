# Legacy counter sources — audited 2026-10-02

Actual baseline producers for every qualification/trial counter family. A live producer does not prove every mode or character can earn the counter. Floors/trials are in [path-matrix.md](path-matrix.md); findings/owner actions are in [README.md](README.md).

| Counters | Actual source | Meaning / limitation |
|---|---|---|
| Four specialty `*Kills` | `missions/report-ai-fight.ts:487`; `_legacy-pvp.ts:114` via `missions/report-pvp-win.ts` | Victory attributed to permanent specialty. General rewarded AI within its 50-win legacy cap; combat missions omit style kills. F01/F03. |
| Four specialty `*Damage` | `_legacy-pvp.ts:89` | Parsed PvP damage attributed to permanent specialty, including Wound ticks and loser damage. No PvE writer. F01/F03/F08. |
| `pvpWins`, `pvpKills`, `pvpLosses`, `rankedWins` | `_legacy-pvp.ts:108`, `127`; `missions/report-pvp-win.ts:126` | Authorized real matches with age/shared-IP/device/short-fight gates. Winner gets lifetime-target/gap decay; capped historical headline/ranked bootstrap. F01/F08. |
| `sameRankWins` | `_legacy-pvp.ts:124` | Same level rank band, not rating tier or leadership title. |
| `higherLevelWins` | `_legacy-pvp.ts:123` | Opponent at least five levels higher. Cannot grow at 96+; no bootstrap. F02. |
| `comebackWins` | `_legacy-pvp.ts:106` | Finish a victory at ≤15% HP; does not establish recovery from a deficit. F08. |
| `bestKillStreak` | `_legacy-track.ts:391`; win/reset options in `report-pvp-win.ts` | Maximum credited rolling streak. Fully decayed winner does not extend it. |
| `defensiveWins`, `sectorDefenses` | `_legacy-pvp.ts:45` queue marker; `pvp/_sector-war-continuation.ts:93` | Queued guard wins or sector-war defender victories. Guard queue opens outside wars but still needs opposing players. F01/F06/F08. |
| `warPvpKills` | `_legacy-pvp.ts:59`; `pvp/_sector-war-continuation.ts:93` | Attacker defeats a queued guard, or sector-war PvP winner. Not every player raid supplies it. |
| `pveKills` | `missions/claim-mission.ts:448`; `missions/report-ai-fight.ts:487`; capped bootstrap | Combat missions and rewarded general AI inside its legacy cap. Not every story/tower/boss enemy. |
| `eliteKills` | `hollow-gate/settle.ts:268`; `sector/wanderer-ambush.ts:144`; `weekly-boss.ts:679` | Two per Gate clear, one per ambush gauntlet, five per weekly-boss top-10 credit. No universal elite-enemy extractor. |
| `missionCompletions` | `missions/claim-mission.ts` progress spec and combat-run settlement | Eligible server-claimed missions; academy checklist excluded. Capped historical bootstrap. |
| `huntCompletions` | Hunt claim spec in `missions/claim-mission.ts` | Claimed hunts, not each target/encounter. |
| `raidsCompleted` | `missions/_raid-progression.ts:280`; `village/anbu-infiltration.ts:45` | Verified raid/infiltration completion plus capped bootstrap. General PvP extraction is separate. F01. |
| `warContribution` | Raid progression; sector-war continuation; treasury economy legacy intent; infiltration | Mode-defined contribution units, not exclusively damage. Historical `lifetimeWarDamage` bootstrap cap 80,000. |
| `bossContribution` | `weekly-boss.ts:679`; `story/settle.ts:193` | Weekly-boss damage plus one per witnessed story first-clear. No clan-boss damage producer; client label explicitly says weekly-boss damage. |
| `weeklyBossTop10` | `weekly-boss.ts:682` | Distributed weekly-boss top-10 result, not clan-boss placement. |
| `eventCompletions` | `weekly-boss.ts:681` | Credited completed weekly-boss participation. Other festivals/events do not automatically count. Cadence tests assume one per week. |
| `firstClears` | `story/settle.ts:193`; `weekly-boss.ts:683` | Personal story first-clear or weekly-boss MVP, not exclusively server-first. Story receipts are durable. |
| `hollowGateClears` | `hollow-gate/settle.ts:268` | Verified Gate completion; capped historical warden-kill bootstrap. |
| `dungeonClears` | `hollow-gate/settle.ts:268` | One per Gate; separate actual dungeon settlement omits it. F05. |
| `endlessTowerBest` | `_legacy-track.ts:249`, `529`, from `endlessTowerBestWave` | Older Endless Tower wave, legacy cap 45. Server-owned current record; not Endless Spire tier or Celestial floor. Qualification only. |
| `arenaTournaments` | `_legacy-track.ts:248`, `530`, from `totalTournamentsCompleted` | Historical/daily save mirror cap 12; not every pet ladder/showdown win. Qualification only. |
| `tilesExplored` | `_legacy-track.ts:247`, `526`, from `totalTilesExplored`; `world/_explore.ts:143` | Current total has server exploration authority; legacy remains bootstrap/daily reconcile, cap 2,500. Same-day new tiles can lag until another reconcile. Qualification only. |
| `sectorDiscoveries` | `sector/wanderer-gift.ts:141`; `sector/wanderer-service.ts:277` | Settled wanderer encounters, not unique map sectors. Natural IDs rotate each six-hour bucket (`shared/wanderer-roster.ts:411`); floors above the geographical sector count are not inherently impossible. |
| `hiddenFinds` | `sector/wanderer-ambush.ts:144` | Settled ambush gauntlets, not every chest/hidden dungeon/unusual tile. |
| `wandererQuests` | `sector/wanderer-quest.ts:205` | Server-claimed wanderer quests, including supported emissary quests. |
| `villageDonations` | `village/treasury/donate.ts:180`; `_legacy-economy-outbox.ts:77` | Actual ryo in committed treasury transactions; retained delivery outbox retries on login. |
| `villageTenureDays` | `player/daily-login.ts:114`; `_legacy-track.ts:258` | Receipted UTC login days plus first-touch level-50 villager floor 10. Lifetime participation, not elapsed calendar tenure exclusive to one village. |
| `warsWon` | `village/claim-war-crate.ts:179`; capped bootstrap | Verified victory-crate claim, not automatically every unclaimed war win. |
| `sectorCaptures` | `_sector-war-settle.ts:144`, `captureContributors` | Eligible contributors to victorious contest instances; not every village member. Re-sieges have distinct receipts. |
| `healingDone`, `shieldsApplied`, `damageBlocked` | `_legacy-pvp.ts:89` via `report-pvp-win.ts` | Parsed PvP Heal tags, successful Shield grants and absorption. Omits Basic Heal/Siphon/Lifesteal/PvE; direct Heal can credit overheal. F01/F04/F08. |
| `petDuelWins` | `pet/battle-result.ts`; `pet/showdown.ts`; capped bootstrap/reconcile | Supported verified pet wins; historical save mirror cap 120. Particular modes need their own verified source. |
| `petExpeditions` | `missions/report-pet-event.ts:34` | Token-backed completed expeditions, daily cap and stable receipt. Repeatable fresh-trial source. |
| `cardClashWins` | `card-clash/ai-move.ts`; `card-clash/_freeplay-legacy.ts`; capped mirror | Supported Chronicle victories. Historical mirror cap 100; live producers allow higher floors. Later card trials can force player PvP. F06. |

Unused/future counters `cleansesUsed`, `biomesVisited`, `genjutsuControlUses`, `warMissions` and `warMvps` are not requirements or generated trial objectives in this roster. Presence in the type does not create an acquisition dependency.
