import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyForge, countOwned } from './_forge.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { SUPPLY_CRAFT_RECIPES } from '../../shared/crafting-recipes.js';
import { effectiveItemLevelReq } from '../../shared/item-level-gate.js';
import { GEAR_CRAFT_RYO } from '../../shared/craft-fees.js';

describe('server Crafter ingredient recipes', () => {
    it('spends only selected ore grades, rejects ineligible ingredients and leaves the original save untouched', () => {
        const base = { level: 100, ryo: 1_000_000, itemStacks: [
            { itemId: 'gather-iron-sand', count: 20 }, { itemId: 'gather-iron-sand-fine', count: 4 }, { itemId: 'gather-iron-sand-pristine', count: 10 },
            { itemId: 'gather-heartwood-bark', count: 2 }, { itemId: 'gather-binding-fiber', count: 4 },
        ] };
        const before = structuredClone(base);
        const selected = [{ 'gather-iron-sand': 10, 'gather-iron-sand-fine': 2 }, { 'gather-heartwood-bark': 2 }, { 'gather-binding-fiber': 4 }];
        const out = applyForge(base, 'supply', 'thrown-shuriken', 2, selected)!;
        assert.ok(out); assert.equal(countOwned(out, 'thrown-shuriken'), 6);
        assert.equal(countOwned(out, 'gather-iron-sand'), 10); assert.equal(countOwned(out, 'gather-iron-sand-fine'), 2);
        assert.equal(countOwned(out, 'gather-iron-sand-pristine'), 10); assert.deepEqual(base, before);
        assert.equal(applyForge(base, 'weapon', 'ashen-leaf-saber', 1, [{ 'gather-iron-sand': 10 }, { 'gather-heartwood-bark': 2 }, { 'gather-binding-fiber': 4 }]), null, 'common ore cannot satisfy a Fine recipe');
        const unavailable = [{ 'gather-iron-sand-fine': 10 }, { 'gather-heartwood-bark': 2 }, { 'gather-binding-fiber': 4 }];
        assert.equal(applyForge(base, 'weapon', 'ashen-leaf-saber', 1, unavailable), null, 'no fallback to the Pristine ore');
        assert.deepEqual(base, before);
    });
    it('makes pet food from mixed loose meat and stacked fish, preserving unrelated materials', () => {
        const base = { level: 100, ryo: 1_000_000, inventory: ['hunt-beast-meat', 'hunt-torn-hide'], itemStacks: [
            { itemId: 'gather-river-fish', count: 7 }, { itemId: 'gather-field-herb', count: 2 }, { itemId: 'weekly-boss-core', count: 10 },
        ] };
        const out = applyForge(base, 'supply', 'pet-treat', 1)!;
        assert.ok(out); assert.equal(countOwned(out, 'pet-treat'), 1);
        for (const id of ['hunt-beast-meat', 'gather-field-herb']) assert.equal(countOwned(out, id), 0);
        assert.equal(countOwned(out, 'gather-river-fish'), 4);
        assert.equal(countOwned(out, 'hunt-torn-hide'), 1); assert.equal(countOwned(out, 'weekly-boss-core'), 10);
        assert.equal(applyForge({ level: 100, ryo: 1_000_000, itemStacks: [{ itemId: 'weekly-boss-core', count: 100 }] }, 'supply', 'pet-treat', 1), null);
    });
    it('requires the complete batch before consuming anything', () => {
        const base = { level: 100, ryo: 1_000_000, itemStacks: [{ itemId: 'gather-iron-sand', count: 7 }, { itemId: 'gather-heartwood-bark', count: 1 }, { itemId: 'gather-binding-fiber', count: 2 }, { itemId: 'hunt-beast-meat', count: 100 }] };
        const before = structuredClone(base);
        assert.equal(applyForge(base, 'supply', 'thrown-shuriken', 2), null); assert.deepEqual(base, before);
        for (const missing of ['gather-heartwood-bark', 'gather-binding-fiber']) {
            const incomplete = { ...base, itemStacks: base.itemStacks.filter(stack => stack.itemId !== missing) };
            const snapshot = structuredClone(incomplete);
            assert.equal(applyForge(incomplete, 'supply', 'thrown-shuriken', 1), null, missing);
            assert.deepEqual(incomplete, snapshot, 'missing co-materials never spend the iron');
        }
        const out = applyForge(base, 'supply', 'thrown-shuriken', 1)!;
        assert.equal(countOwned(out, 'thrown-shuriken'), 3); assert.equal(countOwned(out, 'gather-iron-sand'), 1);
        assert.equal(countOwned(out, 'gather-heartwood-bark'), 0); assert.equal(countOwned(out, 'gather-binding-fiber'), 0);
        assert.equal(countOwned(out, 'hunt-beast-meat'), 100);
    });
    it('gates Master Beast Seals and uses crystals and seal materials available before S-rank hunts', () => {
        const materials = { level: 29, ryo: 1_000_000, itemStacks: [
            { itemId: 'gather-stormglass-shard-fine', count: 12 }, { itemId: 'gather-heartwood-bark', count: 4 },
            { itemId: 'gather-shadow-thread', count: 4 }, { itemId: 'gather-binding-fiber', count: 8 },
        ] };
        assert.equal(applyForge(materials, 'supply', 'beast-seal-master', 1), null);
        const out = applyForge({ ...materials, level: 30 }, 'supply', 'beast-seal-master', 1)!;
        assert.equal(countOwned(out, 'beast-seal-master'), 1); assert.equal(countOwned(out, 'gather-stormglass-shard-fine'), 8);
    });
    it('forges canonical weapons without eating hunt stock or unnecessary Pristine ore', () => {
        const base = { level: 100, ryo: 100_000, itemStacks: [
            { itemId: 'gather-iron-sand-fine', count: 4 }, { itemId: 'gather-iron-sand-superior', count: 6 },
            { itemId: 'gather-iron-sand-pristine', count: 7 }, { itemId: 'gather-heartwood-bark', count: 2 },
            { itemId: 'gather-binding-fiber', count: 4 }, { itemId: 'hunt-beast-meat', count: 100 }, { itemId: 'hunt-torn-hide', count: 100 },
        ] };
        assert.equal(applyForge(base, 'weapon', 'forged-client-item', 1), null);
        const out = applyForge(base, 'weapon', 'ashen-leaf-saber', 1)!;
        assert.ok(out); assert.equal(out.ryo, 100_000 - GEAR_CRAFT_RYO.rare); assert.equal(countOwned(out, 'ashen-leaf-saber'), 1);
        assert.equal(countOwned(out, 'gather-iron-sand-fine'), 0); assert.equal(countOwned(out, 'gather-iron-sand-superior'), 0);
        assert.equal(countOwned(out, 'gather-iron-sand-pristine'), 7);
        assert.equal(countOwned(out, 'hunt-beast-meat'), 100); assert.equal(countOwned(out, 'hunt-torn-hide'), 100);
        assert.equal(applyForge({ ...base, itemStacks: base.itemStacks.filter(s => s.itemId !== 'gather-binding-fiber') }, 'weapon', 'ashen-leaf-saber', 1), null);
    });
    it('uses medicinal ingredients for pills and preserves unrelated rank-up stock', () => {
        const base = { level: 100, ryo: 1_000_000, itemStacks: [{ itemId: 'gather-field-herb', count: 4 }, { itemId: 'hunt-cracked-horn', count: 2 }, { itemId: 'gather-heartwood-bark', count: 1 }, { itemId: 'hunt-beast-meat', count: 5 }] };
        const out = applyForge(base, 'supply', 'item-defense-pill', 1)!;
        assert.equal(countOwned(out, 'item-defense-pill'), 1); assert.equal(countOwned(out, 'hunt-beast-meat'), 5);
        assert.equal(countOwned(out, 'gather-field-herb'), 0); assert.equal(countOwned(out, 'hunt-cracked-horn'), 0);
    });
    it('converts exactly five fragments into one relic', () => {
        const out = applyForge({ itemStacks: [{ itemId: 'dungeon-legendary-fragment', count: 6 }] }, 'relic', 'dungeon-legendary-relic', 1)!;
        assert.equal(countOwned(out, 'dungeon-legendary-fragment'), 1); assert.equal(countOwned(out, 'dungeon-legendary-relic'), 1);
    });
    it('extracts Aura Dust from graded chakra crystals and refuses food as currency ingredients', () => {
        const unrelated = { level: 100, ryo: 1_000_000, itemStacks: [{ itemId: 'hunt-beast-meat', count: 10000 }] };
        assert.equal(applyForge(unrelated, 'supply', 'currency:aura-dust', 1), null);
        assert.equal(applyForge(unrelated, 'supply', 'currency:bone-charm', 1), null);
        const aura = applyForge({ level: 100, ryo: 1_000_000, auraDust: 7, itemStacks: [{ itemId: 'gather-stormglass-shard', count: 4 }, { itemId: 'gather-stormglass-shard-fine', count: 8 }, { itemId: 'gather-field-herb', count: 8 }, { itemId: 'gather-binding-fiber', count: 4 }] }, 'supply', 'currency:aura-dust', 2)!;
        assert.equal(aura.auraDust, 107); assert.equal(countOwned(aura, 'gather-stormglass-shard'), 0);
        assert.equal(countOwned(aura, 'gather-stormglass-shard-fine'), 8);
    });
});

