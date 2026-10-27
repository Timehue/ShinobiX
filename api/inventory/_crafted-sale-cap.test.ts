import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
    CRAFTED_SALE_INPUT_DEN,
    CRAFTED_SALE_INPUT_NUM,
    SUPPLY_CRAFT_RECIPES,
    craftedSaleCapRyo,
    standardSaleUnitValue,
} from '../../shared/crafting-recipes.js';
import { HUNT_MATERIAL_SELL_RYO } from '../../shared/hunt-material-sale.js';
import { isStepItemId } from '../../shared/gear-steps.js';
import { gearCraftRyo } from '../../shared/craft-fees.js';
import { saleCostBasis } from '../../shared/shop-pricing.js';
import { isNamedGearId } from '../../shared/named-gear-rules.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import type { SettlementItem } from '../shop/_catalog.js';
import { applyInventorySale } from './_sale.js';
import { sellCatalogItem } from '../shop/_sale.js';

/*
 * Crafted goods sell to the NPC for at most 7/10 of what their inputs sell for
 * (2026-10 economy rebalance, framework 2.11 / #33). Before, a supply recipe
 * charged no ryo and its output sold for half its catalog cost, so crafting
 * turned unsellable gathered materials, and hunt materials at 1.65-17x their own
 * sale price, into ryo (3 Apex Fangs paid 14,400 against 6,360 for the raw
 * materials). Every expected value below is derived from the live hunt-material
 * table, so the hunt-material re-price cannot break these tests.
 */

const catalog = ITEM_CATALOG as Record<string, { id: string; slot: string; rarity: string; cost?: number; saleBasis?: number; weaponEp?: number; armorQuality?: string }>;
// What NPC buy-back prices from: the pre-scale cost of a repriced item (shared/shop-pricing.ts).
const costOf = (id: string) => Math.max(0, Math.floor(saleCostBasis({ cost: Number(catalog[id]?.cost) || 0, saleBasis: catalog[id]?.saleBasis })));
const half = (id: string) => Math.floor(costOf(id) / 2);
const itemRecipes = Object.entries(SUPPLY_CRAFT_RECIPES).filter(([id, recipe]) => !recipe.currency && catalog[id]);

/** What the player could get for one unit of an input instead of crafting with it. */
function inputSaleValue(id: string): number {
    if (Object.hasOwn(HUNT_MATERIAL_SELL_RYO, id)) return HUNT_MATERIAL_SELL_RYO[id];
    if (Object.hasOwn(SUPPLY_CRAFT_RECIPES, id) && catalog[id]) return standardSaleUnitValue(id, costOf(id));
    return 0; // gathered and graded materials have no NPC price
}
function cheapestInputValue(id: string): number {
    return SUPPLY_CRAFT_RECIPES[id].ingredients.reduce((sum, row) =>
        sum + row.count * Math.min(...row.ids.map(inputSaleValue)), 0);
}

/** Outputs whose recipes accept only gathered materials (plus a gathered-only intermediate). */
const GATHER_ONLY = [
    'thrown-shuriken', 'thrown-senbon', 'item-smoke-bomb', 'potion-rejuvenation',
    'consum-smoke-pellet', 'consum-cleansing-incense', 'consum-lifeline-elixir',
    'pve-loyal-companion-bell', 'pve-avengers-pendant', 'pet-treat',
];
/** Crafter-only pet food (main's pet growth v2): no catalog price, so never an NPC sale. */
const CRAFT_ONLY_FOOD = ['elemental-pet-treat', 'ancient-pet-treat'];

