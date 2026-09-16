import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { SettlementItem } from '../shop/_catalog.js';
import { applyInventorySale, HUNT_MATERIAL_SELL_RYO } from './_sale.js';
import { HUNT_MATERIAL_SELL_RYO as SHARED_HUNT_MATERIAL_SELL_RYO } from '../../shared/hunt-material-sale.js';

const item = (overrides: Partial<SettlementItem> = {}): SettlementItem => ({
    id: 'sale-item', name: 'Sale Item', slot: 'hand', rarity: 'common', cost: 101, ...overrides,
} as SettlementItem);
const character = (overrides: Record<string, unknown> = {}) => ({
    name: 'rill', ryo: 10, inventory: [], itemStacks: [], equipment: {}, ...overrides,
});

test('backpack sale consumes stacks before uniques and credits canonical half-cost', () => {
    const sold = applyInventorySale(character({ inventory: ['sale-item', 'other'], itemStacks: [{ itemId: 'sale-item', count: 2 }] }), item(), 'backpack', 3, undefined, 'inventorysale001', 100);
    assert.equal(sold.ok, true);
    if (!sold.ok) return;
    assert.equal(sold.character.ryo, 160);
    assert.deepEqual(sold.character.inventory, ['other']);
    assert.deepEqual(sold.character.itemStacks, []);
    const replay = applyInventorySale(sold.character, item(), 'backpack', 3, undefined, 'inventorysale001', 101);
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.character.ryo, 160);

    const legacy = applyInventorySale(character({ inventory: ['sale-item'], itemStacks: undefined }), item(), 'backpack', 1, undefined, 'inventorysale007', 100);
    assert.equal(legacy.ok, true);
});

test('equipped sale requires the physical slot and clears its aliases', () => {
    const sold = applyInventorySale(character({ equipment: { hand: 'sale-item', weapon: 'sale-item', gloves: 'keep' } }), item(), 'equipped', 9, 'hand', 'inventorysale002', 100);
    assert.equal(sold.ok, true);
    if (sold.ok) assert.deepEqual(sold.character.equipment, { gloves: 'keep' });
    assert.equal(applyInventorySale(character({ equipment: { hand: 'other' } }), item(), 'equipped', 1, 'hand', 'inventorysale003', 100).ok, false);
});

test('equipped sales resolve canonical client slots and never revive a shadowed alias', () => {
    for (const [storedSlot, selectedSlot] of [['weapon', 'hand'], ['hand', 'weapon'], ['armor', 'body'], ['accessory', 'aura']]) {
        const sold = applyInventorySale(character({ equipment: { [storedSlot]: 'sale-item' } }), item(), 'equipped', 1, selectedSlot, `alias-${storedSlot}`, 100);
        assert.equal(sold.ok, true);
        if (sold.ok) assert.deepEqual(sold.character.equipment, {});
    }
    for (const equipment of [{ weapon: 'other', hand: 'sale-item' }, { hand: 'sale-item', weapon: 'other' }]) {
        const stored = character({ inventory: ['other'], equipment });
        assert.equal(applyInventorySale(stored, item({ id: 'other' }), 'equipped', 1, 'weapon', 'shadowedsale01', 100).ok, false);
        const sold = applyInventorySale(stored, item(), 'equipped', 1, 'hand', 'canonicalsal01', 100);
        assert.equal(sold.ok, true);
        if (!sold.ok) continue;
        assert.deepEqual(sold.character.equipment, {});
        assert.deepEqual(sold.character.inventory, ['other']);
        assert.equal(sold.character.ryo, 60);
    }
});

test('all reference slots refuse equipped sales without mutating the owned stack', () => {
    for (const slot of ['item', 'item1', 'item2', 'item3', 'thrown', 'potion']) {
        const stored = character({ itemStacks: [{ itemId: 'sale-item', count: 1 }], equipment: { [slot]: 'sale-item' } });
        const before = structuredClone(stored);
        const sold = applyInventorySale(stored, item({ slot: 'item' }), 'equipped', 1, slot, `reference-sale-${slot}`, 100);
        assert.equal(sold.ok, false, slot);
        assert.deepEqual(stored, before);
    }
});

test('sale rejects missing ownership, unsellable items, invalid balances, and request conflicts', () => {
    assert.equal(applyInventorySale(character(), item(), 'backpack', 1, undefined, 'inventorysale004', 100).ok, false);
    assert.equal(applyInventorySale(character({ inventory: ['sale-item'] }), item({ cost: 0 }), 'backpack', 1, undefined, 'inventorysale005', 100).ok, false);
    assert.equal(applyInventorySale(character({ ryo: -1, inventory: ['sale-item'] }), item(), 'backpack', 1, undefined, 'inventorysale006', 100).ok, false);
});

