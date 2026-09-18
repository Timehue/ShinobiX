import type { Character } from '../types/character';

/** Only recommendation-relevant state, never the per-second vitals/render clock.
 * This is an invalidation key; no client fact is submitted as eligibility. */
export function activitySourceKey(character: Character, trainingState = ''): string {
    const c = character as unknown as Record<string, unknown>;
    return JSON.stringify([
        character.name.trim().toLowerCase(), trainingState,
        ...['level', 'village', 'storyVillage', 'storyProgress', 'onboardingStep', 'hospitalized', 'hospitalizedUntil', 'statPoints', 'unspentStats',
            'examsPassed', 'clan', 'lastLoginRewardDate', 'jutsuMastery', 'equippedJutsuIds',
            'battleTowerBestFloor', 'battleTowerClearedFloors', 'battleTowerAscension', 'endlessTowerBestWave',
            'hollowGateRun', 'endlessTowerRun', 'activePetId', 'activePetId2v2', 'carriedPetIds', 'petBreeding', 'patreon',
            'cardClashDeck', 'tileCards', 'starterCardsClaimed', 'legacy', 'profession', 'professionXp', 'professionRank',
            'masterySpec', 'inventory', 'itemStacks', 'ryo', 'dailyBattleDate', 'dailyBattleFloors', 'rankedWins',
            'cardClashWins'].map(key => c[key]),
        character.pets?.map(p => [p.id, p.level, p.training, p.expedition]),
    ]);
}
