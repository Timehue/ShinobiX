import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { ITEM_CATALOG } from './pvp/_item-catalog.js';
import { deriveCombatMultipliers } from './pvp/_multipliers.js';
import { purchaseCatalogItem } from './shop/_purchase.js';
import { applyForge } from './craft/_forge.js';
import {
    GEAR_DROP_CHANCE_BP, effectiveGearTierUnlocks, gearRoll, pickGearDrop, readGearTierUnlocks, rollGearDrop, withGearTierUnlock,
} from './_gear-drops.js';
import { isStepItemId, parseStepItemId } from '../shared/gear-steps.js';

describe('the event roll', () => {
    const keys = Array.from({ length: 4000 }, (_, i) => `tower:run${i}:player`);

    it('is fixed by the key, so every retry of an event answers the same', () => {
        for (const key of keys.slice(0, 50)) assert.equal(gearRoll(key), gearRoll(key));
        assert.ok(keys.slice(0, 50).every((key) => gearRoll(key) >= 0 && gearRoll(key) < 1));
    });

    it('is spread evenly enough that the odds stay what the owner set', () => {
        const hits = keys.filter((key) => gearRoll(key) < GEAR_DROP_CHANCE_BP.boss / 10_000).length;
        // 5 percent of 4000 is 200; allow a generous band for sampling noise.
        assert.ok(hits > 140 && hits < 270, `${hits} hits of 4000`);
    });

    it('is salted with the server secret, so the visible ids and this public code do not reveal the hits', () => {
        const before = process.env.SESSION_SECRET;
        try {
            process.env.SESSION_SECRET = 'secret-one-for-the-gear-roll-test';
            const one = keys.slice(0, 200).map(gearRoll);
            process.env.SESSION_SECRET = 'secret-two-for-the-gear-roll-test';
            const two = keys.slice(0, 200).map(gearRoll);
            assert.ok(one.filter((value, i) => value === two[i]).length < 3, 'a different secret gives different rolls');
            const hitsOne = one.map((value) => value < 0.05);
            const hitsTwo = two.map((value) => value < 0.05);
            assert.notDeepEqual(hitsOne, hitsTwo, 'the set of hitting events changes with the secret');
        } finally {
            if (before === undefined) delete process.env.SESSION_SECRET;
            else process.env.SESSION_SECRET = before;
        }
    });
});

const steps = Object.values(ITEM_CATALOG).filter((item) => isStepItemId(item.id));
const weaponSteps = steps.filter((item) => item.slot === 'hand');
const armorSteps = steps.filter((item) => item.slot !== 'hand');

describe('gear step items', () => {
    it('adds 65 weapon steps and 45 armor steps', () => {
        assert.equal(weaponSteps.length, 65);
        assert.equal(armorSteps.length, 45);
    });

    it('moves weapon EP in half points and never reaches the next tier', () => {
        const nextTierEp: Record<string, number> = { common: 17, rare: 19, epic: 22 };
        for (const item of weaponSteps) {
            const base = ITEM_CATALOG[parseStepItemId(item.id)!.baseId];
            const step = parseStepItemId(item.id)!.step;
            assert.equal(item.weaponEp, base.weaponEp! + step * 0.5, item.id);
            assert.ok(item.weaponEp! < nextTierEp[item.rarity], item.id);
            assert.ok(item.weaponEp! < 22, item.id);
        }
    });

    it('keeps the second effect, its percent, tags, stats and range exactly as the base', () => {
        for (const item of [...weaponSteps, ...armorSteps]) {
            const base = ITEM_CATALOG[parseStepItemId(item.id)!.baseId];
            assert.equal(item.weaponEffect, base.weaponEffect, item.id);
            assert.equal(item.weaponEffectValue, base.weaponEffectValue, item.id);
            assert.deepEqual(item.weaponTags, base.weaponTags, item.id);
            assert.deepEqual(item.bonuses, base.bonuses, item.id);
            assert.equal(item.weaponRange, base.weaponRange, item.id);
            assert.equal(item.armorQuality, base.armorQuality, item.id);
        }
    });

    it('moves armor reduction in half points and stays under Legendary 7 percent', () => {
        const nextTier: Record<string, number> = { Standard: 0.03, Reinforced: 0.05, Rare: 0.07 };
        for (const item of armorSteps) {
            assert.ok(item.armorReduction! < nextTier[item.armorQuality!], item.id);
            assert.ok(item.armorReduction! < 0.07, item.id);
        }
        assert.equal(Math.max(...armorSteps.map((item) => item.armorReduction!)), 0.065);
    });

    it('costs 0 and has a name with no hyphen', () => {
        for (const item of steps) {
            assert.equal(item.cost, 0, item.id);
            assert.ok(!item.name.includes('-') || ITEM_CATALOG[parseStepItemId(item.id)!.baseId].name.includes('-'), item.name);
        }
    });

    it('is never sold or crafted', () => {
        assert.deepEqual(purchaseCatalogItem({ level: 99, ryo: 99999, inventory: [] }, 'cloth-hood-s1', 1), { ok: false, reason: 'item-not-for-sale' });
        assert.equal(applyForge({ level: 99, ryo: 99999, inventory: [] }, 'weapon', 'ashglass-katana-s1', 1), null);
        assert.equal(applyForge({ level: 99, ryo: 99999, inventory: [] }, 'armor', 'iron-kabuto-s1', 1), null);
    });
});

