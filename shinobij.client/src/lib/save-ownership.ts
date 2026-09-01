/*
 * Client mirror of the save state-ownership manifest.
 *
 * The authority is api/save/_state-ownership.ts. This file lists only what the
 * conflict-recovery UI needs: the fields a GENERIC player save cannot durably
 * change, because the sanitizer copies the stored value back over whatever the
 * client sent. Membership is pinned to the server manifest by
 * scripts/save-ownership-parity.test.ts — add a field there and that test tells
 * you to add it here.
 *
 * WHY the conflict UI needs this: a "device draft" is only worth protecting if
 * restoring it could change anything. When a save diverges purely in
 * server-owned fields (level, rank, currencies, counters, payout stamps), the
 * server is correcting the client, not losing the player's progress — and a
 * restore of those fields is guaranteed to be discarded by the sanitizer. Before
 * this list existed the client protected those divergences anyway, so the
 * recovery banner reappeared every autosave with a draft nothing could restore.
 *
 * Mirrored categories (see OwnershipCategory in the manifest):
 *   server-ledger, server-owned, server-payout-stamp, derived, deprecated,
 *   forbidden, shared-admin-content
 * Deliberately NOT mirrored — these stay restorable because a generic save may
 * still write them, even if bounded:
 *   server-clamped, client-state, client-preference, cosmetic-ref,
 *   personal-authored
 */

