import {
    CHAKRA_BASE_V2,
    COMBAT_RESOURCES_V2,
    STARTING_STAT_POINTS,
    STAT_KEYS,
    STAMINA_BASE_V2,
    maxChakraForLevel,
    maxHpForLevel,
    maxStaminaForLevel,
} from '../_xp-engine.js';

// Canonical character-creation grant. This mirrors createCharacter() in the
// client, but the server owns the persisted first-save values so registering a
// name can never be followed by a forged high-level/economy/loadout bootstrap.
export const FIRST_SAVE_RYO = 100;
export const FIRST_SAVE_INVENTORY = ['rustfang-kunai', 'shinobi-vest'] as const;

const ZERO_CURRENCIES = [
    'bankRyo', 'honorSeals', 'fateShards', 'boneCharms', 'auraStones',
    'auraDust', 'mythicSeals', 'hollowShards',
] as const;

const ZERO_PROGRESS_COUNTERS = [
    'totalStatsTrained', 'totalMissionsCompleted', 'totalAiKills',
    'totalPvpKills', 'monthlyPvpKills', 'totalVillageRaids',
    'totalTilesExplored', 'totalTournamentsCompleted',
    'totalEndlessTowerWins', 'totalPetWins', 'warsWon', 'warMvpCount',
    'lifetimeWarDamage', 'dailyAiKills', 'dailyPetWins',
    'dailyTilesExplored', 'dailyMissionsCompleted',
    'rankedSeasonsWon', 'battleTowerAscension', 'hunterRank',
] as const;

export function applyCanonicalFirstSave(character: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = { ...character };
    const stats = Object.fromEntries(STAT_KEYS.map((key) => [key, 10]));
    const maxHp = maxHpForLevel(1);
    const maxChakra = COMBAT_RESOURCES_V2 ? CHAKRA_BASE_V2 : maxChakraForLevel(1);
    const maxStamina = COMBAT_RESOURCES_V2 ? STAMINA_BASE_V2 : maxStaminaForLevel(1);

    next.level = 1;
    next.xp = 0;
    next.ryo = FIRST_SAVE_RYO;
    next.stats = stats;
    next.unspentStats = STARTING_STAT_POINTS;
    next.hp = maxHp;
    next.maxHp = maxHp;
    next.chakra = maxChakra;
    next.maxChakra = maxChakra;
    next.stamina = maxStamina;
    next.maxStamina = maxStamina;
    next.rankTitle = 'Academy Student';
    next.inventory = [...FIRST_SAVE_INVENTORY];
    next.itemStacks = [];
    next.pets = [];
    next.tileCards = [];
    next.equipment = {};
    next.activePetId = undefined;
    next.activePetId2v2 = undefined;
    next.professionXp = 0;
    next.professionRank = 1;
    next.examsPassed = [];
    next.auraSphereLevel = 1;
    next.defeatedAiIds = [];
    next.weeklyBossKills = {};
    next.redeemedAuraFeeds = [];
    next.redeemedHunterRanks = [];
    next.element = undefined;
    next.elements = [];
    next.claimedAwakenings = [];
    next.redeemedAwakeningActions = [];
    next.activeDungeonRun = null;
    next.redeemedDungeonRuns = [];
    next.redeemedHollowGateRuns = [];
    next.redeemedPetBattleTokens = [];
    next.redeemedPetExpeditionTokens = [];
    next.claimedServerMissions = [];
    next.redeemedPetGauntletRuns = [];
    delete next.petGauntletRewardDate;
    next.petGauntletRewardCount = 0;
    delete next.petGauntletPremiumDate;
    next.petGauntletFateClaimed = false;
    next.petGauntletBoneClaimed = false;
    next.redeemedWandererQuests = [];
    next.redeemedWandererAmbushes = [];
    delete next.wandererAmbushRewardDate;
    next.wandererAmbushRewardCount = 0;
    next.redeemedQuestbookRuns = [];
    next.villageUpgrades = {};

    for (const key of ZERO_CURRENCIES) next[key] = 0;
    for (const key of ZERO_PROGRESS_COUNTERS) next[key] = 0;

    // A profession is selected later through /api/profession/choose. Accepting
    // it on the first generic save would bypass that server-authoritative gate.
    delete next.profession;
    delete next.masterySpec;
    delete next.elderFocus;
    delete next.customTitle;
    delete next.customTitleStyle;
    delete next.customTitleIcon;

    return next;
}
