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
                "Narrator: The animal lowers its nose toward your open hand, then stops beyond reach.",
                "Narrator: Keep your hand still. It may close the last step or return to the brush. Let it choose the distance.",
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
                "%name: Three seal stamps beside the hinge. Their release marks are still readable.",
                "Narrator: The last seal flakes under your thumb. A hairline split runs through the stamp and into the lacquer.",
                "%name: The hinge inscription says press, turn, then lift the pin. I can follow that.",
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
                "%name: Oilcloth bundles. I don't know that patrol mark. The lacquer around it is badly weathered.",
                "Narrator: The bundles are tied for quick removal, but undisturbed dust has sealed the knots.",
                "%name: Take what the road can use. Leave the lid upright so the next patrol knows it is clear.",
            ],
            choices: [],
        },
    ],
};
