type Character = Record<string, unknown>;
type Rule = { id: string; hidden?: boolean; check: (character: Character) => boolean };

const n = (character: Character, field: string): number => Math.max(0, Number(character[field]) || 0);
const countItems = (character: Character): number => {
    const inventory = Array.isArray(character.inventory) ? character.inventory.length : 0;
    const stacks = Array.isArray(character.itemStacks)
        ? (character.itemStacks as Array<Record<string, unknown>>).reduce((sum, stack) => sum + Math.max(0, Math.floor(Number(stack?.count) || 0)), 0)
        : 0;
    return inventory + stacks;
};
const rows = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    : [];
const objectValueTotal = (value: unknown): number => value && typeof value === 'object'
    ? Object.values(value as Record<string, unknown>).reduce<number>((sum, entry) => sum + Math.max(0, Math.floor(Number(entry) || 0)), 0)
    : 0;
const jutsuAtLevel = (character: Character, level: number): number => rows(character.jutsuMastery)
    .filter((entry) => Math.max(0, Math.floor(Number(entry.level) || 0)) >= level).length;
const petAtLevel = (character: Character, level: number): boolean => rows(character.pets)
    .some((pet) => Math.max(0, Math.floor(Number(pet.level) || 0)) >= level);
const evolvedPetAtStage = (character: Character, stage: number): boolean => rows(character.pets)
    .some((pet) => Math.max(0, Math.floor(Number(pet.evolutionStage) || 0)) >= stage);
const coreEquipmentCount = (character: Character): number => {
    const equipment = character.equipment && typeof character.equipment === 'object'
        ? character.equipment as Record<string, unknown> : {};
    return ['hand', 'gloves', 'body', 'waist', 'legs', 'feet', 'head', 'thrown']
        .filter((slot) => Boolean(equipment[slot])).length;
};

