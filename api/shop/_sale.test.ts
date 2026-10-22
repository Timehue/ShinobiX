import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sellCatalogItem } from './_sale.js';
import { unitSaleValue } from '../inventory/_sale.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import type { SettlementItem } from './_catalog.js';

describe('server shop sale', () => {
    it('refuses selection-slot sales and consumes backing units only through backpack sales', () => {
        for (const slot of ['item', 'item1', 'item2', 'item3', 'thrown', 'potion']) {
            const stored = { ryo: 0, inventory: [], itemStacks: [{ itemId: 'thrown-shuriken', count: 1 }], equipment: { [slot]: 'thrown-shuriken' } };
            const before = structuredClone(stored);
            assert.equal(sellCatalogItem(stored, 'thrown-shuriken', 1, slot).ok, false);
            assert.deepEqual(stored, before);
        }
    });
    it('selling by a legacy alias removes the ordinary slot once', () => {
        const sold = sellCatalogItem({ ryo: 0, equipment: { hand: 'rustfang-kunai', weapon: 'rustfang-kunai' } }, 'rustfang-kunai', 1, 'weapon');
        assert.equal(sold.ok, true);
        if (!sold.ok) return;
        assert.deepEqual((sold.character as Record<string, unknown>).equipment, {});
        assert.equal(sold.character.ryo, 112);
        assert.equal(sellCatalogItem(sold.character, 'rustfang-kunai', 1, 'hand').ok, false);
    });
    it('resolves canonical client slots and clears shadowed aliases without selling them', () => {
        for (const [storedSlot, selectedSlot, id] of [['weapon', 'hand', 'rustfang-kunai'], ['hand', 'weapon', 'rustfang-kunai'], ['armor', 'body', 'shinobi-vest']]) {
            const sold = sellCatalogItem({ ryo: 0, equipment: { [storedSlot]: id } }, id, 1, selectedSlot);
            assert.equal(sold.ok, true);
            if (sold.ok) assert.deepEqual((sold.character as Record<string, unknown>).equipment, {});
        }
        for (const equipment of [{ weapon: 'rustfang-kunai', hand: 'training-katana' }, { hand: 'training-katana', weapon: 'rustfang-kunai' }]) {
            const stored = { ryo: 0, inventory: ['rustfang-kunai'], equipment };
            assert.equal(sellCatalogItem(stored, 'rustfang-kunai', 1, 'weapon').ok, false);
            const sold = sellCatalogItem(stored, 'training-katana', 1, 'hand');
            assert.equal(sold.ok, true);
            if (!sold.ok) continue;
            assert.deepEqual((sold.character as Record<string, unknown>).equipment, {});
            assert.deepEqual((sold.character as Record<string, unknown>).inventory, ['rustfang-kunai']);
            assert.equal(sold.character.ryo, 120);
        }
    });
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

it('/shop/sell credits the same unit price as /inventory/sell for every item it buys', () => {
    let checked = 0;
    for (const item of Object.values(ITEM_CATALOG)) {
        const sold = sellCatalogItem({ ryo: 0, inventory: [item.id], itemStacks: [] }, item.id, 1);
        if (!sold.ok) continue;
        checked++;
        assert.equal(sold.sale.unitValue, unitSaleValue({ ...item, cost: Math.max(0, Math.floor(Number(item.cost) || 0)) } as SettlementItem), item.id);
    }
    assert.ok(checked >= 100, `only ${checked} sellable items checked`);
});

describe('/shop/sell agrees with /inventory/sell (2026-10 item-use pass)', () => {
    it('refuses the potion slot, as /inventory/sell does', () => {
        const sold = sellCatalogItem({ ryo: 0, inventory: ['potion-rejuvenation'], itemStacks: [] }, 'potion-rejuvenation', 1);
        assert.equal(sold.ok, false);
    });

    it('keeps the last copy of a collar or PvP gear a pet still wears', () => {
        const pets = [{ id: 'p1', loadout: { pvp: 'pvp-aegis-pendant' } }];
        assert.deepEqual(sellCatalogItem({ ryo: 0, inventory: ['pvp-aegis-pendant'], itemStacks: [], pets }, 'pvp-aegis-pendant', 1), { ok: false, reason: 'pet-unlock-worn' });
        assert.equal(sellCatalogItem({ ryo: 0, inventory: ['pvp-aegis-pendant', 'pvp-aegis-pendant'], itemStacks: [], pets }, 'pvp-aegis-pendant', 1).ok, true);
        assert.equal(sellCatalogItem({ ryo: 0, inventory: ['pvp-aegis-pendant'], itemStacks: [], pets: [] }, 'pvp-aegis-pendant', 1).ok, true);
    });
});
