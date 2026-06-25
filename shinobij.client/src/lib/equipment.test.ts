import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { EquipmentSlots } from "../types/combat";
import {
    COMBAT_ITEM_SLOTS,
    combatLoadoutSlots,
    equipCombatItem,
    equipmentSlotLabel,
    isCombatConsumable,
    isCombatItemSlot,
} from "./equipment";

describe("equipCombatItem — three combat item slots", () => {
    it("fills item1, item2, item3 with three different combat items (no eviction)", () => {
        let eq: EquipmentSlots = {};
        eq = equipCombatItem(eq, "item-smoke-bomb");
        eq = equipCombatItem(eq, "item-attack-pill");
        eq = equipCombatItem(eq, "item-defense-pill");
        // The whole point of the fix: all three coexist, none replaced.
        assert.equal(eq.item1, "item-smoke-bomb");
        assert.equal(eq.item2, "item-attack-pill");
        assert.equal(eq.item3, "item-defense-pill");
    });

    it("re-equipping an already-equipped item keeps it in place", () => {
        const eq: EquipmentSlots = { item1: "item-smoke-bomb", item2: "item-attack-pill" };
        const out = equipCombatItem(eq, "item-smoke-bomb");
        assert.equal(out.item1, "item-smoke-bomb");
        assert.equal(out.item2, "item-attack-pill");
        assert.equal(out.item3, undefined);
    });

    it("replaces item1 once all three slots are full", () => {
        const out = equipCombatItem({ item1: "a", item2: "b", item3: "c" }, "d");
        assert.equal(out.item1, "d");
        assert.equal(out.item2, "b");
        assert.equal(out.item3, "c");
    });

    it("retires the legacy bare 'item' key and re-homes into the first open slot", () => {
        const out = equipCombatItem({ item: "item-attack-pill" }, "item-smoke-bomb");
        assert.equal(out.item, undefined);
        assert.equal(out.item1, "item-smoke-bomb");
    });

    it("never leaves the same id in two item slots when moving", () => {
        const out = equipCombatItem({ item1: "x", item3: "y" }, "x");
        const where = COMBAT_ITEM_SLOTS.filter((s) => out[s] === "x");
        assert.deepEqual(where, ["item1"]);
    });
});

describe("combat item slot helpers", () => {
    it("isCombatConsumable identifies real combat items, not materials/food", () => {
        assert.equal(isCombatConsumable({ slot: "item", weaponEffect: "Increase Damage Given", apCost: 20 }), true);
        assert.equal(isCombatConsumable({ slot: "item", apCost: 20 }), true);
        assert.equal(isCombatConsumable({ slot: "item" }), false); // hunting material / collar / treat
        assert.equal(isCombatConsumable({ slot: "thrown", apCost: 20 }), false); // not the item slot
    });

    it("isCombatItemSlot covers item1/2/3 and the legacy key", () => {
        for (const s of ["item", "item1", "item2", "item3"] as const) assert.equal(isCombatItemSlot(s), true);
        assert.equal(isCombatItemSlot("thrown"), false);
    });

    it("combatLoadoutSlots carries all three item keys plus the legacy alias", () => {
        for (const s of ["item1", "item2", "item3", "item"] as const) assert.ok(combatLoadoutSlots.includes(s));
    });

    it("labels the three item slots distinctly", () => {
        assert.equal(equipmentSlotLabel("item1"), "Item 1");
        assert.equal(equipmentSlotLabel("item2"), "Item 2");
        assert.equal(equipmentSlotLabel("item3"), "Item 3");
    });
});
