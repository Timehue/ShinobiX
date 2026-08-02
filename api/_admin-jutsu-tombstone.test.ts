import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildAdminJutsuCatalog } from './_admin-jutsu-catalog.js';
import { deletedJutsuEntry, isDeletedJutsuEntry, ADMIN_DELETED_JUTSU_MARKER } from '../shared/admin-content-tombstone.js';

/*
 * Authored jutsu had no deletion tombstone: every reader UNIONS the two admin
 * slots, so removing an entry from one slot let the other slot's copy
 * resurrect it — the admin deletes a jutsu and it comes straight back. These
 * pin the fix, including the resurrection case the item catalog still gets
 * wrong (shared-content audit finding 6).
 */

const slot = (jutsus: unknown[]) => ({ creatorJutsus: jutsus });

describe('authored-jutsu deletion tombstones', () => {
    it('a tombstone removes the id from the catalog', () => {
        const out = buildAdminJutsuCatalog([slot([{ id: 'j1', name: 'Blaze', updatedAt: 1 }, deletedJutsuEntry('j1', 2)])]);
        assert.ok(!out.has('j1'));
    });

    it('a live copy in a LATER slot cannot resurrect a newer deletion', () => {
        const out = buildAdminJutsuCatalog([
            slot([deletedJutsuEntry('j1', 500)]),          // admin1 deleted it
            slot([{ id: 'j1', name: 'Blaze', updatedAt: 1 }]), // admin2 still has the old copy
        ]);
        assert.ok(!out.has('j1'), 'the newer deletion must win over an older live copy');
    });

    it('re-creating a deleted id works — the newer entry wins', () => {
        const out = buildAdminJutsuCatalog([
            slot([deletedJutsuEntry('j1', 100)]),
            slot([{ id: 'j1', name: 'Blaze Reborn', updatedAt: 900 }]),
        ]);
        assert.equal(out.get('j1')?.name, 'Blaze Reborn');
    });

    it('an OLDER deletion does not remove a newer live entry', () => {
        const out = buildAdminJutsuCatalog([
            slot([{ id: 'j1', name: 'Blaze', updatedAt: 900 }]),
            slot([deletedJutsuEntry('j1', 5)]),
        ]);
        assert.equal(out.get('j1')?.name, 'Blaze');
    });

    it('leaves untouched ids alone and never emits a marker as a jutsu', () => {
        const out = buildAdminJutsuCatalog([slot([{ id: 'keep', name: 'Keep', updatedAt: 3 }, deletedJutsuEntry('gone', 4)])]);
        assert.deepEqual([...out.keys()], ['keep']);
        for (const jutsu of out.values()) assert.notEqual(jutsu.name, ADMIN_DELETED_JUTSU_MARKER);
    });

    it('recognizes only the reserved marker', () => {
        assert.ok(isDeletedJutsuEntry({ id: 'x', name: ADMIN_DELETED_JUTSU_MARKER }));
        assert.ok(!isDeletedJutsuEntry({ id: 'x', name: 'A Real Jutsu' }));
        assert.ok(!isDeletedJutsuEntry(null));
    });
});
