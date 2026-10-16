import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeCharacterSave } from './[name].js';

test('generic saves cannot forge, clear, backdate or replace the donation XP reservation', () => {
    const previous = process.env.STRICT_RAW_SAVE_LEDGER;
    try {
        for (const strict of ['0', '1']) {
            process.env.STRICT_RAW_SAVE_LEDGER = strict;
            const stored = { character: { name: 'Donor', clanDonationXp: { day: '2026-10-20', used: 1_800 } } };
            for (const incoming of [undefined, null, {}, { day: '2026-10-19', used: 0 }, { day: '2026-10-20', used: 0 }, { day: '2026-10-21', used: 2_000 }]) {
                const output = sanitizeCharacterSave({ character: { name: 'Donor', clanDonationXp: incoming } }, structuredClone(stored));
                assert.deepEqual((output.character as Record<string, unknown>).clanDonationXp, stored.character.clanDonationXp);
            }
            const first = sanitizeCharacterSave({ character: { name: 'Donor', clanDonationXp: { day: '2026-10-20', used: 0 } } }, null);
            assert.equal((first.character as Record<string, unknown>).clanDonationXp, undefined);
        }
    } finally {
        if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
        else process.env.STRICT_RAW_SAVE_LEDGER = previous;
    }
});
