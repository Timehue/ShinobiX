import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeCharacterSave } from './[name].js';

/*
 * Village Merit gates a Kage challenge (KAGE_MIN_MERIT 250), and only server
 * endpoints may credit it: the daily agenda, map control, treasury donations,
 * ANBU cache turn-ins and war crates. Valuing donated items at their NPC sale
 * value (economy rebalance 2026-10, I-7) closes nothing if a generic save can
 * simply write 9,999 merit, which it could: the field had no ownership entry.
 * The stored value must win whatever the client sends, omits or zeroes.
 *
 * This guard needs `villageMerit` in api/save/_state-ownership.ts (handoff
 * B-village-clan-social, H1); it fails until that entry lands.
 */
test('a generic save cannot raise, clear or zero personal Village Merit', () => {
    const previous = process.env.STRICT_RAW_SAVE_LEDGER;
    try {
        for (const strict of ['0', '1']) {
            process.env.STRICT_RAW_SAVE_LEDGER = strict;
            const stored = { character: { name: 'Merit', level: 90, villageMerit: 10 } };
            for (const incoming of [9_999, 250, 11, undefined, 0, -5, '9999', null]) {
                const output = sanitizeCharacterSave({ character: { name: 'Merit', level: 90, villageMerit: incoming } }, structuredClone(stored));
                assert.equal((output.character as Record<string, unknown>).villageMerit, 10, `STRICT=${strict}, incoming ${String(incoming)}`);
            }
            const first = sanitizeCharacterSave({ character: { name: 'Merit', villageMerit: 9_999 } }, null);
            assert.ok(!Number((first.character as Record<string, unknown>).villageMerit), 'a first save cannot start with merit');
        }
    } finally {
        if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
        else process.env.STRICT_RAW_SAVE_LEDGER = previous;
    }
});
