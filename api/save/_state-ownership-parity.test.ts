import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    PUBLIC_CHAR_FIELDS,
    PUBLIC_TOPLEVEL_FIELDS,
    PUBLIC_COMBAT_TOPLEVEL_FIELDS,
    SHARED_ADMIN_CONTENT_FIELDS,
    COMBAT_STRIP_CHAR_FIELDS,
    COMBAT_STRIP_TOPLEVEL_FIELDS,
    STRICT_SERVER_LEDGER_CHARACTER_FIELDS,
    ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS,
    SERVER_PAYOUT_CHARACTER_FIELDS,
    SERVER_LEDGER_TOPLEVEL_FIELDS,
    SERVER_OWNED_CLAN_POINT_FIELDS,
    CURRENCY_CAPS,
    LIFETIME_COUNTERS,
    SERVER_MIRRORED_CHARACTER_FIELDS,
    PROGRESSION_ENTITLEMENT_CHARACTER_FIELDS,
    SERVER_ARRAY_LEDGER_CHARACTER_FIELDS,
    BOOLEAN_LATCH_CHARACTER_FIELDS,
    DAILY_CLAIM_DATE_FIELDS,
    MONOTONIC_DATE_CHARACTER_FIELDS,
    FORBIDDEN_CREATOR_CHARACTER_FIELDS,
    PET_IDENTITY_FIELDS,
} from './_state-ownership.js';

/*
 * P0-1 extraction parity: the manifest-derived lists must reproduce the exact
 * membership of the literal lists that lived in api/save/[name].ts on main
 * @ de50b3385 (frozen below, verbatim). If a list is meant to change after
 * P0-1, change the manifest AND this frozen copy in the same commit — the
 * diff is the review artifact.
 *
 * Ordering: only PUBLIC_CHAR_FIELDS order is behavior (public-DTO response
 * key order) and is compared exactly. Every other boundary feeds Sets,
 * delete-loops, or stored-copy loops whose output lands in Postgres jsonb —
 * membership is the contract, so those compare as sorted sets.
 */

