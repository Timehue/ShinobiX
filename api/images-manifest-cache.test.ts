import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { kv } from './_storage.js';
import { __clearProcCache } from './_proc-cache.js';
import handler, { isManifestCategory } from './images.js';

/*
 * GET /api/images?cat=<cat>&ids=1 is memoised per (category, image version)
 * (2026-10-12: every client load asks for ~8 manifests). The response must be
 * byte-for-byte what the uncached path returned, a version bump must be seen at
 * once, and a failed read must never be cached.
 */

type Stub = {
    hkeysCalls: number;
    rows: Map<string, Record<string, string>>;
    versions: Map<string, number>;
    failHkeys: boolean;
    /** Per-image row keys (`shared:img:<id>`), listed by the manifest's key scan. */
    imageKeys: string[];
};
const original = { hkeys: kv.hkeys, hgetall: kv.hgetall, get: kv.get, keys: kv.keys };
let stub: Stub;

beforeEach(() => {
    __clearProcCache();
    stub = { hkeysCalls: 0, rows: new Map(), versions: new Map(), failHkeys: false, imageKeys: [] };
    kv.keys = async (pattern: string) => {
        const prefix = pattern.replace(/\*$/, '');
        return stub.imageKeys.filter((key) => key.startsWith(prefix));
    };
    kv.hkeys = async (key: string) => {
        stub.hkeysCalls += 1;
        if (stub.failHkeys) throw new Error('storage down');
        return Object.entries(stub.rows.get(key) ?? {}).filter(([, v]) => typeof v === 'string' && v.length > 0).map(([k]) => k);
    };
    kv.hgetall = (async (key: string) => {
        if (stub.failHkeys) throw new Error('storage down');
        return stub.rows.get(key) ?? null;
    }) as typeof kv.hgetall;
    kv.get = (async (key: string) => {
        const m = /^shared:imgver:(.+)$/.exec(key);
        return m ? (stub.versions.get(m[1]) ?? null) : null;
    }) as typeof kv.get;
});

afterEach(() => {
    Object.assign(kv, original);
    __clearProcCache();
});

async function get(query: Record<string, string>) {
    const out: { status: number; body: unknown; headers: Record<string, string> } = { status: 0, body: null, headers: {} };
    const res = {
        setHeader(name: string, value: string) { out.headers[name.toLowerCase()] = value; return res; },
        status(code: number) { out.status = code; return res; },
        json(payload: unknown) { out.body = payload; return res; },
        end() { return res; },
    };
    await handler({ method: 'GET', headers: {}, query } as never, res as never);
    return out;
}

test('a repeat manifest read is served from memory with an identical body', async () => {
    stub.rows.set('shared:imgfields:pet', { 'pet:a': 'data:x', 'pet:b': 'data:y', 'pet:gone': '' });
    stub.versions.set('pet', 4);
    const first = await get({ cat: 'pet', ids: '1', ver: '1' });
    const callsAfterFirst = stub.hkeysCalls;
    const second = await get({ cat: 'pet', ids: '1', ver: '1' });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { version: '4', ids: ['pet:a', 'pet:b'] });
    assert.deepEqual(second.body, first.body);
    assert.equal(stub.hkeysCalls, callsAfterFirst, 'the second read must not touch storage');
    const bare = await get({ cat: 'pet', ids: '1' });
    assert.deepEqual(bare.body, ['pet:a', 'pet:b'], 'the unversioned shape is unchanged');
});

test('a version bump (replace/delete) is visible on the very next read', async () => {
    stub.rows.set('shared:imgfields:jutsu', { 'jutsu:a': 'data:x' });
    stub.versions.set('jutsu', 1);
    assert.deepEqual((await get({ cat: 'jutsu', ids: '1', ver: '1' })).body, { version: '1', ids: ['jutsu:a'] });
    stub.rows.set('shared:imgfields:jutsu', { 'jutsu:a': 'data:x', 'jutsu:new': 'data:z' });
    stub.versions.set('jutsu', 2);
    assert.deepEqual((await get({ cat: 'jutsu', ids: '1', ver: '1' })).body, { version: '2', ids: ['jutsu:a', 'jutsu:new'] });
});

test('leader manifests also follow the misc version (leader: ids filed under misc)', async () => {
    stub.rows.set('shared:imgfields:leader', {});
    stub.rows.set('shared:imgfields:misc', { 'leader:stormveil:kage': 'data:k', 'misc:other': 'data:o' });
    stub.versions.set('leader', 3);
    stub.versions.set('misc', 7);
    assert.deepEqual((await get({ cat: 'leader', ids: '1' })).body, ['leader:stormveil:kage']);
    stub.rows.set('shared:imgfields:misc', { 'leader:stormveil:kage': 'data:k', 'leader:ashen:elder:1': 'data:e' });
    stub.versions.set('misc', 8);
    assert.deepEqual((await get({ cat: 'leader', ids: '1' })).body, ['leader:stormveil:kage', 'leader:ashen:elder:1']);
});

