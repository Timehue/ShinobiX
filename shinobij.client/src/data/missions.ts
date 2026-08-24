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
    { id: "hunt-wild-boar", name: "Hunt the Wild Boar", rank: "D Rank", description: "An orchard keeper in Sector 25 brought us half a fence and a boar tusk buried in the post. Follow the churned soil, drive the animal away from the terraces, and mark where it beds.", type: "fetchExplore", targetSector: 25, exploreCount: 3, levelReq: 1, xpReward: 80, ryoReward: 60, staminaReward: 8, aiProfileId: "hunt-ai-wild-boar", itemRewards: ["hunt-beast-meat", "hunt-beast-meat", "hunt-torn-hide"] },
    { id: "hunt-forest-hawk", name: "Hunt the Forest Hawk", rank: "D Rank", description: "Two couriers were cut across the scalp on the Sector 28 ridge. Scout the high nests, keep the road below you, and bring down the hawk striking the message route.", type: "fetchExplore", targetSector: 28, exploreCount: 3, levelReq: 1, xpReward: 80, ryoReward: 60, staminaReward: 8, aiProfileId: "hunt-ai-forest-hawk", itemRewards: ["hunt-beast-meat", "hunt-wild-feather", "hunt-small-fang"] },
    { id: "hunt-frost-wolf", name: "Hunt the Frost Wolf", rank: "C Rank", description: "A Frost Wolf pack has learned the bell schedule on the Sector 50 supply road. Find the alpha before the next sled passes and break the pack's habit of hunting lantern lines.", type: "fetchExplore", targetSector: 50, exploreCount: 4, levelReq: 15, xpReward: 200, ryoReward: 160, staminaReward: 12, aiProfileId: "hunt-ai-frost-wolf", itemRewards: ["hunt-wolf-fang", "hunt-wolf-fang", "hunt-frost-pelt"] },
    { id: "hunt-ash-lizard", name: "Hunt the Ash Lizard", rank: "C Rank", description: "An Ash Lizard nested beside the Sector 40 vents and now sleeps across the only cool trade path. Read the fresh scale marks, approach from downwind, and clear the route.", type: "fetchExplore", targetSector: 40, exploreCount: 4, levelReq: 15, xpReward: 200, ryoReward: 160, staminaReward: 12, aiProfileId: "hunt-ai-ash-lizard", itemRewards: ["hunt-ash-scale", "hunt-ash-scale", "hunt-cracked-horn"] },
    { id: "hunt-shadow-panther", name: "Hunt the Shadow Panther", rank: "B Rank", description: "A Shadow Panther has taken three sentries from the same bend in Sector 12. It waits above eye level and circles behind genjutsu decoys. Check the branches before the trail.", type: "fetchExplore", targetSector: 12, exploreCount: 4, levelReq: 30, xpReward: 420, ryoReward: 340, staminaReward: 20, currencyRewards: { boneCharms: 1 }, aiProfileId: "hunt-ai-shadow-panther", itemRewards: ["hunt-shadow-pelt", "hunt-shadow-claw", "hunt-shadow-claw"] },
    { id: "hunt-ironback-bear", name: "Hunt the Ironback Bear", rank: "B Rank", description: "An Ironback Bear claimed the charcoal camps in Sector 30. Blades glance from its back, so watch the forelegs and force it away from the occupied cabins before you commit.", type: "fetchExplore", targetSector: 30, exploreCount: 5, levelReq: 30, xpReward: 420, ryoReward: 340, staminaReward: 20, currencyRewards: { boneCharms: 1 }, aiProfileId: "hunt-ai-ironback-bear", itemRewards: ["hunt-beast-meat", "hunt-beast-meat", "hunt-cracked-horn", "hunt-cracked-horn"] },
    { id: "hunt-ember-drake", name: "Hunt the Ember Drake", rank: "A Rank", description: "Trackers call the vent-lizard in Sector 42 an Ember Drake. It spits superheated ash across the south path and has already melted two signal bells. Take a water seal and close from the rock side.", type: "fetchExplore", targetSector: 42, exploreCount: 5, levelReq: 50, xpReward: 900, ryoReward: 750, staminaReward: 30, currencyRewards: { boneCharms: 2, auraDust: 20 }, aiProfileId: "hunt-ai-ember-drake", itemRewards: ["hunt-ash-scale", "hunt-ash-scale", "hunt-ember-scale", "hunt-wolf-fang"] },
    { id: "hunt-moon-serpent", name: "Hunt the Moon Serpent", rank: "A Rank", description: "The Moon Serpent in Sector 8 uses reflected lanternlight to lay genjutsu over the road. Travel without exposed mirrors, test every voice that calls your name, and strike the real body.", type: "fetchExplore", targetSector: 8, exploreCount: 5, levelReq: 50, xpReward: 900, ryoReward: 750, staminaReward: 30, currencyRewards: { boneCharms: 2, auraDust: 20 }, aiProfileId: "hunt-ai-moon-serpent", itemRewards: ["hunt-shadow-pelt", "hunt-shadow-pelt", "hunt-shadow-claw", "hunt-shadow-claw"] },
    { id: "hunt-ancient-chakra-beast", name: "Hunt the Ancient Chakra Beast", rank: "S Rank", description: "Five patrol tags were found around one set of tracks in Sector 60, each tag burned by a different chakra nature. Locate the Court-era guard beast, record how it changes elements, and do not let it reach Central's road.", type: "fetchExplore", targetSector: 60, exploreCount: 6, levelReq: 70, xpReward: 2000, ryoReward: 1800, staminaReward: 40, currencyRewards: { boneCharms: 3, auraDust: 40, fateShards: 1 }, aiProfileId: "hunt-ai-ancient-chakra-beast", itemRewards: ["hunt-legendary-material", "hunt-legendary-material", "hunt-ancient-beast-core"] },
    { id: "hunt-worldstorm-dragon", name: "Hunt the Worldstorm Dragon", rank: "S Rank", description: "A winged storm beast is feeding along a discarded Storm Engine conductor in Sector 59. Its scales throw lightning into the ground before it dives. Cut the conductor first, then bring the beast down away from the road crews.", type: "fetchExplore", targetSector: 59, exploreCount: 6, levelReq: 70, xpReward: 2000, ryoReward: 1800, staminaReward: 40, currencyRewards: { boneCharms: 3, auraDust: 40, fateShards: 1 }, aiProfileId: "hunt-ai-worldstorm-dragon", itemRewards: ["hunt-legendary-material", "hunt-legendary-material", "hunt-titan-bone"] },
];

