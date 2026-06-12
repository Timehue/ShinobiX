import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    imageFormat,
    decodedBytes,
    contentHashOf,
    assetTypeFor,
    buildAssetMeta,
    findDuplicates,
    writeAssetMeta,
    assetMetaKey,
    type AssetMeta,
} from './_asset-registry.js';

const PNG_HELLO = 'data:image/png;base64,aGVsbG8=';   // "hello"
const PNG_WORLD = 'data:image/png;base64,d29ybGQ=';   // "world"
const EXT_URL = 'https://cdn.example.com/x/y.webp';

describe('imageFormat (pure)', () => {
    it('reads the data-URL mime, normalizing jpg→jpeg', () => {
        assert.equal(imageFormat(PNG_HELLO), 'png');
        assert.equal(imageFormat('data:image/jpg;base64,aaaa'), 'jpeg');
        assert.equal(imageFormat('data:image/jpeg;base64,aaaa'), 'jpeg');
        assert.equal(imageFormat('data:image/webp;base64,aaaa'), 'webp');
        assert.equal(imageFormat('data:image/gif;base64,aaaa'), 'gif');
    });
    it('classifies external urls and unknowns', () => {
        assert.equal(imageFormat(EXT_URL), 'url');
        assert.equal(imageFormat('not-an-image'), 'unknown');
    });
});

describe('decodedBytes (pure)', () => {
    it('computes decoded length for a data URL', () => {
        assert.equal(decodedBytes(PNG_HELLO), 5); // "hello"
    });
    it('returns 0 for external urls / non-data', () => {
        assert.equal(decodedBytes(EXT_URL), 0);
        assert.equal(decodedBytes('whatever'), 0);
    });
});

describe('contentHashOf (pure)', () => {
    it('is stable and content-addressed for identical bytes', () => {
        assert.equal(contentHashOf(PNG_HELLO), contentHashOf(PNG_HELLO));
    });
    it('differs for different bytes', () => {
        assert.notEqual(contentHashOf(PNG_HELLO), contentHashOf(PNG_WORLD));
    });
    it('hashes the same bytes equally regardless of declared mime (dup across formats)', () => {
        // Same decoded payload re-declared as webp → same hash → flagged as a dup.
        assert.equal(contentHashOf(PNG_HELLO), contentHashOf('data:image/webp;base64,aGVsbG8='));
    });
    it('marks external urls with a url: prefix', () => {
        assert.ok(contentHashOf(EXT_URL).startsWith('url:'));
    });
});

describe('assetTypeFor (pure)', () => {
    it('maps categories to coarse types', () => {
        assert.equal(assetTypeFor('jutsu', 'jutsu:fireball', 'png'), 'icon');
        assert.equal(assetTypeFor('avatar', 'avatar:rill', 'png'), 'portrait');
        assert.equal(assetTypeFor('event', 'event:intro:bg', 'webp'), 'background');
        assert.equal(assetTypeFor('misc', 'misc:thing', 'png'), 'static');
    });
    it('treats gif and pet animation slots as animation', () => {
        assert.equal(assetTypeFor('jutsu', 'jutsu:fireball', 'gif'), 'animation');
        assert.equal(assetTypeFor('pet', 'petsheet:0007', 'webp'), 'animation');
        assert.equal(assetTypeFor('pet', 'petlayers:0007:fg', 'webp'), 'animation');
        assert.equal(assetTypeFor('pet', 'pet:0007', 'webp'), 'portrait');
    });
});

