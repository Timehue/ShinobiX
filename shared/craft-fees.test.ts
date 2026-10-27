import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { applyForge, countOwned } from '../api/craft/_forge.js';
import { SUPPLY_CRAFT_RECIPES } from './crafting-recipes.js';
import { VILLAGE_SUPPLY_GOODS } from './gathering-supplies.js';
import { GEAR_CRAFT_RYO, SUPPLY_CRAFT_RYO, gearCraftRyo, supplyCraftRyo } from './craft-fees.js';

/** A bag holding exactly one batch of a recipe's first-listed materials. */
const stocked = (id: string, quantity: number, ryo: number) => {
    const recipe = SUPPLY_CRAFT_RECIPES[id];
    return {
        level: 100, ryo, inventory: [] as string[],
        itemStacks: recipe.ingredients.map((row) => ({ itemId: row.ids[0], count: row.count * quantity })),
    };
};

describe('crafter ryo fees', () => {
    it('every supply recipe charges a ryo fee', () => {
        for (const id of Object.keys(SUPPLY_CRAFT_RECIPES)) {
            assert.ok(supplyCraftRyo(id) > 0, `${id} crafts for free`);
        }
        for (const id of Object.keys(SUPPLY_CRAFT_RYO)) {
            assert.ok(Object.hasOwn(SUPPLY_CRAFT_RECIPES, id), `${id} has a fee but no recipe`);
            assert.ok(!Object.hasOwn(VILLAGE_SUPPLY_GOODS, id), `${id} would shadow its Village supply fee`);
        }
    });

    it('a shop-sold craft costs about a quarter of buying the same batch', () => {
        for (const [id, recipe] of Object.entries(SUPPLY_CRAFT_RECIPES)) {
            const item = ITEM_CATALOG[id];
            if (!item?.cost || recipe.currency || Object.hasOwn(VILLAGE_SUPPLY_GOODS, id)) continue;
            const batchPrice = item.cost * (recipe.count ?? 1);
            const share = supplyCraftRyo(id) / batchPrice;
            assert.ok(share >= 0.2 && share <= 0.3, `${id}: fee ${supplyCraftRyo(id)} is ${(share * 100).toFixed(1)}% of ${batchPrice}`);
        }
    });

    it('gear fees climb with rarity and sit beside the shelf prices', () => {
        assert.ok(GEAR_CRAFT_RYO.rare < GEAR_CRAFT_RYO.epic && GEAR_CRAFT_RYO.epic < GEAR_CRAFT_RYO.legendary);
        assert.equal(gearCraftRyo('rare'), 24_000);
        assert.equal(gearCraftRyo('epic'), 56_000);
        assert.equal(gearCraftRyo('legendary'), 140_000);
        // The first craftable armor tier costs about what the dearest Reinforced piece does in the shop.
        const reinforcedTop = Math.max(...Object.values(ITEM_CATALOG)
            .filter((i) => i.armorQuality === 'Reinforced' && i.cost && i.saleBasis).map((i) => i.cost as number));
        assert.ok(GEAR_CRAFT_RYO.rare >= reinforcedTop * 0.9 && GEAR_CRAFT_RYO.rare <= reinforcedTop * 1.1, `${GEAR_CRAFT_RYO.rare} vs ${reinforcedTop}`);
    });

    it('the server takes the fee from the bag and refuses a craft the player cannot pay for', () => {
        const fee = supplyCraftRyo('thrown-shuriken');
        assert.equal(fee, 1_200);
        const crafted = applyForge(stocked('thrown-shuriken', 2, fee * 2 + 5), 'supply', 'thrown-shuriken', 2);
        assert.ok(crafted);
        assert.equal(crafted.ryo, 5);
        assert.equal(countOwned(crafted, 'thrown-shuriken'), 6);
        assert.equal(applyForge(stocked('thrown-shuriken', 2, fee * 2 - 1), 'supply', 'thrown-shuriken', 2), null);
    });

    it('charges Village supplies the fee they always had', () => {
        assert.equal(supplyCraftRyo('village-supply-bundle'), 30);
        assert.equal(supplyCraftRyo('village-supply-crate'), 100);
        assert.equal(supplyCraftRyo('not-a-recipe'), 0);
    });
});
