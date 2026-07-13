import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { versionedPlayerRecord } from './_mutate-player-save.js';

describe('_mutate-player-save', () => {
    it('bumps the stored player save version', () => {
        const current = { _saveVersion: 7, character: { name: 'Old', ryo: 10 } };
        const nextCharacter = { name: 'Old', ryo: 20 };
        const out = versionedPlayerRecord(current, nextCharacter);
        assert.equal(out._saveVersion, 8);
        assert.equal(out.record._saveVersion, 8);
        assert.equal(out.record.character, nextCharacter);
    });

    it('does not mutate the input save record', () => {
        const current = { _saveVersion: 2, character: { name: 'Old', ryo: 10 } };
        versionedPlayerRecord(current, { name: 'Old', ryo: 20 });
        assert.equal(current._saveVersion, 2);
        assert.deepEqual(current.character, { name: 'Old', ryo: 10 });
    });

    it('starts absent versions at one', () => {
        const out = versionedPlayerRecord({ character: { name: 'Old' } }, { name: 'Old' });
        assert.equal(out._saveVersion, 1);
    });

    it('applies an atomic top-level record patch with the character mutation', () => {
        const current = { _saveVersion: 3, activeTraining: { token: 'abc' }, character: { name: 'Old', stamina: 10 } };
        const out = versionedPlayerRecord(current, { name: 'Old', stamina: 5 }, { activeTraining: null });
        assert.equal(out._saveVersion, 4);
        assert.equal(out.record.activeTraining, null);
        assert.deepEqual(out.record.character, { name: 'Old', stamina: 5 });
        assert.deepEqual(current.activeTraining, { token: 'abc' });
    });
});