const numeric: Array<[string, string, number]> = [
    ['level-10', 'level', 10], ['level-40', 'level', 40], ['level-70', 'level', 70], ['level-100', 'level', 100],
    ['pve-first', 'totalAiKills', 1], ['pve-100', 'totalAiKills', 100], ['pve-500', 'totalAiKills', 500], ['pve-2500', 'totalAiKills', 2500],
    ['pvp-first', 'totalPvpKills', 1], ['pvp-50', 'totalPvpKills', 50], ['pvp-250', 'totalPvpKills', 250], ['pvp-1000', 'totalPvpKills', 1000],
    ['ranked-first', 'rankedWins', 1], ['ranked-50', 'rankedWins', 50], ['ranked-1800', 'rankedRating', 1800], ['ranked-2200', 'rankedRating', 2200], ['ranked-season-champ', 'rankedSeasonsWon', 1],
    ['mission-25', 'totalMissionsCompleted', 25], ['mission-250', 'totalMissionsCompleted', 250], ['mission-1000', 'totalMissionsCompleted', 1000],
    ['explore-100', 'totalTilesExplored', 100], ['explore-1000', 'totalTilesExplored', 1000], ['explore-5000', 'totalTilesExplored', 5000],
    ['ryo-25k', 'ryo', 25_000], ['ryo-500k', 'bankRyo', 500_000], ['honor-100', 'honorSeals', 100], ['honor-500', 'honorSeals', 500], ['fate-250', 'fateShards', 250], ['fate-2500', 'fateShards', 2500],
    ['aura-1', 'auraSphereLevel', 1], ['aura-150', 'auraSphereLevel', 150], ['aura-300', 'auraSphereLevel', 300],
    ['raid-25', 'totalVillageRaids', 25], ['raid-250', 'totalVillageRaids', 250], ['tournament-3', 'totalTournamentsCompleted', 3], ['tower-25', 'totalEndlessTowerWins', 25],
    ['spire-5', 'battleTowerAscension', 5], ['spire-10', 'battleTowerAscension', 10], ['spire-15', 'battleTowerAscension', 15], ['spire-20', 'battleTowerAscension', 20], ['pet-100', 'totalPetWins', 100], ['clan-500', 'clanBattleContrib', 500],
    ['training-first', 'totalStatsTrained', 1], ['training-100', 'totalStatsTrained', 100], ['training-1000', 'totalStatsTrained', 1000],
    ['story-chapter-1', 'storyProgress', 1], ['story-chapter-5', 'storyProgress', 5], ['story-chapter-9', 'storyProgress', 9],
    ['questbook-first', 'redeemedQuestbookRuns.length', 1], ['questbook-5', 'redeemedQuestbookRuns.length', 5],
    ['profession-rank-5', 'professionRank', 5], ['profession-rank-10', 'professionRank', 10],
    ['hollow-clear-1', 'redeemedHollowGateRuns.length', 1], ['hollow-clear-10', 'redeemedHollowGateRuns.length', 10], ['hollow-clear-50', 'redeemedHollowGateRuns.length', 50],
    ['hollow-warden-1', 'hollowGateWardenKills', 1], ['hollow-warden-25', 'hollowGateWardenKills', 25],
    ['dungeon-clear-1', 'redeemedDungeonRuns.length', 1], ['dungeon-clear-25', 'redeemedDungeonRuns.length', 25],
    ['endless-wave-10', 'endlessTowerBestWave', 10], ['endless-wave-25', 'endlessTowerBestWave', 25], ['endless-wave-50', 'endlessTowerBestWave', 50],
    ['pet-hatch-1', 'petBreedingHatchReceipts.length', 1], ['pet-hatch-10', 'petBreedingHatchReceipts.length', 10],
    ['pet-win-1', 'totalPetWins', 1], ['pet-win-25', 'totalPetWins', 25], ['pet-ranked-1800', 'petRankedRating', 1800],
    ['chronicle-win-1', 'cardClashWins', 1], ['chronicle-win-25', 'cardClashWins', 25], ['chronicle-win-100', 'cardClashWins', 100], ['chronicle-deck-40', 'cardClashDeck.length', 40],
    ['craft-first', 'redeemedCrafts.length', 1], ['craft-25', 'redeemedCrafts.length', 25], ['named-forge-first', 'redeemedNamedForges.length', 1],
    ['clan-lifetime-1000', 'lifetimeClanPoints', 1000], ['clan-lifetime-10000', 'lifetimeClanPoints', 10000],
    ['war-win-1', 'warsWon', 1], ['war-win-10', 'warsWon', 10], ['war-mvp-1', 'warMvpCount', 1], ['war-mvp-10', 'warMvpCount', 10], ['war-damage-1m', 'lifetimeWarDamage', 1_000_000],
    ['tournament-first', 'totalTournamentsCompleted', 1], ['tournament-10', 'totalTournamentsCompleted', 10], ['ranked-season-3', 'rankedSeasonsWon', 3],
    ['login-streak-7', 'loginStreak', 7], ['login-streak-30', 'loginStreak', 30],
    ['wanderer-first', 'redeemedWandererQuests.length', 1], ['wanderer-25', 'redeemedWandererQuests.length', 25],
    ['achievements-25', 'unlockedAchievements.length', 25], ['achievements-75', 'unlockedAchievements.length', 75], ['achievements-100', 'unlockedAchievements.length', 100], ['achievements-125', 'unlockedAchievements.length', 125],
    ['secret-charms-100', 'boneCharms', 100], ['secret-stones-100', 'auraStones', 100], ['secret-mythic-10', 'mythicSeals', 10], ['secret-loadout-full', 'equippedJutsuIds.length', 15],
    ['secret-monthly-50', 'monthlyPvpKills', 50], ['secret-hunter-5', 'hunterRank', 5], ['secret-bestiary-50', 'defeatedAiIds.length', 50], ['secret-bestiary-200', 'defeatedAiIds.length', 200],
    ['secret-elements-3', 'elements.length', 3], ['secret-menagerie-5', 'pets.length', 5], ['secret-exams-3', 'examsPassed.length', 3], ['secret-war-vet-50', 'villageWarMissionsCompleted', 50],
    ['secret-tile-cards-1000', 'tileCards.length', 1000], ['secret-war-crates-10', 'claimedWarCrateIds.length', 10],
];

