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
});
