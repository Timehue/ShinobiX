import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { captureBracketedStores, digestOverlay, digestRows, readOverlayDirectory, representativeRecords, sameConnection, validatePayload, validateTargetSchemaEvidence, validatedProxyBase, writeOverlayDirectory } from './kv-backup.mjs';

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

    it('accepts the post-retirement base-only payload (explicitly empty overlay)', () => {
        // Since the cPanel overlay retirement (2026-07-17) exportStableOverlay
        // records zero overlay entries and saves live in the base rows — the
        // v2 validator must keep accepting that shape or backup:kv breaks.
        const saveRows = [...baseRows, { key: 'save:alice', value: { character: { level: 3 } }, expires_at: null, updated_at: '2026-07-12T00:00:04.000Z' }];
        const baseOnly = {
            format: 'shinobix-kv-v2',
            base: { rowCount: saveRows.length, rows: saveRows, sha256: digestRows(saveRows) },
            overlay: { patterns: ['save:*', 'shared:images*', 'shared:imgfields*'], keyCount: 0, entries: [], sha256: digestOverlay([]) },
        };
        assert.equal(validatePayload(baseOnly), baseOnly);
        const samples = representativeRecords([
            ...baseOnly.overlay.entries.map((entry) => ({ ...entry, store: 'overlay' })),
            ...saveRows.map((row) => ({ ...row, store: 'base' })),
        ]);
        assert.ok(samples.some((sample) => sample.category === 'player-save' && sample.store === 'base'));
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
        const root = await writeOverlayDirectory(overlayEntries);
        try {
            const restored = await readOverlayDirectory(root);
            assert.equal(digestOverlay(restored), digestOverlay(overlayEntries));
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

    it('maps only the reviewed production proxy destinations to literal URLs', () => {
        assert.equal(validatedProxyBase('https://theravensark.com/api/kv'), 'https://theravensark.com/api/kv');
        assert.equal(validatedProxyBase('https://www.theravensark.com/api/kv/'), 'https://www.theravensark.com/api/kv');
        for (const value of ['http://theravensark.com/api/kv', 'https://evil.example/api/kv', 'https://theravensark.com/api/kv?next=evil', 'https://theravensark.com:444/api/kv']) {
            assert.throws(() => validatedProxyBase(value), /approved|must not/i);
        }
    });

    it('requires the hardened Supabase table, indexes, RLS policy, and read-only anon grant', () => {
        const good = {
            columns: [
                { column_name: 'key', data_type: 'text', is_nullable: 'NO' },
                { column_name: 'value', data_type: 'jsonb', is_nullable: 'NO' },
                { column_name: 'expires_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
                { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
            ],
            indexes: ['kv_store_pkey', 'kv_store_expires_at_idx', 'kv_store_key_pattern_idx'],
            rlsEnabled: true,
            anonReadPolicy: true,
            anonCanSelect: true,
            anonCanInsert: false,
            anonCanUpdate: false,
            anonCanDelete: false,
        };
        assert.equal(validateTargetSchemaEvidence(good), good);
        assert.throws(() => validateTargetSchemaEvidence({ ...good, rlsEnabled: false }), /RLS|privileges/i);
        assert.throws(() => validateTargetSchemaEvidence({ ...good, anonCanInsert: true }), /RLS|privileges/i);
        assert.throws(() => validateTargetSchemaEvidence({ ...good, indexes: ['kv_store_pkey'] }), /missing index/i);
    });
});
