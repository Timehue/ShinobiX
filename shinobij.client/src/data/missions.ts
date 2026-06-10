/*
 * Built-in hunt/fetch mission catalogs + the merge/raid-progress helpers that
 * overlay creator-defined missions on top of them. Extracted verbatim from
 * App.tsx.
 */
import type { CreatorMission } from "../types/missions";

export const builtinHuntMissions: CreatorMission[] = [
    { id: "hunt-wild-boar", name: "Hunt the Wild Boar", rank: "D Rank", description: "A large wild boar has been spotted trampling the forest undergrowth near Sector 25. Track it down and eliminate it.", type: "fetchExplore", targetSector: 25, exploreCount: 3, levelReq: 1, xpReward: 80, ryoReward: 60, staminaReward: 8, aiProfileId: "hunt-ai-wild-boar", itemRewards: ["hunt-beast-meat", "hunt-beast-meat", "hunt-torn-hide"] },
    { id: "hunt-forest-hawk", name: "Hunt the Forest Hawk", rank: "D Rank", description: "A predatory hawk has been attacking travelers through Sector 28. Scout the area and bring it down.", type: "fetchExplore", targetSector: 28, exploreCount: 3, levelReq: 1, xpReward: 80, ryoReward: 60, staminaReward: 8, aiProfileId: "hunt-ai-forest-hawk", itemRewards: ["hunt-beast-meat", "hunt-wild-feather", "hunt-small-fang"] },
    { id: "hunt-frost-wolf", name: "Hunt the Frost Wolf", rank: "C Rank", description: "A Frost Wolf pack has been raiding supply routes through Sector 50. The alpha must be hunted and driven off.", type: "fetchExplore", targetSector: 50, exploreCount: 4, levelReq: 15, xpReward: 200, ryoReward: 160, staminaReward: 12, aiProfileId: "hunt-ai-frost-wolf", itemRewards: ["hunt-wolf-fang", "hunt-wolf-fang", "hunt-frost-pelt"] },
    { id: "hunt-ash-lizard", name: "Hunt the Ash Lizard", rank: "C Rank", description: "An Ash Lizard has made its nest near the volcanic vents in Sector 40, blocking access to the trade paths.", type: "fetchExplore", targetSector: 40, exploreCount: 4, levelReq: 15, xpReward: 200, ryoReward: 160, staminaReward: 12, aiProfileId: "hunt-ai-ash-lizard", itemRewards: ["hunt-ash-scale", "hunt-ash-scale", "hunt-cracked-horn"] },
    { id: "hunt-shadow-panther", name: "Hunt the Shadow Panther", rank: "B Rank", description: "A Shadow Panther stalks the darkness of Sector 12. It ambushes shinobi under cover of night — approach carefully.", type: "fetchExplore", targetSector: 12, exploreCount: 4, levelReq: 30, xpReward: 420, ryoReward: 340, staminaReward: 20, currencyRewards: { boneCharms: 1 }, aiProfileId: "hunt-ai-shadow-panther", itemRewards: ["hunt-shadow-pelt", "hunt-shadow-claw", "hunt-shadow-claw"] },
    { id: "hunt-ironback-bear", name: "Hunt the Ironback Bear", rank: "B Rank", description: "An Ironback Bear with near-impenetrable hide has claimed the deep forest of Sector 30. It must be driven out.", type: "fetchExplore", targetSector: 30, exploreCount: 5, levelReq: 30, xpReward: 420, ryoReward: 340, staminaReward: 20, currencyRewards: { boneCharms: 1 }, aiProfileId: "hunt-ai-ironback-bear", itemRewards: ["hunt-beast-meat", "hunt-beast-meat", "hunt-cracked-horn", "hunt-cracked-horn"] },
    { id: "hunt-ember-drake", name: "Hunt the Ember Drake", rank: "A Rank", description: "An Ember Drake — a fire-breathing lesser dragon — has emerged from the volcano at Sector 42. Extremely dangerous.", type: "fetchExplore", targetSector: 42, exploreCount: 5, levelReq: 50, xpReward: 900, ryoReward: 750, staminaReward: 30, currencyRewards: { boneCharms: 2, auraDust: 20 }, aiProfileId: "hunt-ai-ember-drake", itemRewards: ["hunt-ash-scale", "hunt-ash-scale", "hunt-ember-scale", "hunt-wolf-fang"] },
    { id: "hunt-moon-serpent", name: "Hunt the Moon Serpent", rank: "A Rank", description: "The Moon Serpent is a colossal genjutsu-wielding serpent that hunts in the shadow sectors. It can trap minds in illusions.", type: "fetchExplore", targetSector: 8, exploreCount: 5, levelReq: 50, xpReward: 900, ryoReward: 750, staminaReward: 30, currencyRewards: { boneCharms: 2, auraDust: 20 }, aiProfileId: "hunt-ai-moon-serpent", itemRewards: ["hunt-shadow-pelt", "hunt-shadow-pelt", "hunt-shadow-claw", "hunt-shadow-claw"] },
    { id: "hunt-ancient-chakra-beast", name: "Hunt the Ancient Chakra Beast", rank: "S Rank", description: "An Ancient Chakra Beast stirs in the central wilderness of Sector 60. It has absorbed centuries of chakra and can use all five elements. Only the strongest hunters survive.", type: "fetchExplore", targetSector: 60, exploreCount: 6, levelReq: 70, xpReward: 2000, ryoReward: 1800, staminaReward: 40, currencyRewards: { boneCharms: 3, auraDust: 40, fateShards: 1 }, aiProfileId: "hunt-ai-ancient-chakra-beast", itemRewards: ["hunt-legendary-material", "hunt-legendary-material", "hunt-ancient-beast-core"] },
    { id: "hunt-worldstorm-dragon", name: "Hunt the Worldstorm Dragon", rank: "S Rank", description: "The Worldstorm Dragon — a living storm given form — has been sighted over Sector 59. Its scales shed lightning, and its roar shakes the ground. This is the apex of all hunts.", type: "fetchExplore", targetSector: 59, exploreCount: 6, levelReq: 70, xpReward: 2000, ryoReward: 1800, staminaReward: 40, currencyRewards: { boneCharms: 3, auraDust: 40, fateShards: 1 }, aiProfileId: "hunt-ai-worldstorm-dragon", itemRewards: ["hunt-legendary-material", "hunt-legendary-material", "hunt-titan-bone"] },
];

