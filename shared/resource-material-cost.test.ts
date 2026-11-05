import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPLY_CRAFT_RECIPES, gearCraftIngredients } from './crafting-recipes.js';
import { resourceForgeRequirement } from './resource-forging.js';
import { COOK_RECIPES } from './cooking-recipes.js';
import { GATHER_RECIPE_INGREDIENTS } from './gathering-materials.js';
import { BUILDING_REPAIR_INGREDIENTS } from './sector-building-content.js';
import { namedForgeIngredients } from './named-forge-materials.js';

test('ore costs increase exactly once while grades, co-materials and relic requirements stay intact', () => {
    for (const [rarity, count] of [['rare', 15], ['epic', 27], ['legendary', 36]] as const) {
        const item = { id: 'test-blade', slot: 'hand', rarity, weaponEp: 1 };
        assert.equal(resourceForgeRequirement(item)!.count, count);
        const rows = gearCraftIngredients(item);
        assert.equal(rows[0].count, count);
        assert.equal(rows[1].count, 3, 'mixed mineral fuel row increases once');
        assert.equal(rows[2].count, (rarity === 'rare' ? 2 : rarity === 'epic' ? 3 : 4) * 2, 'fiber stays unchanged');
        if (rarity === 'legendary') assert.equal(rows.at(-1)!.count, 1, 'relic row is unchanged');
        if (rarity === 'epic') assert.equal(rows.at(-1)!.count, 2, 'mineral/core substitute row increases as a whole');
    }
    assert.equal(resourceForgeRequirement({ slot: 'body', rarity: 'rare', armorQuality: 'fine' })!.count, 21);
    assert.equal(resourceForgeRequirement({ slot: 'legs', rarity: 'rare', armorQuality: 'fine' })!.count, 15);
    assert.equal(resourceForgeRequirement({ slot: 'head', rarity: 'rare', armorQuality: 'fine' })!.count, 12);
    assert.deepEqual(namedForgeIngredients('weapon').map(row => row.count), [30, 2, 1, 1, 3, 1]);
    assert.deepEqual(namedForgeIngredients('armor').map(row => row.count), [24, 2, 4, 1, 3, 1]);
});

test('supplies, cooking and repairs share rounded material costs without increasing outputs or unrelated inputs', () => {
    const bundle = SUPPLY_CRAFT_RECIPES['village-supply-bundle'].ingredients;
    assert.deepEqual(bundle.map(row => row.count), [5, 3, 3, 5]);
    assert.equal(GATHER_RECIPE_INGREDIENTS['village-supply-bundle']['gather-iron-sand'], 5);
    assert.equal(GATHER_RECIPE_INGREDIENTS['village-supply-crate']['gather-iron-sand'], 15);
    assert.deepEqual(SUPPLY_CRAFT_RECIPES['pet-treat'].ingredients.map(row => row.count), [6, 2]);
    assert.deepEqual(SUPPLY_CRAFT_RECIPES['currency:aura-dust'].ingredients.map(row => row.count), [3, 4, 2]);
    assert.equal(SUPPLY_CRAFT_RECIPES['currency:aura-dust'].amount, 50);
    assert.equal(SUPPLY_CRAFT_RECIPES['thrown-shuriken'].count, 3);
    assert.deepEqual(BUILDING_REPAIR_INGREDIENTS.map(row => row.count), [5, 2, 3, 4]);
    for (const [index, recipe] of COOK_RECIPES.filter(row => row.id.startsWith('fish-rations')).entries()) {
        assert.equal(recipe.materialCount, 8);
        assert.equal(recipe.fuel, 2);
        assert.equal(recipe.herbs, 1);
        assert.equal(recipe.ryo, 30);
        assert.equal(recipe.rations, (index + 1) * 5);
    }
});
