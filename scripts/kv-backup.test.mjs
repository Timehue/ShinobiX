import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { captureBracketedStores, digestOverlay, digestRows, readOverlayDirectory, representativeRecords, sameConnection, validatePayload, writeOverlayDirectory } from './kv-backup.mjs';

const baseRows = [
    { key: 'pvp:battle-1', value: { winner: 'alice' }, expires_at: null, updated_at: '2026-07-12T00:00:02.000Z' },
    { key: 'receipt:shop:1', value: { amount: 10 }, expires_at: null, updated_at: '2026-07-12T00:00:03.000Z' },
];
const overlayEntries = [
    { key: 'save:alice', value: { character: { level: 3 } } },
    { key: 'save:clan-leaf', value: { members: ['alice'] } },
    { key: 'shared:imgfields:avatar', value: { alice: 'data:image/png;base64,AA==' } },
];

function payload() {
    return {
        format: 'shinobix-kv-v2',
        base: { rowCount: baseRows.length, rows: baseRows, sha256: digestRows(baseRows) },
        overlay: { patterns: ['save:*', 'shared:images*', 'shared:imgfields*'], keyCount: overlayEntries.length, entries: overlayEntries, sha256: digestOverlay(overlayEntries) },
    };
}

describe('hybrid KV backup evidence helpers', () => {
    it('accepts an intact two-store payload and rejects either store when tampered', () => {
        const good = payload();
        assert.equal(validatePayload(good), good);
        assert.throws(() => validatePayload({ ...good, base: { ...good.base, rows: [{ ...baseRows[0], value: { tampered: true } }, baseRows[1]] } }), /base-store checksum/i);
        assert.throws(() => validatePayload({ ...good, overlay: { ...good.overlay, entries: [{ ...overlayEntries[0], value: { tampered: true } }, ...overlayEntries.slice(1)] } }), /overlay checksum/i);
    });

    it('rejects database-only v1 backups and incomplete overlay prefix coverage', () => {
        assert.throws(() => validatePayload({ format: 'shinobix-kv-v1', rows: [] }), /incomplete backup format/i);
        const good = payload();
        assert.throws(() => validatePayload({ ...good, overlay: { ...good.overlay, patterns: ['save:*'] } }), /prefix coverage/i);
    });

    it('selects redacted representatives with live saves sourced from the overlay', () => {
        const records = [
            ...overlayEntries.map((entry) => ({ ...entry, store: 'overlay' })),
            ...baseRows.map((row) => ({ ...row, store: 'base' })),
        ];
        const samples = representativeRecords(records);
        assert.deepEqual(samples.map((sample) => sample.category), ['player-save', 'clan', 'image', 'pvp', 'receipt']);
        assert.equal(samples[0].store, 'overlay');
        assert.ok(samples.every((sample) => /^[a-f0-9]{16}$/.test(sample.label)));
        assert.ok(samples.every((sample) => !JSON.stringify(sample).includes('alice')));
    });

    it('round-trips the production disk-overlay file format into an empty target', async () => {
        const root = await mkdtemp(join(tmpdir(), 'shinobix-overlay-test-'));
        try {
            await writeOverlayDirectory(root, overlayEntries);
            const restored = await readOverlayDirectory(root);
            assert.equal(digestOverlay(restored), digestOverlay(overlayEntries));
            await assert.rejects(() => writeOverlayDirectory(root, overlayEntries), /must be empty/i);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('requires explicitly requested representative keys to exist', () => {
        const records = overlayEntries.map((entry) => ({ ...entry, store: 'overlay' }));
        assert.equal(representativeRecords(records, ['save:alice']).length, 1);
        assert.throws(() => representativeRecords(records, ['save:missing']), /not present/i);
    });

    it('refuses the same database even when source and target use different users', () => {
        assert.equal(sameConnection('postgres://source:one@db.example.com:5432/postgres', 'postgres://target:two@db.example.com:5432/postgres'), true);
        assert.equal(sameConnection('postgres://source:one@db.example.com:5432/postgres', 'postgres://target:two@other.example.com:5432/postgres'), false);
    });

    it('captures only an overlay bracketed by identical base-store reads', async () => {
        const changed = baseRows.map((row, index) => index ? row : { ...row, value: { changed: true } });
        const reads = [baseRows, changed, changed, changed];
        const result = await captureBracketedStores(async () => reads.shift(), async () => ({ entries: overlayEntries }));
        assert.equal(result.consistencyAttempt, 2);
        assert.deepEqual(result.rows, changed);
        let nonce = 0;
        await assert.rejects(
            () => captureBracketedStores(
                async () => [{ ...baseRows[0], value: { nonce: nonce++ } }],
                async () => ({ entries: overlayEntries }),
                2,
            ),
            /changed throughout/i,
        );
    });
});
