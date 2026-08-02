import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { _makeMemoryKv } from './_storage.js';
import {
    CONTENT_FIELDS,
    contentKey,
    isContentField,
    normalizeContentValue,
    publishContent,
    readContentRecord,
    loadPublishedContent,
    mirrorSlotContent,
    ContentVersionConflictError,
    type ContentRecord,
} from './_content-store.js';
import { SHARED_ADMIN_CONTENT_FIELDS } from './save/_state-ownership.js';

/*
 * P0-4: the canonical content store. The publish path must be
 * version-guarded (the unguarded ?signal=1 revert is the High Phase 0
 * finding) and the read path must stay empty-safe so dual-read is a no-op
 * until content is actually published.
 */

describe('content store field set', () => {
    it('publishes exactly the shared-admin-content fields from the ownership manifest', () => {
        assert.deepEqual([...CONTENT_FIELDS], [...SHARED_ADMIN_CONTENT_FIELDS]);
        assert.ok(isContentField('creatorJutsus'));
        assert.ok(isContentField('hollowGateEventConfig'));
        assert.ok(!isContentField('ryo'), 'player state is not publishable content');
        assert.ok(!isContentField('character'));
    });

    it('namespaces keys away from player saves', () => {
        assert.equal(contentKey('creatorJutsus'), 'content:creatorJutsus');
        assert.ok(!contentKey('creatorJutsus').startsWith('save:'));
    });
});

describe('normalizeContentValue', () => {
    it('keeps authored values as-is (no rebalancing) while dropping unusable entries', () => {
        const out = normalizeContentValue('creatorJutsus', [
            { id: 'j1', name: 'Overload', effectPower: 9999 },
            { id: '  ', name: 'no id' },
            'not an object',
            { id: 'j1', name: 'duplicate' },
            { name: 'missing id' },
        ]) as Array<Record<string, unknown>>;
        assert.deepEqual(out.map((e) => e.id), ['j1']);
        assert.equal(out[0].effectPower, 9999, 'authored balance values are preserved verbatim');
    });

    it('passes non-array values (VN / gate config) through untouched', () => {
        const cfg = { enabled: true, scenes: [1, 2, 3] };
        assert.deepEqual(normalizeContentValue('hollowGateEventConfig', cfg), cfg);
        assert.equal(normalizeContentValue('ancientChestVn', undefined), null);
    });
});

describe('publishContent version guard', () => {
    it('increments the version and records the actor', async () => {
        const kv = _makeMemoryKv();
        const first = await publishContent('creatorJutsus', [{ id: 'j1' }], { actor: 'admin1', kv });
        assert.equal(first.version, 1);
        assert.equal(first.updatedBy, 'admin1');
        const second = await publishContent('creatorJutsus', [{ id: 'j1' }, { id: 'j2' }], { actor: 'admin2', baseVersion: 1, kv });
        assert.equal(second.version, 2);
        const stored = await readContentRecord('creatorJutsus', { kv });
        assert.equal((stored!.value as unknown[]).length, 2);
    });

    it('REJECTS a stale publish instead of reverting newer content', async () => {
        const kv = _makeMemoryKv();
        await publishContent('creatorItems', [{ id: 'i1' }], { actor: 'admin1', kv });          // v1
        await publishContent('creatorItems', [{ id: 'i1' }, { id: 'i2' }], { actor: 'admin1', baseVersion: 1, kv }); // v2
        // A second admin tab that loaded v1 tries to save its older snapshot.
        await assert.rejects(
            () => publishContent('creatorItems', [{ id: 'i1' }], { actor: 'admin2', baseVersion: 1, kv }),
            ContentVersionConflictError,
        );
        const stored = await readContentRecord('creatorItems', { kv });
        assert.equal((stored!.value as unknown[]).length, 2, 'the newer content survives the stale write');
    });

    it('allows an unversioned publish (first write / scripted mirror)', async () => {
        const kv = _makeMemoryKv();
        await publishContent('creatorCards', [{ id: 'c1' }], { actor: 'admin1', kv });
        const record = await publishContent('creatorCards', [{ id: 'c2' }], { actor: 'mirror', kv });
        assert.equal(record.version, 2);
    });

    it('refuses to publish a non-content field', async () => {
        const kv = _makeMemoryKv();
        await assert.rejects(() => publishContent('ryo', 999, { actor: 'admin1', kv }), /not a publishable content field/);
    });
});

describe('loadPublishedContent', () => {
    it('returns an empty record before anything is published (dual-read no-op)', async () => {
        const kv = _makeMemoryKv();
        assert.deepEqual(await loadPublishedContent({ kv }), {});
    });

    it('shapes published content like an admin slot', async () => {
        const kv = _makeMemoryKv();
        await publishContent('creatorJutsus', [{ id: 'j1', name: 'Overload' }], { actor: 'admin1', kv });
        await publishContent('hollowGateEventConfig', { enabled: true }, { actor: 'admin1', kv });
        const loaded = await loadPublishedContent({ kv });
        assert.deepEqual(loaded.creatorJutsus, [{ id: 'j1', name: 'Overload' }]);
        assert.deepEqual(loaded.hollowGateEventConfig, { enabled: true });
        assert.ok(!('creatorItems' in loaded), 'unpublished fields are absent, not empty arrays');
    });

    it('survives a storage failure without throwing', async () => {
        const brokenKv = { get: async () => { throw new Error('kv down'); }, set: async () => 'OK' } as never;
        assert.deepEqual(await loadPublishedContent({ kv: brokenKv }), {});
    });
});

describe('mirrorSlotContent', () => {
    it('mirrors only the content fields an admin write carried', async () => {
        const kv = _makeMemoryKv();
        const slotWrite = {
            character: { name: 'admin1', ryo: 500 },
            creatorJutsus: [{ id: 'j1' }],
            creatorItems: [{ id: 'i1' }],
            _saveVersion: 12,
        };
        const mirrored = await mirrorSlotContent(slotWrite, { actor: 'admin1', kv });
        assert.deepEqual(mirrored.sort(), ['creatorItems', 'creatorJutsus']);
        const loaded = await loadPublishedContent({ kv });
        assert.deepEqual(Object.keys(loaded).sort(), ['creatorItems', 'creatorJutsus']);
        assert.ok(!('character' in loaded) && !('_saveVersion' in loaded), 'player state never enters the content store');
    });

    it('never rejects on version (a mirror follows a committed write)', async () => {
        const kv = _makeMemoryKv();
        await publishContent('creatorJutsus', [{ id: 'j1' }], { actor: 'admin1', kv });
        const mirrored = await mirrorSlotContent({ creatorJutsus: [{ id: 'j2' }] }, { actor: 'legacy-signal', kv });
        assert.deepEqual(mirrored, ['creatorJutsus']);
        const stored = await readContentRecord('creatorJutsus', { kv }) as ContentRecord;
        assert.equal(stored.version, 2);
        assert.deepEqual(stored.value, [{ id: 'j2' }]);
    });
});
