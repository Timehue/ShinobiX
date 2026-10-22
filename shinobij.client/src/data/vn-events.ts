/*
 * Built-in visual novel events. Three template events that fire from
 * the engine itself (not the creator panel):
 *
 *   • awakeningLv2VnEvent   — opens when the level-2 player first leaves
 *                             the village; delivers the Awakening Stone summons.
 *   • auraSphereLv9VnEvent  — opens a timed level-9 issue seal;
 *                             grants the Aura Sphere.
 *   • hiddenDungeonVnEvent  — the 3-seal hidden dungeon intro shown when
 *                             a Hidden Dungeon Gate tile is uncovered.
 *
 * Plus craftDungeonEvents — five biome-themed clones of hiddenDungeonVnEvent
 * used by the Crafter's "Relic Dungeon" entries.
 *
 * Pure data. Extracted from App.tsx.
 */

import type { CreatorEvent } from "../App";
import { AWAKENING_VN_ID, AURA_SPHERE_VN_ID, DUNGEON_VN_ID } from "../constants/game";

export const awakeningLv2VnEvent: CreatorEvent = {
    id: AWAKENING_VN_ID,
    name: "The Pull Toward Central",
    biome: "central",
    icon: "⚔",
    eventKind: "visualNovel",
    trigger: "firstLeaveVillage",
    levelReq: 2,
            xpReward: 0,
            ryoReward: 0,
            staminaReward: 0,
            currencyRewards: {},
            dialogue: [],
    vnPages: [
        {
            title: "The Pull Toward Central",
            scene: "A summons seal opens across your field record as a hard tug of chakra numbs your fingers.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: The pull comes from Central. Every time you turn away, the feeling tightens along your palm.",
                "Village Elder: This is a recorded summons. Stop a moment and open your hand. The Awakening Stone at Central Hub is calling you.",
                "Village Elder: Visit the Awakening Stone at Central Hub to reveal your first chakra element: Water, Wind, Earth, Lightning, or Fire.",
                "Village Elder: It does not choose your future. It gives you a place to begin training.",
                "Village Elder: Your first element awakening is free at level 2. You can awaken a second element for free at level 20.",
                "Village Elder: Open Central Hub and visit the Awakening Stone when you are ready.",
                "Narrator: The seal marks Central on your route sheet. You have your next destination.",
            ],
        },
    ],
};

export const auraSphereLv9VnEvent: CreatorEvent = {
    id: AURA_SPHERE_VN_ID,
    name: "The Elder's Aura Sphere",
    biome: "central",
    icon: "AS",
    eventKind: "visualNovel",
    trigger: "manual",
    levelReq: 9,
    xpReward: 0,
    ryoReward: 0,
    staminaReward: 0,
    dialogue: [],
    vnPages: [
        {
            title: "A Timed Issue Seal",
            scene: "At level 9, a seal on your field kit opens to reveal an Aura Sphere and a recorded message.",
            speaker: "Village Elder",
            dialogue: [
                "Village Elder: You have reached level 9. Put the kit on something steady before you work the clasp.",
                "Village Elder: This is an Aura Sphere. Upgrade it with Aura Dust to gain combat bonuses.",
                "Village Elder: Equip it and open its upgrade controls to see which bonuses you can improve.",
            ],
        },
        {
            title: "The Sphere Awakens",
            scene: "Mist turns slowly over the opened aura fitting while the issue seal finishes its message.",
            speaker: "Village Elder",
            dialogue: [
                "Village Elder: Open your Profile and equip the Aura Sphere in your aura slot if you do not already have one equipped.",
                "Village Elder: You can equip one Aura Sphere at a time.",
                "Village Elder: Bring it Aura Dust from real service: battles, raids, village war, dangerous hunts, and old field caches.",
                "Village Elder: In your Profile, use Feed Aura Dust to level up the sphere. Check the displayed cost and bonuses first.",
            ],
        },
    ],
};

