import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAdminJutsuCatalog } from './_admin-jutsu-catalog.js';
import { buildAdminItemCatalog } from './_admin-item-catalog.js';
import { buildSettlementCatalogs } from './shop/_catalog.js';

/*
 * P0-4 dual-read parity.
 *
 * Every server catalog now reads the canonical content store as ONE MORE
 * source appended last. Two properties must hold:
 *   1. with nothing published, results are identical to slots-only (so the
 *      wiring cannot change live behavior before any publish happens);
 *   2. published content participates with each catalog's EXISTING merge rule
 *      — no precedence redesign snuck in with the plumbing.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), 'api', rel), 'utf8');

const slot1 = { creatorJutsus: [{ id: 'j1', name: 'Slot One', updatedAt: 10 }], creatorItems: [{ id: 'i1', name: 'Slot Item' }] };
const slot2 = { creatorJutsus: [{ id: 'j2', name: 'Slot Two', updatedAt: 5 }], creatorItems: [{ id: 'i2', name: 'Other Item' }] };

describe('dual-read is a no-op until content is published', () => {
    it('jutsu catalog: empty published record changes nothing', () => {
        const before = buildAdminJutsuCatalog([slot1, slot2]);
        const after = buildAdminJutsuCatalog([slot1, slot2, {}]);
        assert.deepEqual([...after.entries()], [...before.entries()]);
    });

    it('item catalog: empty published record changes nothing', () => {
        const before = buildAdminItemCatalog([slot1, slot2]);
        const after = buildAdminItemCatalog([slot1, slot2, {}]);
        assert.deepEqual([...after.entries()], [...before.entries()]);
    });

    it('shop catalogs: empty published record changes nothing', () => {
        const before = buildSettlementCatalogs([slot1, slot2]);
        const after = buildSettlementCatalogs([slot1, slot2, {}]);
        assert.deepEqual(after, before);
    });
});

describe('published content participates with each catalog’s existing rule', () => {
    it('jutsu: recency still decides, and a published edit wins a tie', () => {
        const stalePublish = buildAdminJutsuCatalog([slot1, slot2, { creatorJutsus: [{ id: 'j1', name: 'Stale', updatedAt: 1 }] }]);
        assert.equal(stalePublish.get('j1')!.name, 'Slot One', 'an older updatedAt still loses — recency is unchanged');

        const freshPublish = buildAdminJutsuCatalog([slot1, slot2, { creatorJutsus: [{ id: 'j1', name: 'Published', updatedAt: 10 }] }]);
        assert.equal(freshPublish.get('j1')!.name, 'Published', 'the canonical source wins an updatedAt tie (ordered last)');
    });

    it('items: later-source-wins still decides', () => {
        const merged = buildAdminItemCatalog([slot1, slot2, { creatorItems: [{ id: 'i1', name: 'Published Item' }] }]);
        assert.equal(merged.get('i1')!.name, 'Published Item');
        assert.equal(merged.get('i2')!.name, 'Other Item', 'untouched ids are unaffected');
    });

    it('items: a published tombstone deletes exactly like a slot tombstone', () => {
        const merged = buildAdminItemCatalog([slot1, slot2, { creatorItems: [{ id: 'i1', name: '__ADMIN_DELETED_ITEM__' }] }]);
        assert.ok(!merged.has('i1'));
    });

    it('items: a tombstone remains authoritative over a stale later source', () => {
        const merged = buildAdminItemCatalog([
            { creatorItems: [{ id: 'i1', name: '__ADMIN_DELETED_ITEM__' }] },
            { creatorItems: [{ id: 'i1', name: 'Stale Resurrection' }] },
        ]);
        assert.ok(!merged.has('i1'));
        assert.ok(merged.deletedIds.has('i1'));
    });

    it('forged gear published by mistake still never enters the shared catalog', () => {
        const forged = 'named-weapon-00000000-0000-4000-8000-00000000cccc';
        const merged = buildAdminItemCatalog([slot1, { creatorItems: [{ id: forged, name: 'Leak' }] }]);
        assert.ok(!merged.has(forged));
    });
});

describe('every shared-content reader dual-reads', () => {
    it('the four server readers consult the canonical store', () => {
        for (const rel of ['_admin-jutsu-catalog.ts', '_admin-item-catalog.ts', 'shop/_catalog.ts', 'hollow-gate/start.ts']) {
            assert.match(read(rel), /loadPublishedContent\(/, `${rel} must dual-read the canonical content store`);
        }
    });

    it('a storage failure in the content store degrades to slots-only', () => {
        for (const rel of ['_admin-jutsu-catalog.ts', '_admin-item-catalog.ts', 'shop/_catalog.ts', 'hollow-gate/start.ts']) {
            assert.match(read(rel), /loadPublishedContent\(\)\.catch\(/, `${rel} must not fail when the content store is unavailable`);
        }
    });
});
