/*
 * Built-in hunt/fetch mission catalogs + the merge/raid-progress helpers that
 * overlay creator-defined missions on top of them. Extracted verbatim from
 * App.tsx.
 */
import type { CreatorMission, MissionRank } from "../types/missions";

const FIELD_MISSION_RANK_ORDER: Record<MissionRank, number> = {
    "D Rank": 0,
    "C Rank": 1,
    "B Rank": 2,
    "A Rank": 3,
    "S Rank": 4,
    Daily: 5,
};

export const builtinHuntMissions: CreatorMission[] = [
    { id: "hunt-wild-boar", name: "Hunt the Wild Boar", rank: "D Rank", description: "Accept the hunt, then travel to Sector 25 and follow the hunt trail to find the Wild Boar. Defeat it and claim your reward at the Hunter's Guild.", type: "fetchExplore", targetSector: 25, exploreCount: 3, levelReq: 1, xpReward: 80, ryoReward: 280, staminaReward: 8, aiProfileId: "hunt-ai-wild-boar", itemRewards: ["hunt-beast-meat", "hunt-beast-meat", "hunt-torn-hide"] },
    { id: "hunt-forest-hawk", name: "Hunt the Forest Hawk", rank: "D Rank", description: "Accept the hunt, then travel to Sector 28 and follow the hunt trail to find the Forest Hawk. Defeat it and claim your reward at the Hunter's Guild.", type: "fetchExplore", targetSector: 28, exploreCount: 3, levelReq: 1, xpReward: 80, ryoReward: 280, staminaReward: 8, aiProfileId: "hunt-ai-forest-hawk", itemRewards: ["hunt-beast-meat", "hunt-wild-feather", "hunt-small-fang"] },
    { id: "hunt-frost-wolf", name: "Hunt the Frost Wolf", rank: "C Rank", description: "Accept the hunt, then travel to Sector 50 and follow the hunt trail to find the Frost Wolf. Defeat it and claim your reward at the Hunter's Guild.", type: "fetchExplore", targetSector: 50, exploreCount: 4, levelReq: 15, xpReward: 200, ryoReward: 480, staminaReward: 12, aiProfileId: "hunt-ai-frost-wolf", itemRewards: ["hunt-wolf-fang", "hunt-wolf-fang", "hunt-frost-pelt"] },
    { id: "hunt-ash-lizard", name: "Hunt the Ash Lizard", rank: "C Rank", description: "Accept the hunt, then travel to Sector 40 and follow the hunt trail to find the Ash Lizard. Defeat it and claim your reward at the Hunter's Guild.", type: "fetchExplore", targetSector: 40, exploreCount: 4, levelReq: 15, xpReward: 200, ryoReward: 480, staminaReward: 12, aiProfileId: "hunt-ai-ash-lizard", itemRewards: ["hunt-ash-scale", "hunt-ash-scale", "hunt-cracked-horn"] },
    { id: "hunt-shadow-panther", name: "Hunt the Shadow Panther", rank: "B Rank", description: "Accept the hunt, then travel to Sector 12 and follow the hunt trail to find the Shadow Panther. Defeat it and claim your reward at the Hunter's Guild.", type: "fetchExplore", targetSector: 12, exploreCount: 4, levelReq: 30, xpReward: 420, ryoReward: 660, staminaReward: 20, currencyRewards: { boneCharms: 1 }, aiProfileId: "hunt-ai-shadow-panther", itemRewards: ["hunt-shadow-pelt", "hunt-shadow-claw", "hunt-shadow-claw"] },
    { id: "hunt-ironback-bear", name: "Hunt the Ironback Bear", rank: "B Rank", description: "Accept the hunt, then travel to Sector 30 and follow the hunt trail to find the Ironback Bear. Defeat it and claim your reward at the Hunter's Guild.", type: "fetchExplore", targetSector: 30, exploreCount: 5, levelReq: 30, xpReward: 420, ryoReward: 660, staminaReward: 20, currencyRewards: { boneCharms: 1 }, aiProfileId: "hunt-ai-ironback-bear", itemRewards: ["hunt-beast-meat", "hunt-beast-meat", "hunt-cracked-horn", "hunt-cracked-horn"] },
    { id: "hunt-ember-drake", name: "Hunt the Ember Drake", rank: "A Rank", description: "Accept the hunt, then travel to Sector 42 and follow the hunt trail to find the Ember Drake. Defeat it and claim your reward at the Hunter's Guild.", type: "fetchExplore", targetSector: 42, exploreCount: 5, levelReq: 50, xpReward: 900, ryoReward: 1020, staminaReward: 30, currencyRewards: { boneCharms: 1, auraDust: 20 }, aiProfileId: "hunt-ai-ember-drake", itemRewards: ["hunt-ash-scale", "hunt-ash-scale", "hunt-ember-scale", "hunt-wolf-fang"] },
    { id: "hunt-moon-serpent", name: "Hunt the Moon Serpent", rank: "A Rank", description: "Accept the hunt, then travel to Sector 8 and follow the hunt trail to find the Moon Serpent. Defeat it and claim your reward at the Hunter's Guild.", type: "fetchExplore", targetSector: 8, exploreCount: 5, levelReq: 50, xpReward: 900, ryoReward: 1020, staminaReward: 30, currencyRewards: { boneCharms: 1, auraDust: 20 }, aiProfileId: "hunt-ai-moon-serpent", itemRewards: ["hunt-shadow-pelt", "hunt-shadow-pelt", "hunt-shadow-claw", "hunt-shadow-claw"] },
    { id: "hunt-ancient-chakra-beast", name: "Hunt the Ancient Chakra Beast", rank: "S Rank", description: "Accept the hunt, then travel to Sector 60 and follow the hunt trail to find the Ancient Chakra Beast. Defeat it and claim your reward at the Hunter's Guild.", type: "fetchExplore", targetSector: 60, exploreCount: 6, levelReq: 70, xpReward: 2000, ryoReward: 1450, staminaReward: 40, currencyRewards: { boneCharms: 2, auraDust: 40 }, aiProfileId: "hunt-ai-ancient-chakra-beast", itemRewards: ["hunt-legendary-material", "hunt-legendary-material", "hunt-ancient-beast-core"] },
    { id: "hunt-worldstorm-dragon", name: "Hunt the Worldstorm Dragon", rank: "S Rank", description: "Accept the hunt, then travel to Sector 59 and follow the hunt trail to find the Worldstorm Dragon. Defeat it and claim your reward at the Hunter's Guild.", type: "fetchExplore", targetSector: 59, exploreCount: 6, levelReq: 70, xpReward: 2000, ryoReward: 1450, staminaReward: 40, currencyRewards: { boneCharms: 2, auraDust: 40 }, aiProfileId: "hunt-ai-worldstorm-dragon", itemRewards: ["hunt-legendary-material", "hunt-legendary-material", "hunt-titan-bone"] },
];