describe('crafted goods sell for at most 7/10 of their inputs', () => {
    it('uses the 7/10 ratio', () => {
        assert.equal(CRAFTED_SALE_INPUT_NUM / CRAFTED_SALE_INPUT_DEN, 0.7);
    });

    it('every crafted output sells for no more than 0.7 x its cheapest inputs, and never above half its cost', () => {
        let checked = 0;
        for (const [id, recipe] of itemRecipes) {
            if (costOf(id) <= 0) continue;
            checked++;
            const unit = standardSaleUnitValue(id, costOf(id));
            const perCraft = unit * (recipe.count ?? 1);
            // Integer 7/10, not 0.7: 0.7 x 650 is 454.999... in binary floating point.
            assert.ok(perCraft <= Math.floor((cheapestInputValue(id) * 7) / 10), `${id}: ${perCraft} per craft > 0.7 x ${cheapestInputValue(id)}`);
            assert.ok(unit <= half(id), `${id}: ${unit} > half cost ${half(id)}`);
            assert.ok(unit >= 0 && Number.isSafeInteger(unit), `${id}: ${unit}`);
        }
        // 24 since Elemental Treats lost their shop price (main's pet growth v2).
        assert.ok(checked >= 24, `only ${checked} crafted outputs checked`);
    });

    it('Crafter-only pet food has no price and sells for nothing', () => {
        for (const id of CRAFT_ONLY_FOOD) {
            assert.equal(costOf(id), 0, id);
            assert.equal(standardSaleUnitValue(id, costOf(id)), 0, id);
        }
    });

    it('a craft made only of gathered materials sells for nothing', () => {
        for (const id of GATHER_ONLY) {
            assert.ok(costOf(id) > 0, `${id} still has a catalog price`);
            assert.equal(craftedSaleCapRyo(id), 0, id);
            assert.equal(standardSaleUnitValue(id, costOf(id)), 0, id);
        }
    });

    it('pins the outputs whose inputs the hunt-material re-price leaves alone', () => {
        const pins: Record<string, number> = {
            'item-attack-pill': 21,        // 2 Beast Meat x 15
            'item-defense-pill': 16,       // 2 Cracked Horn x 12
            'thrown-serpent-dust': 16,     // 2 Wild Feather x 12
            'consum-phantom-charm': 25,    // 3 Wild Feather x 12
            'pve-hunters-bond-harness': 100, // 12 Torn Hide x 12
            'pve-frenzy-claw': 224,        // 8 Shadow Claw x 40
            'pve-predators-fang': 308,     // 8 Wolf Fang x 55
            'pve-pack-alpha-crest': 455,   // 8 Frost Pelt x 40 + 6 Wolf Fang x 55
        };
        for (const [id, expected] of Object.entries(pins)) {
            assert.equal(standardSaleUnitValue(id, costOf(id)), expected, id);
        }
    });

    it('an intermediate never overstates the cap of the recipe it feeds', () => {
        let seen = 0;
        for (const [, recipe] of itemRecipes) {
            for (const row of recipe.ingredients) {
                for (const id of row.ids) {
                    if (!Object.hasOwn(SUPPLY_CRAFT_RECIPES, id)) continue;
                    seen++;
                    const cap = craftedSaleCapRyo(id);
                    assert.ok(cap != null && cap <= half(id), `${id}: cap ${cap} > half cost ${half(id)}`);
                }
            }
        }
        assert.ok(seen >= 1, 'the Elemental Treat still feeds on Treats');
    });

    it('crafted gear already sells for no more than 0.7 x its craft fee', () => {
        // api/craft/_forge.ts ryoFor reads shared/craft-fees.ts gearCraftRyo.
        const fee = gearCraftRyo;
        let checked = 0;
        for (const item of Object.values(catalog)) {
            if (item.id.startsWith('named-') || isStepItemId(item.id)) continue;
            const weapon = item.slot === 'hand' && item.weaponEp != null && ['rare', 'epic', 'legendary'].includes(item.rarity);
            const armor = ['body', 'head', 'waist', 'legs', 'feet'].includes(item.slot) && item.rarity === 'rare' && Boolean(item.armorQuality);
            if (!weapon && !armor) continue;
            checked++;
            assert.ok(half(item.id) <= Math.floor((fee(item.rarity) * 7) / 10), `${item.id}: sells ${half(item.id)} > 0.7 x ${fee(item.rarity)}`);
        }
        assert.ok(checked >= 15, `only ${checked} craftable gear pieces checked`);
    });

    it('leaves every item without a supply recipe at half its cost', () => {
        for (const item of Object.values(catalog)) {
            if (Object.hasOwn(SUPPLY_CRAFT_RECIPES, item.id)) continue;
            assert.equal(craftedSaleCapRyo(item.id), null, item.id);
            assert.equal(standardSaleUnitValue(item.id, costOf(item.id)), half(item.id), item.id);
        }
    });
});