describe('buildAssetMeta (pure)', () => {
    it('fills content-derived fields and stamps timestamps', () => {
        const m = buildAssetMeta({ id: 'jutsu:fireball', category: 'jutsu', image: PNG_HELLO, actor: 'admin', now: 100 });
        assert.equal(m.id, 'jutsu:fireball');
        assert.equal(m.category, 'jutsu');
        assert.equal(m.type, 'icon');
        assert.equal(m.format, 'png');
        assert.equal(m.bytes, 5);
        assert.equal(m.createdBy, 'admin');
        assert.equal(m.createdAt, 100);
        assert.equal(m.updatedAt, 100);
        assert.equal(m.hidden, false);
        assert.deepEqual(m.tags, []);
    });
    it('preserves provenance/curation from a prior record and only refreshes updatedAt + content', () => {
        const prev: AssetMeta = {
            id: 'jutsu:fireball', category: 'jutsu', type: 'icon', format: 'png', bytes: 5,
            contentHash: 'old', createdBy: 'admin', createdAt: 100, updatedAt: 100,
            hidden: true, tags: ['fire'], sourceNote: 'AI-gen', frames: 4, animSpeed: 12,
        };
        const m = buildAssetMeta({ id: 'jutsu:fireball', category: 'jutsu', image: PNG_WORLD, actor: 'someoneElse', now: 999, prev });
        assert.equal(m.createdBy, 'admin', 'original uploader preserved');
        assert.equal(m.createdAt, 100, 'createdAt preserved');
        assert.equal(m.updatedAt, 999, 'updatedAt refreshed');
        assert.equal(m.hidden, true, 'hidden flag preserved');
        assert.deepEqual(m.tags, ['fire'], 'curated tags preserved');
        assert.equal(m.sourceNote, 'AI-gen');
        assert.equal(m.frames, 4);
        assert.equal(m.animSpeed, 12);
        assert.notEqual(m.contentHash, 'old', 'content hash refreshed to new bytes');
    });
});

describe('findDuplicates (pure)', () => {
    const meta = (id: string, contentHash: string): AssetMeta => ({
        id, category: 'jutsu', type: 'icon', format: 'png', bytes: 1, contentHash,
        createdBy: 'admin', createdAt: 0, updatedAt: 0, hidden: false, tags: [],
    });
    it('returns only content hashes shared by more than one id', () => {
        const dups = findDuplicates([meta('a', 'h1'), meta('b', 'h1'), meta('c', 'h2')]);
        assert.equal(dups.length, 1);
        assert.equal(dups[0].contentHash, 'h1');
        assert.deepEqual(dups[0].ids.sort(), ['a', 'b']);
    });
    it('returns nothing when all assets are unique', () => {
        assert.deepEqual(findDuplicates([meta('a', 'h1'), meta('b', 'h2')]), []);
    });
});

describe('writeAssetMeta (best-effort, injectable store)', () => {
    function makeFakeKv() {
        const store = new Map<string, unknown>();
        return {
            store,
            async get<T = unknown>(key: string): Promise<T | null> {
                return (store.has(key) ? store.get(key) : null) as T | null;
            },
            async set(key: string, value: unknown): Promise<'OK' | null> {
                store.set(key, value);
                return 'OK';
            },
        };
    }
    const PRIOR = process.env.DISABLE_ASSET_META;
    beforeEach(() => { delete process.env.DISABLE_ASSET_META; });
    afterEach(() => {
        if (PRIOR === undefined) delete process.env.DISABLE_ASSET_META;
        else process.env.DISABLE_ASSET_META = PRIOR;
    });

    it('writes a metadata record and preserves createdAt across re-uploads', async () => {
        const kv = makeFakeKv();
        await writeAssetMeta({ id: 'jutsu:fireball', category: 'jutsu', image: PNG_HELLO, actor: 'admin', now: 100 }, { kv });
        await writeAssetMeta({ id: 'jutsu:fireball', category: 'jutsu', image: PNG_WORLD, actor: 'admin', now: 500 }, { kv });
        const stored = kv.store.get(assetMetaKey('jutsu:fireball')) as AssetMeta;
        assert.equal(stored.createdAt, 100, 'first-seen createdAt survives');
        assert.equal(stored.updatedAt, 500, 'updatedAt tracks the latest write');
    });

    it('no-ops when DISABLE_ASSET_META=1', async () => {
        process.env.DISABLE_ASSET_META = '1';
        const kv = makeFakeKv();
        await writeAssetMeta({ id: 'jutsu:fireball', category: 'jutsu', image: PNG_HELLO, actor: 'admin', now: 1 }, { kv });
        assert.equal(kv.store.size, 0);
    });
});