const FROZEN = {
    PUBLIC_CHAR_FIELDS: [
        'name', 'level', 'village', 'rank', 'avatarImage', 'specialty', 'storyProgress',
        'hp', 'maxHp', 'chakra', 'maxChakra', 'stamina', 'maxStamina',
        'customTitle', 'hospitalized', 'hospitalizedUntil',
        'profession', 'professionRank', 'professionXp',
    ],
    PUBLIC_TOPLEVEL_FIELDS: [] as string[],
    PUBLIC_COMBAT_TOPLEVEL_FIELDS: ['savedBloodlines', 'creatorJutsus', 'creatorItems'],
    SHARED_ADMIN_CONTENT_FIELDS: [
        'creatorJutsus', 'creatorItems', 'creatorAis', 'creatorEvents',
        'creatorMissions', 'creatorRaids', 'creatorCards',
        'editablePets', 'petEncounterVn', 'ancientChestVn', 'hollowGateEventConfig',
    ],
    COMBAT_STRIP_CHAR_FIELDS: [
        'inventory', 'itemStacks', 'tileCards', 'savedTileDeck',
        'missions', 'missionLog', 'completedMissions', 'activeMissions', 'questLog', 'bankLog',
        'storyTraits', 'storyTitle',
        'weeklyBossKills', 'claimedWarCrateIds',
        'unlockedAchievements', 'achievementUnlockedAt',
        'battleHistory',
        'hollowGateRun', 'hollowGateWardenKills', 'hollowGateIntroSeen', 'hollowGateAttunement', 'lastHollowGateStart',
        'endlessTowerRun', 'endlessTowerBestWave',
        'battleTowerBestFloor', 'battleTowerRating', 'battleTowerClearedFloors',
        'battleTowerClaimedRewards', 'battleTowerAssistRewardsClaimed', 'battleTowerMilestones',
        'totalStatsTrained', 'totalMissionsCompleted', 'totalAiKills', 'totalVillageRaids',
        'totalTilesExplored', 'totalTournamentsCompleted', 'totalEndlessTowerWins', 'totalPetWins',
        // Relic-survey quest bookkeeping — non-combat, so stripped from the
        // sealed fighter snapshot like every other progress counter.
        'relicSurvey', 'relicSurveyCount',
        'totalPvpKills', 'monthlyPvpKills', 'pvpKillMonth',
        'dailyAiKills', 'dailyPetWins', 'dailyTilesExplored', 'dailyMissionsCompleted',
        'dailyFateSpins', 'lastDailyReset',
        'claimedVillageAgendaDate', 'claimedMapControlDate', 'warGroundBountyDate',
        'defeatedAiIds', 'elderFocus', 'examsPassed',
        'lastBankInterestAt', 'bankRyo',
        'villageWarMissionDate', 'villageWarRaidProgress', 'villageWarMissionsCompleted',
        'clanBattleContrib', 'clanEventContrib', 'clanMissionContrib', 'clanContribMonth',
        'clanPoints', 'weeklyClanPoints', 'weeklyClanPointsWeek', 'lifetimeClanPoints',
        'clanPointHistory', 'clanExchangePurchases',
        'dailyHonorSealsEarned', 'dailyHonorSealsByTarget', 'vanguardDailyResetDate',
        'lastExpeditionClaimDate', 'expeditionsClaimedToday',
        'expeditionStartAllowance', 'expeditionStartReceipts',
        'dailyDonatedSeals', 'dailyDonationDate', 'miraaWagerDate', 'miraaWagerCount',
        'petEscortBonusReady', 'hunterRank',
        'petBreeding', 'petBreedingMigrationVersion', 'petBreedingReceipts',
        'petBreedingHatchReceipts', 'petBreedingProgressReceipts',
        'ryo', 'honorSeals', 'fateShards', 'boneCharms', 'auraStones', 'mythicSeals', 'auraDust', 'hollowShards',
        'rankedWins', 'rankedLosses', 'rankedSeasonSettlementReceipts', 'pvpRewardSettlementReceipts',
        'petRankedSettlementStamp', 'playerRankedSettlementStamp', 'vanguardRewardSettlementStamp', 'warDeclarationFundingReceipts', 'warMercenaryHireReceipts',
        'aiFightRewardSettlements', 'combatMissionClaimSettlements',
        'worldAiChainWins', 'worldAiChainHeals', 'worldAiContextWins', 'worldAiPendingChain', 'worldAiPendingOutcome', 'serverHuntTrails', 'serverFieldMissionRuns', 'raidProgressionSettlements', 'serverFreeDungeonProbeReceipts',
        'createdAt', 'professionChosenAt', 'professionRespecUsed',
    ],
    COMBAT_STRIP_TOPLEVEL_FIELDS: [
        'currentBiome', 'activeTraining', 'activeJutsuTraining',
        'acceptedMissionIds', 'missionProgress',
        'triggeredEvents', 'pendingAiProfileId', 'currentSector',
        'creatorAis', 'creatorEvents', 'creatorMissions', 'creatorRaids', 'creatorCards',
        'petEncounterVn', 'ancientChestVn', 'editablePets',
    ],
    STRICT_SERVER_LEDGER_CHARACTER_FIELDS: [
        'level', 'xp', 'experience', 'ryo', 'bankRyo',
        'honorSeals', 'fateShards', 'boneCharms', 'auraStones', 'auraDust',
        'mythicSeals', 'hollowShards',
        'stats', 'unspentStats', 'totalStatsTrained', 'maxHp', 'maxChakra', 'maxStamina',
        'rankTitle', 'professionXp', 'professionRank', 'auraSphereLevel',
        'professionRespecUsed',
        'hollowGateAttunement', 'rankedRating', 'petRankedRating',
        'rankedSeasonSettlementReceipts', 'pvpRewardSettlementReceipts', 'petRankedSettlementStamp', 'playerRankedSettlementStamp', 'vanguardRewardSettlementStamp', 'warDeclarationFundingReceipts', 'warMercenaryHireReceipts',
        'warGroundBountyDate', 'villageWarMissionDate', 'villageWarRaidProgress',
        'miraaWagerDate', 'miraaWagerCount',
        'petBreeding', 'petBreedingMigrationVersion', 'petBreedingReceipts',
        'petBreedingHatchReceipts', 'petBreedingProgressReceipts',
        'expeditionStartAllowance', 'expeditionStartReceipts',
        'aiFightRewardSettlements', 'combatMissionClaimSettlements',
        'worldAiChainWins', 'worldAiChainHeals', 'worldAiContextWins', 'worldAiPendingChain', 'worldAiPendingOutcome', 'serverHuntTrails', 'serverFieldMissionRuns', 'raidProgressionSettlements', 'serverFreeDungeonProbeReceipts',
    ],
    ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS: [
        'bankRyo', 'rankedRating', 'petRankedRating', 'rankedSeasonSettlementReceipts',
        'professionXp', 'professionRank', 'serverSettlementReceipts', 'pvpRewardSettlementReceipts',
        'warGroundBountyDate', 'villageWarMissionDate', 'villageWarRaidProgress',
        'petRankedSettlementStamp', 'playerRankedSettlementStamp', 'vanguardRewardSettlementStamp', 'warDeclarationFundingReceipts', 'warMercenaryHireReceipts',
        'professionRespecUsed',
        'patreon', 'weaponElements',
        'miraaWagerDate', 'miraaWagerCount',
        'petBreeding', 'petBreedingMigrationVersion', 'petBreedingReceipts',
        'petBreedingHatchReceipts', 'petBreedingProgressReceipts',
        'expeditionStartAllowance',
        'aiFightRewardSettlements', 'combatMissionClaimSettlements',
        'worldAiChainWins', 'worldAiChainHeals', 'worldAiContextWins', 'worldAiPendingChain', 'worldAiPendingOutcome', 'serverHuntTrails', 'serverFieldMissionRuns', 'raidProgressionSettlements', 'serverFreeDungeonProbeReceipts',
    ],
    SERVER_PAYOUT_CHARACTER_FIELDS: [
        'lastBankInterestAt', 'lastLoginRewardDate', 'loginStreak',
        'academyChecklistClaimed', 'academyTrialClaimed',
        'cardClashDailyWinDate', 'claimedWarCrateIds',
        'claimedVillageAgendaDate', 'claimedMapControlDate', 'warGroundBountyDate',
        'lastExpeditionClaimDate', 'expeditionsClaimedToday', 'petEscortBonusReady',
        'dailyHonorSealsEarned', 'dailyHonorSealsByTarget', 'vanguardDailyResetDate',
        'dailyDonatedSeals', 'dailyDonationDate', 'pendingCombatMissionClaims',
        'battleTowerClaimedRewards', 'battleTowerAssistRewardsClaimed', 'battleTowerMilestones',
        'dailyBattleFloors', 'dailyBattleDate', 'lastTaxDate',
    ],
    SERVER_LEDGER_TOPLEVEL_FIELDS: [
        '_trainingReceipts', 'activeTraining',
        'activeWandererQuestSeal', 'activeStoryReckoningSeal',
        'activeRiftQuestSeal', 'activeQuestbookSeal',
        'creatorJutsus', 'creatorAis', 'creatorMissions', 'creatorEvents',
        'creatorCards', 'creatorRaids',
    ],
    SERVER_OWNED_CLAN_POINT_FIELDS: [
        'clanPoints', 'weeklyClanPoints', 'weeklyClanPointsWeek',
        'lifetimeClanPoints', 'clanPointHistory', 'clanExchangePurchases',
    ],
    CURRENCY_CAP_FIELDS: [
        'fateShards', 'boneCharms', 'auraStones', 'auraDust',
        'mythicSeals', 'honorSeals', 'hollowShards',
    ],
    LIFETIME_COUNTER_FIELDS: [
        'totalPvpKills', 'totalAiKills', 'totalVillageRaids', 'warsWon', 'warMvpCount',
        'lifetimeWarDamage', 'monthlyPvpKills', 'dailyAiKills', 'totalPetWins',
        'totalEndlessTowerWins', 'battleTowerBestFloor', 'battleTowerRating',
        'totalTournamentsCompleted', 'totalTilesExplored', 'hollowGateWardenKills',
        'rankedWins', 'rankedLosses', 'villageWarMissionsCompleted',
        'totalStatsTrained', 'totalMissionsCompleted',
        'cardClashWins', 'cardClashLosses', 'cardClashDraws',
    ],
    // The four copy-if-defined groups that were separate inline loops
    // (exploration trio, chest trio, achievements quad, endless seven) — now
    // one uniform mirror loop; semantics per group were identical.
    SERVER_MIRRORED_CHARACTER_FIELDS: [
        'serverExploreDate', 'serverExploresToday', 'serverFreeDungeonProbeDate', 'serverFreeDungeonProbesToday', 'redeemedSectorExplorations',
        'serverChestDate', 'serverChestsToday', 'redeemedAncientChests',
        // Relic survey: world/explore appends the biome, quest accept resets it.
        // Mirrored so a client cannot write its own objective progress.
        'relicSurvey', 'relicSurveyCount',
        'unlockedAchievements', 'achievementUnlockedAt', 'claimedAchievementRewards', 'earnedTitles',
        'endlessTowerRun', 'endlessTowerBestWave', 'totalEndlessTowerWins',
        'dailyTowerXp', 'dailyEndlessRuns', 'dailyEndlessDate', 'redeemedEndlessActions',
    ],
    PROGRESSION_ENTITLEMENT_CHARACTER_FIELDS: [
        'auraSphereLevel', 'redeemedAuraFeeds', 'battleTowerAscension', 'rankedSeasonsWon',
        'weeklyBossKills', 'defeatedAiIds', 'hunterRank', 'redeemedHunterRanks',
        'apexWeekClaimed', 'element', 'elements', 'claimedAwakenings',
        'redeemedAwakeningActions', 'elderFocus', 'activeDungeonRun', 'redeemedDungeonRuns',
        'redeemedHollowGateRuns', 'redeemedPetBattleTokens', 'redeemedPetExpeditionTokens',
        'claimedServerMissions', 'redeemedPetGauntletRuns', 'petGauntletRewardDate',
        'petGauntletRewardCount', 'petGauntletPremiumDate', 'petGauntletFateClaimed',
        'petGauntletBoneClaimed', 'petGauntletEntryDate', 'petGauntletEntryCount',
        'redeemedWandererQuests', 'redeemedWandererAmbushes',
        'wandererAmbushRewardDate', 'wandererAmbushRewardCount', 'redeemedQuestbookRuns',
        'storyReckoningRewardDate', 'storyReckoningRewardCount', 'redeemedStoryReckonings',
        // `villageUpgrades` LEFT this list on 2026-08-17 (owner ruling): village
        // upgrades became SHARED village infrastructure bought from the treasury
        // seal pool, so the character field is now a cross-validated mirror of
        // game:village-state:<slug>.upgrades rather than a per-character
        // entitlement frozen to stored. Freezing it here would have blocked the
        // mirror from ever refreshing. See api/village/_upgrade.ts.
    ],
    // The individual copy-if-array statements, unified into one loop.
    // redeemedCardClashAiSessions added in P0-2 (AI-match payout receipts) —
    // a deliberate, reviewed extension of the frozen P0-1 membership.
    SERVER_ARRAY_LEDGER_CHARACTER_FIELDS: [
        'redeemedTrainingTokens', 'redeemedJutsuTrainingActions', 'redeemedAiFightRewards',
        'redeemedShopPurchases', 'redeemedShopSales', 'redeemedCrafts', 'redeemedNamedForges',
        'redeemedStoryBattles', 'redeemedPetEncounters', 'claimedCreatorEvents',
        'claimedWarCrateIds', 'redeemedCardClashAiSessions',
        'redeemedPetRankedMatchTokens', 'chroniclePetWitnesses', 'chroniclePetArenaProgressReceipts',
        'expeditionStartReceipts',
    ],
    BOOLEAN_LATCH_CHARACTER_FIELDS: ['academySparClaimed', 'starterPetClaimed', 'starterCardsClaimed'],
    DAILY_CLAIM_DATE_FIELDS: ['claimedVillageAgendaDate', 'claimedMapControlDate'],
    MONOTONIC_DATE_CHARACTER_FIELDS: ['lastDailyReset', 'lastHuntReset'],
    FORBIDDEN_CREATOR_CHARACTER_FIELDS: [
        'creatorJutsus', 'creatorItems', 'creatorAis', 'creatorMissions',
        'creatorEvents', 'creatorCards', 'creatorRaids',
    ],
    PET_IDENTITY_FIELDS: [
        'id', 'rarity', 'maxLevel', 'jutsus', 'unlockedForPve', 'trait', 'element',
        'evolutionStage', 'wildSpawnable', 'role', 'subRole', 'updatedAt',
        'level', 'xp', 'hp', 'attack', 'defense', 'speed', 'happiness',
        'training', 'expedition', 'nickname', 'loadout',
        'templateId', 'origin', 'breedingUsesMax', 'breedingUsesRemaining',
        'paletteVariantId', 'generation', 'parentInstanceIds', 'parentTemplateIds',
        'hatchedAt', 'breedable', 'chronicleArenaWins', 'breedingSessionId',
    ],
};