const value = (character: Character, field: string): number => field.endsWith('.length')
    ? (Array.isArray(character[field.slice(0, -7)]) ? (character[field.slice(0, -7)] as unknown[]).length : 0)
    : n(character, field);

const HIDDEN_IDS = new Set([
    'secret-untouched', 'secret-charms-100', 'secret-stones-100', 'secret-mythic-10', 'secret-packrat', 'secret-loadout-full',
    'secret-monthly-50', 'secret-hunter-5', 'secret-titled', 'secret-story-titled', 'secret-bestiary-50', 'secret-bestiary-200',
    'secret-elements-3', 'secret-menagerie-5', 'secret-exams-3', 'secret-war-vet-50', 'secret-weekly-bosses-5', 'secret-tile-cards-1000',
    'secret-minmaxer', 'secret-war-crates-10',
]);

export const ACHIEVEMENT_TITLES: Readonly<Record<string, string>> = {
    'level-100': 'Centenarian', 'pve-2500': 'Slayer of Thousands', 'pvp-250': 'Warlord', 'pvp-1000': 'Crimson Sovereign',
    'ranked-1800': 'Tempered Steel', 'ranked-2200': 'Apex Predator', 'ranked-season-champ': 'Season Champion',
    'mission-1000': 'Mission Master', 'explore-5000': 'World Walker', 'ryo-5m': 'Ryo Tycoon', 'honor-500': 'Sealed Legend',
    'fate-2500': 'Fate Weaver', 'aura-300': 'Eternal Aura', 'raid-250': 'Village Scourge', 'tournament-3': 'Arena Champion',
    'tower-25': 'Tower Survivor', 'spire-5': 'Spire Ascendant', 'spire-10': 'Spire Conqueror', 'spire-15': 'Spire Vanquisher',
    'spire-20': 'Spire Immortal', 'pet-100': 'Beast Tamer', 'clan-founder': 'Clan Founder', 'secret-bestiary-200': 'Encyclopedia',
    'secret-elements-3': 'Polyelementalist', 'secret-war-vet-50': 'War Veteran', 'secret-weekly-bosses-5': 'Weekly Reaper',
    'secret-hunter-5': 'Chakra Beast Warden',
    'story-chapter-9': 'Living Chronicle', 'legacy-stage-5': 'Myth Made Flesh', 'profession-rank-10': 'Master of the Calling',
    'hollow-clear-50': 'Gatebound', 'pet-ranked-1800': 'Apex Handler', 'chronicle-win-100': 'Duel Archivist',
    'named-forge-first': 'Named in Steel', 'clan-lifetime-10000': 'Pillar of the Clan', 'war-mvp-10': 'Living Banner',
    'tournament-10': 'Colosseum Legend', 'ranked-season-3': 'Ranked Dynasty', 'achievements-100': 'Shinobi Journey',
    'achievements-125': 'Living Legend',
};

export function achievementTitlesForIds(ids: Iterable<string>): string[] {
    return [...new Set([...ids].map((id) => ACHIEVEMENT_TITLES[id]).filter((title): title is string => Boolean(title)))];
}

