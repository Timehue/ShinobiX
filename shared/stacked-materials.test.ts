import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { CRAFT_POINTS } from '../api/craft/_forge.js';
import { stackableItemIds } from '../api/_pet-sim/pet-config.js';
import {
    ITEM_STACK_KEY_CAP, ITEM_STACK_MAX, STACKED_MATERIAL_IDS, WEEKLY_BOSS_CORE_ID,
    foldStackedMaterials, grantItemIds, heldUnits, isStackedMaterialId,
} from './stacked-materials.js';

const copies = (id: string, n: number) => Array.from({ length: n }, () => id);

describe('stacked materials (owner ruling A12)', () => {
    it('covers every hunt material in the catalog and the Weekly Boss Core, and nothing else', () => {
        const hunt = Object.keys(ITEM_CATALOG).filter((id) => id.startsWith('hunt-'));
        assert.equal(hunt.length, 14);
        assert.deepEqual([...STACKED_MATERIAL_IDS].sort(), [...hunt, WEEKLY_BOSS_CORE_ID].sort());
        for (const id of STACKED_MATERIAL_IDS) assert.ok(CRAFT_POINTS[id] > 0, `${id} keeps its Village Stores value`);
        assert.equal(isStackedMaterialId('rustfang-kunai'), false);
        assert.equal(isStackedMaterialId(undefined), false);
    });

    it('is part of the shared stackable set, which stays under the save validator\'s stack-key cap', () => {
        for (const id of STACKED_MATERIAL_IDS) assert.ok(stackableItemIds.has(id), id);
        // The save sanitizer keeps at most ITEM_STACK_KEY_CAP distinct stacks, so a
        // legitimate save holding one of every stackable id must fit under it.
        assert.ok(stackableItemIds.size < ITEM_STACK_KEY_CAP, `${stackableItemIds.size} stackable ids`);
    });

    it('folds inventory[] copies into stacks with exact counts and leaves everything else in order', () => {
        const before = {
            inventory: ['a-blade', ...copies('hunt-torn-hide', 4), 'b-vest', 'weekly-boss-core', ...copies('hunt-torn-hide', 2)],
            itemStacks: [{ itemId: 'gather-iron-sand', count: 9 }, { itemId: 'hunt-torn-hide', count: 3 }],
        };
        const after = foldStackedMaterials(before);
        assert.deepEqual(after.inventory, ['a-blade', 'b-vest']);
        assert.deepEqual(after.itemStacks, [
            { itemId: 'gather-iron-sand', count: 9 }, { itemId: 'hunt-torn-hide', count: 9 }, { itemId: 'weekly-boss-core', count: 1 },
        ]);
        for (const id of ['hunt-torn-hide', 'weekly-boss-core', 'gather-iron-sand', 'a-blade']) assert.equal(heldUnits(after, id), heldUnits(before, id), id);
        assert.equal(before.inventory.length, 9, 'the input is not mutated');
    });

    it('is idempotent and returns the same object when nothing moves', () => {
        const once = foldStackedMaterials({ inventory: [...copies('hunt-wolf-fang', 5), 'x'], itemStacks: [] });
        assert.equal(foldStackedMaterials(once), once);
        const clean = { inventory: ['x'], itemStacks: [{ itemId: 'hunt-wolf-fang', count: 2 }] };
        assert.equal(foldStackedMaterials(clean), clean);
    });

    it('never drops a unit: a full stack or no free stack key leaves the copy in inventory[]', () => {
        const full = foldStackedMaterials({ inventory: copies('hunt-ash-scale', 4), itemStacks: [{ itemId: 'hunt-ash-scale', count: ITEM_STACK_MAX - 1 }] });
        assert.deepEqual(full.itemStacks, [{ itemId: 'hunt-ash-scale', count: ITEM_STACK_MAX }]);
        assert.deepEqual(full.inventory, copies('hunt-ash-scale', 3));
        assert.equal(heldUnits(full, 'hunt-ash-scale'), ITEM_STACK_MAX + 3);

        const keys = Array.from({ length: ITEM_STACK_KEY_CAP }, (_, i) => ({ itemId: `stack-${i}`, count: 1 }));
        const noKey = foldStackedMaterials({ inventory: ['hunt-titan-bone'], itemStacks: keys });
        assert.deepEqual(noKey.inventory, ['hunt-titan-bone']);
        assert.equal(noKey.itemStacks.length, ITEM_STACK_KEY_CAP);
    });

    it('leaves a malformed store untouched rather than guess', () => {
        const odd = { inventory: ['hunt-titan-bone'], itemStacks: { 'hunt-titan-bone': 3 } };
        assert.equal(foldStackedMaterials(odd), odd);
        const noInventory = { itemStacks: [] };
        assert.equal(foldStackedMaterials(noInventory), noInventory);
    });

    it('grantItemIds stacks materials, appends unique items, folds legacy copies and drops blanks', () => {
        const granted = grantItemIds({ inventory: ['hunt-shadow-pelt', 'old-gear'], itemStacks: [{ itemId: 'hunt-shadow-pelt', count: 1 }] },
            ['hunt-shadow-pelt', 'weekly-boss-core', 'new-gear', '', 7 as unknown as string]);
        assert.deepEqual(granted.inventory, ['old-gear', 'new-gear']);
        assert.deepEqual(granted.itemStacks, [{ itemId: 'hunt-shadow-pelt', count: 3 }, { itemId: 'weekly-boss-core', count: 1 }]);
        assert.deepEqual(grantItemIds({}, ['hunt-beast-meat']), { inventory: [], itemStacks: [{ itemId: 'hunt-beast-meat', count: 1 }] });
        const untouched = { level: 3 };
        assert.equal(grantItemIds(untouched, []), untouched);
    });
});
