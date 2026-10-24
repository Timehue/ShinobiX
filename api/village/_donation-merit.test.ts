import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { CRAFT_POINTS } from '../craft/_forge.js';
import { HUNT_MATERIAL_SELL_RYO } from '../../shared/hunt-material-sale.js';
import { GEAR_STEP_SELL_RYO, isStepItemId } from '../../shared/gear-steps.js';
import { applyInventorySale } from '../inventory/_sale.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import type { SettlementItem } from '../shop/_catalog.js';
import { itemDonationMeritRyoValue, npcUnitSaleValue, VILLAGE_PROVISIONS_MERIT_RYO_PER_ITEM } from './_donation-merit.js';

describe('village donation merit basis (economy rebalance 2026-10, I-7)', () => {
    it('values every Village Stores material at exactly what the sale route credits', () => {
        for (const itemId of Object.keys(CRAFT_POINTS)) {
            const raw = ITEM_CATALOG[itemId];
            assert.ok(raw, `${itemId} is a catalog item`);
            const sold = applyInventorySale({ ryo: 0, inventory: [], itemStacks: [{ itemId, count: 1 }] },
                { ...raw, cost: Number((raw as { cost?: unknown }).cost) || 0 } as SettlementItem, 'backpack', 1, undefined, 'donation-merit-parity-1', 1);
            assert.equal(npcUnitSaleValue(itemId), sold.ok ? sold.value.ryo : 0, itemId);
            // Gear step drops joined the Village Stores in the 2026-10 item-use pass;
            // they keep their flat step sale price, so donating one earns the merit
            // that selling it and donating the ryo would.
            const expected = isStepItemId(itemId) ? GEAR_STEP_SELL_RYO : HUNT_MATERIAL_SELL_RYO[itemId] ?? 0;
            assert.equal(npcUnitSaleValue(itemId), expected, `${itemId} follows the hunt-material table, the step price, or 0 for a relic`);
        }
    });

    it('a donated relic earns material points but no merit, so a relic is an exit and never a merit source', () => {
        const relics = Object.keys(CRAFT_POINTS).filter((id) => ITEM_CATALOG[id]?.slot === 'relic');
        assert.ok(relics.length >= 16, 'every non-story relic has a Village Stores value');
        for (const id of relics) assert.equal(itemDonationMeritRyoValue(id, 1, { store: 'materialPoints' }), 0, id);
    });

    it('pays provisions a flat 500 per item, materials their sale value, and loose items nothing', () => {
        assert.equal(VILLAGE_PROVISIONS_MERIT_RYO_PER_ITEM, 500);
        assert.equal(itemDonationMeritRyoValue('ration-pack', 40, { store: 'provisions' }), 20_000, 'the 40-a-day cap bounds rations at 20 merit a day');
        assert.equal(itemDonationMeritRyoValue('hunt-titan-bone', 10, { store: 'materialPoints' }), 10 * HUNT_MATERIAL_SELL_RYO['hunt-titan-bone']);
        assert.equal(itemDonationMeritRyoValue('warforged-relic', 3, { store: 'materialPoints' }), 0);
        assert.equal(itemDonationMeritRyoValue('item-smoke-bomb', 500, null), 0, 'a loose item can be gifted back by the Kage');
        assert.equal(itemDonationMeritRyoValue('ration-pack', -5, { store: 'provisions' }), 0);
    });

    it('prices an unknown or unsellable item at 0', () => {
        assert.equal(npcUnitSaleValue('no-such-item'), 0);
        assert.equal(npcUnitSaleValue('ration-pack'), 0);
        assert.equal(npcUnitSaleValue('territory-control-scroll'), 0);
    });
});
