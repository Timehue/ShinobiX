import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ITEM_CATALOG } from './pvp/_item-catalog.js';
import { applyInventorySale, isSellableItem } from './inventory/_sale.js';
import { sellCatalogItem } from './shop/_sale.js';
import { sealAsset } from './festival/_exchange-assets.js';
import { CLAN_EXCHANGE_ITEMS } from './clan/_exchange.js';
import { GEAR_DROP_CHANCE_BP } from './_gear-drops.js';
import { GEAR_STEP_SELL_RYO, isStepItemId } from '../shared/gear-steps.js';
import type { SettlementItem } from './shop/_catalog.js';

const stepItem = (id: string) => ITEM_CATALOG[id] as SettlementItem;
const character = (over: Record<string, unknown> = {}) => ({ name: 'rill', ryo: 10, inventory: [], itemStacks: [], equipment: {}, ...over });

describe('gear step drops sell for one flat price', () => {
    it('is 500 ryo', () => {
        assert.equal(GEAR_STEP_SELL_RYO, 500);
    });

    it('sells from the backpack through the receipt path, once per request', () => {
        const stored = character({ inventory: ['kept', 'cloth-hood-s1', 'cloth-hood-s1'] });
        const sold = applyInventorySale(stored, stepItem('cloth-hood-s1'), 'backpack', 2, undefined, 'stepsale00000001', 100);
        assert.equal(sold.ok, true);
        if (!sold.ok) return;
        assert.equal(sold.character.ryo, 10 + 2 * GEAR_STEP_SELL_RYO);
        assert.deepEqual(sold.character.inventory, ['kept']);
        const replay = applyInventorySale(sold.character, stepItem('cloth-hood-s1'), 'backpack', 2, undefined, 'stepsale00000001', 101);
        assert.equal(replay.ok && replay.character.ryo, 10 + 2 * GEAR_STEP_SELL_RYO);
    });

    it('sells an equipped step piece through the receipt path', () => {
        const sold = applyInventorySale(character({ equipment: { hand: 'training-katana-s2' } }), stepItem('training-katana-s2'), 'equipped', 1, 'hand', 'stepsale00000002', 100);
        assert.equal(sold.ok, true);
        if (sold.ok) {
            assert.equal(sold.character.ryo, 10 + GEAR_STEP_SELL_RYO);
            assert.deepEqual(sold.character.equipment, {});
        }
    });

    it('sells through the direct shop path too', () => {
        const sold = sellCatalogItem({ ryo: 5, inventory: ['iron-kabuto-s3'], equipment: {} }, 'iron-kabuto-s3', 1);
        assert.equal(sold.ok, true);
        if (sold.ok) {
            assert.equal(sold.sale.unitValue, GEAR_STEP_SELL_RYO);
            assert.equal(sold.character.ryo, 5 + GEAR_STEP_SELL_RYO);
            assert.deepEqual((sold.character as Record<string, unknown>).inventory, []);
        }
    });

    it('prices every one of the 110 step items the same way', () => {
        const ids = Object.keys(ITEM_CATALOG).filter(isStepItemId);
        assert.equal(ids.length, 110);
        for (const id of ids) {
            assert.equal(isSellableItem(stepItem(id)), true, id);
            const sold = sellCatalogItem({ ryo: 0, inventory: [id], equipment: {} }, id, 1);
            assert.equal(sold.ok && sold.sale.unitValue, GEAR_STEP_SELL_RYO, id);
        }
    });

    it('does not make other free items sellable, nor an invented id that only looks like a step', () => {
        assert.equal(isSellableItem(stepItem('ranked-format-mantle')), false);
        assert.equal(sellCatalogItem({ ryo: 0, inventory: ['ranked-format-mantle'], equipment: {} }, 'ranked-format-mantle', 1).ok, false);
        const invented = { id: 'my-forged-blade-s1', name: 'Forged', slot: 'hand', rarity: 'epic', cost: 0, weaponEp: 99 } as SettlementItem;
        assert.equal(isSellableItem(invented), false);
        assert.equal(sellCatalogItem({ ryo: 0, inventory: ['my-forged-blade-s1'], equipment: {} }, 'my-forged-blade-s1', 1).ok, false);
    });

    it('does not sell a step item the player does not own', () => {
        assert.equal(sellCatalogItem({ ryo: 0, inventory: [], equipment: {} }, 'cloth-hood-s1', 1).ok, false);
        assert.equal(applyInventorySale(character(), stepItem('cloth-hood-s1'), 'backpack', 1, undefined, 'stepsale00000003', 100).ok, false);
    });
});

describe('Sunscar Exchange listing of a step armor piece', () => {
    const catalogs = { items: new Map(Object.entries(ITEM_CATALOG)), cards: new Map() } as never;
    const seal = (id: string) => sealAsset({ character: {}, creatorItems: [] }, catalogs, 'item', id).asset.stats;

    it('shows the exact damage reduction, not just the base tier', () => {
        assert.deepEqual(seal('cloth-hood-s1').find((s) => s.label === 'Damage Reduction'), { label: 'Damage Reduction', value: '1.5%' });
        assert.deepEqual(seal('iron-kabuto-s3').find((s) => s.label === 'Damage Reduction'), { label: 'Damage Reduction', value: '6.5%' });
    });

    it('leaves ordinary armor and weapons as they were', () => {
        assert.equal(seal('cloth-hood').some((s) => s.label === 'Damage Reduction'), false);
        assert.equal(seal('ashglass-katana-s3').find((s) => s.label === 'Weapon Ep')?.value, '20.5');
    });
});

describe('clan cache wording matches the 20 percent step roll', () => {
    it('says so on both caches, on the server and in the client list', () => {
        assert.equal(GEAR_DROP_CHANCE_BP.clanCache, 2000, 'the wording says one in five');
        const client = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'components', 'ClanExchange.tsx'), 'utf8');
        for (const id of ['weaponCache', 'armorCache']) {
            const server = CLAN_EXCHANGE_ITEMS.find((item) => item.id === id)!;
            assert.match(server.description, /one (scroll|vault) in five instead holds an upgrade/, id);
            assert.ok(client.includes(server.description), `${id}: the client copy must match the server copy`);
        }
    });
});
