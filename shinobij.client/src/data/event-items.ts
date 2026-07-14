import type { GameItem } from "../types/combat";

export const eventItems: GameItem[] = [
    {
        id: "event-kesa-storm-seal",
        name: "Kesa's Storm-Seal",
        slot: "aura",
        rarity: "epic",
        cost: 0,
        levelReq: 58,
        description: "A recovered seal tied to Kesa Volt's reason, carried back from the Stormveil outskirts.",
        flavorText: "The account closed. The reason stayed.",
        bonuses: { ninjutsuOffense: 20, maxChakra: 80 },
    },
    {
        id: "event-kesa-marker",
        name: "Kesa's Ridge Marker",
        slot: "waist",
        rarity: "rare",
        cost: 0,
        levelReq: 25,
        description: "A pressed ridge marker gathered for Mira Volt, proof that Kesa was a person before she was an account.",
        flavorText: "A line on a ridge. A name in a daughter's hand.",
        bonuses: { taijutsuDefense: 16, willpower: 10 },
    },
];

export const eventItemIds = new Set(eventItems.map((item) => item.id));
