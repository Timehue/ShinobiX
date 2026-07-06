import type { CreatorEvent } from "../types/vn";

export const defaultPetEncounterVn: CreatorEvent = {
    id: "sys-pet-encounter",
    name: "Pet Encounter",
    biome: "forest",
    icon: "⚔",
    eventKind: "visualNovel",
    trigger: "manual",
    levelReq: 1,
    xpReward: 0,
    ryoReward: 0,
    staminaReward: 0,
    dialogue: [],
    vnTitle: "A Presence in the Shadows",
    vnScene: "The rustling of leaves breaks the silence of the sector.",
    vnSpeaker: "Narrator",
    vnPages: [
        {
            title: "A Presence in the Shadows",
            scene: "The rustling of leaves breaks the silence of the sector.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: Something stirs at the edge of your senses.",
                "Narrator: A warmth — not from fire, but from living breath nearby.",
                "Narrator: You stop moving. So does it.",
            ],
            choices: [],
        },
        {
            title: "The Creature Reveals Itself",
            scene: "A creature emerges from the undergrowth, watching you carefully.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: Eyes catch yours — ancient, curious, unafraid.",
                "Narrator: It does not run. It does not attack.",
                "Narrator: It simply waits.",
            ],
            choices: [],
        },
        {
            title: "A Choice Before You",
            scene: "The creature tilts its head as if asking a question only it understands.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: Shinobi learn to read animals the way they read the wind.",
                "Narrator: This one is not lost. It chose to find you.",
                "Narrator: The question is — will you let it stay?",
            ],
            choices: [],
        },
    ],
};

export const defaultAncientChestVn: CreatorEvent = {
    id: "sys-ancient-chest",
    name: "Ancient Chest",
    biome: "forest",
    icon: "⚔",
    eventKind: "visualNovel",
    trigger: "manual",
    levelReq: 1,
    xpReward: 0,
    ryoReward: 0,
    staminaReward: 0,
    dialogue: [],
    vnTitle: "Something Stirs in the Ruins",
    vnScene: "Deep within the wilderness, a faint shimmer catches your eye.",
    vnSpeaker: "Narrator",
    vnPages: [
        {
            title: "Something Stirs in the Ruins",
            scene: "Deep within the wilderness, a faint shimmer catches your eye.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: You pause. Something between the rubble is glowing.",
                "Narrator: Half-buried under centuries of earth and stone — an ancient chest.",
                "Narrator: These runes... pre-war era seals. This thing has been here a long time.",
                "Narrator: The chakra lock flickers as you approach, as if recognizing your presence.",
                "Narrator: Whoever left this... they wanted someone strong enough to find it.",
                "Narrator: You press your hand to the seal. It dissolves at your touch.",
            ],
            choices: [],
        },
        {
            title: "The Chest Opens",
            scene: "Golden light spills from the ancient chest as the seal breaks.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: The lid swings open with a low resonant hum.",
                "Narrator: Inside — preserved by chakra for decades — the chest reveals its contents.",
                "Narrator: ...I wasn't expecting this.",
                "Narrator: The ancient shinobi who sealed this chest left something worth finding.",
            ],
            choices: [],
        },
    ],
};
