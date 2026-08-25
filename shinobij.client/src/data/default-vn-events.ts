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
    vnTitle: "Tracks Beside Your Own",
    vnScene: "A snapped branch stops you on a narrow sector trail.",
    vnSpeaker: "Narrator",
    vnPages: [
        {
            title: "Tracks Beside Your Own",
            scene: "A snapped branch stops you on a narrow sector trail.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: A branch snaps behind you. When you turn, the brush is still.",
                "Narrator: One set of pawprints crosses your trail, circles back, and stops a spear-length away.",
                "Narrator: You lower your hand from your weapon. An animal steps out.",
            ],
            choices: [],
        },
        {
            title: "Close Enough to See",
            scene: "The animal stands between two cedars, muddy and watchful.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: Mud cakes one flank. A thorn is caught above its foreleg.",
                "Narrator: Its eyes follow your hands, not your face. It knows what shinobi carry.",
                "Narrator: You crouch and set your weapon on the ground. It takes one careful step closer.",
            ],
            choices: [],
        },
        {
            title: "An Open Hand",
            scene: "You hold out an empty hand and let the animal decide the distance.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: Wild companions do not care about academy rank. They care whether you rush them.",
                "Narrator: This one followed your trail and came close enough to be seen. That is an offer, not obedience.",
                "Narrator: Keep your hand still. If it closes the last step, the two of you can meet properly.",
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
    vnTitle: "A Seal Under the Rubble",
    vnScene: "A straight lacquered edge shows beneath the moss of a collapsed waystation.",
    vnSpeaker: "Narrator",
    vnPages: [
        {
            title: "A Seal Under the Rubble",
            scene: "A straight lacquered edge shows beneath the moss of a collapsed waystation.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: You clear two loose stones and uncover a shinobi courier chest, lacquer split but hinges intact.",
                "Narrator: Three field seals guard the lid: water, rot, and chakra tampering. Old quartermaster work.",
                "Narrator: The last seal has weakened with age. It is not choosing you. It is simply failing.",
                "Narrator: You trace the release order cut beside the hinge and feed a narrow thread of chakra through each mark.",
                "Narrator: The lock gives with a dry click.",
            ],
            choices: [],
        },
        {
            title: "The Chest Opens",
            scene: "The old courier chest opens on a row of oilcloth bundles.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: The hinges complain loudly enough to wake every bird in the waystation roof.",
                "Narrator: Oilcloth kept the contents dry. A faded patrol mark dates the cache to the wars before the villages drew their present borders.",
                "Narrator: Whoever packed it expected to come back. They never did.",
                "Narrator: You take what the road can still use and leave the lid standing upright, the field sign for a cleared cache.",
            ],
            choices: [],
        },
    ],
};
