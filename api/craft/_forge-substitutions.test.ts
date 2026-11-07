/*
 * The 2026-10 item-use pass substitutions, through the server Crafter itself
 * (applyForge), spending from the counted itemStacks the hunt materials now
 * live in (owner ruling A12) and from legacy inventory[] copies alike.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyForge, countOwned } from './_forge.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { SUPPLY_CRAFT_RECIPES, gearCraftIngredients } from '../../shared/crafting-recipes.js';

type Stack = { itemId: string; count: number };
const save = (itemStacks: Stack[], extra: Record<string, unknown> = {}) => ({ level: 100, ryo: 1_000_000, inventory: [] as string[], itemStacks, ...extra });
/** One craft's count for the recipe row that accepts `materialId`, read from the live recipe. */
const supplyNeed = (recipeId: string, materialId: string) => {
    const row = SUPPLY_CRAFT_RECIPES[recipeId]?.ingredients.find(ingredient => ingredient.ids.includes(materialId));
    assert.ok(row, `${recipeId} has a row accepting ${materialId}`);
    return row.count;
};
const gearNeed = (itemId: string, materialId: string) => {
    const row = gearCraftIngredients(ITEM_CATALOG[itemId]).find(ingredient => ingredient.ids.includes(materialId));
    assert.ok(row, `${itemId} has a row accepting ${materialId}`);
    return row.count;
};

