/*
 * Hunt materials and the Weekly Boss Core stack (owner ruling A12): the client
 * folds a loaded save (lib/inventory.ts normalizeInventory) and the server folds
 * every save write (api/save/[name].ts). This drives both, in the order a live
 * session runs them, over repeated load -> autosave -> reload cycles, including
 * a stale tab that still writes the pre-fold shape, and proves every unit of
 * every id is conserved exactly. Imports both trees, so it lives in scripts/.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from '../api/save/[name]';
import { normalizeInventory } from '../shinobij.client/src/lib/inventory';
import type { Character } from '../shinobij.client/src/types/character';
import { STACKED_MATERIAL_IDS, heldUnits, isStackedMaterialId } from '../shared/stacked-materials';

type Char = Record<string, unknown> & { inventory: string[]; itemStacks: Array<{ itemId: string; count: number }> };
const copies = (id: string, n: number) => Array.from({ length: n }, () => id);

const legacy: Char = {
    name: 'roundtrip', level: 70, village: 'Mist',
    hp: 100, maxHp: 100, chakra: 50, maxChakra: 50, stamina: 50, maxStamina: 50, stats: {}, equipment: {},
    inventory: ['rustfang-kunai', ...copies('hunt-legendary-material', 9), ...copies('hunt-shadow-pelt', 4), 'weekly-boss-core',
        ...copies('gather-field-herb', 6), ...copies('hunt-beast-meat', 12)],
    itemStacks: [{ itemId: 'hunt-shadow-pelt', count: 2 }, { itemId: 'thrown-shuriken', count: 20 }],
};
const TRACKED = [...STACKED_MATERIAL_IDS, 'rustfang-kunai', 'gather-field-herb', 'thrown-shuriken'];
const census = (c: Record<string, unknown>) => Object.fromEntries(TRACKED.map((id) => [id, heldUnits(c, id)]));
const clientLoad = (c: Char) => normalizeInventory(structuredClone(c) as unknown as Character) as unknown as Char;
const serverSave = (incoming: Char, stored: Char) =>
    (sanitizeCharacterSave({ character: structuredClone(incoming) }, { character: structuredClone(stored) }).character) as Char;

for (const mode of ['0', '1'] as const) {
    test(`client load and server save fold hunt materials with exact unit conservation (STRICT_RAW_SAVE_LEDGER=${mode})`, () => {
        const previous = process.env.STRICT_RAW_SAVE_LEDGER;
        process.env.STRICT_RAW_SAVE_LEDGER = mode;
        try {
            const expected = census(legacy);
            let stored = legacy;
            for (let cycle = 0; cycle < 6; cycle++) {
                const loaded = clientLoad(stored);
                assert.deepEqual(census(loaded), expected, `cycle ${cycle}: the client load keeps every unit`);
                assert.equal(loaded.inventory.filter(isStackedMaterialId).length, 0, `cycle ${cycle}: the client shows stacks, not copies`);
                // Every other cycle a stale tab writes the legacy shape instead.
                stored = serverSave(cycle % 2 ? legacy : loaded, stored);
                assert.deepEqual(census(stored), expected, `cycle ${cycle}: the server write keeps every unit`);
                assert.equal(stored.inventory.filter(isStackedMaterialId).length, 0, `cycle ${cycle}: the stored save is folded`);
            }
            // Gathered herbs are folded by the client only (they stacked before A12),
            // so a stale tab's herb copies may sit in inventory[] until the next load.
            assert.deepEqual(stored.inventory.filter((id) => id !== 'gather-field-herb'), ['rustfang-kunai']);
        } finally {
            if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
            else process.env.STRICT_RAW_SAVE_LEDGER = previous;
        }
    });
}
