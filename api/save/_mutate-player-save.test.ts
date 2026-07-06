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
});
