import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('./_storage.js').kv;
let catalog: typeof import('./_admin-item-catalog.js');
let content: typeof import('./_admin-content.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    catalog = await import('./_admin-item-catalog.js');
    content = await import('./_admin-content.js');
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    catalog.__resetAdminItemCatalogCache();
});

const ITEM = { id: 'admin-tidewall-plate', name: 'Tidewall Plate', slot: 'body', rarity: 'mythic' };

function failReads(t: import('node:test').TestContext) {
    const boom = async () => { throw new Error('storage down'); };
    t.mock.method(kv, 'get', boom);
    t.mock.method(kv, 'mget', boom);
}

test('a strict load refuses to stand an empty catalog in for one that never loaded', async (t) => {
    failReads(t);
    assert.equal((await catalog.loadAdminItemObjects()).size, 0, 'the default (non-strict) load still never throws');
    await assert.rejects(catalog.loadAdminItemObjects({ strict: true }), new RegExp(catalog.ADMIN_ITEM_CATALOG_UNAVAILABLE));
    await assert.rejects(content.loadAdminCombatContent(), new RegExp(catalog.ADMIN_ITEM_CATALOG_UNAVAILABLE), 'combat loads strict');
});

test('after one good read, a later failure serves the last good catalog even to strict callers', async (t) => {
    await kv.set('save:admin1', { character: { name: 'Admin 1' }, creatorItems: [ITEM] });
    assert.equal((await catalog.loadAdminItemObjects({ strict: true })).get(ITEM.id)?.name, 'Tidewall Plate');
    const now = Date.now();
    t.mock.method(Date, 'now', () => now + 120_000); // past the 60s memo
    failReads(t);
    assert.equal((await catalog.loadAdminItemObjects({ strict: true })).get(ITEM.id)?.name, 'Tidewall Plate');
});

test('an empty but successfully read catalog is not an outage', async () => {
    assert.equal((await catalog.loadAdminItemObjects({ strict: true })).size, 0);
});
