import assert from 'node:assert/strict';
import test from 'node:test';
import { CRAFT_MATERIAL_NAMES } from './crafting-recipes.js';
import { RESOURCE_ITEMS } from './resource-items.js';
import { PET_EXPEDITION_MATERIAL_GRADE_WEIGHTS, rollPetExpeditionMaterials, petExpeditionReturnMaterials, readPetExpeditionMaterials } from './pet-expedition-materials.js';

const total = (haul: { count: number }[]) => haul.reduce((sum, reward) => sum + reward.count, 0);
const routes = ['scout', 'forage', 'ruins'] as const;
function seededRandom(seed: number) {
    return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x1_0000_0000);
}

test('all routes draw existing items from all four activities with exact 3/6/12 base hauls', () => {
    for (const [index, route] of routes.entries()) {
        const random = seededRandom(731);
        const found = new Set<string>();
        for (let run = 0; run < 1000; run++) {
            const rewards = rollPetExpeditionMaterials(route, 'forest', 1, random);
            assert.equal(total(rewards), [3, 6, 12][index]);
            for (const reward of rewards) {
                assert.ok(CRAFT_MATERIAL_NAMES[reward.itemId], `${reward.itemId} must exist in the crafting catalog`);
                found.add(reward.itemId);
            }
        }
        assert.ok([...found].some(id => id.startsWith('hunt-')));
        assert.ok([...found].some(id => id.startsWith('gather-river-fish')));
        assert.ok([...found].some(id => id.startsWith('gather-iron-sand')));
        assert.ok(found.has('gather-field-herb'));
        assert.ok(found.has('gather-heartwood-bark'));
    }
});

test('higher routes improve every quality threshold and actual fish rolls match configured odds', () => {
    let previous = [0, 0, 0];
    for (const route of routes) {
        const weights = PET_EXPEDITION_MATERIAL_GRADE_WEIGHTS[route];
        assert.equal(weights.reduce((sum, weight) => sum + weight, 0), 100);
        const thresholds = [100 - weights[0], weights[2] + weights[3], weights[3]];
        thresholds.forEach((chance, index) => assert.ok(chance >= previous[index]));
        previous = thresholds;
        const grades = [0, 0, 0, 0];
        for (let draw = 0; draw < 100; draw++) {
            let calls = 0;
            const haul = rollPetExpeditionMaterials(route, 'unknown', 1, () => ++calls === 1 ? 0 : calls % 2 === 0 ? 0.3 : (draw + 0.5) / 100);
            const item = RESOURCE_ITEMS.find(item => item.id === haul[0].itemId)!;
            assert.equal(item.activity, 'fishing');
            grades[item.grade]++;
        }
        assert.deepEqual(grades, [...weights]);
    }
});

test('fractional bonuses round the whole haul without losing small stacks', () => {
    assert.deepEqual(rollPetExpeditionMaterials('scout', 'forest', 0, () => 0), []);
    assert.equal(total(rollPetExpeditionMaterials('scout', 'forest', 1.5, () => 0.1)), 5);
    assert.equal(total(rollPetExpeditionMaterials('scout', 'forest', 1.5, () => 0.9)), 4);
    assert.equal(total(rollPetExpeditionMaterials('forage', 'forest', 1.5, () => 0.9)), 9);
    assert.equal(total(rollPetExpeditionMaterials('ruins', 'forest', 1.5, () => 0.9)), 18);
    assert.equal(total(rollPetExpeditionMaterials('ruins', 'forest', 100, () => 0)), 48);
});

test('return choices preserve total quantities and recovery retains a large mixed, graded haul', () => {
    const haul = RESOURCE_ITEMS.slice(0, 12).map(item => ({ itemId: item.id, count: 1 }));
    assert.deepEqual(readPetExpeditionMaterials(haul), haul, 'more than three unique stacks must survive cache recovery');
    for (const multiplier of [1, 1.25, 0.6]) {
        const returned = petExpeditionReturnMaterials(haul, multiplier);
        assert.equal(total(returned), Math.floor(12 * multiplier));
        assert.ok(returned.every(reward => haul.some(original => original.itemId === reward.itemId)));
    }
    assert.deepEqual(petExpeditionReturnMaterials(haul, 1), haul);
    assert.deepEqual(readPetExpeditionMaterials(undefined), []);
    assert.deepEqual(readPetExpeditionMaterials([
        { itemId: 'unknown-material', count: 1 }, { itemId: 'gather-iron-sand', count: Infinity },
        { itemId: 'gather-river-fish', count: -1 }, { itemId: 'gather-field-herb', count: 1.5 },
    ]), []);
});
