import { ACHIEVEMENT_RULES, eligibleAchievementIds } from './_catalog.js';

const publicIds = new Set(ACHIEVEMENT_RULES.map(rule => rule.id));

/** Public recognition only: no counters, claim ledgers, balances or unknown fields. */
export function publicAchievementRecord(character: Record<string, unknown>) {
    const ledger = Array.isArray(character.unlockedAchievements) ? character.unlockedAchievements : [];
    const unlockedAchievements = [...new Set([
        ...ledger.filter((id): id is string => typeof id === 'string' && publicIds.has(id)),
        ...eligibleAchievementIds(character),
    ])];
    const stamps = character.achievementUnlockedAt;
    const achievementUnlockedAt: Record<string, number> = {};
    if (stamps && typeof stamps === 'object' && !Array.isArray(stamps)) {
        for (const id of unlockedAchievements) {
            const at = (stamps as Record<string, unknown>)[id];
            if (typeof at === 'number' && Number.isFinite(at) && at > 0) achievementUnlockedAt[id] = at;
        }
    }
    return { unlockedAchievements, achievementUnlockedAt };
}