export const builtinFetchMissions: CreatorMission[] = [
    { id: "fetch-d-supply-trail", name: "D Rank Supply Trail Sweep", rank: "D Rank", description: "Accept the mission and use Explore 3 times in Sector 18. Win 1 village guard raid from another village's outskirts, then claim your reward at the Mission Hall. Repeat raids against the same village count.", type: "fetchExplore", targetSector: 18, exploreCount: 3, raidCount: 1, levelReq: 1, xpReward: 90, ryoReward: 100, staminaReward: 8 },
    { id: "fetch-c-border-scout", name: "C Rank Border Scout Run", rank: "C Rank", description: "Accept the mission and use Explore 5 times in Sector 32. Win 2 village guard raids from another village's outskirts, then claim your reward at the Mission Hall. Repeat raids against the same village count.", type: "fetchExplore", targetSector: 32, exploreCount: 5, raidCount: 2, levelReq: 15, xpReward: 240, ryoReward: 540, staminaReward: 14 },
    { id: "fetch-b-enemy-cache", name: "B Rank Enemy Cache Search", rank: "B Rank", description: "Accept the mission and use Explore 7 times in Sector 47. Win 3 village guard raids from another village's outskirts, then claim your reward at the Mission Hall. Repeat raids against the same village count.", type: "fetchExplore", targetSector: 47, exploreCount: 7, raidCount: 3, levelReq: 30, xpReward: 520, ryoReward: 1320, staminaReward: 22, currencyRewards: { boneCharms: 1 } },
    { id: "fetch-a-black-route", name: "A Rank Black Route Operation", rank: "A Rank", description: "Accept the mission and use Explore 9 times in Sector 58. Win 4 village guard raids from another village's outskirts, then claim your reward at the Mission Hall. Repeat raids against the same village count.", type: "fetchExplore", targetSector: 58, exploreCount: 9, raidCount: 4, levelReq: 50, xpReward: 1100, ryoReward: 3050, staminaReward: 32, currencyRewards: { boneCharms: 1, auraDust: 20 } },
    { id: "fetch-s-shadow-front", name: "S Rank Shadow Front Incursion", rank: "S Rank", description: "Accept the mission and use Explore 12 times in Sector 60. Win 5 village guard raids from another village's outskirts, then claim your reward at the Mission Hall. Repeat raids against the same village count.", type: "fetchExplore", targetSector: 60, exploreCount: 12, raidCount: 5, levelReq: 70, xpReward: 2400, ryoReward: 5630, staminaReward: 45, currencyRewards: { boneCharms: 2, auraDust: 45 } },
];

