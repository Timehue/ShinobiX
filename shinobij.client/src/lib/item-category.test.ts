import { test } from "node:test";
import assert from "node:assert/strict";

import { itemCategory, rarityWeight, ITEM_CATEGORY_ORDER } from "./item-category";
import { starterItems } from "../data/starter-items";
import type { GameItem } from "../types/combat";

function byId(id: string): GameItem {
    const item = starterItems.find((candidate) => candidate.id === id);
    assert.ok(item, `expected starter item "${id}" to exist`);
    return item;
}

test("spend/access/loot tokens classify as event", () => {
    for (const id of [
        "territory-control-scroll", // spend to claim sectors
        "dungeon-key",              // spend to enter a dungeon
        "hollow-gate-key",          // spend to enter the shrine
        "legendary-war-crate",      // open for loot
    ]) {
        assert.equal(itemCategory(id, byId(id)), "event", id);
    }
});

test("forging relics classify as material, not event", () => {
    // Boss/war/dungeon drops that are CONSUMED at the Crafter to forge weapons
    // belong with the other crafting materials, despite their event origin.
    for (const id of [
        "weekly-boss-core",
        "warforged-relic",
        "dungeon-legendary-relic",
        "dungeon-legendary-fragment",
        "veil-of-the-hollow",
    ]) {
        assert.equal(itemCategory(id, byId(id)), "material", id);
    }
});

test("pet treats, collars, gear, consumables, and evo stones classify as pet", () => {
    assert.equal(itemCategory("pet-treat", byId("pet-treat")), "pet");
    assert.equal(itemCategory("ancient-pet-treat", byId("ancient-pet-treat")), "pet");
    assert.equal(itemCategory("golden-apple", byId("golden-apple")), "pet");
    assert.equal(itemCategory("evo-stone-awakening", byId("evo-stone-awakening")), "pet");
    assert.equal(itemCategory("collar-crimson", byId("collar-crimson")), "pet");
    assert.equal(itemCategory("pvp-spiked-war-harness", byId("pvp-spiked-war-harness")), "pet");
    assert.equal(itemCategory("pve-frenzy-claw", byId("pve-frenzy-claw")), "pet");
    assert.equal(itemCategory("consum-phantom-charm", byId("consum-phantom-charm")), "pet");
});

test("hunting drops and generic materials classify as material", () => {
    assert.equal(itemCategory("hunt-beast-meat", byId("hunt-beast-meat")), "material");
    assert.equal(itemCategory("hunt-legendary-material", byId("hunt-legendary-material")), "material");
});

test("potions, combat pills, and legacy string pills classify as consumable", () => {
    assert.equal(itemCategory("potion-rejuvenation", byId("potion-rejuvenation")), "consumable");
    assert.equal(itemCategory("item-attack-pill", byId("item-attack-pill")), "consumable");
    assert.equal(itemCategory("item-smoke-bomb", byId("item-smoke-bomb")), "consumable");
    // Legacy pills live as bare strings with no catalog entry.
    assert.equal(itemCategory("Soldier Pill"), "consumable");
    assert.equal(itemCategory("Chakra Pill"), "consumable");
});

test("weapons, armor, accessories, and throwables classify as gear", () => {
    assert.equal(itemCategory("rustfang-kunai", byId("rustfang-kunai")), "gear");
    assert.equal(itemCategory("iron-kabuto", byId("iron-kabuto")), "gear");
    assert.equal(itemCategory("chakra-ring", byId("chakra-ring")), "gear");        // aura
    assert.equal(itemCategory("thrown-shuriken", byId("thrown-shuriken")), "gear"); // thrown
    assert.equal(itemCategory("legendary-gloves", byId("legendary-gloves")), "gear");
});

test("uncatalogued named weapons fall back to gear", () => {
    assert.equal(itemCategory("named-weapon-abc123"), "gear");
});

test("every starter item maps to a known category (classifier is total)", () => {
    const known = new Set<string>(ITEM_CATEGORY_ORDER);
    for (const item of starterItems) {
        assert.ok(known.has(itemCategory(item.id, item)), `${item.id} produced an unknown category`);
    }
});

test("rarityWeight orders rarest first and sinks unknowns", () => {
    assert.ok(rarityWeight("mythic") > rarityWeight("legendary"));
    assert.ok(rarityWeight("legendary") > rarityWeight("rare"));
    assert.ok(rarityWeight("rare") > rarityWeight("common"));
    assert.equal(rarityWeight(undefined), 0);
    assert.equal(rarityWeight("nonsense"), 0);
});
