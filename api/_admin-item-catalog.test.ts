import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildAdminItemCatalog } from './_admin-item-catalog.js';

describe('buildAdminItemCatalog', () => {
    it('keys authored items from both admin slots by id', () => {
        const catalog = buildAdminItemCatalog([
            { creatorItems: [{ id: 'custom-storm-tanto', name: 'Storm Tanto', slot: 'hand' }] },
            { creatorItems: [{ id: 'custom-ash-mantle', name: 'Ash Mantle', slot: 'body' }] },
        ]);
        assert.deepEqual([...catalog.keys()].sort(), ['custom-ash-mantle', 'custom-storm-tanto']);
        assert.equal(catalog.get('custom-storm-tanto')?.name, 'Storm Tanto');
    });

    it('preserves authored values verbatim (budgeting happens at load, not here)', () => {
        const authored = { id: 'a', slot: 'body', armorQuality: 'Mythic', bonuses: { reflectPercent: 2, ninjutsuOffense: 35 } };
        const catalog = buildAdminItemCatalog([{ creatorItems: [authored] }]);
        assert.deepEqual(catalog.get('a'), authored);
    });

    it('lets the later slot win an id collision (Admin 2 over Admin 1)', () => {
        const catalog = buildAdminItemCatalog([
            { creatorItems: [{ id: 'dup', name: 'First' }] },
            { creatorItems: [{ id: 'dup', name: 'Second' }] },
        ]);
        assert.equal(catalog.get('dup')?.name, 'Second');
    });

    it('honors the admin delete tombstone', () => {
        const catalog = buildAdminItemCatalog([
            { creatorItems: [{ id: 'gone', name: 'Old Blade' }] },
            { creatorItems: [{ id: 'gone', name: '__ADMIN_DELETED_ITEM__' }] },
        ]);
        assert.equal(catalog.has('gone'), false);
        assert.equal(catalog.deletedIds.has('gone'), true);
    });

    it('does not let a stale later source resurrect a tombstoned id', () => {
        const catalog = buildAdminItemCatalog([
            { creatorItems: [{ id: 'gone', name: '__ADMIN_DELETED_ITEM__' }] },
            { creatorItems: [{ id: 'gone', name: 'Stale Resurrection' }] },
        ]);
        assert.equal(catalog.has('gone'), false);
        assert.equal(catalog.deletedIds.has('gone'), true);
    });

    it('skips malformed entries and missing/absent records', () => {
        const catalog = buildAdminItemCatalog([
            null,
            undefined,
            {},
            { creatorItems: 'not-an-array' },
            { creatorItems: [null, 42, [], { name: 'no id' }, { id: '   ' }, { id: 'x'.repeat(200) }, { id: '  ok  ', name: 'Trimmed' }] },
        ]);
        assert.deepEqual([...catalog.keys()], ['ok']);
        assert.equal(catalog.get('ok')?.name, 'Trimmed');
    });
});
