import assert from 'node:assert/strict';
import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';
import {
    backupStorageTopology,
    captureBracketedStores,
    digestOverlay,
    digestRows,
    prepareRestoreOverlay,
    readOverlayDirectory,
    representativeRecords,
    resolveOverlayExportPlan,
    restoreApplicationStoragePlan,
    sameConnection,
    sameDatabaseIdentity,
    validatePayload,
    validateTargetSchemaEvidence,
    validatedProxyBase,
    verifyRestoreRepresentatives,
    withPreparedRestoreOverlay,
    writeOverlayDirectory,
} from './kv-backup.mjs';

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

async function managedOverlayDirectories() {
    return new Set((await readdir(tmpdir(), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('shinobix-restore-overlay-'))
        .map((entry) => entry.name));
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

    it('validates current base-only saves from PostgreSQL without enabling an empty overlay', async () => {
        // Since the cPanel overlay retirement (2026-07-17) exportStableOverlay
        // records zero overlay entries and saves live in the base rows — the
        // v2 validator must accept that shape, create no disk directory, and
        // verify representative saves by reading the restored target database.
        const baseOnly = baseOnlyPayload();
        assert.equal(validatePayload(baseOnly), baseOnly);
        const overlayRoot = await prepareRestoreOverlay(baseOnly.overlay.entries);
        assert.equal(overlayRoot, null);

        const plan = restoreApplicationStoragePlan(baseOnly.base.rows, baseOnly.overlay.entries, 'ignored-empty-overlay-path');
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
        const samples = await verifyRestoreRepresentatives(target, overlayRoot, baseOnly, ['save:alice']);
        assert.equal(samples.length, 1);
        assert.equal(samples[0].category, 'player-save');
        assert.equal(samples[0].store, 'base');
        assert.deepEqual(queriedKeys, ['save:alice']);
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

    it('includes separately stored companion sanctuaries in restore-drill evidence', () => {
        const records = [
            { key: 'save:alice', value: { character: { level: 3 } }, store: 'base' },
            { key: 'pet-sanctuary:alice:meta', value: { total: 12, lastPage: 1 }, store: 'base' },
        ];
        const samples = representativeRecords(records);
        assert.deepEqual(samples.map((sample) => sample.category), ['player-save', 'pet-sanctuary']);
        assert.ok(samples.every((sample) => !JSON.stringify(sample).includes('alice')));
    });

    it('keeps retired-overlay backups authoritative and application-validatable', async () => {
        const root = await prepareRestoreOverlay(overlayEntries);
        assert.ok(root);
        try {
            const restored = await readOverlayDirectory(root);
            assert.equal(digestOverlay(restored), digestOverlay(overlayEntries));
            const plan = restoreApplicationStoragePlan(baseRows, restored, root);
            assert.equal(plan.expectedSaveStore, 'disk');
            assert.equal(plan.enableDiskOverlay, true);
            assert.equal(plan.applicationValidation.requireDiskOverlay, true);
            assert.equal(plan.targetOverlay.kind, 'disk');
            assert.equal(plan.targetOverlayDir, root);
            assert.equal(plan.saveCount, 2);
            assert.equal(plan.baseSaveCount, 0);
            assert.equal(plan.overlaySaveCount, 2);

            const samples = await verifyRestoreRepresentatives(
                { async query() { throw new Error('overlay representative must not read the base store'); } },
                root,
                payload(),
                ['save:alice'],
            );
            assert.equal(samples.length, 1);
            assert.equal(samples[0].store, 'overlay');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
        assert.throws(
            () => restoreApplicationStoragePlan(baseRows, overlayEntries, null),
            /requires a restored overlay directory/i,
        );
    });

    it('removes partial overlay staging and a completed overlay when downstream restore work fails', async () => {
        const before = await managedOverlayDirectories();
        await assert.rejects(
            () => writeOverlayDirectory([
                overlayEntries[0],
                { key: 'save:..', value: { shouldNotWrite: true } },
            ]),
            /unsafe overlay key segment/i,
        );
        assert.deepEqual(await managedOverlayDirectories(), before);

        let stagedRoot;
        await assert.rejects(
            () => withPreparedRestoreOverlay(overlayEntries, async (overlayRoot) => {
                stagedRoot = overlayRoot;
                throw new Error('simulated restore verification failure');
            }),
            /simulated restore verification failure/i,
        );
        assert.ok(stagedRoot);
        await assert.rejects(() => stat(stagedRoot), (error) => error?.code === 'ENOENT');
        assert.deepEqual(await managedOverlayDirectories(), before);
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

    it('maps only the reviewed legacy proxy destinations to literal URLs', () => {
        assert.equal(validatedProxyBase('https://theravensark.com/api/kv'), 'https://theravensark.com/api/kv');
        assert.equal(validatedProxyBase('https://www.theravensark.com/api/kv/'), 'https://www.theravensark.com/api/kv');
        for (const value of ['http://theravensark.com/api/kv', 'https://evil.example/api/kv', 'https://theravensark.com/api/kv?next=evil', 'https://theravensark.com:444/api/kv']) {
            assert.throws(() => validatedProxyBase(value), /approved|must not/i);
        }
    });

    it('requires explicit legacy-overlay intent before a configured proxy can affect an export', () => {
        assert.deepEqual(resolveOverlayExportPlan('', false), { kind: 'base-only' });
        assert.throws(
            () => resolveOverlayExportPlan('https://theravensark.com/api/kv', false),
            /without explicit legacy-overlay export intent/i,
        );
        assert.throws(() => resolveOverlayExportPlan('', true), /requires KV_PROXY_URL/i);
        assert.deepEqual(resolveOverlayExportPlan('https://theravensark.com/api/kv', true), {
            kind: 'legacy-overlay',
            proxyBase: 'https://theravensark.com/api/kv',
        });
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