const asSortedSet = (values: Iterable<string>) => [...new Set(values)].sort();

function assertSetParity(name: string, derived: Iterable<string>, frozen: readonly string[]) {
    assert.deepEqual(
        asSortedSet(derived),
        asSortedSet(frozen),
        `${name} membership diverged from the pre-manifest literal`,
    );
}

describe('state-ownership manifest parity with pre-extraction literals', () => {
    it('preserves PUBLIC_CHAR_FIELDS exactly, including order (response key order)', () => {
        assert.deepEqual([...PUBLIC_CHAR_FIELDS], FROZEN.PUBLIC_CHAR_FIELDS);
    });

    it('preserves membership of every other boundary list', () => {
        assertSetParity('PUBLIC_TOPLEVEL_FIELDS', PUBLIC_TOPLEVEL_FIELDS, FROZEN.PUBLIC_TOPLEVEL_FIELDS);
        assertSetParity('PUBLIC_COMBAT_TOPLEVEL_FIELDS', PUBLIC_COMBAT_TOPLEVEL_FIELDS, FROZEN.PUBLIC_COMBAT_TOPLEVEL_FIELDS);
        assertSetParity('SHARED_ADMIN_CONTENT_FIELDS', SHARED_ADMIN_CONTENT_FIELDS, FROZEN.SHARED_ADMIN_CONTENT_FIELDS);
        assertSetParity('COMBAT_STRIP_CHAR_FIELDS', COMBAT_STRIP_CHAR_FIELDS, FROZEN.COMBAT_STRIP_CHAR_FIELDS);
        assertSetParity('COMBAT_STRIP_TOPLEVEL_FIELDS', COMBAT_STRIP_TOPLEVEL_FIELDS, FROZEN.COMBAT_STRIP_TOPLEVEL_FIELDS);
        assertSetParity('STRICT_SERVER_LEDGER_CHARACTER_FIELDS', STRICT_SERVER_LEDGER_CHARACTER_FIELDS, FROZEN.STRICT_SERVER_LEDGER_CHARACTER_FIELDS);
        assertSetParity('ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS', ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS, FROZEN.ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS);
        assertSetParity('SERVER_PAYOUT_CHARACTER_FIELDS', SERVER_PAYOUT_CHARACTER_FIELDS, FROZEN.SERVER_PAYOUT_CHARACTER_FIELDS);
        assertSetParity('SERVER_LEDGER_TOPLEVEL_FIELDS', SERVER_LEDGER_TOPLEVEL_FIELDS, FROZEN.SERVER_LEDGER_TOPLEVEL_FIELDS);
        assertSetParity('SERVER_OWNED_CLAN_POINT_FIELDS', SERVER_OWNED_CLAN_POINT_FIELDS, FROZEN.SERVER_OWNED_CLAN_POINT_FIELDS);
        assertSetParity('CURRENCY_CAPS', Object.keys(CURRENCY_CAPS), FROZEN.CURRENCY_CAP_FIELDS);
        assertSetParity('LIFETIME_COUNTERS', Object.keys(LIFETIME_COUNTERS), FROZEN.LIFETIME_COUNTER_FIELDS);
        assertSetParity('SERVER_MIRRORED_CHARACTER_FIELDS', SERVER_MIRRORED_CHARACTER_FIELDS, FROZEN.SERVER_MIRRORED_CHARACTER_FIELDS);
        assertSetParity('PROGRESSION_ENTITLEMENT_CHARACTER_FIELDS', PROGRESSION_ENTITLEMENT_CHARACTER_FIELDS, FROZEN.PROGRESSION_ENTITLEMENT_CHARACTER_FIELDS);
        assertSetParity('SERVER_ARRAY_LEDGER_CHARACTER_FIELDS', SERVER_ARRAY_LEDGER_CHARACTER_FIELDS, FROZEN.SERVER_ARRAY_LEDGER_CHARACTER_FIELDS);
        assertSetParity('BOOLEAN_LATCH_CHARACTER_FIELDS', BOOLEAN_LATCH_CHARACTER_FIELDS, FROZEN.BOOLEAN_LATCH_CHARACTER_FIELDS);
        assertSetParity('DAILY_CLAIM_DATE_FIELDS', DAILY_CLAIM_DATE_FIELDS, FROZEN.DAILY_CLAIM_DATE_FIELDS);
        assertSetParity('MONOTONIC_DATE_CHARACTER_FIELDS', MONOTONIC_DATE_CHARACTER_FIELDS, FROZEN.MONOTONIC_DATE_CHARACTER_FIELDS);
        assertSetParity('FORBIDDEN_CREATOR_CHARACTER_FIELDS', FORBIDDEN_CREATOR_CHARACTER_FIELDS, FROZEN.FORBIDDEN_CREATOR_CHARACTER_FIELDS);
        assertSetParity('PET_IDENTITY_FIELDS', PET_IDENTITY_FIELDS, FROZEN.PET_IDENTITY_FIELDS);
    });

    it('keeps every cap record at zero (gains only via domain endpoints)', () => {
        assert.ok(Object.values(CURRENCY_CAPS).every((v) => v === 0), 'currency gain caps are all 0');
        assert.ok(Object.values(LIFETIME_COUNTERS).every((v) => v === 0), 'lifetime counter deltas are all 0');
    });
});