/** Character-scope fields a generic save cannot durably change. */
export const SERVER_OWNED_CHARACTER_FIELDS: ReadonlySet<string> = new Set([
    // Identity & public profile
    'level', 'village', 'rank', 'specialty', 'storyProgress', 'maxHp', 'maxChakra', 'maxStamina',
    'customTitle', 'profession', 'professionRank', 'professionXp', 'professionRespecUsed',
    // Wallet & currencies
    'bankRyo', 'lastBankInterestAt', 'honorSeals', 'fateShards', 'boneCharms',
    'auraStones', 'auraDust', 'mythicSeals', 'hollowShards',
    // Stats & progression ledger
    'xp', 'experience', 'stats', 'unspentStats', 'totalStatsTrained', 'rankTitle',
    'auraSphereLevel', 'hollowGateAttunement', 'rankedRating', 'petRankedRating',
    'rankedSeasonSettlementReceipts', 'serverSettlementReceipts', 'pvpRewardSettlementReceipts', 'petRankedSettlementStamp',
    'playerRankedSettlementStamp', 'vanguardRewardSettlementStamp', 'patreon',
    'weaponElements', 'petBreeding', 'petBreedingMigrationVersion', 'petBreedingReceipts',
    'petBreedingHatchReceipts', 'petBreedingProgressReceipts', 'miraaWagerDate',
    'miraaWagerCount', 'levelLedgerMigrated', 'createdAt',
    // Claim stamps & payout latches
    'lastLoginRewardDate', 'loginStreak', 'academyChecklistClaimed', 'academyTrialClaimed',
    'cardClashDailyWinDate', 'claimedWarCrateIds', 'claimedVillageAgendaDate',
    'claimedMapControlDate', 'warGroundBountyDate', 'villageWarMissionDate',
    // Exact-once Honor Seal intents and debit receipts co-written by the
    // village-war declaration funding and mercenary sagas
    // (api/_war-declaration-funding.ts, api/_war-mercenary-hire.ts).
    // Server-owned payout stamps.
    'warDeclarationFundingReceipts', 'warMercenaryHireReceipts',
    'villageWarRaidProgress', 'lastExpeditionClaimDate', 'expeditionsClaimedToday',
    'expeditionStartAllowance', 'expeditionStartReceipts', 'petExpeditionLog', 'petEscortBonusReady',
    'dailyHonorSealsEarned', 'dailyHonorSealsByTarget', 'vanguardDailyResetDate',
    'dailyDonatedSeals', 'dailyDonationDate', 'pendingCombatMissionClaims',
    'battleTowerClaimedRewards', 'battleTowerAssistRewardsClaimed', 'battleTowerMilestones',
    'dailyBattleFloors', 'dailyBattleDate', 'lastTaxDate',
    // Server-mirrored redemption ledgers & counters
    'serverExploreDate', 'serverExploresToday', 'redeemedSectorExplorations',
    // Relic-survey quest progress: world/explore appends the biome walked and
    // quest accept resets it, so a local draft must never be restored over the
    // server's copy — that would silently rewind (or forge) the objective.
    'relicSurvey', 'relicSurveyCount',
    'serverFreeDungeonProbeDate', 'serverFreeDungeonProbesToday', 'serverFreeDungeonProbeReceipts',
    'serverChestDate', 'serverChestsToday', 'redeemedAncientChests', 'unlockedAchievements',
    'achievementUnlockedAt', 'claimedAchievementRewards', 'earnedTitles', 'endlessTowerRun',
    'endlessTowerBestWave', 'totalEndlessTowerWins', 'dailyTowerXp', 'dailyEndlessRuns',
    'dailyEndlessDate', 'redeemedEndlessActions',
    // Village Stores daily cook/donate counters (api/village-stores/*).
    'rationsCookedDate', 'rationsCookedToday', 'storesDonatedDate', 'rationsDonatedToday',
    'craftPointsDonatedToday',
    // Server array ledgers
    'redeemedTrainingTokens', 'redeemedJutsuTrainingActions', 'redeemedAiFightRewards',
    'aiFightRewardSettlements', 'combatMissionClaimSettlements', 'worldAiChainWins',
    'worldAiChainHeals', 'worldAiContextWins', 'worldAiPendingChain', 'worldAiPendingOutcome',
    'serverHuntTrails', 'serverFieldMissionRuns', 'raidProgressionSettlements',
    'redeemedShopPurchases', 'redeemedShopSales', 'redeemedCrafts', 'redeemedNamedForges',
    'redeemedTebexPurchases',
    'redeemedStoryBattles', 'redeemedPetEncounters', 'claimedCreatorEvents',
    'redeemedCardClashAiSessions', 'redeemedPetRankedMatchTokens', 'chroniclePetWitnesses',
    'chroniclePetArenaProgressReceipts', 'tournamentWinReceipts',
    // One-time boolean latches
    'academySparClaimed', 'starterPetClaimed', 'starterCardsClaimed',
    // Progression entitlements
    'redeemedAuraFeeds', 'battleTowerAscension', 'rankedSeasonsWon', 'weeklyBossKills',
    'defeatedAiIds', 'hunterRank', 'redeemedHunterRanks', 'apexWeekClaimed', 'element',
    'elements', 'claimedAwakenings', 'redeemedAwakeningActions', 'elderFocus',
    'activeDungeonRun', 'redeemedDungeonRuns', 'redeemedHollowGateRuns',
    'redeemedPetBattleTokens', 'redeemedPetExpeditionTokens', 'claimedServerMissions',
    'redeemedPetGauntletRuns', 'petGauntletRewardDate', 'petGauntletRewardCount',
    'petGauntletPremiumDate', 'petGauntletFateClaimed', 'petGauntletBoneClaimed',
    'petGauntletEntryDate', 'petGauntletEntryCount', 'redeemedWandererQuests',
    'redeemedWandererAmbushes', 'wandererAmbushRewardDate', 'wandererAmbushRewardCount',
    'redeemedQuestbookRuns', 'storyReckoningRewardDate', 'storyReckoningRewardCount',
    'redeemedStoryReckonings',
    // `villageUpgrades` left this list on 2026-08-17: it became `server-clamped`
    // (a cross-validated mirror of the shared village record) rather than
    // `server-owned`, and server-clamped fields are deliberately NOT mirrored
    // here — see the category note at the top.
    // Lifetime / leaderboard counters
    'totalPvpKills', 'totalAiKills', 'totalVillageRaids', 'warsWon', 'warMvpCount',
    'lifetimeWarDamage', 'monthlyPvpKills', 'dailyAiKills', 'totalPetWins',
    'battleTowerBestFloor', 'battleTowerRating', 'battleTowerClearedFloors',
    'totalTournamentsCompleted', 'totalTilesExplored', 'hollowGateWardenKills',
    'rankedWins', 'rankedLosses', 'villageWarMissionsCompleted', 'totalMissionsCompleted',
    'cardClashWins', 'cardClashLosses', 'cardClashDraws',
    // Clan
    'clanPoints', 'weeklyClanPoints', 'weeklyClanPointsWeek', 'lifetimeClanPoints',
    'clanPointHistory', 'clanExchangePurchases',
    // Inventory, jutsu, pets, titles, legacy
    'professionChosenAt', 'jutsu', 'jutsuMastery', 'pets', 'tileCards', 'lastHollowGateStart',
    'serverTitles', 'legacy', 'masterySpec', 'examsPassed',
    // Forbidden at character scope (deleted from the character on every save)
    'creatorJutsus', 'creatorItems', 'creatorAis', 'creatorMissions', 'creatorEvents',
    'creatorCards', 'creatorRaids',
]);

