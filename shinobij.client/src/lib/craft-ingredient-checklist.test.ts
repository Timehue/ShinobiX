import test from 'node:test';
import assert from 'node:assert/strict';
import { craftChecklistRows } from './craft-ingredient-checklist';
import { planCraftIngredients } from '../../../shared/crafting-recipes';

const ingredients = [
    { ids: ['sand-a', 'sand-b'], count: 24, label: 'Pristine Iron Sand or better' },
    { ids: ['fiber'], count: 8, label: 'Binding Fiber' },
    { ids: ['shard'], count: 2, label: 'Superior Stormglass Shard or better' },
    { ids: ['bark'], count: 2, label: 'Heartwood Bark or Ember fuel' },
];
const bag: Record<string, number> = { 'sand-b': 0, fiber: 15, shard: 1 };
const owned = (id: string) => bag[id] ?? 0;

test('rows put missing first, then partial, then ready, keeping recipe order within each', () => {
    const rows = craftChecklistRows(ingredients, owned);
    assert.deepEqual(rows.map(row => [row.label, row.state]), [
        ['Pristine Iron Sand or better', 'missing'],
        ['Heartwood Bark or Ember fuel', 'missing'],
        ['Superior Stormglass Shard or better', 'partial'],
        ['Binding Fiber', 'done'],
    ]);
});

test('a full row caps at the need and reports the surplus separately', () => {
    const fiber = craftChecklistRows(ingredients, owned).find(row => row.label === 'Binding Fiber');
    assert.deepEqual(fiber && { have: fiber.have, need: fiber.need, extra: fiber.extra }, { have: 8, need: 8, extra: 7 });
});

test('the grade note moves off the name; other "or" labels stay whole', () => {
    const rows = craftChecklistRows(ingredients, owned);
    const sand = rows.find(row => row.label.startsWith('Pristine'));
    const bark = rows.find(row => row.label.startsWith('Heartwood'));
    assert.equal(sand?.name, 'Pristine Iron Sand');
    assert.equal(sand?.orBetter, true);
    assert.equal(bark?.name, 'Heartwood Bark or Ember fuel');
    assert.equal(bark?.orBetter, false);
});

test('a material two rows accept counts once, matching the forge planner', () => {
    const shared = [
        { ids: ['ember-ore'], count: 2, label: 'Ember Ore' },
        { ids: ['bark', 'ember-ore'], count: 2, label: 'Heartwood Bark or Ember fuel' },
    ];
    const stock = (id: string) => (id === 'ember-ore' ? 3 : 0);
    const rows = craftChecklistRows(shared, stock);
    assert.deepEqual(rows.map(row => [row.label, row.have, row.state]), [
        ['Heartwood Bark or Ember fuel', 1, 'partial'],
        ['Ember Ore', 2, 'done'],
    ]);
    assert.equal(planCraftIngredients(shared, stock), null);
});

test('every row ready exactly when the forge planner can reserve the batch', () => {
    const cases: Array<Record<string, number>> = [{}, bag, { 'sand-a': 24, fiber: 8, shard: 2, bark: 2 }, { 'sand-a': 10, 'sand-b': 14, fiber: 8, shard: 2, bark: 2 }];
    for (const stock of cases) {
        const own = (id: string) => stock[id] ?? 0;
        assert.equal(craftChecklistRows(ingredients, own).every(row => row.state === 'done'), planCraftIngredients(ingredients, own) !== null, JSON.stringify(stock));
    }
});

test('batch quantity scales the need and sums every accepted material', () => {
    const [sand] = craftChecklistRows([ingredients[0]], id => (id === 'sand-a' ? 20 : 30), 2);
    assert.deepEqual({ have: sand.have, need: sand.need, extra: sand.extra, state: sand.state }, { have: 48, need: 48, extra: 2, state: 'done' });
});
