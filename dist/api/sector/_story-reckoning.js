"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORY_RECKONINGS = exports.STORY_RECKONING_DAILY_CAP = void 0;
exports.isStoryReckoningId = isStoryReckoningId;
exports.parseStoryReckoningSeal = parseStoryReckoningSeal;
exports.storyReckoningRyo = storyReckoningRyo;
exports.storyReckoningTaskComplete = storyReckoningTaskComplete;
exports.storyReckoningEligible = storyReckoningEligible;
exports.ownedItemCount = ownedItemCount;
exports.STORY_RECKONING_DAILY_CAP = 3;
exports.STORY_RECKONINGS = {
    "story-reckoning-vanta-ninth": {
        id: "story-reckoning-vanta-ninth",
        village: "Stormveil Village",
        levelReq: 58,
        ownProgress: 5,
        completionTrait: "svr-vanta-ninth-closed",
        metric: "totalAiKills",
        target: 1,
        dropItemId: "event-kesa-storm-seal",
        weight: 6,
        fateShards: 1,
        title: "Storm-Witness",
    },
    "story-reckoning-mira-marker": {
        id: "story-reckoning-mira-marker",
        village: "Stormveil Village",
        levelReq: 25,
        ownProgress: 3,
        completionTrait: "svr-mira-marker-set",
        metric: "totalTilesExplored",
        target: 12,
        dropItemId: "event-kesa-marker",
        weight: 4,
        fateShards: 0,
        title: "Ridge-Walker",
    },
};
const clampLevel = (n) => Math.max(1, Math.min(100, Math.floor(Number(n) || 0) || 1));
function isStoryReckoningId(id) {
    return Object.prototype.hasOwnProperty.call(exports.STORY_RECKONINGS, id);
}
function parseStoryReckoningSeal(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const value = raw;
    const id = typeof value.id === 'string' ? value.id : '';
    const stage = value.stage === 'task' || value.stage === 'return' ? value.stage : null;
    const baseline = Number(value.baseline);
    const at = Number(value.at ?? 0);
    if (!isStoryReckoningId(id) || !stage || !Number.isFinite(baseline) || !Number.isSafeInteger(at) || at < 0)
        return null;
    return { id, stage, baseline, at };
}
function storyReckoningRyo(level, weight) {
    return Math.round(weight * (40 + clampLevel(level) * 5));
}
function storyReckoningTaskComplete(baseline, current, target) {
    return (Number(current) || 0) - (Number(baseline) || 0) >= Math.max(1, target);
}
function storyReckoningEligible(char, def) {
    const traits = Array.isArray(char.storyTraits) ? char.storyTraits.map(String) : [];
    if (traits.includes(def.completionTrait))
        return false;
    if ((Number(char.level) || 0) < def.levelReq)
        return false;
    if (char.storyVillage !== def.village)
        return false;
    return (Number(char.storyProgress) || 0) >= def.ownProgress;
}
function ownedItemCount(char, itemId) {
    let count = 0;
    if (Array.isArray(char.inventory)) {
        for (const entry of char.inventory)
            if (entry === itemId)
                count += 1;
    }
    if (Array.isArray(char.itemStacks)) {
        for (const stack of char.itemStacks) {
            if (stack?.itemId === itemId)
                count += Math.max(0, Math.floor(Number(stack.count) || 0));
        }
    }
    return count;
}
