import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPlayerSaveSnapshot, readSaveAcknowledgement, readSaveError } from './save-api';
import { validatedSaveVersionEventDetail } from '../authFetch';

test('only complete successful save acknowledgements publish authority', async () => {
    for (const raw of [null, { _saveVersion: 99 }, { ok: false, _saveVersion: 99 },
        { ok: true, _saveVersion: 99, fateShards: '10' }, { ok: false, persisted: false, reason: 'reset-pending' }]) {
        assert.equal(await validatedSaveVersionEventDetail(raw, 'Kaya', 'full-save', '/api/save/kaya'), null);
        await assert.rejects(readSaveAcknowledgement(raw));
    }
    const valid = { ok: true, _saveVersion: 6, ryo: 10 };
    assert.deepEqual(await readSaveAcknowledgement(valid), valid);
    assert.equal((await validatedSaveVersionEventDetail(valid, 'Kaya', 'full-save', '/api/save/kaya'))?.version, 6);
});

test('saved character reads validate the account and preserve unknown progress', async () => {
    const save = { character: { name: 'Kaya', futureProgress: ['kept'] }, _saveVersion: 6 };
    assert.deepEqual(await readPlayerSaveSnapshot(save, 'kaya'), save);
    for (const raw of [{ ...save, _saveVersion: '6' }, { ...save, character: [] }, { ...save, character: { name: 'Other' } }]) {
        await assert.rejects(readPlayerSaveSnapshot(raw, 'Kaya'));
    }
    assert.equal(await readSaveError({ retryAfterMs: 1000 }), null);
});
