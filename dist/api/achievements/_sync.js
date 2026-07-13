"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyAchievementSync = applyAchievementSync;
const _catalog_js_1 = require("./_catalog.js");
const strings = (value) => Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
function applyAchievementSync(character, now = Date.now()) {
    const eligible = (0, _catalog_js_1.eligibleAchievementIds)(character);
    const unlocked = strings(character.unlockedAchievements);
    const claimsWereInitialized = Array.isArray(character.claimedAchievementRewards);
    const priorClaims = claimsWereInitialized ? strings(character.claimedAchievementRewards) : [...unlocked];
    // A legacy account with no unlock array is silently backfilled on first sync.
    // Seed those eligible IDs into the claim ledger so launch does not create a
    // retroactive windfall, matching the original client behavior.
    const baselineClaims = !claimsWereInitialized && unlocked.length === 0 ? eligible : priorClaims;
    const claimSet = new Set(baselineClaims);
    const newlyRewarded = claimsWereInitialized ? eligible.filter((id) => !claimSet.has(id)) : [];
    const reward = (0, _catalog_js_1.achievementRewardForIds)(newlyRewarded);
    const nextUnlocked = [...new Set([...unlocked, ...eligible])];
    const earnedTitles = [...new Set([...strings(character.earnedTitles), ...(0, _catalog_js_1.achievementTitlesForIds)(nextUnlocked)])];
    const stamps = character.achievementUnlockedAt && typeof character.achievementUnlockedAt === 'object'
        ? { ...character.achievementUnlockedAt } : {};
    for (const id of eligible)
        if (stamps[id] == null)
            stamps[id] = now;
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
