"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _asset_registry_js_1 = require("./_asset-registry.js");
const PNG_HELLO = 'data:image/png;base64,aGVsbG8='; // "hello"
const PNG_WORLD = 'data:image/png;base64,d29ybGQ='; // "world"
const EXT_URL = 'https://cdn.example.com/x/y.webp';
(0, node_test_1.describe)('imageFormat (pure)', () => {
    (0, node_test_1.it)('reads the data-URL mime, normalizing jpg→jpeg', () => {
        node_assert_1.strict.equal((0, _asset_registry_js_1.imageFormat)(PNG_HELLO), 'png');
        node_assert_1.strict.equal((0, _asset_registry_js_1.imageFormat)('data:image/jpg;base64,aaaa'), 'jpeg');
        node_assert_1.strict.equal((0, _asset_registry_js_1.imageFormat)('data:image/jpeg;base64,aaaa'), 'jpeg');
        node_assert_1.strict.equal((0, _asset_registry_js_1.imageFormat)('data:image/webp;base64,aaaa'), 'webp');
        node_assert_1.strict.equal((0, _asset_registry_js_1.imageFormat)('data:image/gif;base64,aaaa'), 'gif');
    });
    (0, node_test_1.it)('classifies external urls and unknowns', () => {
        node_assert_1.strict.equal((0, _asset_registry_js_1.imageFormat)(EXT_URL), 'url');
        node_assert_1.strict.equal((0, _asset_registry_js_1.imageFormat)('not-an-image'), 'unknown');
    });
});
(0, node_test_1.describe)('decodedBytes (pure)', () => {
    (0, node_test_1.it)('computes decoded length for a data URL', () => {
        node_assert_1.strict.equal((0, _asset_registry_js_1.decodedBytes)(PNG_HELLO), 5); // "hello"
    });
    (0, node_test_1.it)('returns 0 for external urls / non-data', () => {
        node_assert_1.strict.equal((0, _asset_registry_js_1.decodedBytes)(EXT_URL), 0);
        node_assert_1.strict.equal((0, _asset_registry_js_1.decodedBytes)('whatever'), 0);
    });
});
(0, node_test_1.describe)('contentHashOf (pure)', () => {
    (0, node_test_1.it)('is stable and content-addressed for identical bytes', () => {
        node_assert_1.strict.equal((0, _asset_registry_js_1.contentHashOf)(PNG_HELLO), (0, _asset_registry_js_1.contentHashOf)(PNG_HELLO));
    });
    (0, node_test_1.it)('differs for different bytes', () => {
        node_assert_1.strict.notEqual((0, _asset_registry_js_1.contentHashOf)(PNG_HELLO), (0, _asset_registry_js_1.contentHashOf)(PNG_WORLD));
    });
    (0, node_test_1.it)('hashes the same bytes equally regardless of declared mime (dup across formats)', () => {
        // Same decoded payload re-declared as webp → same hash → flagged as a dup.
        node_assert_1.strict.equal((0, _asset_registry_js_1.contentHashOf)(PNG_HELLO), (0, _asset_registry_js_1.contentHashOf)('data:image/webp;base64,aGVsbG8='));
    });
    (0, node_test_1.it)('marks external urls with a url: prefix', () => {
        node_assert_1.strict.ok((0, _asset_registry_js_1.contentHashOf)(EXT_URL).startsWith('url:'));
    });
});
(0, node_test_1.describe)('assetTypeFor (pure)', () => {
    (0, node_test_1.it)('maps categories to coarse types', () => {
        node_assert_1.strict.equal((0, _asset_registry_js_1.assetTypeFor)('jutsu', 'jutsu:fireball', 'png'), 'icon');
        node_assert_1.strict.equal((0, _asset_registry_js_1.assetTypeFor)('avatar', 'avatar:rill', 'png'), 'portrait');
        node_assert_1.strict.equal((0, _asset_registry_js_1.assetTypeFor)('event', 'event:intro:bg', 'webp'), 'background');
        node_assert_1.strict.equal((0, _asset_registry_js_1.assetTypeFor)('misc', 'misc:thing', 'png'), 'static');
    });
    (0, node_test_1.it)('treats gif and pet animation slots as animation', () => {
        node_assert_1.strict.equal((0, _asset_registry_js_1.assetTypeFor)('jutsu', 'jutsu:fireball', 'gif'), 'animation');
        node_assert_1.strict.equal((0, _asset_registry_js_1.assetTypeFor)('pet', 'petsheet:0007', 'webp'), 'animation');
        node_assert_1.strict.equal((0, _asset_registry_js_1.assetTypeFor)('pet', 'petlayers:0007:fg', 'webp'), 'animation');
        node_assert_1.strict.equal((0, _asset_registry_js_1.assetTypeFor)('pet', 'pet:0007', 'webp'), 'portrait');
    });
});
(0, node_test_1.describe)('buildAssetMeta (pure)', () => {
    (0, node_test_1.it)('fills content-derived fields and stamps timestamps', () => {
        const m = (0, _asset_registry_js_1.buildAssetMeta)({ id: 'jutsu:fireball', category: 'jutsu', image: PNG_HELLO, actor: 'admin', now: 100 });
        node_assert_1.strict.equal(m.id, 'jutsu:fireball');
        node_assert_1.strict.equal(m.category, 'jutsu');
        node_assert_1.strict.equal(m.type, 'icon');
        node_assert_1.strict.equal(m.format, 'png');
        node_assert_1.strict.equal(m.bytes, 5);
        node_assert_1.strict.equal(m.createdBy, 'admin');
        node_assert_1.strict.equal(m.createdAt, 100);
        node_assert_1.strict.equal(m.updatedAt, 100);
        node_assert_1.strict.equal(m.hidden, false);
        node_assert_1.strict.deepEqual(m.tags, []);
    });
    (0, node_test_1.it)('preserves provenance/curation from a prior record and only refreshes updatedAt + content', () => {
        const prev = {
            id: 'jutsu:fireball', category: 'jutsu', type: 'icon', format: 'png', bytes: 5,
            contentHash: 'old', createdBy: 'admin', createdAt: 100, updatedAt: 100,
            hidden: true, tags: ['fire'], sourceNote: 'AI-gen', frames: 4, animSpeed: 12,
        };
        const m = (0, _asset_registry_js_1.buildAssetMeta)({ id: 'jutsu:fireball', category: 'jutsu', image: PNG_WORLD, actor: 'someoneElse', now: 999, prev });
        node_assert_1.strict.equal(m.createdBy, 'admin', 'original uploader preserved');
        node_assert_1.strict.equal(m.createdAt, 100, 'createdAt preserved');
        node_assert_1.strict.equal(m.updatedAt, 999, 'updatedAt refreshed');
        node_assert_1.strict.equal(m.hidden, true, 'hidden flag preserved');
        node_assert_1.strict.deepEqual(m.tags, ['fire'], 'curated tags preserved');
        node_assert_1.strict.equal(m.sourceNote, 'AI-gen');
        node_assert_1.strict.equal(m.frames, 4);
        node_assert_1.strict.equal(m.animSpeed, 12);
        node_assert_1.strict.notEqual(m.contentHash, 'old', 'content hash refreshed to new bytes');
    });
});
(0, node_test_1.describe)('findDuplicates (pure)', () => {
    const meta = (id, contentHash) => ({
        id, category: 'jutsu', type: 'icon', format: 'png', bytes: 1, contentHash,
        createdBy: 'admin', createdAt: 0, updatedAt: 0, hidden: false, tags: [],
    });
    (0, node_test_1.it)('returns only content hashes shared by more than one id', () => {
        const dups = (0, _asset_registry_js_1.findDuplicates)([meta('a', 'h1'), meta('b', 'h1'), meta('c', 'h2')]);
        node_assert_1.strict.equal(dups.length, 1);
        node_assert_1.strict.equal(dups[0].contentHash, 'h1');
        node_assert_1.strict.deepEqual(dups[0].ids.sort(), ['a', 'b']);
    });
    (0, node_test_1.it)('returns nothing when all assets are unique', () => {
        node_assert_1.strict.deepEqual((0, _asset_registry_js_1.findDuplicates)([meta('a', 'h1'), meta('b', 'h2')]), []);
    });
});
(0, node_test_1.describe)('writeAssetMeta (best-effort, injectable store)', () => {
    function makeFakeKv() {
        const store = new Map();
        return {
            store,
            async get(key) {
                return (store.has(key) ? store.get(key) : null);
            },
            async set(key, value) {
                store.set(key, value);
                return 'OK';
            },
        };
    }
    const PRIOR = process.env.DISABLE_ASSET_META;
    (0, node_test_1.beforeEach)(() => { delete process.env.DISABLE_ASSET_META; });
    (0, node_test_1.afterEach)(() => {
        if (PRIOR === undefined)
            delete process.env.DISABLE_ASSET_META;
        else
            process.env.DISABLE_ASSET_META = PRIOR;
    });
    (0, node_test_1.it)('writes a metadata record and preserves createdAt across re-uploads', async () => {
        const kv = makeFakeKv();
        await (0, _asset_registry_js_1.writeAssetMeta)({ id: 'jutsu:fireball', category: 'jutsu', image: PNG_HELLO, actor: 'admin', now: 100 }, { kv });
        await (0, _asset_registry_js_1.writeAssetMeta)({ id: 'jutsu:fireball', category: 'jutsu', image: PNG_WORLD, actor: 'admin', now: 500 }, { kv });
        const stored = kv.store.get((0, _asset_registry_js_1.assetMetaKey)('jutsu:fireball'));
        node_assert_1.strict.equal(stored.createdAt, 100, 'first-seen createdAt survives');
        node_assert_1.strict.equal(stored.updatedAt, 500, 'updatedAt tracks the latest write');
    });
    (0, node_test_1.it)('no-ops when DISABLE_ASSET_META=1', async () => {
        process.env.DISABLE_ASSET_META = '1';
        const kv = makeFakeKv();
        await (0, _asset_registry_js_1.writeAssetMeta)({ id: 'jutsu:fireball', category: 'jutsu', image: PNG_HELLO, actor: 'admin', now: 1 }, { kv });
        node_assert_1.strict.equal(kv.store.size, 0);
    });
});
