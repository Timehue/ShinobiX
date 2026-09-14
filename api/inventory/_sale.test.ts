import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { SettlementItem } from '../shop/_catalog.js';
import { applyInventorySale } from './_sale.js';

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
    assert.match(screen, /if \(!onVersionedCharacter\(result\.character, result\._saveVersion\)\) return;\s*setSelectedInventoryItem\(null\)/,
        'the authoritative sale snapshot must be accepted before closing the item action');
});
