/*
 * The 2026-10 item-use pass substitutions, through the server Crafter itself
 * (applyForge), spending from the counted itemStacks the hunt materials now
 * live in (owner ruling A12) and from legacy inventory[] copies alike.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyForge, countOwned } from './_forge.js';

type Stack = { itemId: string; count: number };
const save = (itemStacks: Stack[], extra: Record<string, unknown> = {}) => ({ level: 100, ryo: 1_000_000, inventory: [] as string[], itemStacks, ...extra });

describe('Crafter substitutions (item-use pass)', () => {
    it('burns Ember Ore or Ember Scale as forge fuel when the player picks it', () => {
        const base = save([{ itemId: 'gather-iron-sand', count: 6 }, { itemId: 'gather-binding-fiber', count: 2 },
            { itemId: 'gather-heartwood-bark', count: 1 }, { itemId: 'hunt-ember-scale', count: 1 }]);
        const out = applyForge(base, 'supply', 'thrown-shuriken', 1, [{ 'gather-iron-sand': 6 }, { 'hunt-ember-scale': 1 }, { 'gather-binding-fiber': 2 }])!;
        assert.ok(out);
        assert.equal(countOwned(out, 'thrown-shuriken'), 3);
        assert.equal(countOwned(out, 'hunt-ember-scale'), 0);
        assert.equal(countOwned(out, 'gather-heartwood-bark'), 1, 'the bark the player kept back is untouched');
        const ore = applyForge(save([{ itemId: 'gather-iron-sand-fine', count: 3 }, { itemId: 'gather-binding-fiber', count: 2 }, { itemId: 'gather-ember-ore', count: 1 }]), 'supply', 'thrown-senbon', 1)!;
        assert.ok(ore, 'with no selection the planner finds the Ember Ore');
        assert.equal(countOwned(ore, 'gather-ember-ore'), 0);
    });

    it('binds a Master Beast Seal from Shadow Pelts held as a stack and as legacy copies', () => {
        const base = save([{ itemId: 'gather-stormglass-shard-fine', count: 4 }, { itemId: 'gather-heartwood-bark', count: 4 },
            { itemId: 'gather-binding-fiber', count: 8 }, { itemId: 'hunt-shadow-pelt', count: 2 }], { inventory: ['hunt-shadow-pelt', 'hunt-shadow-pelt'] });
        const out = applyForge(base, 'supply', 'beast-seal-master', 1)!;
        assert.ok(out);
        assert.equal(countOwned(out, 'beast-seal-master'), 1);
        assert.equal(countOwned(out, 'hunt-shadow-pelt'), 0, 'two stacked + two legacy copies all spent');
        assert.deepEqual(out.inventory, []);
    });

    it('builds an Apex Predator Fang from Ancient Beast Cores and a Sanguine Charm from Titan Bones', () => {
        const apex = applyForge(save([{ itemId: 'hunt-ancient-beast-core', count: 4 }, { itemId: 'hunt-shadow-claw', count: 8 },
            { itemId: 'gather-iron-sand-superior', count: 10 }, { itemId: 'gather-binding-fiber', count: 8 }]), 'supply', 'pve-apex-predator-fang', 1)!;
        assert.ok(apex);
        assert.equal(countOwned(apex, 'pve-apex-predator-fang'), 1);
        assert.equal(countOwned(apex, 'hunt-ancient-beast-core'), 0);
        const charm = applyForge(save([{ itemId: 'hunt-small-fang', count: 10 }, { itemId: 'hunt-titan-bone', count: 1 },
            { itemId: 'hunt-legendary-material', count: 1 }, { itemId: 'gather-binding-fiber', count: 6 }]), 'supply', 'pve-sanguine-charm', 1)!;
        assert.ok(charm);
        assert.equal(countOwned(charm, 'hunt-titan-bone'), 0);
        assert.equal(countOwned(charm, 'hunt-legendary-material'), 0);
    });

    it('forges a legendary weapon with a Weekly Boss Core as its relic, and an epic one with a core as its catalyst', () => {
        const legendary = applyForge(save([{ itemId: 'gather-iron-sand-pristine', count: 24 }, { itemId: 'gather-heartwood-bark', count: 2 },
            { itemId: 'gather-binding-fiber', count: 8 }, { itemId: 'gather-shadow-thread', count: 3 }, { itemId: 'weekly-boss-core', count: 1 }]), 'weapon', 'black-lotus-dagger', 1)!;
        assert.ok(legendary);
        assert.equal(countOwned(legendary, 'black-lotus-dagger'), 1);
        assert.equal(countOwned(legendary, 'weekly-boss-core'), 0);
        const epic = applyForge(save([{ itemId: 'gather-iron-sand-superior', count: 18 }, { itemId: 'gather-heartwood-bark', count: 2 },
            { itemId: 'gather-binding-fiber', count: 6 }, { itemId: 'weekly-boss-core', count: 1 }]), 'weapon', 'ashglass-katana', 1)!;
        assert.ok(epic);
        assert.equal(countOwned(epic, 'weekly-boss-core'), 0);
        // A real relic is still spent ahead of the core when both are held.
        const both = applyForge(save([{ itemId: 'gather-iron-sand-pristine', count: 24 }, { itemId: 'gather-heartwood-bark', count: 2 },
            { itemId: 'gather-binding-fiber', count: 8 }, { itemId: 'gather-shadow-thread', count: 3 }, { itemId: 'warforged-relic', count: 1 }, { itemId: 'weekly-boss-core', count: 1 }]), 'weapon', 'black-lotus-dagger', 1)!;
        assert.equal(countOwned(both, 'warforged-relic'), 0);
        assert.equal(countOwned(both, 'weekly-boss-core'), 1);
    });

    it('makes Treats from a Pristine River Fish once Beast Meat runs out', () => {
        const out = applyForge(save([{ itemId: 'gather-river-fish-pristine', count: 4 }, { itemId: 'gather-field-herb', count: 2 }]), 'supply', 'pet-treat', 1)!;
        assert.ok(out);
        assert.equal(countOwned(out, 'pet-treat'), 1);
        assert.equal(countOwned(out, 'gather-river-fish-pristine'), 0);
    });
});
