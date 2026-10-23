import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { debitGauntletEntry, PET_GAUNTLET_ENTRY_FEE } from './_gauntlet-entry.js';

describe('server-authoritative Pet Gauntlet entry fee', () => {
    const day = '2026-08-07';

    it('grants one daily free run, then debits each start', () => {
        const first = debitGauntletEntry({ ryo: 2_000, level: 90 }, day);
        assert.equal(first.ok, true);
        if (!first.ok) return;
        assert.equal(first.charged, 0);
        const second = debitGauntletEntry(first.character, day);
        assert.equal(second.ok, true);
        if (second.ok) assert.equal(second.character.ryo, 500);
    });

    it('fails closed when the stored wallet cannot cover a paid run', () => {
        assert.deepEqual(debitGauntletEntry({ ryo: PET_GAUNTLET_ENTRY_FEE - 1, level: 90, petGauntletEntryDate: day, petGauntletEntryCount: 1 }, day), {
            ok: false,
            required: PET_GAUNTLET_ENTRY_FEE,
        });
    });

    it('scales the paid entry with the stored level', () => {
        const paid = debitGauntletEntry({ ryo: 1_000, level: 10, petGauntletEntryDate: day, petGauntletEntryCount: 1 }, day);
        assert.equal(paid.ok, true);
        if (paid.ok) {
            assert.equal(paid.charged, 300);
            assert.equal(paid.character.ryo, 700);
        }
        assert.deepEqual(debitGauntletEntry({ ryo: 299, level: 10, petGauntletEntryDate: day, petGauntletEntryCount: 1 }, day), { ok: false, required: 300 });
    });
});
