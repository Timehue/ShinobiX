import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    assertBaseOnlyRestore,
    assertNoLegacyOverlayExport,
    backupStorageTopology,
    captureBracketedStores,
    digestOverlay,
    digestRows,
    representativeRecords,
    restoreApplicationStoragePlan,
    sameConnection,
    sameDatabaseIdentity,
    validatePayload,
    validateTargetSchemaEvidence,
    verifyRestoreRepresentatives,
} from './kv-backup.mjs';

const baseRows = [
    { key: 'pvp:battle-1', value: { winner: 'alice' }, expires_at: null, updated_at: '2026-07-12T00:00:02.000Z' },
    { key: 'receipt:shop:1', value: { amount: 10 }, expires_at: null, updated_at: '2026-07-12T00:00:03.000Z' },
];
// The overlay section of a backup captured before the 2026-07-17 cutover.
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

function baseOnlyPayload() {
    const rows = [
        ...baseRows,
        { key: 'save:alice', value: { character: { level: 3 } }, expires_at: null, updated_at: '2026-07-12T00:00:04.000Z' },
    ];
    return {
        format: 'shinobix-kv-v2',
        base: { rowCount: rows.length, rows, sha256: digestRows(rows) },
        overlay: { patterns: ['save:*', 'shared:images*', 'shared:imgfields*'], keyCount: 0, entries: [], sha256: digestOverlay([]) },
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
        assert.throws(
            () => validatePayload({ ...good, overlay: { ...good.overlay, patterns: ['save:*', 'save:*', 'save:*'] } }),
            /prefix coverage/i,
        );
        const reordered = { ...good, overlay: { ...good.overlay, patterns: [...good.overlay.patterns].reverse() } };
        assert.equal(validatePayload(reordered), reordered);
    });

    it('rejects save topologies whose selected application store is empty or hides base-only saves', () => {
        const noSaves = {
            format: 'shinobix-kv-v2',
            base: { rowCount: baseRows.length, rows: baseRows, sha256: digestRows(baseRows) },
            overlay: { patterns: payload().overlay.patterns, keyCount: 0, entries: [], sha256: digestOverlay([]) },
        };
        assert.throws(() => validatePayload(noSaves), /no save:\* keys/i);

        const imageOnlyOverlay = overlayEntries.slice(2);
        const baseOnly = baseOnlyPayload();
        assert.throws(
            () => validatePayload({
                ...baseOnly,
                overlay: {
                    ...baseOnly.overlay,
                    keyCount: imageOnlyOverlay.length,
                    entries: imageOnlyOverlay,
                    sha256: digestOverlay(imageOnlyOverlay),
                },
            }),
            /no overlay save:\* keys/i,
        );

        const otherSaveOverlay = [{ key: 'save:bob', value: { character: { level: 2 } } }];
        assert.throws(
            () => validatePayload({
                ...baseOnly,
                overlay: {
                    ...baseOnly.overlay,
                    keyCount: otherSaveOverlay.length,
                    entries: otherSaveOverlay,
                    sha256: digestOverlay(otherSaveOverlay),
                },
            }),
            /hide 1 base-only save:\* key/i,
        );

        const duplicateSaveOverlay = [overlayEntries[0]];
        const covered = {
            ...baseOnly,
            overlay: {
                ...baseOnly.overlay,
                keyCount: duplicateSaveOverlay.length,
                entries: duplicateSaveOverlay,
                sha256: digestOverlay(duplicateSaveOverlay),
            },
        };
        assert.equal(validatePayload(covered), covered);

        const baseWithImageOnly = {
            ...covered,
            base: {
                rows: [
                    ...covered.base.rows,
                    { key: 'shared:images:base-only', value: { hidden: true }, expires_at: null, updated_at: '2026-07-12T00:00:05.000Z' },
                ],
            },
        };
        baseWithImageOnly.base.rowCount = baseWithImageOnly.base.rows.length;
        baseWithImageOnly.base.sha256 = digestRows(baseWithImageOnly.base.rows);
        assert.throws(() => validatePayload(baseWithImageOnly), /hide 1 base-only disk-routed key/i);
    });

    it('validates current base-only saves from PostgreSQL and restores them from the base store', async () => {
        // Since the cPanel overlay retirement (2026-07-17) every export records
        // zero overlay entries and saves live in the base rows; representative
        // saves are verified by reading the restored target database.
        const baseOnly = baseOnlyPayload();
        assert.equal(validatePayload(baseOnly), baseOnly);

        const plan = restoreApplicationStoragePlan(baseOnly.base.rows, baseOnly.overlay.entries);
        assert.deepEqual(plan, {
            expectedSaveStore: 'base-store',
            enableDiskOverlay: false,
            baseSaveCount: 1,
            overlaySaveCount: 0,
            saveCount: 1,
            targetOverlay: { kind: 'none' },
            targetOverlayDir: null,
            applicationValidation: {
                expectedSaveStore: 'base-store',
                enableDiskOverlay: false,
                requireDiskOverlay: false,
            },
        });

        const queriedKeys = [];
        const target = {
            async query(_sql, params) {
                const key = params[0];
                queriedKeys.push(key);
                const row = baseOnly.base.rows.find((candidate) => candidate.key === key);
                return { rowCount: row ? 1 : 0, rows: row ? [{ value: row.value }] : [] };
            },
        };
        const samples = await verifyRestoreRepresentatives(target, baseOnly, ['save:alice']);
        assert.equal(samples.length, 1);
        assert.equal(samples[0].category, 'player-save');
        assert.equal(samples[0].store, 'base');
        assert.deepEqual(queriedKeys, ['save:alice']);
    });

    it('selects redacted representatives with live saves sourced from the overlay', () => {
        // Inspecting a pre-cutover file still reports where each sample lived.
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

    it('includes separately stored companion sanctuaries in restore-drill evidence', () => {
        const records = [
            { key: 'save:alice', value: { character: { level: 3 } }, store: 'base' },
            { key: 'pet-sanctuary:alice:meta', value: { total: 12, lastPage: 1 }, store: 'base' },
        ];
        const samples = representativeRecords(records);
        assert.deepEqual(samples.map((sample) => sample.category), ['player-save', 'pet-sanctuary']);
        assert.ok(samples.every((sample) => !JSON.stringify(sample).includes('alice')));
    });

    it('refuses to restore a pre-cutover overlay backup the server can no longer serve', async () => {
        // The file is still valid v2 evidence and can be inspected...
        assert.equal(validatePayload(payload()).overlay.keyCount, overlayEntries.length);
        // ...but restoring only its base rows would silently drop the saves that
        // lived on the overlay, so every restore entry point refuses it.
        assert.throws(() => assertBaseOnlyRestore(overlayEntries), /3 record\(s\) from the retired cPanel overlay/);
        assert.throws(() => restoreApplicationStoragePlan(baseRows, overlayEntries), /retired cPanel overlay/);
        assert.doesNotThrow(() => assertBaseOnlyRestore([]));
        await assert.rejects(
            () => verifyRestoreRepresentatives(
                { async query() { throw new Error('an overlay sample must not be read from the base store'); } },
                payload(),
                ['save:alice'],
            ),
            /is not a base-store record/,
        );
    });

    it('reports authoritative save counts from the selected store instead of adding stale copies', () => {
        const baseWithCopy = [
            ...baseRows,
            { key: 'save:alice', value: { stale: true }, expires_at: null, updated_at: '2026-07-12T00:00:01.000Z' },
        ];
        assert.deepEqual(backupStorageTopology(baseWithCopy, overlayEntries), {
            expectedSaveStore: 'disk',
            enableDiskOverlay: true,
            baseSaveCount: 1,
            overlaySaveCount: 2,
            saveCount: 2,
        });
        assert.deepEqual(backupStorageTopology(baseOnlyPayload().base.rows, []), {
            expectedSaveStore: 'base-store',
            enableDiskOverlay: false,
            baseSaveCount: 1,
            overlaySaveCount: 0,
            saveCount: 1,
        });
    });

    it('requires explicitly requested representative keys to exist', () => {
        const records = overlayEntries.map((entry) => ({ ...entry, store: 'overlay' }));
        assert.equal(representativeRecords(records, ['save:alice']).length, 1);
        assert.throws(() => representativeRecords(records, ['save:missing']), /not present/i);
    });

    it('refuses one generic database across users but distinguishes projects on a shared Supabase pooler', () => {
        assert.equal(sameConnection('postgres://source:one@db.example.com:5432/postgres', 'postgres://target:two@db.example.com:5432/postgres'), true);
        assert.equal(sameConnection('postgres://source:one@db.example.com:5432/postgres', 'postgres://target:two@other.example.com:5432/postgres'), false);
        const pooler = 'aws-0-us-east-1.pooler.supabase.com:6543/postgres';
        assert.equal(sameConnection(`postgres://postgres.project-a:one@${pooler}`, `postgres://postgres.project-b:two@${pooler}`), false);
        assert.equal(sameConnection(`postgres://postgres.project-a:one@${pooler}`, `postgres://migration.project-a:two@${pooler}`), true);
        assert.equal(sameConnection(`postgres://postgres:one@db.project-a.supabase.co:5432/postgres`, `postgres://postgres.project-a:two@${pooler}`), true);
    });

    it('uses Supabase project identity instead of a shared pooler server address after connecting', () => {
        const common = {
            database: 'postgres',
            serverAddressHash: 'shared-pooler-address',
            endpoint: {
                host: 'aws-0-us-east-1.pooler.supabase.com',
                port: '6543',
                database: 'postgres',
                sharedSupabasePooler: true,
            },
        };
        const source = { ...common, endpoint: { ...common.endpoint, userHash: 'source-user', supabaseProjectHash: 'project-a' } };
        const isolated = { ...common, endpoint: { ...common.endpoint, userHash: 'target-user', supabaseProjectHash: 'project-b' } };
        const sameProject = { ...common, endpoint: { ...common.endpoint, userHash: 'another-role', supabaseProjectHash: 'project-a' } };
        assert.equal(sameDatabaseIdentity(source, isolated), false);
        assert.equal(sameDatabaseIdentity(source, sameProject), true);
        assert.equal(sameDatabaseIdentity(
            { database: 'game', serverAddressHash: 'one-server', endpoint: {} },
            { database: 'game', serverAddressHash: 'one-server', endpoint: {} },
        ), true);
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

    it('refuses the retired --legacy-overlay export instead of silently ignoring it', () => {
        assert.throws(() => assertNoLegacyOverlayExport(true), /--legacy-overlay was removed/);
        assert.doesNotThrow(() => assertNoLegacyOverlayExport(false));
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
