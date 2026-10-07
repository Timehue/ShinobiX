/**
 * Gear step drops (shared/gear-steps.ts) copy their base item's rarity, EP and
 * armor quality, so a forge list that filters on those alone would offer all 55
 * weapon and armor steps as payable recipes. The server refuses them
 * (api/craft/_forge.ts), which would leave a button that only ever errors.
 *
 * This is a source scan, so it also proves the scan still finds the two filters it
 * guards: if CentralHub renames them, the guard fails instead of passing vacuously.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { starterItems } from "../data/starter-items";
import { isStepItemId } from "../../../shared/gear-steps";

const source = readFileSync(new URL("./CentralHub.tsx", import.meta.url), "utf8");

function filterBlock(name: string): string {
    const start = source.indexOf(`const ${name} = `);
    assert.ok(start >= 0, `CentralHub no longer defines ${name}; update this guard`);
    const end = source.indexOf(".sort(", start);
    assert.ok(end > start, `${name} no longer ends in a sort; update this guard`);
    return source.slice(start, end);
}

describe("forge recipe lists exclude gear step drops", () => {
    it("filters craftable weapons and armor by isStepItemId", () => {
        for (const name of ["craftableWeapons", "craftableArmor"]) {
            const block = filterBlock(name);
            assert.match(block, /\.filter\(/, `${name} should still be a filter`);
            assert.match(block, /!isStepItemId\(item\.id\)/, `${name} must exclude gear step drops`);
        }
    });

    it("would otherwise match 55 step items, so the exclusion is doing real work", () => {
        const weapons = starterItems.filter((item) => item.slot === "hand" && item.weaponEp != null
            && ["rare", "epic", "legendary"].includes(item.rarity) && isStepItemId(item.id));
        const armor = starterItems.filter((item) => ["body", "head", "waist", "legs", "feet"].includes(item.slot)
            && item.armorQuality && item.rarity === "rare" && isStepItemId(item.id));
        assert.equal(weapons.length, 40);
        assert.equal(armor.length, 15);
    });
});
