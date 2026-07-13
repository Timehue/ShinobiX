import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GameItem } from "../types/combat";
import { formatItemBonus, presentItem } from "./item-presentation";

function item(overrides: Partial<GameItem>): GameItem {
    return {
        id: "test-item",
        name: "Test Item",
        slot: "item",
        rarity: "common",
        cost: 0,
        description: "A test item.",
        bonuses: {},
        ...overrides,
    };
}

describe("item detail presentation", () => {
    it("gives player equipment decision-focused labels", () => {
        assert.equal(presentItem(item({ slot: "hand", name: "Kunai" })).category, "Weapon");
        assert.equal(presentItem(item({ slot: "body", name: "Vest" })).category, "Armor");
        assert.equal(presentItem(item({ slot: "aura", name: "Chakra Ring" })).category, "Aura Equipment");
        assert.equal(presentItem(item({ slot: "thrown", name: "Shuriken" })).category, "Throwable");
        assert.equal(presentItem(item({ slot: "potion", name: "Potion" })).category, "Combat Potion");
        assert.equal(presentItem(item({ slot: "item", name: "Attack Pill", apCost: 20 })).category, "Battle Item");
    });

    it("does not describe activity items as player equipment", () => {
        const petFood = presentItem(item({ id: "pet-treat", name: "Treats" }), 100);
        const petGear = presentItem(item({ name: "Pet Harness", description: "Pet companion gear for a pet's PVE slot." }));
        const material = presentItem(item({ name: "Torn Hide", description: "A crafting material used in the Crafter." }));
        const terseHuntDrop = presentItem(item({ id: "hunt-titan-bone", name: "Titan Bone", description: "Near-indestructible." }));
        const key = presentItem(item({ name: "Dungeon Key", description: "A key that opens a dungeon." }));
        const crate = presentItem(item({ id: "legendary-war-crate", name: "Legendary War Crate" }));

        assert.deepEqual(
            [petFood.category, petGear.category, material.category, terseHuntDrop.category, key.category, crate.category],
            ["Pet Training Item", "Pet Gear", "Crafting Material", "Crafting Material", "Key Item", "Reward Crate"],
        );
        for (const presentation of [petFood, petGear, material, terseHuntDrop, key, crate]) {
            assert.equal(presentation.showPlayerSlot, false);
        }
    });

    it("formats percentage traits without changing flat stat bonuses", () => {
        assert.equal(formatItemBonus("Increase Damage", 10), "+10%");
        assert.equal(formatItemBonus("Taijutsu Defense", 20), "+20");
    });
});