export const ACHIEVEMENT_RULES: Rule[] = [
    ...numeric.map(([id, field, threshold]) => ({ id, hidden: HIDDEN_IDS.has(id), check: (character: Character) => value(character, field) >= threshold })),
    { id: 'ryo-5m', check: (c) => n(c, 'ryo') + n(c, 'bankRyo') >= 5_000_000 },
    { id: 'bloodline-equipped', check: (c) => Boolean(c.equippedBloodlineId) },
    { id: 'clan-founder', check: (c) => c.clanFounder === true },
    { id: 'jutsu-mastery-10', check: (c) => jutsuAtLevel(c, 10) >= 1 },
    { id: 'jutsu-mastery-40', check: (c) => jutsuAtLevel(c, 40) >= 1 },
    { id: 'jutsu-versatile-10', check: (c) => jutsuAtLevel(c, 20) >= 10 },
    { id: 'legacy-stage-1', check: (c) => n(c.legacy && typeof c.legacy === 'object' ? c.legacy as Character : {}, 'stage') >= 1 },
    { id: 'legacy-stage-3', check: (c) => n(c.legacy && typeof c.legacy === 'object' ? c.legacy as Character : {}, 'stage') >= 3 },
    { id: 'legacy-stage-5', check: (c) => n(c.legacy && typeof c.legacy === 'object' ? c.legacy as Character : {}, 'stage') >= 5 },
    { id: 'profession-chosen', check: (c) => typeof c.profession === 'string' && c.profession.length > 0 },
    { id: 'profession-mastery-10', check: (c) => objectValueTotal(c.masterySpec) >= 10 },
    { id: 'pet-active', check: (c) => typeof c.activePetId === 'string' && c.activePetId.length > 0 },
    { id: 'pet-pack-tactics', check: (c) => typeof c.activePetId === 'string' && c.activePetId.length > 0 && typeof c.activePetId2v2 === 'string' && c.activePetId2v2.length > 0 && c.activePetId !== c.activePetId2v2 },
    { id: 'pet-level-25', check: (c) => petAtLevel(c, 25) },
    { id: 'pet-level-max', check: (c) => rows(c.pets).some((pet) => n(pet, 'maxLevel') > 0 && n(pet, 'level') >= n(pet, 'maxLevel')) },
    { id: 'pet-evolution-1', check: (c) => evolvedPetAtStage(c, 1) },
    { id: 'pet-evolution-2', check: (c) => evolvedPetAtStage(c, 2) },
    { id: 'chronicle-starter', check: (c) => c.starterCardsClaimed === true },
    { id: 'chronicle-unique-25', check: (c) => new Set(Array.isArray(c.tileCards) ? c.tileCards.filter((entry): entry is string => typeof entry === 'string') : []).size >= 25 },
    { id: 'weapon-attuned', check: (c) => c.weaponElements != null && typeof c.weaponElements === 'object' && Object.keys(c.weaponElements as object).length >= 1 },
    { id: 'equipment-core-8', check: (c) => coreEquipmentCount(c) >= 8 },
    { id: 'clan-joined', check: (c) => typeof c.clan === 'string' && c.clan.length > 0 },
    { id: 'clan-all-fronts', check: (c) => n(c, 'clanBattleContrib') > 0 && n(c, 'clanEventContrib') > 0 && n(c, 'clanMissionContrib') > 0 },
    { id: 'secret-untouched', hidden: true, check: (c) => n(c, 'ryo') >= 1_000_000 && n(c, 'bankRyo') === 0 },
    { id: 'secret-packrat', hidden: true, check: (c) => countItems(c) >= 100 },
    { id: 'secret-titled', hidden: true, check: (c) => Boolean(c.customTitle) },
    { id: 'secret-story-titled', hidden: true, check: (c) => Boolean(c.storyTitle) },
    { id: 'secret-weekly-bosses-5', hidden: true, check: (c) => c.weeklyBossKills != null && typeof c.weeklyBossKills === 'object' && Object.keys(c.weeklyBossKills as object).length >= 5 },
    { id: 'secret-minmaxer', hidden: true, check: (c) => n(c, 'level') >= 50 && n(c, 'unspentStats') === 0 },
];

export function eligibleAchievementIds(character: Character): string[] {
    return ACHIEVEMENT_RULES.filter((rule) => rule.check(character)).map((rule) => rule.id);
}

export function achievementRewardForIds(ids: string[]): { ryo: number; fateShards: number } {
    let ryo = 0; let fateShards = 0;
    for (const id of new Set(ids)) {
        if (!ACHIEVEMENT_RULES.some((rule) => rule.id === id)) continue;
        if (HIDDEN_IDS.has(id)) { ryo += 3000; fateShards += 1; } else ryo += 2000;
    }
    return { ryo, fateShards };
}
