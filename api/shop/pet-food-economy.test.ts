import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { purchaseCatalogItem } from './_purchase.js';
import { applyItemPurchase, isPurchasableItem } from './_settlement.js';
import { applyForge, countOwned } from '../craft/_forge.js';
import { rollAncientChestLoot, applyAncientChestLoot } from '../world/_chest.js';
import { SUPPLY_CRAFT_RECIPES } from '../../shared/crafting-recipes.js';

const buyer = () => ({ level: 100, ryo: 100000, fateShards: 1000, inventory: ['keepsake', 'pet-treat'], itemStacks: [{ itemId: 'pet-treat', count: 4 }] });
test('ordinary and premium food prices and batch buys stack without weakening unique gear', () => {
    assert.equal(ITEM_CATALOG['pet-treat'].cost, 400);
    assert.equal(ITEM_CATALOG['golden-apple'].cost, 40);
    for (const id of ['pet-treat','golden-apple']) {
        const direct = purchaseCatalogItem(buyer(), id, 20); assert.ok(direct.ok);
        assert.equal(direct.item.qty, 20); assert.equal(countOwned(direct.character, id), id === 'pet-treat' ? 25 : 20);
        const item = { ...ITEM_CATALOG[id], cost: ITEM_CATALOG[id].cost ?? 0 };
        const settled = applyItemPurchase(buyer(), item, 20, 'pet-food-order-0001', 1000); assert.ok(settled.ok);
        assert.equal(countOwned(settled.character, id), id === 'pet-treat' ? 25 : 20);
        const again = applyItemPurchase(settled.character, item, 20, 'pet-food-order-0001', 1001); assert.ok(again.ok); assert.equal(again.replayed, true);
    }
    assert.equal(purchaseCatalogItem({ ...buyer(), inventory: ['shinobi-vest'] }, 'shinobi-vest', 5).ok, false);
});
test('both purchase authorities reject crafted food even with a stale positive catalog price', () => {
    for (const id of ['elemental-pet-treat','ancient-pet-treat']) {
        const before = buyer();
        assert.equal(purchaseCatalogItem(before, id, 1).ok, false);
        const stale = { ...ITEM_CATALOG[id], cost: 100 };
        assert.equal(isPurchasableItem(stale), false);
        assert.equal(applyItemPurchase(before, stale, 1, 'pet-food-order-0002', 1000).ok, false);
        assert.deepEqual(before, buyer());
    }
});
test('batch crafting consumes actual repeatable materials and adds to existing stacks', () => {
    for (const id of ['pet-treat','elemental-pet-treat','ancient-pet-treat']) {
        const recipe = SUPPLY_CRAFT_RECIPES[id];
        const itemStacks = recipe.ingredients.map(row => ({ itemId: row.ids[0], count: row.count * 2 }));
        const input = { level: 100, ryo: 100000, inventory: ['keepsake'], itemStacks: [...itemStacks, { itemId: id, count: 3 }] };
        const out = applyForge(input, 'supply', id, 2); assert.ok(out, id);
        assert.equal(countOwned(out, id), 5); assert.deepEqual(out.inventory, ['keepsake']);
        for (const row of recipe.ingredients) assert.equal(countOwned(out, row.ids[0]), 0);
        assert.equal(applyForge({ ...input, itemStacks: [] }, 'supply', id, 2), null);
    }
});
test('new chest rolls only grant ordinary food and repeated rewards use counted stacks', () => {
    for (const draw of [0, .25, .5, .75, .999]) {
        const sequence = [.9, .10, draw, .9];
        const loot = rollAncientChestLoot(1, () => sequence.shift() ?? .9)!;
        assert.equal(loot.itemId, 'pet-treat');
    }
    const once = applyAncientChestLoot(buyer(), { xp: 0, itemId: 'pet-treat' });
    const twice = applyAncientChestLoot(once, { xp: 0, itemId: 'pet-treat' });
    assert.equal(countOwned(twice, 'pet-treat'), 7);
    assert.deepEqual(twice.inventory, buyer().inventory);
});
