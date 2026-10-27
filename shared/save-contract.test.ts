import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playerSaveRequestContract as request, playerSaveSnapshotContract as snapshot, playerSaveAcknowledgementContract as acknowledgement, deferredSaveContract, saveWriteResponseContract, saveErrorContract } from './save-contract.js';

test('save contracts retain opaque game fields and legacy versionless snapshots', () => {
    const save = { character: { name: 'Kaya', futureProgress: { keep: true } }, futureContent: [1], _baseSaveVersion: 0 };
    assert.deepEqual(request.parse(save), save);
    assert.deepEqual(snapshot.parse(save), save);
    assert.deepEqual(saveWriteResponseContract.parse({ ok: true }), { ok: true }, 'clan/reset acknowledgements stay versionless');
    assert.deepEqual(deferredSaveContract.parse({ ok: false, persisted: false, reason: 'reset-pending' }), { ok: false, persisted: false, reason: 'reset-pending' });
});

test('save requests reject malformed containers and unsafe base versions', () => {
    for (const body of [null, [], { character: [] }, { character: null },
        ...[undefined, null, '1', -1, 0.5, Number.MAX_SAFE_INTEGER + 1].map(_baseSaveVersion => ({ character: {}, _baseSaveVersion }))]) {
        assert.equal(request.safeParse(body).success, false);
    }
});

test('durable save acknowledgements require explicit success and validate every adopted field', () => {
    const valid = { ok: true, _saveVersion: 3, ryo: 10, fateShards: 2, nextSaveInMs: 1200,
        savedBloodlineIds: ['owned'], savedBloodlineRanks: { owned: 'B Rank' }, equippedBloodlineId: null };
    assert.deepEqual(acknowledgement.parse(valid), valid);
    for (const body of [null, {}, { ...valid, ok: false }, { ...valid, ok: undefined },
        ...[{ _saveVersion: '3' }, { _saveVersion: 0 }, { ryo: Infinity }, { fateShards: -2 }, { persisted: false },
            { nextSaveInMs: '20' }, { savedBloodlineIds: [1] }, { savedBloodlineRanks: { owned: {} } }, { equippedBloodlineId: [] }]
            .map(patch => ({ ...valid, ...patch }))]) assert.equal(acknowledgement.safeParse(body).success, false);
});

test('save error contracts retain status-specific metadata without accepting malformed recovery hints', () => {
    const valid = { error: 'Ryo is server-authoritative.', code: 'RYO_SERVER_AUTHORITY', authoritativeRyo: 10, _saveVersion: 0 };
    assert.deepEqual(saveErrorContract.parse(valid), valid);
    for (const body of [{ code: 'RYO_SERVER_AUTHORITY', authoritativeRyo: 10 }, { error: [] },
        { error: 'conflict', currentVersion: '3' }, { error: 'retry', retryAfterMs: -1 }]) {
        assert.equal(saveErrorContract.safeParse(body).success, false);
    }
});
