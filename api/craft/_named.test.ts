import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildNamedItem, debitNamedForge } from './_named.js';

describe('named forge authority', () => {
    it('debits the canonical 1000-point premium pool and rejects insufficient funds', () => {
        assert.equal(debitNamedForge({ boneCharms: 199 }), null);
        assert.equal(debitNamedForge({ boneCharms: 200 })?.boneCharms, 0);
        const mixed = debitNamedForge({ boneCharms: 100, auraStones: 20 })!;
        assert.equal(mixed.boneCharms, 0); assert.equal(mixed.auraStones, 0);
    });
    it('builds combat fields only from the sealed roll', () => {
        const item = buildNamedItem({ kind: 'weapon', ep: 31, range: 4, offenseVal: 170, tags: [{ name: 'Wound', percent: 36 }] }, 'Blade', 'Lore');
        assert.equal(item.weaponEp, 31); assert.equal(item.apCost, 40); assert.equal(item.bonuses.ninjutsuOffense, 170);
    });

    /*
     * Hand gear grants stats + its special roll, never damage reduction (owner
     * ruling 2026-08-16) — matching the built-in gloves, which carry no
     * armorQuality. The `gloves` equip slot is deliberately absent from BOTH
     * armour-DR sums (client getCharacterArmorRawDR, server ARMOR_SLOTS in
     * api/pvp/_multipliers.ts), so an armorQuality on a gauntlet was a promise
     * nothing kept — the description advertised "7% damage reduction" and the
     * wearer got 0%.
     */
    const armorRoll = (slot: 'hand' | 'body') => ({
        kind: 'armor' as const, slot, armorQuality: 'Legendary' as const,
        offenseVal: 30, defenseVal: 30,
        special: { kind: 'Reflect', bonusKey: 'reflectPercent', value: 1.5 },
    });

    it('a forged GAUNTLET carries no armorQuality and never claims damage reduction', () => {
        const item = buildNamedItem(armorRoll('hand'), '', '');
        assert.equal(item.armorQuality, undefined, 'hand gear is not armour — no quality tier');
        assert.ok(!/damage reduction/i.test(String(item.description)), `the description must not promise DR: ${item.description}`);
        assert.equal(item.bonuses.taijutsuOffense, 30, 'it still grants its offense roll');
        assert.equal(item.bonuses.taijutsuDefense, 30, 'and its defense roll');
        assert.equal(item.bonuses.reflectPercent, 1.5, 'and its special roll');
    });

    it('forged BODY armour is unchanged — it keeps its quality and its DR claim', () => {
        const item = buildNamedItem(armorRoll('body'), '', '');
        assert.equal(item.armorQuality, 'Legendary');
        assert.match(String(item.description), /7% damage reduction/);
    });
});