/** Top-level fields a generic player save cannot durably change. */
export const SERVER_OWNED_TOPLEVEL_FIELDS: ReadonlySet<string> = new Set([
    '_trainingReceipts', 'activeTraining', 'activeJutsuTraining', 'activeWandererQuestSeal',
    'activeStoryReckoningSeal', 'activeRiftQuestSeal', 'activeQuestbookSeal',
    'creatorJutsus', 'creatorAis', 'creatorMissions', 'creatorEvents', 'creatorCards',
    'creatorRaids', 'editablePets', 'petEncounterVn', 'ancientChestVn',
    'hollowGateEventConfig', 'pendingBloodlineForges', 'worldGeoV', '_saveVersion', '_saveAt',
]);

/**
 * Vitals are `server-clamped` in the manifest — a save MAY write them — but
 * settleSaveRecordForRead re-projects them from `_saveAt` on every single read
 * (VITAL_REGEN_MS = 1s). A device copy of them therefore never survives to be
 * observed, so treating them as recoverable only produces banners the player
 * cannot act on. Classified here rather than in the mirrored sets above because
 * the reason is the read projection, not the ownership category.
 */
export const SERVER_PROJECTED_VITAL_FIELDS: ReadonlySet<string> = new Set(['hp', 'chakra', 'stamina']);

/**
 * True when a difference at this path cannot be restored by a generic save.
 * Paths are shallow: `['currentSector']` or `['character', 'level']` — the
 * granularity detectSaveConflictAreas compares at.
 */
export function isServerOwnedSavePath(path: readonly string[]): boolean {
    if (path.length === 0) return false;
    if (path[0] === 'character') {
        if (path.length < 2) return false;
        const field = path[1];
        return SERVER_OWNED_CHARACTER_FIELDS.has(field) || SERVER_PROJECTED_VITAL_FIELDS.has(field);
    }
    return SERVER_OWNED_TOPLEVEL_FIELDS.has(path[0]);
}

/**
 * Which save fields make up each player-facing conflict area. It lives here, on
 * the lazily-loaded classification chunk, rather than in save-conflict.ts: it is
 * read only when a conflict is being described, and it is ~1.6KB the boot bundle
 * would otherwise carry on every single page load.
 */
export const CONFLICT_AREA_PATHS: ReadonlyArray<{ label: string; paths: ReadonlyArray<readonly string[]> }> = [
    {
        label: "Level, rank & stats",
        paths: [
            ["character", "level"], ["character", "rank"], ["character", "xp"],
            ["character", "stats"], ["character", "unspentStats"],
            ["character", "hp"], ["character", "chakra"], ["character", "stamina"],
        ],
    },
    {
        label: "Story & Legacy",
        paths: [
            ["character", "storyProgress"], ["character", "storyChoices"],
            ["character", "storyTraits"], ["character", "onboardingStep"],
            ["character", "legacy"], ["character", "titles"],
        ],
    },
    {
        label: "Currency & rewards",
        paths: [
            ["character", "ryo"], ["character", "bankRyo"], ["character", "auraDust"],
            ["character", "auraStones"], ["character", "fateShards"],
            ["character", "boneCharms"], ["character", "honorSeals"],
        ],
    },
    {
        label: "Inventory & loadout",
        paths: [
            ["character", "inventory"], ["character", "itemStacks"],
            ["character", "equipment"], ["character", "equippedJutsuIds"],
            ["character", "jutsuMastery"],
        ],
    },
    {
        label: "Companions",
        paths: [
            ["character", "pets"], ["character", "activePetId"],
            ["character", "activePetId2v2"], ["editablePets"],
        ],
    },
    {
        label: "Living Chronicle",
        paths: [
            ["character", "tileCards"], ["character", "cardClashDeck"],
            ["character", "cardClashWins"], ["character", "cardClashLosses"],
            ["character", "cardClashDraws"],
        ],
    },
    {
        label: "Training",
        paths: [["activeTraining"], ["activeJutsuTraining"], ["character", "training"]],
    },
    {
        label: "Missions & events",
        paths: [
            ["acceptedMissionIds"], ["missionProgress"], ["triggeredEvents"],
            ["character", "battleHistory"],
        ],
    },
    {
        label: "Travel & world position",
        paths: [["currentSector"], ["currentBiome"], ["pendingTravel"]],
    },
    {
        label: "Hollow Gate",
        paths: [
            ["character", "hollowGateRun"], ["character", "hollowGateKeys"],
            ["character", "hollowGateUnlocks"],
        ],
    },
    {
        label: "Clan & profession",
        paths: [
            ["character", "clan"], ["character", "profession"],
            ["character", "professionRank"], ["character", "professionXp"],
            ["character", "masterySpec"],
        ],
    },
];