export function missionRaidProgressKey(missionId: string) {
    return `${missionId}:raids`;
}

export function missionRaidRequirement(mission: CreatorMission) {
    return Math.max(0, Number(mission.raidCount ?? 0));
}

export function fieldMissionRaidNeeded(mission: CreatorMission, raidProgress: number): boolean {
    return Math.max(0, Number(raidProgress) || 0) < missionRaidRequirement(mission);
}

export type FieldMissionObjective = "explore" | "raid" | "claim";

/** One next-action rule shared by the mission board, tracker, and world map. */
export function nextFieldMissionObjective(
    mission: CreatorMission,
    exploreProgress: number,
    raidProgress: number,
): FieldMissionObjective {
    if (Math.max(0, Number(exploreProgress) || 0) < Math.max(0, Number(mission.exploreCount) || 0)) return "explore";
    if (fieldMissionRaidNeeded(mission, raidProgress)) return "raid";
    return "claim";
}

export function fieldMissionNextAction(
    mission: CreatorMission,
    exploreProgress: number,
    raidProgress: number,
    _currentSector: number,
): { objective: FieldMissionObjective; instruction: string; label: string } {
    const objective = nextFieldMissionObjective(mission, exploreProgress, raidProgress);
    if (objective === "claim") return { objective, instruction: "All objectives complete. Claim your reward.", label: "Claim reward" };
    if (objective === "explore") return {
        objective,
        instruction: `World Map → Sector ${mission.targetSector} → Explore.`,
        label: `Explore Sector ${mission.targetSector}`,
    };
    return {
        objective,
        instruction: "Travel to one of the other three villages and raid its village guard from the outskirts.",
        label: "Go to an enemy village",
    };
}

export function mergeBuiltinMissions(customMissions: CreatorMission[]) {
    const customById = new Map(customMissions.map((mission) => [mission.id, mission]));
    return [
        ...builtinFetchMissions.map((mission) => customById.get(mission.id) ?? mission),
        ...customMissions.filter((mission) => !builtinFetchMissions.some((builtin) => builtin.id === mission.id)),
    ];
}

export function sortFieldMissions(missions: CreatorMission[]) {
    return [...missions].sort((left, right) =>
        FIELD_MISSION_RANK_ORDER[left.rank] - FIELD_MISSION_RANK_ORDER[right.rank]
        || left.name.localeCompare(right.name)
    );
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
