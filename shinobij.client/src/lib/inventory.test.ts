import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import {
    addItem,
    addItems,
    removeItem,
    countItem,
    ownsItem,
    totalItemCount,
    unifiedItemStacks,
    normalizeInventory,
    isStackableId,
    MAX_ITEM_STACK,
} from "./inventory";

// Minimal character: the helpers only read/write inventory + itemStacks.
function mk(inventory: string[] = [], itemStacks?: { itemId: string; count: number }[]): Character {
    return { inventory, itemStacks } as unknown as Character;
}

// Known ids: a throwable is stackable; an arbitrary gear id is not.
const STACK = "thrown-shuriken";
const SCROLL = "territory-control-scroll";
const GEAR = "iron-sword-test"; // not in stackableItemIds → unique

describe("inventory — classification", () => {
    it("knows stackable vs unique ids", () => {
        assert.equal(isStackableId(STACK), true);
        assert.equal(isStackableId(SCROLL), true);
        assert.equal(isStackableId(GEAR), false);
    });

    it("the Rejuvenation Potion stacks high and depletes one per use", () => {
        // Stacks like other consumables (counted itemStacks, not one slot each).
        assert.equal(isStackableId("potion-rejuvenation"), true);
        let c = addItem(mk(), "potion-rejuvenation", 9);
        assert.equal(countItem(c, "potion-rejuvenation"), 9);
        // Two in-battle sips (the per-fight cap) each remove one from the supply.
        c = removeItem(c, "potion-rejuvenation", 1);
        c = removeItem(c, "potion-rejuvenation", 1);
        assert.equal(countItem(c, "potion-rejuvenation"), 7);
    });
});

describe("inventory — addItem routing", () => {
    it("routes stackables into itemStacks (one entry, summed count)", () => {
        let c = mk();
        c = addItem(c, STACK, 3);
        c = addItem(c, STACK, 2);
        assert.deepEqual(c.inventory, []);
        assert.deepEqual(c.itemStacks, [{ itemId: STACK, count: 5 }]);
        assert.equal(countItem(c, STACK), 5);
    });

    it("routes uniques into the inventory array", () => {
        let c = mk();
        c = addItem(c, GEAR, 1);
        assert.deepEqual(c.inventory, [GEAR]);
        assert.deepEqual(c.itemStacks ?? [], []); // unique add leaves stacks untouched
        assert.equal(countItem(c, GEAR), 1);
    });

    it("addItems mixes both stores", () => {
        const c = addItems(mk(), [GEAR, STACK, STACK, SCROLL]);
        assert.equal(countItem(c, GEAR), 1);
        assert.equal(countItem(c, STACK), 2);
        assert.equal(countItem(c, SCROLL), 1);
        assert.equal(c.inventory!.length, 1); // only the unique
    });
});

describe("inventory — removeItem", () => {
    it("drains the counted stack and deletes a zeroed key", () => {
        let c = addItem(mk(), STACK, 2);
        c = removeItem(c, STACK, 1);
        assert.deepEqual(c.itemStacks, [{ itemId: STACK, count: 1 }]);
        c = removeItem(c, STACK, 5); // remove more than owned
        assert.deepEqual(c.itemStacks, []);
        assert.equal(countItem(c, STACK), 0);
    });

    it("removes a unique from the array", () => {
        let c = mk([GEAR, GEAR]);
        c = removeItem(c, GEAR, 1);
        assert.deepEqual(c.inventory, [GEAR]);
    });

    it("drains a stackable that straddles BOTH stores (mid-migration)", () => {
        // legacy copy in inventory[] + counted copies in itemStacks
        const c = mk([STACK], [{ itemId: STACK, count: 2 }]);
        assert.equal(countItem(c, STACK), 3);
        const after = removeItem(c, STACK, 3);
        assert.equal(countItem(after, STACK), 0);
        assert.deepEqual(after.inventory, []);
        assert.deepEqual(after.itemStacks, []);
    });
});

describe("inventory — counts & display", () => {
    it("ownsItem / totalItemCount span both stores", () => {
        const c = mk([GEAR], [{ itemId: STACK, count: 4 }]);
        assert.equal(ownsItem(c, GEAR), true);
        assert.equal(ownsItem(c, STACK), true);
        assert.equal(ownsItem(c, "nope"), false);
        assert.equal(totalItemCount(c), 5);
    });

    it("unifiedItemStacks merges both stores", () => {
        const c = mk([GEAR, GEAR], [{ itemId: STACK, count: 3 }]);
        const stacks = unifiedItemStacks(c).sort((a, b) => a.itemId.localeCompare(b.itemId));
        assert.deepEqual(stacks, [
            { itemId: GEAR, count: 2 },
            { itemId: STACK, count: 3 },
        ]);
    });
});

describe("inventory — normalizeInventory (migration)", () => {
    it("moves inline stackables out of inventory[] into itemStacks, keeps uniques", () => {
        const legacy = mk([GEAR, STACK, STACK, SCROLL, GEAR]);
        const norm = normalizeInventory(legacy);
        assert.deepEqual(norm.inventory, [GEAR, GEAR]);
        const stacks = (norm.itemStacks ?? []).sort((a, b) => a.itemId.localeCompare(b.itemId));
        assert.deepEqual(stacks, [
            { itemId: SCROLL, count: 1 },
            { itemId: STACK, count: 2 },
        ]);
    });

    it("is idempotent — re-running changes nothing", () => {
        const once = normalizeInventory(mk([GEAR, STACK, STACK]));
        const twice = normalizeInventory(once);
        assert.deepEqual(twice.inventory, once.inventory);
        assert.deepEqual(twice.itemStacks, once.itemStacks);
    });

    it("is lossless — total count preserved", () => {
        const legacy = mk([GEAR, STACK, STACK, STACK, SCROLL]);
        const before = ["thrown-shuriken", "territory-control-scroll", GEAR]
            .reduce((sum, id) => sum + countItem(legacy, id), 0);
        const after = normalizeInventory(legacy);
        const total = ["thrown-shuriken", "territory-control-scroll", GEAR]
            .reduce((sum, id) => sum + countItem(after, id), 0);
        assert.equal(after.inventory!.length + (after.itemStacks ?? []).reduce((s, x) => s + x.count, 0), 5);
        assert.equal(total, before);
    });

    it("merges inline copies with pre-existing itemStacks counts", () => {
        const mixed = mk([STACK], [{ itemId: STACK, count: 2 }]);
        const norm = normalizeInventory(mixed);
        assert.deepEqual(norm.inventory, []);
        assert.deepEqual(norm.itemStacks, [{ itemId: STACK, count: 3 }]);
    });
});

describe("inventory — clamps", () => {
    it("clamps a stack to MAX_ITEM_STACK", () => {
        const c = addItem(mk(), STACK, MAX_ITEM_STACK + 50);
        assert.equal(countItem(c, STACK), MAX_ITEM_STACK);
    });
});
