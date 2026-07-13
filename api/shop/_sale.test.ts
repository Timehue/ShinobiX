import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sellCatalogItem } from './_sale.js';

describe('server shop sale', () => {
    it('removes owned catalog items and credits canonical half-price ryo', () => {
        const out = sellCatalogItem({ ryo: 10, inventory: ['ashen-leaf-saber'] }, 'ashen-leaf-saber', 1);
        assert.equal(out.ok, true); if (!out.ok) return;
        assert.deepEqual((out.character as Record<string, unknown>).inventory, []); assert.equal(out.character.ryo, 250);
    });
    it('rejects forged/absent items and verifies equipped slots', () => {
        assert.equal(sellCatalogItem({ ryo: 0 }, 'forged-item', 1).ok, false);
        assert.equal(sellCatalogItem({ equipment: { hand: 'other' } }, 'ashen-leaf-saber', 1, 'hand').ok, false);
        const out = sellCatalogItem({ ryo: 0, equipment: { hand: 'ashen-leaf-saber', weapon: 'ashen-leaf-saber' } }, 'ashen-leaf-saber', 1, 'hand');
        assert.equal(out.ok, true); if (out.ok) assert.equal(((out.character as Record<string, unknown>).equipment as any).hand, undefined);
    });
});
