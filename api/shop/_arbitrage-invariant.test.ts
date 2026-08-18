import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { shopDiscountPercent, discountedShopCost } from './_settlement.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { HUNT_MATERIAL_SELL_RYO } from '../inventory/_sale.js';

/*
 * ⛔ THE INFINITE-RYO GUARD.
 *
 * Sell-back is a hard `floor(item.cost / 2)` computed from the BASE catalog
 * cost (api/shop/_sale.ts and api/inventory/_sale.ts). Purchase price is
 * `discountedShopCost(cost, shopDiscountPercent(...))`. Nothing in the codebase
 * binds those two numbers together — they live in different modules and neither
 * knows about the other.
 *
 * Today the stack maxes at 32.5% (village shop 12.5 + elder trade focus 5 +
 * clan blacksmith 10 + merchant doctrine 5), so buying costs 67.5% of base and
 * selling returns 50%: a 17.5-point loss, no arbitrage. But the margin is only
 * 17.5 points. ONE new 20% discount source — a festival, a title, a clan
 * doctrine — silently turns every purchasable item into an infinite ryo printer
 * that no other test would notice.
 *
 * This is that test. If it fails, do not raise the threshold: either cap the
 * discount or lower the sell-back rate.
 */

/** Every discount source stacked to its ceiling. */
const MAX_DISCOUNT_CHARACTER = {
    villageUpgrades: { shop: 50 },      // 50 x 0.25 = 12.5
    elderFocus: 'trade',                // +5
    clanUpgradeLevels: { blacksmith: 50 }, // capped contribution, +10
    clanDoctrine: 'merchant',           // +5
} as const;

const SELL_BACK_RATE = 0.5; // floor(cost / 2) — mirrored in both sale modules

describe('shop arbitrage invariant', () => {
    it('the maximum stacked discount stays below the sell-back rate', () => {
        const pct = shopDiscountPercent(MAX_DISCOUNT_CHARACTER as unknown as Record<string, unknown>, 'ryo');
        assert.ok(
            pct < SELL_BACK_RATE * 100,
            `max shop discount ${pct}% has reached the ${SELL_BACK_RATE * 100}% sell-back rate — `
            + 'buying and re-selling now MINTS ryo. Cap the discount or lower the sell-back.',
        );
        // Keep a real margin, not a hairline. If a change eats into this, it is
        // a deliberate economy decision that should be made consciously.
        assert.ok(pct <= 40, `max shop discount is ${pct}% — under 10 points of headroom left before arbitrage`);
    });

    it('no PURCHASABLE catalog item can be bought for less than it sells for', () => {
        const pct = shopDiscountPercent(MAX_DISCOUNT_CHARACTER as unknown as Record<string, unknown>, 'ryo');
        for (const item of Object.values(ITEM_CATALOG)) {
            const cost = Number(item.cost) || 0;
            if (cost <= 0) continue;
            const buy = discountedShopCost(cost, pct);
            const sell = Math.floor(cost / 2);
            assert.ok(buy > sell, `${item.id}: buy ${buy} <= sell ${sell} — this item mints ryo on a buy/sell loop`);
        }
    });

    it('hunt materials cannot be bought at all, so their fixed sell price cannot be farmed', () => {
        // Hunt drops are cost:0 with a fixed sell table. That is only safe while
        // they stay unbuyable — a shop entry would be a direct printer.
        for (const id of Object.keys(HUNT_MATERIAL_SELL_RYO)) {
            const item = ITEM_CATALOG[id];
            if (!item) continue;
            assert.equal(Number(item.cost) || 0, 0, `${id} has a purchase cost AND a fixed sell price — that is a ryo printer`);
        }
    });
});
