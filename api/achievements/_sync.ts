import { achievementRewardForIds, achievementTitlesForIds, eligibleAchievementIds } from './_catalog.js';

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
export function applyAchievementSync(character: Record<string, unknown>, now = Date.now()) {
    const eligible = eligibleAchievementIds(character);
    const unlocked = strings(character.unlockedAchievements);
    const claimsWereInitialized = Array.isArray(character.claimedAchievementRewards);
    const priorClaims = claimsWereInitialized ? strings(character.claimedAchievementRewards) : [...unlocked];
    // A legacy account with no unlock array is silently backfilled on first sync.
    // Seed those eligible IDs into the claim ledger so launch does not create a
    // retroactive windfall, matching the original client behavior.
    const baselineClaims = !claimsWereInitialized && unlocked.length === 0 ? eligible : priorClaims;
    const claimSet = new Set(baselineClaims);
    const newlyRewarded = claimsWereInitialized ? eligible.filter((id) => !claimSet.has(id)) : [];
    const reward = achievementRewardForIds(newlyRewarded);
    const nextUnlocked = [...new Set([...unlocked, ...eligible])];
    const earnedTitles = [...new Set([...strings(character.earnedTitles), ...achievementTitlesForIds(nextUnlocked)])];
    const stamps = character.achievementUnlockedAt && typeof character.achievementUnlockedAt === 'object'
        ? { ...character.achievementUnlockedAt as Record<string, unknown> } : {};
    for (const id of eligible) if (stamps[id] == null) stamps[id] = now;
    return {
        character: {
            ...character,
            unlockedAchievements: nextUnlocked,
            achievementUnlockedAt: stamps,
            claimedAchievementRewards: [...new Set([...baselineClaims, ...newlyRewarded])],
            earnedTitles,
            ryo: Math.max(0, Number(character.ryo) || 0) + reward.ryo,
            fateShards: Math.max(0, Number(character.fateShards) || 0) + reward.fateShards,
        },
        eligible,
        newlyUnlocked: eligible.filter((id) => !unlocked.includes(id)),
        newlyRewarded,
        reward,
    };
}
