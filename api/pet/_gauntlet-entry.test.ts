import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { debitGauntletEntry, PET_GAUNTLET_ENTRY_FEE } from './_gauntlet-entry.js';

describe('server-authoritative Pet Gauntlet entry fee', () => {
    const day = '2026-08-07';

    it('grants one daily free run, then debits each start', () => {
        const first = debitGauntletEntry({ ryo: 2_000 }, day);
        assert.equal(first.ok, true);
        if (!first.ok) return;
        assert.equal(first.charged, 0);
        const second = debitGauntletEntry(first.character, day);
        assert.equal(second.ok, true);
        if (second.ok) assert.equal(second.character.ryo, 500);
    });

    it('fails closed when the stored wallet cannot cover a paid run', () => {
        assert.deepEqual(debitGauntletEntry({ ryo: PET_GAUNTLET_ENTRY_FEE - 1, petGauntletEntryDate: day, petGauntletEntryCount: 1 }, day), {
            ok: false,
            required: PET_GAUNTLET_ENTRY_FEE,
        });
    });
});