test('hunt drop materials (cost:0) sell for their rarity-tiered ryo value', () => {
    // common Beast Meat = 15 ryo each
    const sold = applyInventorySale(
        character({ ryo: 0, inventory: ['hunt-beast-meat', 'hunt-beast-meat'] }),
        item({ id: 'hunt-beast-meat', slot: 'item', rarity: 'common', cost: 0 }),
        'backpack', 2, undefined, 'huntsale001', 100,
    );
    assert.equal(sold.ok, true);
    if (sold.ok) assert.equal(sold.character.ryo, 30);
    // legendary Legendary Material = 600 ryo each
    const leg = applyInventorySale(
        character({ ryo: 0, inventory: ['hunt-legendary-material'] }),
        item({ id: 'hunt-legendary-material', slot: 'item', rarity: 'legendary', cost: 0 }),
        'backpack', 1, undefined, 'huntsale002', 100,
    );
    assert.equal(leg.ok, true);
    if (leg.ok) assert.equal(leg.character.ryo, 600);
    // a NON-hunt cost:0 item stays unsellable (materials didn't make everything sellable)
    assert.equal(
        applyInventorySale(character({ inventory: ['misc'] }), item({ id: 'misc', slot: 'item', cost: 0 }), 'backpack', 1, undefined, 'huntsale003', 100).ok,
        false,
    );
});

test('sale route and inventory screen use authenticated locked settlement', () => {
    const route = readFileSync(join(process.cwd(), 'api', 'inventory', 'sell.ts'), 'utf8');
    const helper = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'lib', 'shop-settlement.ts'), 'utf8');
    const screen = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'screens', 'Inventory.tsx'), 'utf8');
    assert.match(route, /await authedPlayer\(req, playerName\)/);
    assert.match(route, /await mutatePlayerSave\(playerName/);
    assert.match(route, /strict: true/);
    assert.match(helper, /'\/api\/inventory\/sell'/);
    assert.match(screen, /settleInventorySale\(character\.name/);
    assert.match(screen, /if \(!onVersionedCharacter\(result\.character, result\._saveVersion\)\) \{\s*setSaleError\(\{ selection: selected, message: AMBIGUOUS_ACTION_MESSAGE \}\);\s*return;\s*\}/,
        'an unaccepted sale snapshot must retain item details and explain recovery');
    assert.match(screen, /gameToast\(`Sold [\s\S]*?setSelectedInventoryItem\(\(current\) => current === selected \? null : current\)/,
        'an accepted sale reports its receipt and only closes the submitted selection');
});

test('every shared hunt-material price preserves the authoritative sale payout', () => {
    const expectedPrices = {
        'hunt-torn-hide': 12, 'hunt-wild-feather': 12, 'hunt-small-fang': 12, 'hunt-cracked-horn': 12,
        'hunt-beast-meat': 15, 'hunt-frost-pelt': 40, 'hunt-shadow-claw': 40, 'hunt-wolf-fang': 55,
        'hunt-ash-scale': 80, 'hunt-ember-scale': 180, 'hunt-shadow-pelt': 220,
        'hunt-ancient-beast-core': 450, 'hunt-titan-bone': 450, 'hunt-legendary-material': 600,
    };
    assert.strictEqual(HUNT_MATERIAL_SELL_RYO, SHARED_HUNT_MATERIAL_SELL_RYO, 'legacy API export remains compatible');
    assert.deepEqual(HUNT_MATERIAL_SELL_RYO, expectedPrices);
    for (const [id, price] of Object.entries(expectedPrices)) {
        for (const quantity of [1, 9_999]) {
            const stored = character({ itemStacks: [{ itemId: id, count: 9_999 }] });
            const before = structuredClone(stored);
            const sold = applyInventorySale(stored, item({ id, slot: 'item', cost: 0 }), 'backpack', quantity, undefined, 'shared-hunt-sale', 100);
            assert.equal(sold.ok, true, id);
            if (!sold.ok) continue;
            assert.deepEqual(sold.value, { kind: 'inventory-sale', itemId: id, quantity, ryo: price * quantity, source: 'backpack' });
            assert.equal(sold.character.ryo, 10 + price * quantity);
            assert.equal(sold.replayed, false);
            assert.deepEqual(stored, before, 'settlement must leave its input unchanged');
        }
        const priced = applyInventorySale(character({ inventory: [id] }), item({ id, cost: 101 }), 'backpack', 1, undefined, 'priced-hunt-sale', 100);
        assert.equal(priced.ok, true, id);
        if (priced.ok) assert.equal(priced.value.ryo, 50, 'positive catalog cost still takes precedence over the material price');
    }
});
