import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { SUPPLY_CRAFT_RECIPES, gearCraftIngredients, planCraftIngredients, planSelectedCraftIngredients, craftMaterialName, craftedSaleCapRyo } from './crafting-recipes.js';
import { COOK_RECIPES, FUEL_IDS } from './cooking-recipes.js';
import { namedForgeIngredients } from './named-forge-materials.js';
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

// ── 2026-10 rebalance, item-use pass: substitutions ────────────────────────
// Each substitute is accepted 1:1 and sits LAST in its row, so the planner
// still spends the original material first and no craft costs more than before.
const rowWith = (ingredients: readonly { ids: readonly string[] }[], id: string) => ingredients.find(row => row.ids.includes(id));
const stock = (counts: Record<string, number>) => (id: string) => counts[id] ?? 0;

test('Ember Ore and Ember Scale fuel the forge 1:1 after Heartwood Bark; the Elderbranch keeps exact bark', () => {
    assert.deepEqual([...FUEL_IDS], ['gather-heartwood-bark', 'gather-ember-ore', 'hunt-ember-scale']);
    const shuriken = SUPPLY_CRAFT_RECIPES['thrown-shuriken'].ingredients;
    assert.deepEqual(rowWith(shuriken, 'gather-heartwood-bark')?.ids, [...FUEL_IDS]);
    assert.deepEqual(rowWith(SUPPLY_CRAFT_RECIPES['thrown-senbon'].ingredients, 'gather-heartwood-bark')?.ids, [...FUEL_IDS]);
    const base = { 'gather-iron-sand': 6, 'gather-binding-fiber': 2 };
    assert.deepEqual(planCraftIngredients(shuriken, stock({ ...base, 'gather-ember-ore': 1 })), { ...base, 'gather-ember-ore': 1 });
    assert.deepEqual(planCraftIngredients(shuriken, stock({ ...base, 'hunt-ember-scale': 1 })), { ...base, 'hunt-ember-scale': 1 });
    assert.deepEqual(planCraftIngredients(shuriken, stock({ ...base, 'gather-heartwood-bark': 1, 'gather-ember-ore': 5 })), { ...base, 'gather-heartwood-bark': 1 }, 'bark is spent first');
    for (const id of ['ashen-leaf-saber', 'ashglass-katana', 'black-lotus-dagger']) {
        const fuel = rowWith(gearCraftIngredients(ITEM_CATALOG[id]), 'gather-heartwood-bark');
        assert.deepEqual(fuel?.ids, [...FUEL_IDS], id);
        assert.equal(fuel?.count, 2, id);
    }
    const elder = rowWith(gearCraftIngredients(ITEM_CATALOG['elderbranch-katana']), 'gather-heartwood-bark');
    assert.deepEqual(elder, { ids: ['gather-heartwood-bark'], count: 4, label: 'Heartwood Bark' });
    // Bark-only rows that are not fuel (pills, potions, smoke) are unchanged.
    for (const id of ['item-smoke-bomb', 'item-attack-pill', 'potion-rejuvenation', 'consum-smoke-pellet']) {
        assert.deepEqual(rowWith(SUPPLY_CRAFT_RECIPES[id].ingredients, 'gather-heartwood-bark')?.ids, ['gather-heartwood-bark'], id);
    }
});

test('every River Fish grade makes Treats, Beast Meat first', () => {
    const row = SUPPLY_CRAFT_RECIPES['pet-treat'].ingredients[0];
    assert.deepEqual(row.ids, ['hunt-beast-meat', 'gather-river-fish', 'gather-river-fish-fine', 'gather-river-fish-superior', 'gather-river-fish-pristine']);
    assert.equal(row.count, 4);
    assert.deepEqual(planCraftIngredients(SUPPLY_CRAFT_RECIPES['pet-treat'].ingredients, stock({ 'gather-river-fish-pristine': 4, 'gather-field-herb': 2 })),
        { 'gather-river-fish-pristine': 4, 'gather-field-herb': 2 });
});

test('Shadow Pelt stands in for Shadow Thread in the seal, totem, charm and serpent dust; the Black Lotus keeps exact thread', () => {
    for (const [id, count] of [['beast-seal-master', 4], ['pve-bloodbond-totem', 2], ['consum-phantom-charm', 1], ['thrown-serpent-dust', 1]] as const) {
        const row = rowWith(SUPPLY_CRAFT_RECIPES[id].ingredients, 'gather-shadow-thread');
        assert.deepEqual(row?.ids, ['gather-shadow-thread', 'hunt-shadow-pelt'], id);
        assert.equal(row?.count, count, id);
    }
    const seal = SUPPLY_CRAFT_RECIPES['beast-seal-master'].ingredients;
    const sealStock = { 'gather-stormglass-shard-fine': 4, 'gather-heartwood-bark': 4, 'gather-binding-fiber': 8 };
    assert.deepEqual(planCraftIngredients(seal, stock({ ...sealStock, 'hunt-shadow-pelt': 4 })), { ...sealStock, 'hunt-shadow-pelt': 4 },
        'a hunter can bind with pelts alone, so the seal really is "forged from rare hunt materials"');
    const lotus = rowWith(gearCraftIngredients(ITEM_CATALOG['black-lotus-dagger']), 'gather-shadow-thread');
    assert.deepEqual(lotus?.ids, ['gather-shadow-thread']);
});

