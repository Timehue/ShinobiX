/*
 * Built-in visual novel events. Three template events that fire from
 * the engine itself (not the creator panel):
 *
 *   • awakeningLv2VnEvent   — opens when the level-2 player first leaves
 *                             the village; introduces the Awakening Stone.
 *   • auraSphereLv9VnEvent  — opens at level 9 from the village elder;
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
    name: "The Awakening Stone Calls",
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
            title: "A Strange Resonance",
            scene: "An ancient energy stirs as you step beyond the village gates.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: The moment you step past the gates, a deep hum resonates through your chakra network.",
                "Narrator: It pulses from far away — from the heart of Central, the Thousand Gates.",
                "Village Elder: Wait, young one. You feel it, don't you?",
                "Village Elder: That vibration. The Awakening Stone is calling to you.",
                "Village Elder: Hidden within Central Hub lies an ancient relic — the Awakening Stone.",
                "Village Elder: Every shinobi carries a hidden elemental nature — Water, Wind, Earth, Lightning, or Fire.",
                "Village Elder: The stone will awaken yours and align your chakra to its truest form.",
                "Village Elder: Travel to Central Hub. Find the Awakening Stone. Discover your element.",
                "Village Elder: At certain power thresholds — level 2 and level 20 — the stone will read you for free.",
                "Narrator: A new path opens before you. The Awakening Stone awaits in Central...",
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
            title: "A Quiet Summons",
            scene: "An elder waits beside a low lantern, holding a small sphere that drinks in the light around it.",
            speaker: "Village Elder",
            dialogue: [
                "Village Elder: Level nine already. Your chakra is beginning to leave footprints in the air.",
                "Village Elder: That means you are ready to carry something older than our village walls.",
                "Village Elder: This is an Aura Sphere. It does not make power for you. It remembers the power you earn.",
            ],
        },
        {
            title: "The Sphere Awakens",
            scene: "The sphere rises from the elder's palm and turns slowly, mist curling around its surface.",
            speaker: "Village Elder",
            dialogue: [
                "Village Elder: Equip it in your aura slot. Only then will its menu reveal itself to you.",
                "Village Elder: Feed it Aura Dust from battles, raids, bosses, war contribution, and ancient chests.",
                "Village Elder: Treat it well, and one day your own aura will answer before you speak.",
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
    currencyRewards: { boneCharms: 10, auraStones: 5, fateShards: 5 },
    dialogue: [
        "Narrator: The ground exhales old chakra.",
        "Narrator: Three seals burn in the dark: combat, strategy, and companionship.",
    ],
    vnPages: [
        {
            title: "Seal One: The Warden",
            scene: "A masked shinobi steps from a hall of old torii gates.",
            speaker: "Dungeon Warden",
            dialogue: [
                "Dungeon Warden: Only shinobi level 50 or higher may cross this seal.",
                "Dungeon Warden: Defeat the guardian chosen by the dungeon, or leave with your life.",
            ],
            leftName: "Player",
            rightName: "Dungeon Warden",
        },
        {
            title: "Seal Two: The Tile Shrine",
            scene: "Stone cards grind across a square altar. Five slots wait for your deck.",
            speaker: "Dungeon Warden",
            dialogue: [
                "Dungeon Warden: Strength is not enough.",
                "Dungeon Warden: Win the shinobi tile game. If you have no cards, you cannot complete this seal.",
            ],
            leftName: "Player",
            rightName: "Dungeon Warden",
        },
        {
            title: "Seal Three: The Rare Beast",
            scene: "A rare pet spirit circles the final chamber with bright, hostile eyes.",
            speaker: "Dungeon Warden",
            dialogue: [
                "Dungeon Warden: The final seal tests the bond between shinobi and pet.",
                "Dungeon Warden: Win this battle and the dungeon treasury opens.",
            ],
            leftName: "Player",
            rightName: "Dungeon Warden",
        },
    ],
};

export const craftDungeonEvents: CreatorEvent[] = [
    { ...hiddenDungeonVnEvent, id: "craft-dungeon-forest", name: "Forest Relic Dungeon", biome: "forest", icon: "FD", vnTitle: "Forest Relic Dungeon", vnScene: "Ancient roots twist around a sealed forge gate." },
    { ...hiddenDungeonVnEvent, id: "craft-dungeon-snow", name: "Snow Relic Dungeon", biome: "snow", icon: "SD", vnTitle: "Snow Relic Dungeon", vnScene: "A glacial stairway opens into a frozen armory." },
    { ...hiddenDungeonVnEvent, id: "craft-dungeon-volcano", name: "Volcano Relic Dungeon", biome: "volcano", icon: "VD", vnTitle: "Volcano Relic Dungeon", vnScene: "Lava-lit stone doors reveal a buried weapon vault." },
    { ...hiddenDungeonVnEvent, id: "craft-dungeon-shadow", name: "Shadow Relic Dungeon", biome: "shadow", icon: "XD", vnTitle: "Shadow Relic Dungeon", vnScene: "A black shrine exhales old chakra and opens below." },
    { ...hiddenDungeonVnEvent, id: "craft-dungeon-central", name: "Central Relic Dungeon", biome: "central", icon: "CD", vnTitle: "Central Relic Dungeon", vnScene: "A neutral gate beneath Central hums with sealed relic power." },
];