export const builtinFetchMissions: CreatorMission[] = [
    { id: "fetch-d-supply-trail", name: "D Rank Supply Trail Sweep", rank: "D Rank", description: "Walk the Sector 18 supply trail, mark three routes a loaded cart can survive, and recover the crate taken to the nearest outpost. Bring back the quartermaster's cord from the handle.", type: "fetchExplore", targetSector: 18, exploreCount: 3, raidCount: 1, levelReq: 1, xpReward: 90, ryoReward: 75, staminaReward: 8 },
    { id: "fetch-c-border-scout", name: "C Rank Border Scout Run", rank: "C Rank", description: "Map the patrol changes in Sector 32 without using the main road. The guard post holds two field reports we need; take both before the next shift learns your face.", type: "fetchExplore", targetSector: 32, exploreCount: 5, raidCount: 2, levelReq: 15, xpReward: 240, ryoReward: 190, staminaReward: 14 },
    { id: "fetch-b-enemy-cache", name: "B Rank Enemy Cache Search", rank: "B Rank", description: "Courier chalk in Sector 47 points to a hidden supply chain. Find the caches, then hit the defenses hard enough that their runners abandon the marked route.", type: "fetchExplore", targetSector: 47, exploreCount: 7, raidCount: 3, levelReq: 30, xpReward: 520, ryoReward: 420, staminaReward: 22, currencyRewards: { boneCharms: 1 } },
    { id: "fetch-a-black-route", name: "A Rank Black Route Operation", rank: "A Rank", description: "Someone is moving sealed orders through Sector 58 after lantern-out. Trace the handoff marks, raid each post in the chain, and return with one seal intact for comparison.", type: "fetchExplore", targetSector: 58, exploreCount: 9, raidCount: 4, levelReq: 50, xpReward: 1100, ryoReward: 900, staminaReward: 32, currencyRewards: { boneCharms: 2, auraDust: 20 } },
    { id: "fetch-s-shadow-front", name: "S Rank Shadow Front Incursion", rank: "S Rank", description: "Cross Sector 60 beyond friendly signal range, chart the full approach to the enemy front, and break five command posts. Return with the sealed orders before either village can deny issuing them.", type: "fetchExplore", targetSector: 60, exploreCount: 12, raidCount: 5, levelReq: 70, xpReward: 2400, ryoReward: 2100, staminaReward: 45, currencyRewards: { boneCharms: 3, auraDust: 45, fateShards: 1 } },
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