const builtinFetchMissions: CreatorMission[] = [
    { id: "fetch-d-supply-trail", name: "D Rank Supply Trail Sweep", rank: "D Rank", description: "Scout a random low-risk sector, mark safe tile routes, then raid the nearby village outpost once to recover missing supplies.", type: "fetchExplore", targetSector: 18, exploreCount: 3, raidCount: 1, levelReq: 1, xpReward: 90, ryoReward: 75, staminaReward: 8 },
    { id: "fetch-c-border-scout", name: "C Rank Border Scout Run", rank: "C Rank", description: "Explore the assigned border sector several times to map patrol movement, then raid the village guard post twice for field reports.", type: "fetchExplore", targetSector: 32, exploreCount: 5, raidCount: 2, levelReq: 15, xpReward: 240, ryoReward: 190, staminaReward: 14 },
    { id: "fetch-b-enemy-cache", name: "B Rank Enemy Cache Search", rank: "B Rank", description: "Search a contested sector for hidden supply caches, then raid the village defenses to break their courier route.", type: "fetchExplore", targetSector: 47, exploreCount: 7, raidCount: 3, levelReq: 30, xpReward: 520, ryoReward: 420, staminaReward: 22, currencyRewards: { boneCharms: 1 } },
    { id: "fetch-a-black-route", name: "A Rank Black Route Operation", rank: "A Rank", description: "Sweep a dangerous sector for black-route intel, then raid the enemy village enough times to expose their command chain.", type: "fetchExplore", targetSector: 58, exploreCount: 9, raidCount: 4, levelReq: 50, xpReward: 1100, ryoReward: 900, staminaReward: 32, currencyRewards: { boneCharms: 2, auraDust: 20 } },
    { id: "fetch-s-shadow-front", name: "S Rank Shadow Front Incursion", rank: "S Rank", description: "Penetrate a high-threat sector, complete a deep tile sweep, and raid the village front repeatedly before returning with the sealed orders.", type: "fetchExplore", targetSector: 65, exploreCount: 12, raidCount: 5, levelReq: 70, xpReward: 2400, ryoReward: 2100, staminaReward: 45, currencyRewards: { boneCharms: 3, auraDust: 45, fateShards: 1 } },
];

export function missionRaidProgressKey(missionId: string) {
    return `${missionId}:raids`;
}

export function missionRaidRequirement(mission: CreatorMission) {
    return Math.max(0, Number(mission.raidCount ?? 0));
}

export function mergeBuiltinMissions(customMissions: CreatorMission[]) {
    const customById = new Map(customMissions.map((mission) => [mission.id, mission]));
    return [
        ...builtinFetchMissions.map((mission) => customById.get(mission.id) ?? mission),
        ...customMissions.filter((mission) => !builtinFetchMissions.some((builtin) => builtin.id === mission.id)),
    ];
}

export function allProgressMissions(customMissions: CreatorMission[]) {
    const customById = new Map(customMissions.map((mission) => [mission.id, mission]));
    return [
        ...builtinFetchMissions.map((mission) => customById.get(mission.id) ?? mission),
        ...builtinHuntMissions.map((mission) => customById.get(mission.id) ?? mission),
        ...customMissions.filter((mission) =>
            !builtinFetchMissions.some((builtin) => builtin.id === mission.id) &&
            !builtinHuntMissions.some((builtin) => builtin.id === mission.id)
        ),
    ];
}
