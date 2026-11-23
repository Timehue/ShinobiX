import coastQuestBadges from "../../../shared/coast-quest-badges.json";

/** Keys used by quest journal presentation. A reward appears only when the server names it. */
/**
 * A quest's painting. The server names it (`art` and `backdrop` on a quest
 * line, from QUEST_PAINTINGS in api/quests/_views.ts), so no table of quests
 * is held here.
 */
export function coastStoryArt(art: string | undefined) {
    return art ? "/scenes/story/coast-" + art + "-v1.webp" : undefined;
}
const badgeRegions: Record<string, string> = {
    "saltstair": "Saltstair Landing",
    "brackwater": "Brackwater Fields",
    "briarwood": "Briarwood Deep",
    "whitecrown": "Whitecrown Passes",
    "hushcrown": "Hushcrown Heights"
};
const rewards: Record<string, { image: string; name: string }> = {
    "gear-mantle": { image: "/items/coast-mantle-v1.webp", name: "Quiet Crown Mantle" },
    "gear-bracer": { image: "/items/coast-bracer-v1.webp", name: "Ridgewarden Bracer" },
};
export function coastRewardArt(key: string) {
    if (Object.hasOwn(rewards, key)) return rewards[key];
    const achievement = coastQuestBadges.find(badge => badge.id === key);
    if (achievement) return { image: "/badges/" + key + ".webp", name: achievement.name };
    const badge = /^badge-([a-z]+)-tier-([1-4])$/.exec(key);
    if (!badge || !Object.hasOwn(badgeRegions, badge[1])) return undefined;
    return { image: "/badges/coast-" + badge[1] + "-tier-" + badge[2] + "-v1.webp", name: badgeRegions[badge[1]] + " · Tier " + badge[2] };
}
