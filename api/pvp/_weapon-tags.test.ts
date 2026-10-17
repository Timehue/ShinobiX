/*
 * The server's weapon tag text (api/pvp/_weapon-tags.ts) must say what a swing
 * does, because the Sunscar Exchange and the forged description print it. A
 * listing used to show the stored roll: "Heal 37%" for a flat 450 HP, "Wound 38%"
 * for a 25% bleed. Each case here is checked against what applyJutsu applies.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { weaponTagEffectText, weaponDistinctTagCount, catalogWeaponFlatTags } from './_weapon-tags.js';
import { catalogWeaponFlatTags as moveCatalogWeaponFlatTags } from './move.js';
import { ITEM_CATALOG } from './_item-catalog.js';

const NAMED = 'named-weapon-0f07ac7966d24f4fa4b43c9b6eb74527';
const named = (...tags: Array<[string, number]>) => ({ id: NAMED, weaponTags: tags.map(([name, percent]) => ({ name, percent })) });

describe('weaponTagEffectText', () => {
    it('gives a Named Weapon its flat Heal/Shield/Drain by tag count', () => {
        assert.equal(weaponTagEffectText(named(['Heal', 37]), 'Heal', 37), 'Heal 450 HP');
        assert.equal(weaponTagEffectText(named(['Shield', 18], ['Wound', 17]), 'Shield', 18), 'Shield 225');
        assert.equal(weaponTagEffectText(named(['Drain', 39]), 'Drain', 39), 'Drain 150 HP + chakra per turn');
        assert.equal(weaponTagEffectText(named(['Drain', 18], ['Absorb', 16]), 'Drain', 18), 'Drain 75 HP + chakra per turn');
    });

    it('shows a named blade\'s percents exactly as rolled (owner ruling 2026-10-16)', () => {
        assert.equal(weaponTagEffectText(named(['Wound', 30]), 'Wound', 30), 'Wound 30% of damage dealt');
        assert.equal(weaponTagEffectText(named(['Wound', 17], ['Heal', 16]), 'Wound', 17), 'Wound 17% of damage dealt');
        assert.equal(weaponTagEffectText(named(['Reflect', 40]), 'Reflect', 40), 'Reflect 40%');
        assert.equal(weaponTagEffectText(named(['Increase Generals', 38]), 'Increase Generals', 38), 'Increase Generals 38%');
        assert.equal(weaponTagEffectText(named(['Poison', 12]), 'Poison', 12), 'Poison 12%');
        // An older blade's Wound above today's top roll reads what combat bounds it to.
        assert.equal(weaponTagEffectText(named(['Wound', 38]), 'Wound', 38), 'Wound 30% of damage dealt');
    });

    it('keeps the 35% / 25% caps for every other weapon', () => {
        const custom = { id: 'custom-blade' };
        assert.equal(weaponTagEffectText(custom, 'Reflect', 40), 'Reflect 35%');
        assert.equal(weaponTagEffectText(custom, 'Wound', 38), 'Wound 25% of damage dealt');
    });

    it('gives a built-in its authored flat amount and anything else the mastery-0 one', () => {
        const frostfang = ITEM_CATALOG['frostfang-oathblade'] as unknown as Record<string, unknown> | undefined;
        if (frostfang) assert.equal(weaponTagEffectText(frostfang, 'Shield', 300), 'Shield 300');
        assert.equal(weaponTagEffectText({ id: 'custom-blade', weaponEffect: 'Heal' }, 'Heal', 35), 'Heal 225 HP');
        assert.equal(weaponTagEffectText({ id: 'custom-blade', weaponEffect: 'Drain' }, 'Drain', 35), 'Drain 50 HP + chakra per turn');
    });

    it('reads a missing percent the way combat does, and names a tag without a number', () => {
        const custom = { id: 'custom-blade' };
        assert.equal(weaponTagEffectText(custom, 'Lifesteal', 0), 'Lifesteal 30%');
        assert.equal(weaponTagEffectText(custom, 'Wound', undefined), 'Wound 25% of damage dealt');
        assert.equal(weaponTagEffectText(custom, 'Poison', 0), 'Poison 6%');
        assert.equal(weaponTagEffectText(custom, 'Pierce', 0), 'Pierce');
    });

    it('counts a legacy weaponEffect as a distinct tag, once', () => {
        assert.equal(weaponDistinctTagCount({ weaponTags: [{ name: 'Heal' }], weaponEffect: 'Heal' }), 1);
        assert.equal(weaponDistinctTagCount({ weaponTags: [{ name: 'Heal' }], weaponEffect: 'Wound' }), 2);
    });

    it('move.ts still exports the same catalogWeaponFlatTags the engines import', () => {
        assert.equal(moveCatalogWeaponFlatTags, catalogWeaponFlatTags);
    });
});