test('Ancient Beast Core, Titan Bone and Legendary Material share one S-rank trophy row in the repeatable pet recipes', () => {
    for (const [id, count, first] of [['pve-sanguine-charm', 2, 'hunt-ancient-beast-core'], ['pve-bloodbond-totem', 3, 'hunt-ancient-beast-core'],
        ['consum-second-wind', 1, 'hunt-ancient-beast-core'], ['pve-apex-predator-fang', 4, 'hunt-titan-bone']] as const) {
        const row = rowWith(SUPPLY_CRAFT_RECIPES[id].ingredients, 'hunt-legendary-material');
        assert.ok(row, id);
        assert.equal(row.ids[0], first, `${id}: its original trophy is spent first`);
        assert.deepEqual([...row.ids].sort(), ['hunt-ancient-beast-core', 'hunt-legendary-material', 'hunt-titan-bone'], id);
        assert.equal(row.ids[2], 'hunt-legendary-material', `${id}: Legendary Material is last`);
        assert.equal(row.count, count, id);
    }
    // A dragon farmer (bones only) can now build a Sanguine Charm, a chakra-beast farmer an Apex Fang.
    const charm = SUPPLY_CRAFT_RECIPES['pve-sanguine-charm'].ingredients;
    assert.deepEqual(planCraftIngredients(charm, stock({ 'hunt-small-fang': 10, 'hunt-titan-bone': 2, 'gather-binding-fiber': 6 })),
        { 'hunt-small-fang': 10, 'hunt-titan-bone': 2, 'gather-binding-fiber': 6 });
    const apex = SUPPLY_CRAFT_RECIPES['pve-apex-predator-fang'].ingredients;
    const apexStock = { 'hunt-shadow-claw': 8, 'gather-iron-sand-superior': 10, 'gather-binding-fiber': 8 };
    assert.deepEqual(planCraftIngredients(apex, stock({ ...apexStock, 'hunt-ancient-beast-core': 3, 'hunt-legendary-material': 1 })),
        { 'hunt-ancient-beast-core': 3, 'hunt-legendary-material': 1, ...apexStock });
});

test('the Weekly Boss Core forges epic and legendary weapons as its description says, last in each row', () => {
    for (const item of Object.values(ITEM_CATALOG).filter(item => item.slot === 'hand' && item.weaponEp != null && !/-s\d+$/.test(item.id))) {
        const ingredients = gearCraftIngredients(item);
        const coreRow = rowWith(ingredients, 'weekly-boss-core');
        if (item.rarity === 'epic') {
            assert.deepEqual(coreRow?.ids, ['gather-stormglass-shard-fine', 'gather-stormglass-shard-superior', 'gather-stormglass-shard-pristine', 'weekly-boss-core'], item.id);
            assert.equal(coreRow?.count, 1, item.id);
        } else if (item.rarity === 'legendary') {
            assert.deepEqual(coreRow?.ids, ['dungeon-legendary-relic', 'warforged-relic', 'veil-of-the-hollow', 'weekly-boss-core'], item.id);
            assert.equal(coreRow?.count, 1, item.id);
        } else {
            assert.equal(coreRow, undefined, `${item.id}: a rare weapon takes no core`);
        }
    }
    assert.equal(craftMaterialName('weekly-boss-core'), 'Weekly Boss Core');
    // The named forge keeps its exact relic and trophy rows.
    for (const kind of ['weapon', 'armor'] as const) {
        assert.equal(namedForgeIngredients(kind).some(row => row.ids.includes('weekly-boss-core')), false, kind);
        assert.equal(namedForgeIngredients(kind).some(row => row.ids.length > 1 && row.ids.includes('hunt-legendary-material')), false, kind);
    }
});

test('Rare armor (the only armor the Crafter forges) takes ore, the shared hide row and fiber; no dead armor branches remain', () => {
    const rareArmor = Object.values(ITEM_CATALOG).filter(item => ['body', 'head', 'waist', 'legs', 'feet'].includes(item.slot)
        && item.rarity === 'rare' && item.armorQuality && !/-s\d+$/.test(item.id));
    assert.ok(rareArmor.length >= 5);
    for (const item of rareArmor) {
        const rows = gearCraftIngredients(item);
        assert.equal(rows.length, 3, item.id);
        assert.deepEqual(rows[1].ids, ['hunt-torn-hide', 'hunt-frost-pelt', 'hunt-shadow-pelt'], item.id);
        assert.deepEqual(rows[2].ids, ['gather-binding-fiber'], item.id);
    }
});

test('no substitution raises a crafted good\'s NPC sale cap (the crafted-goods converter fix still holds)', () => {
    // Values computed from the pre-substitution recipes: a substitute is never
    // cheaper than the material it stands in for, so each row's cheapest input,
    // and with it the 7/10 cap, is unchanged. The core-row caps follow the
    // 2026-10-23 cut to Ancient Beast Core / Titan Bone (200) and Legendary
    // Material (240), which keeps Legendary Material the dearest core.
    const before: Record<string, number> = {
        'pet-treat': 0, 'thrown-shuriken': 0, 'thrown-senbon': 0, 'thrown-serpent-dust': 16, 'consum-phantom-charm': 25,
        'pve-bloodbond-totem': 420, 'pve-sanguine-charm': 364, 'consum-second-wind': 165, 'pve-apex-predator-fang': 784,
        'beast-seal-master': 0, 'elemental-pet-treat': 0,
    };
    for (const [id, cap] of Object.entries(before)) assert.equal(craftedSaleCapRyo(id), cap, id);
});