describe('armor reduction in combat', () => {
    it('uses the exact step reduction from the catalog', () => {
        const mult = deriveCombatMultipliers({ equipment: { head: 'cloth-hood-s2', body: 'iron-kabuto-s3' } }, null);
        assert.equal(Math.round(mult.armorRawDR * 1000) / 1000, 0.02 + 0.065);
    });

    it('ignores a reduction a forged custom item claims', () => {
        const forged = { id: 'fake-helm-s1', name: 'Fake Helm', slot: 'head', rarity: 'common', armorQuality: 'Standard', armorReduction: 1.4, bonuses: {} };
        const mult = deriveCombatMultipliers({ equipment: { head: 'fake-helm-s1' } }, { creatorItems: [forged] });
        assert.equal(mult.armorRawDR, 0.01);
    });
});

describe('tier unlock', () => {
    it('starts at the lowest tier and only ever rises', () => {
        assert.deepEqual(readGearTierUnlocks(undefined), { weapon: 0, armor: 0 });
        const none: Record<string, unknown> = {};
        const rare = withGearTierUnlock(none, ITEM_CATALOG['ashen-leaf-saber']);
        assert.deepEqual(rare.gearTierUnlocks, { weapon: 1, armor: 0 });
        const epic = withGearTierUnlock(rare, ITEM_CATALOG['ashglass-katana']);
        assert.deepEqual(epic.gearTierUnlocks, { weapon: 2, armor: 0 });
        assert.equal(withGearTierUnlock(epic, ITEM_CATALOG['ashen-leaf-saber']), epic);
    });

    it('raises armor on Reinforced and Rare pieces and ignores non gear', () => {
        const none: Record<string, unknown> = {};
        const reinforced = withGearTierUnlock(none, ITEM_CATALOG['leather-headband']);
        assert.deepEqual(reinforced.gearTierUnlocks, { weapon: 0, armor: 1 });
        const rare = withGearTierUnlock(reinforced, ITEM_CATALOG['iron-kabuto']);
        assert.deepEqual(rare.gearTierUnlocks, { weapon: 0, armor: 2 });
        const potion: Record<string, unknown> = {};
        assert.equal(withGearTierUnlock(potion, ITEM_CATALOG['thrown-shuriken']), potion);
    });

    it('is raised by a shop purchase of a tier item', () => {
        const bought = purchaseCatalogItem({ level: 99, ryo: 99999, inventory: [] }, 'leather-headband', 1);
        assert.equal(bought.ok, true);
        if (bought.ok) assert.deepEqual(bought.character.gearTierUnlocks, { weapon: 0, armor: 1 });
    });
});

describe('gear drops', () => {
    // Deterministic rng: always returns the first option.
    const first = () => 0;

    it('drops only the common tier until a higher tier is bought or crafted', () => {
        for (let pick = 0; pick < 2; pick += 1) {
            const id = pickGearDrop({}, (max) => (max === 2 ? pick : 0))!;
            assert.ok(['common', 'uncommon'].includes(ITEM_CATALOG[id].rarity), id);
        }
    });

    it('drops from the highest unlocked tier', () => {
        const rng = (max: number) => (max === 2 ? 0 : 0);
        const id = pickGearDrop({ gearTierUnlocks: { weapon: 2, armor: 0 } }, rng)!;
        assert.equal(ITEM_CATALOG[id].rarity, 'epic');
        const armor = pickGearDrop({ gearTierUnlocks: { weapon: 0, armor: 2 } }, (max) => (max === 2 ? 1 : 0))!;
        assert.equal(ITEM_CATALOG[armor].armorQuality, 'Rare');
    });

    it('never drops above the top steppable tier even with Legendary unlocked', () => {
        const id = pickGearDrop({ gearTierUnlocks: { weapon: 3, armor: 3 } }, first)!;
        assert.ok(isStepItemId(id));
        assert.ok((ITEM_CATALOG[id].weaponEp ?? 0) < 22);
    });

    it('counts gear the player already holds, so earlier crafters are not stuck at the lowest tier', () => {
        assert.deepEqual(effectiveGearTierUnlocks({ inventory: ['ashglass-katana'], equipment: { head: 'iron-kabuto' } }), { weapon: 2, armor: 2 });
        const id = pickGearDrop({ inventory: ['ashglass-katana'] }, first, 'weapon')!;
        assert.equal(ITEM_CATALOG[id].rarity, 'epic');
        // A stored unlock still wins when it is higher.
        assert.deepEqual(effectiveGearTierUnlocks({ gearTierUnlocks: { weapon: 2, armor: 0 }, inventory: ['rustfang-kunai'] }), { weapon: 2, armor: 0 });
    });

    it('does not let a step drop unlock the next tier by itself', () => {
        const held = { inventory: ['ashen-leaf-saber-s2', 'iron-kabuto-s3', 'ashglass-katana-s1'] };
        assert.deepEqual(effectiveGearTierUnlocks(held), { weapon: 0, armor: 0 });
    });

    it('prefers a piece the player does not own yet', () => {
        const owned = pickGearDrop({}, first)!;
        const next = pickGearDrop({ inventory: [owned] }, first)!;
        assert.notEqual(next, owned);
    });

    it('only drops on a hit of the chance roll', () => {
        assert.equal(rollGearDrop({}, GEAR_DROP_CHANCE_BP.normalFight, (max) => (max === 10_000 ? 50 : 0)), null);
        assert.ok(rollGearDrop({}, GEAR_DROP_CHANCE_BP.normalFight, (max) => (max === 10_000 ? 49 : 0)));
    });

    it('uses the owner set drop chances', () => {
        assert.deepEqual(GEAR_DROP_CHANCE_BP, { ancientChest: 500, boss: 500, normalFight: 50, clanCache: 2000 });
    });
});
