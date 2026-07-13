import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { digestRows, representativeRecords, validatePayload } from './kv-backup.mjs';

const rows = [
    { key: 'save:alice', value: { character: { level: 3 } }, expires_at: null, updated_at: '2026-07-12T00:00:00.000Z' },
    { key: 'save:clan-leaf', value: { members: ['alice'] }, expires_at: null, updated_at: '2026-07-12T00:00:01.000Z' },
    { key: 'pvp:battle-1', value: { winner: 'alice' }, expires_at: null, updated_at: '2026-07-12T00:00:02.000Z' },
    { key: 'receipt:shop:1', value: { amount: 10 }, expires_at: null, updated_at: '2026-07-12T00:00:03.000Z' },
];

describe('KV backup evidence helpers', () => {
    it('accepts an intact payload and rejects tampering', () => {
        const payload = { format: 'shinobix-kv-v1', rowCount: rows.length, rows, sha256: digestRows(rows) };
        assert.equal(validatePayload(payload), payload);
        assert.throws(() => validatePayload({ ...payload, rows: rows.map((row, index) => index ? row : { ...row, value: { tampered: true } }) }), /checksum/i);
    });

    it('selects redacted representative records by category', () => {
        const samples = representativeRecords(rows);
        assert.deepEqual(samples.map((sample) => sample.category), ['player-save', 'clan', 'pvp', 'receipt']);
        assert.ok(samples.every((sample) => /^[a-f0-9]{16}$/.test(sample.label)));
        assert.ok(samples.every((sample) => !JSON.stringify(sample).includes('alice')));
    });

    it('requires explicitly requested representative keys to exist', () => {
        assert.equal(representativeRecords(rows, ['save:alice']).length, 1);
        assert.throws(() => representativeRecords(rows, ['save:missing']), /not present/i);
    });
});