/*
 * 2026-10 item-use pass: a combat consumable equips into a character slot that
 * the rarity ladder gates, so its supply recipe opens at that same level. A
 * Lv1-29 crafter used to make Lv30 pills, smoke, needles and potions that they
 * could only sell. Pet supplies stay open: no character level gates their use.
 */
describe('supply recipes open at the level their output can be used', () => {
    const characterEquipped = (id: string) => {
        const item = ITEM_CATALOG[id];
        if (!item) return false;
        return item.slot === 'thrown' || item.slot === 'potion'
            || (item.slot === 'item' && (item.weaponEffect != null || item.apCost != null || item.weaponEp != null || item.restoreChakra != null || item.restoreStamina != null));
    };

    it('gates every combat consumable recipe at the ladder level of its output', () => {
        let checked = 0;
        for (const [id, recipe] of Object.entries(SUPPLY_CRAFT_RECIPES)) {
            if (!characterEquipped(id)) continue;
            checked++;
            assert.equal(recipe.levelReq ?? 1, effectiveItemLevelReq(ITEM_CATALOG[id]), `${id} recipe gate`);
        }
        assert.ok(checked >= 7, `${checked} combat consumable recipes`);
    });

    it('refuses an Attack Pill at Lv29 and crafts it at Lv30', () => {
        const save = (level: number) => ({ level, ryo: 1_000_000, itemStacks: [
            { itemId: 'gather-field-herb', count: 4 }, { itemId: 'hunt-beast-meat', count: 2 }, { itemId: 'gather-heartwood-bark', count: 1 },
        ] });
        assert.equal(applyForge(save(29), 'supply', 'item-attack-pill', 1), null);
        assert.equal(countOwned(applyForge(save(30), 'supply', 'item-attack-pill', 1)!, 'item-attack-pill'), 1);
    });

    it('keeps the Shuriken and the pet supplies open from Lv1', () => {
        for (const id of ['thrown-shuriken', 'pet-treat', 'elemental-pet-treat', 'consum-lifeline-elixir', 'pve-frenzy-claw']) {
            assert.equal(SUPPLY_CRAFT_RECIPES[id]?.levelReq ?? 1, 1, id);
        }
    });
});