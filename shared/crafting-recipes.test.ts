import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { SUPPLY_CRAFT_RECIPES, gearCraftIngredients, planCraftIngredients, planSelectedCraftIngredients, craftMaterialName } from './crafting-recipes.js';
import { COOK_RECIPES } from './cooking-recipes.js';
import { RESOURCE_ITEMS } from './resource-items.js';
import { builtinHuntMissions } from '../shinobij.client/src/data/missions.js';
import { effectiveItemLevelReq } from './item-level-gate.js';

test('every recipe ingredient exists and has a player-facing name', () => {
    const available = new Set([...Object.keys(ITEM_CATALOG), ...RESOURCE_ITEMS.map(item => item.id)]);
    const recipes = [...Object.entries(SUPPLY_CRAFT_RECIPES).map(([id, recipe]) => ({ id, ingredients: recipe.ingredients })),
        ...Object.values(ITEM_CATALOG).filter(item => !/-s\d+$/.test(item.id)).map(item => ({ id: item.id, ingredients: gearCraftIngredients(item) }))];
    for (const recipe of recipes) for (const ingredient of recipe.ingredients) {
        assert.ok(Number.isInteger(ingredient.count) && ingredient.count > 0, recipe.id);
        assert.ok(ingredient.ids.length, recipe.id);
        for (const id of ingredient.ids) {
            assert.ok(available.has(id), `${recipe.id}: missing ${id}`);
            assert.notEqual(id, recipe.id, `${recipe.id}: self dependency`);
            assert.doesNotMatch(craftMaterialName(id), /^(hunt-|gather-|pet-)/, id);
        }
    }
});
test('cooking consumes only meat or fish, with herbs as seasoning', () => {
    const food = new Set(['hunt-beast-meat', ...RESOURCE_ITEMS.filter(item => item.activity === 'fishing').map(item => item.id)]);
    for (const recipe of COOK_RECIPES) for (const id of recipe.materials) assert.ok(food.has(id), `${recipe.id} cannot cook ${id}`);
});
test('crafted recipes combine at least two distinct materials and most use three or more', () => {
    const recipes = [
        ...Object.values(SUPPLY_CRAFT_RECIPES).map(recipe => recipe.ingredients),
        ...Object.values(ITEM_CATALOG).filter(item => !/-s\d+$/.test(item.id)).map(gearCraftIngredients).filter(ingredients => ingredients.length),
    ];
    for (const ingredients of recipes) {
        assert.ok(ingredients.length >= 2, 'a crafted item needs co-materials');
        for (let i = 0; i < ingredients.length; i++) for (let j = i + 1; j < ingredients.length; j++) {
            assert.ok(!ingredients[i].ids.some(id => ingredients[j].ids.includes(id)), 'different grades of one material do not count as separate ingredients');
        }
    }
    assert.ok(recipes.filter(ingredients => ingredients.length >= 3).length / recipes.length >= 0.9, 'at least 90% of crafted recipes use three or more materials');
    for (const recipe of COOK_RECIPES) {
        assert.ok(recipe.materials.length && recipe.herbs > 0 && recipe.fuel > 0, `${recipe.id}: food, seasoning and fuel`);
    }
});
test('alternatives combine stock and overlapping requirements cannot double spend it', () => {
    const requirements = [{ ids: ['a', 'b'], count: 3, label: 'A or B' }, { ids: ['b'], count: 2, label: 'B' }];
    const stock: Record<string, number> = { a: 2, b: 3 };
    assert.deepEqual(planCraftIngredients(requirements, id => stock[id]), { a: 2, b: 3 });
    assert.equal(planCraftIngredients(requirements, id => id === 'b' ? 4 : 0), null);
    assert.equal(planCraftIngredients(requirements, id => stock[id], 2), null);
});
test('explicit selections mix eligible materials, reserve the full batch and never substitute stock', () => {
    const rows = [{ ids: ['fine', 'superior', 'pristine'], count: 6, label: 'Ore' }, { ids: ['fiber'], count: 2, label: 'Binding' }];
    const stock: Record<string, number> = { fine: 10, superior: 5, pristine: 20, fiber: 4 };
    assert.deepEqual(planSelectedCraftIngredients(rows, id => stock[id], 1, [{ fine: 4, superior: 2 }, { fiber: 2 }]), { fine: 4, superior: 2, fiber: 2 });
    assert.equal(planSelectedCraftIngredients(rows, id => stock[id], 2, [{ fine: 4, superior: 2 }, { fiber: 2 }]), null, 'a batch needs scaled quantities');
    assert.equal(planSelectedCraftIngredients(rows, id => id === 'fine' ? 3 : stock[id], 1, [{ fine: 4, superior: 2 }, { fiber: 2 }]), null, 'Pristine stock cannot replace missing selected Fine ore');
    for (const selection of [undefined, null, [], {}, [null, { fiber: 2 }], [{ common: 6 }, { fiber: 2 }], [{ fine: 7 }, { fiber: 2 }], [{ fine: -1, superior: 7 }, { fiber: 2 }], [{ fine: 5.5, superior: .5 }, { fiber: 2 }], [{ fine: '6' }, { fiber: 2 }]]) {
        assert.equal(planSelectedCraftIngredients(rows, id => stock[id], 1, selection), null, JSON.stringify(selection));
    }
    const overlapping = [{ ids: ['a', 'b'], count: 3, label: 'A or B' }, { ids: ['b'], count: 2, label: 'B' }];
    assert.equal(planSelectedCraftIngredients(overlapping, () => 4, 1, [{ b: 3 }, { b: 2 }]), null, 'shared stock cannot be spent twice');
});
test('regional legendary blades need their own catalyst and a relic; food cannot supply weapons', () => {
    for (const [id, catalyst] of [['frostfang-oathblade', 'gather-rime-crystal-superior'], ['embercoil-scythe', 'gather-ember-ore-superior'], ['tempest-fang-blade', 'gather-stormglass-shard-superior']]) {
        const ingredients = gearCraftIngredients(ITEM_CATALOG[id]);
        assert.ok(ingredients.some(ingredient => ingredient.ids.includes(catalyst)), id);
        assert.ok(ingredients.some(ingredient => ingredient.ids.includes('warforged-relic')), id);
        assert.equal(planCraftIngredients(ingredients, item => item === 'hunt-beast-meat' ? 1_000_000 : 0), null);
    }
});
test('weapon recipes and the level-30 seal do not require hunting drops from later character levels', () => {
    const huntLevel = (id: string) => Math.min(...builtinHuntMissions.filter(mission => mission.itemRewards?.includes(id)).map(mission => mission.levelReq ?? 1));
    const check = (id: string, level: number, ingredients: ReturnType<typeof gearCraftIngredients>) => {
        for (const ingredient of ingredients) assert.ok(ingredient.ids.some(material => !material.startsWith('hunt-') || huntLevel(material) <= level), `${id}: ${ingredient.label} is locked beyond level ${level}`);
    };
    for (const item of Object.values(ITEM_CATALOG).filter(item => item.slot === 'hand' && item.weaponEp != null && !/-s\d+$/.test(item.id))) {
        check(item.id, effectiveItemLevelReq(item), gearCraftIngredients(item));
    }
    check('beast-seal-master', 30, [...SUPPLY_CRAFT_RECIPES['beast-seal-master'].ingredients]);
});