describe('Crafter substitutions (item-use pass)', () => {
    it('burns Ember Ore or Ember Scale as forge fuel when the player picks it', () => {
        const fuel = supplyNeed('thrown-shuriken', 'hunt-ember-scale'), fiber = supplyNeed('thrown-shuriken', 'gather-binding-fiber');
        const base = save([{ itemId: 'gather-iron-sand', count: 9 }, { itemId: 'gather-binding-fiber', count: fiber },
            { itemId: 'gather-heartwood-bark', count: 1 }, { itemId: 'hunt-ember-scale', count: fuel }]);
        const out = applyForge(base, 'supply', 'thrown-shuriken', 1, [{ 'gather-iron-sand': 9 }, { 'hunt-ember-scale': fuel }, { 'gather-binding-fiber': fiber }])!;
        assert.ok(out);
        assert.equal(countOwned(out, 'thrown-shuriken'), 3);
        assert.equal(countOwned(out, 'hunt-ember-scale'), 0);
        assert.equal(countOwned(out, 'gather-heartwood-bark'), 1, 'the bark the player kept back is untouched');
        const ore = applyForge(save([{ itemId: 'gather-iron-sand-fine', count: 5 }, { itemId: 'gather-binding-fiber', count: supplyNeed('thrown-senbon', 'gather-binding-fiber') },
            { itemId: 'gather-ember-ore', count: supplyNeed('thrown-senbon', 'gather-ember-ore') }]), 'supply', 'thrown-senbon', 1)!;
        assert.ok(ore, 'with no selection the planner finds the Ember Ore');
        assert.equal(countOwned(ore, 'gather-ember-ore'), 0);
    });

    it('binds a Master Beast Seal from Shadow Pelts held as a stack and as legacy copies', () => {
        const need = (id: string) => supplyNeed('beast-seal-master', id);
        const legacyPelts = ['hunt-shadow-pelt', 'hunt-shadow-pelt'];
        const stackedPelts = need('hunt-shadow-pelt') - legacyPelts.length;
        assert.ok(stackedPelts > 0, 'the pelt row needs stacked pelts as well as the legacy copies');
        const base = save([{ itemId: 'gather-stormglass-shard-fine', count: need('gather-stormglass-shard-fine') }, { itemId: 'gather-heartwood-bark', count: need('gather-heartwood-bark') },
            { itemId: 'gather-binding-fiber', count: need('gather-binding-fiber') }, { itemId: 'hunt-shadow-pelt', count: stackedPelts }], { inventory: legacyPelts });
        const out = applyForge(base, 'supply', 'beast-seal-master', 1)!;
        assert.ok(out);
        assert.equal(countOwned(out, 'beast-seal-master'), 1);
        assert.equal(countOwned(out, 'hunt-shadow-pelt'), 0, `${stackedPelts} stacked + two legacy copies all spent`);
        assert.deepEqual(out.inventory, []);
    });

    it('builds an Apex Predator Fang from Ancient Beast Cores and a Sanguine Charm from Titan Bones', () => {
        const apex = applyForge(save([{ itemId: 'hunt-ancient-beast-core', count: 4 }, { itemId: 'hunt-shadow-claw', count: 8 },
            { itemId: 'gather-iron-sand-superior', count: 15 }, { itemId: 'gather-binding-fiber', count: supplyNeed('pve-apex-predator-fang', 'gather-binding-fiber') }]), 'supply', 'pve-apex-predator-fang', 1)!;
        assert.ok(apex);
        assert.equal(countOwned(apex, 'pve-apex-predator-fang'), 1);
        assert.equal(countOwned(apex, 'hunt-ancient-beast-core'), 0);
        const charm = applyForge(save([{ itemId: 'hunt-small-fang', count: 10 }, { itemId: 'hunt-titan-bone', count: 1 },
            { itemId: 'hunt-legendary-material', count: 1 }, { itemId: 'gather-binding-fiber', count: supplyNeed('pve-sanguine-charm', 'gather-binding-fiber') }]), 'supply', 'pve-sanguine-charm', 1)!;
        assert.ok(charm);
        assert.equal(countOwned(charm, 'hunt-titan-bone'), 0);
        assert.equal(countOwned(charm, 'hunt-legendary-material'), 0);
    });

    it('forges a legendary weapon with a Weekly Boss Core as its relic, and an epic one with a core as its catalyst', () => {
        const lotus = (id: string) => gearNeed('black-lotus-dagger', id);
        const lotusStacks = [{ itemId: 'gather-iron-sand-pristine', count: lotus('gather-iron-sand-pristine') }, { itemId: 'gather-heartwood-bark', count: lotus('gather-heartwood-bark') },
            { itemId: 'gather-binding-fiber', count: lotus('gather-binding-fiber') }, { itemId: 'gather-shadow-thread', count: lotus('gather-shadow-thread') }];
        const legendary = applyForge(save([...lotusStacks, { itemId: 'weekly-boss-core', count: 1 }]), 'weapon', 'black-lotus-dagger', 1)!;
        assert.ok(legendary);
        assert.equal(countOwned(legendary, 'black-lotus-dagger'), 1);
        assert.equal(countOwned(legendary, 'weekly-boss-core'), 0);
        const katana = (id: string) => gearNeed('ashglass-katana', id);
        const epic = applyForge(save([{ itemId: 'gather-iron-sand-superior', count: katana('gather-iron-sand-superior') }, { itemId: 'gather-heartwood-bark', count: katana('gather-heartwood-bark') },
            { itemId: 'gather-binding-fiber', count: katana('gather-binding-fiber') }, { itemId: 'weekly-boss-core', count: katana('weekly-boss-core') }]), 'weapon', 'ashglass-katana', 1)!;
        assert.ok(epic);
        assert.equal(countOwned(epic, 'weekly-boss-core'), 0);
        // A real relic is still spent ahead of the core when both are held.
        const both = applyForge(save([...lotusStacks, { itemId: 'warforged-relic', count: 1 }, { itemId: 'weekly-boss-core', count: 1 }]), 'weapon', 'black-lotus-dagger', 1)!;
        assert.equal(countOwned(both, 'warforged-relic'), 0);
        assert.equal(countOwned(both, 'weekly-boss-core'), 1);
    });

    it('makes Treats from a Pristine River Fish once Beast Meat runs out', () => {
        const out = applyForge(save([{ itemId: 'gather-river-fish-pristine', count: supplyNeed('pet-treat', 'gather-river-fish-pristine') },
            { itemId: 'gather-field-herb', count: supplyNeed('pet-treat', 'gather-field-herb') }]), 'supply', 'pet-treat', 1)!;
        assert.ok(out);
        assert.equal(countOwned(out, 'pet-treat'), 1);
        assert.equal(countOwned(out, 'gather-river-fish-pristine'), 0);
    });
});