export const hiddenDungeonVnEvent: CreatorEvent = {
    id: DUNGEON_VN_ID,
    name: "Hidden Dungeon Gate",
    biome: "shadow",
    icon: "DG",
    eventKind: "visualNovel",
    trigger: "manual",
    vnTitle: "Hidden Dungeon Gate",
    vnScene: "A sealed stairwell opens beneath the tile you explored.",
    vnSpeaker: "Narrator",
    levelReq: 50,
    xpReward: 0,
    ryoReward: 0,
    staminaReward: 0,
    // Mirrors the server's DUNGEON_CLEAR_REWARD (api/dungeon/_run.ts); pinned by
    // scripts/dungeon-reward-parity.test.ts. The clear alert in App.tsx reads it.
    currencyRewards: { boneCharms: 10, auraStones: 5, fateShards: 2 },
    dialogue: [
        "Narrator: The ground exhales old chakra.",
        "Narrator: Three seals burn in the dark: combat, strategy, and companionship.",
    ],
    vnPages: [
        {
            title: "First Seal: The Warden",
            scene: "A masked shinobi steps from a hall of old torii gates.",
            speaker: "Dungeon Warden",
            dialogue: [
                "Dungeon Warden: You must be level 50 or higher to enter this dungeon.",
                "Dungeon Warden: The first seal is mine. Defeat the guardian and I open the inner hall. Lose, and I drag you back to these steps once.",
                "Player: Once?",
                "Dungeon Warden: One rescue rope, one pair of shoulders, and a whole night before the next shift. Show me you can stop when the floor turns bad.",
            ],
            leftName: "Player",
            rightName: "Dungeon Warden",
        },
        {
            title: "Second Seal: The Chronicle Table",
            scene: "Stone cards grind across a square altar. Five slots wait for your deck.",
            speaker: "Dungeon Warden",
            dialogue: [
                "Dungeon Warden: A shinobi who only knows how to strike is easy to bury.",
                "Dungeon Warden: Bring a full, legal Chronicle deck. Win the Shinobi Chronicle Showdown at this table to open the second seal. Come back with your cards if you haven't brought them.",
            ],
            leftName: "Player",
            rightName: "Dungeon Warden",
        },
        {
            title: "Third Seal: The Companion",
            scene: "A rare sector beast circles the final chamber, watching both you and your companion.",
            speaker: "Dungeon Warden",
            dialogue: [
                "Dungeon Warden: The third seal opens when you win the companion battle. Bring a companion that is available to fight.",
                "Dungeon Warden: Win that battle to open the treasury. If you lose, the treasury stays locked.",
            ],
            leftName: "Player",
            rightName: "Dungeon Warden",
        },
    ],
};

function craftDungeonEvent(
    patch: Pick<CreatorEvent, "id" | "name" | "biome" | "icon" | "vnTitle" | "vnScene">,
): CreatorEvent {
    const firstPage = hiddenDungeonVnEvent.vnPages?.[0];
    return {
        ...hiddenDungeonVnEvent,
        ...patch,
        vnPages: hiddenDungeonVnEvent.vnPages?.map((page, index) => index === 0 && firstPage
            ? { ...page, scene: patch.vnScene ?? page.scene }
            : { ...page }),
    };
}

export const craftDungeonEvents: CreatorEvent[] = [
    craftDungeonEvent({ id: "craft-dungeon-forest", name: "Forest Relic Dungeon", biome: "forest", icon: "FD", vnTitle: "Forest Relic Dungeon", vnScene: "Roots have buckled the forge gate, and Ashen Leaf repair marks cover its hinges." }),
    craftDungeonEvent({ id: "craft-dungeon-snow", name: "Snow Relic Dungeon", biome: "snow", icon: "SD", vnTitle: "Snow Relic Dungeon", vnScene: "A stair cut into the glacier descends toward a frozen armory." }),
    craftDungeonEvent({ id: "craft-dungeon-volcano", name: "Volcano Relic Dungeon", biome: "volcano", icon: "VD", vnTitle: "Volcano Relic Dungeon", vnScene: "Heat leaks around a stone door stamped with an old weapons seal." }),
    craftDungeonEvent({ id: "craft-dungeon-shadow", name: "Shadow Relic Dungeon", biome: "shadow", icon: "XD", vnTitle: "Shadow Relic Dungeon", vnScene: "A black-painted shrine door opens over a narrow descending stair." }),
    craftDungeonEvent({ id: "craft-dungeon-central", name: "Central Relic Dungeon", biome: "central", icon: "CD", vnTitle: "Central Relic Dungeon", vnScene: "An old inspection gate beneath Central stands open for the first time in years." }),
];