test('a failed read answers 503 no-store and is never cached', async () => {
    stub.rows.set('shared:imgfields:card', { 'card:a': 'data:x' });
    stub.failHkeys = true;
    const failed = await get({ cat: 'card', ids: '1', ver: '1' });
    assert.equal(failed.status, 503);
    assert.equal(failed.headers['cache-control'], 'no-store');
    stub.failHkeys = false;
    const recovered = await get({ cat: 'card', ids: '1', ver: '1' });
    assert.equal(recovered.status, 200);
    assert.deepEqual(recovered.body, { version: '0', ids: ['card:a'] });
});

test('a superseded version list is dropped, so version bumps cannot pile up lists in memory', async () => {
    const { manifestCacheKey } = await import('./images.js');
    const { cachedFor } = await import('./_proc-cache.js');
    let builds = 0;
    const build = async () => { builds += 1; return ['x']; };
    await cachedFor(manifestCacheKey('avatar', '1', null), 60_000, build);
    await cachedFor(manifestCacheKey('avatar', '2', null), 60_000, build);
    // Version 1's entry was invalidated when version 2's key was minted, so
    // reading it again rebuilds instead of returning a list kept forever.
    await cachedFor(manifestCacheKey('avatar', '1', null), 60_000, build);
    assert.equal(builds, 3);
});

test('a failed version read never evicts the live list (no full rebuild when the read recovers)', async () => {
    const { manifestCacheKey } = await import('./images.js');
    const { cachedFor } = await import('./_proc-cache.js');
    let builds = 0;
    const build = async () => { builds += 1; return ['x']; };
    await cachedFor(manifestCacheKey('pet', '7', null), 60_000, build);
    await cachedFor(manifestCacheKey('pet', null, null), 60_000, build); // version read failed
    await cachedFor(manifestCacheKey('pet', '7', null), 60_000, build);
    assert.equal(builds, 2, 'version 7 is still served from memory after the blip');
});

test('a per-image row the legacy rows do not hold joins the manifest (the shared-row split)', async () => {
    stub.rows.set('shared:imgfields:avatar', { 'avatar:old': 'data:x' });
    stub.imageKeys = ['shared:img:avatar:old', 'shared:img:avatar:new', 'shared:imgfields:avatar', 'shared:img:avatarx:no'];
    stub.versions.set('avatar', 2);
    assert.deepEqual((await get({ cat: 'avatar', ids: '1', ver: '1' })).body, { version: '2', ids: ['avatar:old', 'avatar:new'] });
    // Pet owns several prefixes; a misc-filed stray of another category is not pet's.
    stub.imageKeys = ['shared:img:pet:a', 'shared:img:petbody:a', 'shared:img:petlayers:a:mid', 'shared:img:sector-base:x'];
    assert.deepEqual((await get({ cat: 'pet', ids: '1' })).body, ['pet:a', 'petbody:a', 'petlayers:a:mid']);
});

test('the legacy rows are read once per category version, not on every manifest build', async () => {
    const { buildManifestIds } = await import('./images.js');
    stub.rows.set('shared:imgfields:card', { 'card:a': 'data:x' });
    const versions = { version: '5', miscVersion: null };
    const now = <T,>(read: Promise<T | null>) => read;
    assert.deepEqual(await buildManifestIds('card', now, versions), ['card:a']);
    const afterFirst = stub.hkeysCalls;
    stub.imageKeys = ['shared:img:card:b'];
    assert.deepEqual(await buildManifestIds('card', now, versions), ['card:a', 'card:b'], 'the key scan is always live');
    assert.equal(stub.hkeysCalls, afterFirst, 'the 9-16 MB legacy rows were not read again for the same version');
    await buildManifestIds('card', now, { version: '6', miscVersion: null });
    assert.ok(stub.hkeysCalls > afterFirst, 'a version bump (a delete) reads them again');
});

test('only known categories are memoised, so a request cannot mint cache entries', async () => {
    assert.equal(isManifestCategory('pet'), true);
    assert.equal(isManifestCategory('misc'), true);
    assert.equal(isManifestCategory('leader'), true);
    assert.equal(isManifestCategory('made-up-category-123'), false);
    stub.rows.set('shared:imgfields:made-up', { 'x:1': 'data:x' });
    await get({ cat: 'made-up', ids: '1' });
    const calls = stub.hkeysCalls;
    const again = await get({ cat: 'made-up', ids: '1' });
    assert.deepEqual(again.body, ['x:1']);
    assert.ok(stub.hkeysCalls > calls, 'an unknown category is read live every time');
});
