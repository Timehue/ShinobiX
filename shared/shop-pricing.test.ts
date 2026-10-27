import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { unitSaleValue } from '../api/inventory/_sale.js';
import { sellCatalogItem } from '../api/shop/_sale.js';
import { SHOP_PRICE_SCALE, saleCostBasis, shopPriceScale, withShopPrice } from './shop-pricing.js';

/** The shelf as it stood before the 2026-10-27 price rise, from the shop screenshot that prompted it. */
const OLD_GEAR_COSTS: Readonly<Record<string, number>> = {
    'tool-basic-fishing-pole': 150, 'tool-basic-pickaxe': 150,
    'cloth-hood': 120, 'leather-headband': 270,
    'shinobi-vest': 60, 'cloth-robe': 150, 'reinforced-vest': 330,
    'cloth-sash': 90, 'leather-belt': 210,
    'cloth-pants': 105, 'padded-leggings': 240,
    'cloth-sandals': 75, 'shinobi-boots': 195,
};

describe('shop price scale', () => {
    it('prices every armor piece and basic gathering tool at exactly 75x its old cost', () => {
        assert.equal(SHOP_PRICE_SCALE.gear, 75);
        for (const [id, old] of Object.entries(OLD_GEAR_COSTS)) {
            assert.equal(ITEM_CATALOG[id].cost, old * 75, id);
            assert.equal(ITEM_CATALOG[id].saleBasis, old, id);
        }
    });

    it('raises every other ryo-priced shelf item by more than its old price', () => {
        for (const item of Object.values(ITEM_CATALOG)) {
            if (!item.saleBasis) continue;
            assert.ok(item.cost >= item.saleBasis * 3, `${item.id} rose by less than 3x`);
            assert.equal(item.cost % item.saleBasis, 0, `${item.id} is not a whole multiple of its old cost`);
        }
        // The shelf rows the owner did not name rise too: none may sit at its old price.
        for (const id of ['rustfang-kunai', 'thrown-shuriken', 'pet-treat', 'beast-seal-worn', 'potion-rejuvenation', 'pve-frenzy-claw', 'item-attack-pill']) {
            assert.ok(ITEM_CATALOG[id].saleBasis, `${id} was not repriced`);
        }
    });

    it('leaves Fate Shard items, free items and event gear at their authored price', () => {
        for (const item of Object.values(ITEM_CATALOG)) {
            if (item.rarity === 'legendary' || item.rarity === 'mythic' || !(item.cost && item.cost > 0)) {
                assert.equal(item.saleBasis, undefined, `${item.id} must not be rescaled`);
            }
        }
        assert.equal(ITEM_CATALOG['tool-golden-pickaxe'].cost, 50);
        assert.equal(ITEM_CATALOG['legendary-crown'].cost, 150);
    });

    it('does not raise what any item sells for', () => {
        // Half the OLD cost, exactly as before the price rise.
        for (const [id, old] of Object.entries(OLD_GEAR_COSTS)) {
            assert.equal(unitSaleValue(ITEM_CATALOG[id] as never), Math.floor(old / 2), id);
        }
        for (const item of Object.values(ITEM_CATALOG)) {
            if (!item.saleBasis) continue;
            assert.ok(unitSaleValue(item as never) <= Math.floor(item.saleBasis / 2), `${item.id} sells for more than before`);
        }
    });

    it('sells a bought piece back for a small fraction of what it cost', () => {
        const owned = { ryo: 0, inventory: ['cloth-hood'], itemStacks: [], equipment: {} };
        const sold = sellCatalogItem(owned, 'cloth-hood', 1);
        assert.ok(sold.ok);
        assert.equal(sold.sale.unitValue, 60);
        assert.ok(sold.sale.unitValue * 100 < ITEM_CATALOG['cloth-hood'].cost);
    });

    it('withShopPrice is idempotent and skips creator-style items', () => {
        const hood = { id: 'x-hood', slot: 'head', rarity: 'common', cost: 100, armorQuality: 'Standard' };
        const once = withShopPrice(hood);
        assert.deepEqual([once.cost, once.saleBasis], [7500, 100]);
        assert.equal(withShopPrice(once), once);
        const fate = { id: 'x-crown', slot: 'head', rarity: 'legendary', cost: 150, armorQuality: 'Legendary' };
        assert.equal(withShopPrice(fate), fate);
        assert.equal(shopPriceScale({ id: 'x', slot: 'hand', rarity: 'common', cost: 0, weaponEp: 18 }), 1);
    });

    it('saleCostBasis never exceeds the shelf price', () => {
        assert.equal(saleCostBasis({ cost: 500 }), 500);
        assert.equal(saleCostBasis({ cost: 500, saleBasis: 120 }), 120);
        assert.equal(saleCostBasis({ cost: 500, saleBasis: 99_999 }), 500);
        assert.equal(saleCostBasis({ cost: 500, saleBasis: Number.NaN }), 500);
    });
});
