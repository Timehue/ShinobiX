import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeCharacterSave } from './[name].js';
import { applyInventorySale } from '../inventory/_sale.js';
import { sellCatalogItem } from '../shop/_sale.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import type { SettlementItem } from '../shop/_catalog.js';

type Character = Record<string, unknown>;
const kunai = 'rustfang-kunai';
const katana = 'training-katana';
const shuriken = 'thrown-shuriken';
const character = (overrides: Character = {}): Character => ({
    name: 'holder', level: 100, ryo: 0, inventory: [], itemStacks: [], equipment: {}, stats: {}, ...overrides,
});
const save = (incoming: Character, stored: Character) =>
    sanitizeCharacterSave({ character: incoming }, { character: stored }).character as Character;

function withLedger<T>(flag: string | undefined, run: () => T): T {
    const previous = process.env.STRICT_RAW_SAVE_LEDGER;
    if (flag === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
    else process.env.STRICT_RAW_SAVE_LEDGER = flag;
    try { return run(); }
    finally {
        if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
        else process.env.STRICT_RAW_SAVE_LEDGER = previous;
    }
}

// Independent assertion: reference slots do not contribute owned units.
function ownedCount(char: Character, id: string): number {
    const backpack = (char.inventory as string[]).filter(value => value === id).length;
    const stacks = (char.itemStacks as Array<{ itemId: string; count: number }>).reduce((n, stack) => n + (stack.itemId === id ? stack.count : 0), 0);
    const equipment = char.equipment as Record<string, string>;
    const equipped = [equipment.hand ?? equipment.weapon, equipment.body ?? equipment.armor, equipment.aura ?? equipment.accessory,
        equipment.relic, equipment.head, equipment.waist, equipment.legs, equipment.feet, equipment.gloves].filter(value => value === id).length;
    return backpack + stacks + equipped;
}

for (const flag of [undefined, '0', '1']) describe(`equipment conservation, strict ledger ${flag ?? 'unset'}`, () => {
    it('retains an unequipped weapon through repeated saves and re-equips', () => withLedger(flag, () => {
        let current = character({ equipment: { hand: kunai } });
        for (let n = 0; n < 3; n++) {
            current = save({ ...current, inventory: [kunai], equipment: {} }, current);
            assert.deepEqual(current.inventory, [kunai]);
            assert.deepEqual(current.equipment, {});
            current = save(current, current);
            assert.equal(ownedCount(current, kunai), 1);
            current = save({ ...current, inventory: [], equipment: { hand: kunai } }, current);
            assert.deepEqual(current.equipment, { hand: kunai });
            assert.equal(ownedCount(current, kunai), 1);
        }
    }));

    it('returns displaced gear to the backpack during a swap', () => withLedger(flag, () => {
        const stored = character({ inventory: [katana], equipment: { hand: kunai } });
        const swapped = save({ ...stored, inventory: [kunai], equipment: { hand: katana } }, stored);
        assert.deepEqual(swapped.inventory, [kunai]);
        assert.deepEqual(swapped.equipment, { hand: katana });
        assert.equal(ownedCount(swapped, kunai), 1);
        assert.equal(ownedCount(swapped, katana), 1);
    }));

    it('honors the client canonical swap while an older alias remains in the equipment object', () => withLedger(flag, () => {
        for (const [alias, slot, oldId, newId] of [
            ['weapon', 'hand', kunai, katana],
            ['armor', 'body', 'shinobi-vest', 'reinforced-vest'],
        ]) {
            const stored = character({ inventory: [newId], equipment: { [alias]: oldId } });
            for (const equipment of [{ [alias]: oldId, [slot]: newId }, { [slot]: newId, [alias]: oldId }]) {
                const swapped = save({ ...stored, inventory: [oldId], equipment }, stored);
                assert.deepEqual(swapped.inventory, [oldId]);
                assert.deepEqual(swapped.equipment, { [slot]: newId });
                assert.equal(ownedCount(swapped, oldId), 1);
                assert.equal(ownedCount(swapped, newId), 1);
            }
        }
    }));

    it('never turns a shadowed stored alias into an extra owned item', () => withLedger(flag, () => {
        for (const equipment of [{ weapon: kunai, hand: katana }, { hand: katana, weapon: kunai }]) {
            const stored = character({ equipment });
            const returned = save({ ...stored, inventory: [kunai, katana, katana], equipment: {} }, stored);
            assert.deepEqual(returned.inventory, [katana]);
            assert.deepEqual(returned.equipment, {});
            const realCopy = character({ inventory: [kunai], equipment });
            const bothReturned = save({ ...realCopy, inventory: [kunai, katana], equipment: {} }, realCopy);
            assert.deepEqual(bothReturned.inventory, [kunai, katana]);
        }
    }));

    it('resolves a canonical combat selection without minting its shadowed alias', () => withLedger(flag, () => {
        const stored = character({ itemStacks: [{ itemId: 'item-attack-pill', count: 1 }, { itemId: 'item-defense-pill', count: 1 }] });
        const selected = save({ ...stored, equipment: { item: 'item-attack-pill', item1: 'item-defense-pill' } }, stored);
        assert.deepEqual(selected.equipment, { item1: 'item-defense-pill' });
        assert.deepEqual(selected.itemStacks, stored.itemStacks);
    }));

    it('counts legacy equipment aliases once and rejects a duplicated backpack copy', () => withLedger(flag, () => {
        const stored = character({ equipment: { hand: kunai, weapon: kunai } });
        const unequipped = save({ ...stored, inventory: [kunai, kunai], equipment: {} }, stored);
        assert.deepEqual(unequipped.inventory, [kunai]);
        const duplicated = save({ ...stored, inventory: [kunai], equipment: { hand: kunai } }, stored);
        assert.equal(ownedCount(duplicated, kunai), 1);
        const twoOwned = character({ inventory: [kunai], equipment: { hand: kunai, weapon: kunai } });
        const bothReturned = save({ ...twoOwned, inventory: [kunai, kunai], equipment: {} }, twoOwned);
        assert.equal(ownedCount(bothReturned, kunai), 2, 'a genuine backpack copy remains distinct from the equipped unit');
    }));

    it('allows unequip at backpack capacity without dropping owned gear', () => withLedger(flag, () => {
        const inventory = Array.from({ length: 500 }, (_, i) => `held-${i}`);
        const stored = character({ inventory, equipment: { hand: kunai } });
        const next = save({ ...stored, inventory: [...inventory, kunai], equipment: {} }, stored);
        assert.deepEqual(next.inventory, [...inventory, kunai]);
    }));

    it('never counts a consumable selection as another owned unit', () => withLedger(flag, () => {
        const stored = character({ itemStacks: [{ itemId: shuriken, count: 1 }], equipment: { thrown: shuriken } });
        const forged = save({ ...stored, itemStacks: [{ itemId: shuriken, count: 2 }], equipment: {} }, stored);
        assert.deepEqual(forged.itemStacks, [{ itemId: shuriken, count: 1 }]);
        const consumed = save({ ...stored, itemStacks: [], equipment: { thrown: shuriken } }, stored);
        assert.deepEqual(consumed.equipment, {}, 'a consumed stack cannot leave a usable equipment reference');
        const stale = character({ equipment: { thrown: shuriken } });
        assert.deepEqual(save({ ...stale, inventory: [shuriken] }, stale).inventory, []);
    }));

    it('refuses repeat equipped-consumable sales in both handlers and permits one backpack sale', () => withLedger(flag, () => {
        for (const route of ['inventory', 'shop']) {
            let current = character({ itemStacks: [{ itemId: shuriken, count: 1 }] });
            for (let n = 0; n < 3; n++) {
                current = save({ ...current, equipment: { thrown: shuriken } }, current);
                const before = structuredClone(current);
                const sale = route === 'inventory'
                    ? applyInventorySale(current, ITEM_CATALOG[shuriken] as SettlementItem, 'equipped', 1, 'thrown', `audit-sale-${n}`, 100 + n)
                    : sellCatalogItem(current, shuriken, 1, 'thrown');
                assert.equal(sale.ok, false);
                assert.deepEqual(current, before);
            }
            const sale = route === 'inventory'
                ? applyInventorySale(current, ITEM_CATALOG[shuriken] as SettlementItem, 'backpack', 1, undefined, 'audit-sale-backpack', 200)
                : sellCatalogItem(current, shuriken, 1);
            assert.equal(sale.ok, true);
            if (!sale.ok) return;
            const settled = save(sale.character, sale.character);
            assert.equal(settled.ryo, 200);
            assert.equal(ownedCount(settled, shuriken), 0);
            assert.deepEqual(settled.equipment, {});
        }
    }));
});