// The three doors below price through standardSaleUnitValue once the
// integration edits in handoff A-professions-crafting-gathering (PCG-1) land in
// api/inventory/_sale.ts, api/shop/_sale.ts and Inventory.tsx.
describe('both sale routes and the Inventory preview apply the crafted-goods cap', () => {
    const settlementItem = (id: string) => ({ ...catalog[id], cost: costOf(id) } as unknown as SettlementItem);
    const holder = (id: string) => ({ name: 'crafter', ryo: 0, inventory: [], itemStacks: [{ itemId: id, count: 3 }], equipment: {} });

    it('refuses a gather-only craft on /inventory/sell and /shop/sell, and changes nothing', () => {
        for (const id of GATHER_ONLY) {
            const stored = holder(id);
            const before = structuredClone(stored);
            const inventory = applyInventorySale(stored, settlementItem(id), 'backpack', 1, undefined, `capped-${id}`, 100);
            assert.equal(inventory.ok, false, `${id} sold on /inventory/sell`);
            if (!inventory.ok) assert.equal(inventory.status, 400, id);
            const shop = sellCatalogItem(stored, id, 1);
            assert.equal(shop.ok, false, `${id} sold on /shop/sell`);
            assert.deepEqual(stored, before, id);
        }
    });

    it('credits exactly the capped unit value on both routes for every crafted output', () => {
        let sold = 0;
        for (const [id] of itemRecipes) {
            const unit = standardSaleUnitValue(id, costOf(id));
            if (unit <= 0) continue;
            sold++;
            const inventory = applyInventorySale(holder(id), settlementItem(id), 'backpack', 2, undefined, `capped-${id}`, 100);
            assert.equal(inventory.ok && inventory.value.ryo, unit * 2, `${id} on /inventory/sell`);
            const shop = sellCatalogItem(holder(id), id, 2);
            assert.equal(shop.ok && shop.sale.unitValue, unit, `${id} on /shop/sell`);
        }
        assert.ok(sold >= 12, `only ${sold} sellable crafted outputs`);
        // Spot checks on both doors (item and thrown slots).
        const charm = applyInventorySale(holder('pve-apex-predator-fang'), settlementItem('pve-apex-predator-fang'), 'backpack', 1, undefined, 'capped-apex', 100);
        assert.equal(charm.ok && charm.value.ryo, standardSaleUnitValue('pve-apex-predator-fang', costOf('pve-apex-predator-fang')));
        const dust = sellCatalogItem(holder('thrown-serpent-dust'), 'thrown-serpent-dust', 1);
        assert.equal(dust.ok && dust.sale.unitValue, 16);
    });

    it('an ordinary catalog item still sells for half its cost on both routes', () => {
        for (const id of ['rustfang-kunai', 'ashen-leaf-saber', 'cloth-hood']) {
            assert.ok(!isNamedGearId(id) && !isStepItemId(id) && !Object.hasOwn(SUPPLY_CRAFT_RECIPES, id), id);
            const inventory = applyInventorySale(holder(id), settlementItem(id), 'backpack', 1, undefined, `plain-${id}`, 100);
            assert.equal(inventory.ok && inventory.value.ryo, half(id), id);
            const shop = sellCatalogItem(holder(id), id, 1);
            assert.equal(shop.ok && shop.sale.unitValue, half(id), id);
        }
    });

    it('the Inventory preview prices through the same shared helper', () => {
        const src = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'screens', 'Inventory.tsx'), 'utf8');
        const fn = src.slice(src.indexOf('function sellValueForItem('), src.indexOf('async function sellSelectedItem('));
        assert.match(fn, /standardSaleUnitValue\(item\.id, saleCostBasis\(/, 'the preview must call standardSaleUnitValue');
        assert.doesNotMatch(fn, /Math\.floor\(Math\.max\(0, \(item\.cost \?\? 0\)\) \/ 2\)/, 'the preview still prices crafted goods at half cost');
    });
});
