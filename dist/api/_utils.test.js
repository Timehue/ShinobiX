"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _utils_js_1 = require("./_utils.js");
(0, node_test_1.describe)('safeName', () => {
    (0, node_test_1.it)('lowercases', () => {
        node_assert_1.strict.equal((0, _utils_js_1.safeName)('RILL'), 'rill');
    });
    (0, node_test_1.it)('strips non-alphanumeric except - and _', () => {
        node_assert_1.strict.equal((0, _utils_js_1.safeName)("a'b<c>d!"), 'abcd');
        node_assert_1.strict.equal((0, _utils_js_1.safeName)('foo-bar_baz'), 'foo-bar_baz');
    });
    (0, node_test_1.it)('caps at 32 characters', () => {
        // SAFE_NAME_MAX_LEN. A longer input gets truncated rather than rejected.
        const long = 'a'.repeat(100);
        node_assert_1.strict.equal((0, _utils_js_1.safeName)(long).length, 32);
    });
    (0, node_test_1.it)('idempotent', () => {
        const clean = 'rill';
        node_assert_1.strict.equal((0, _utils_js_1.safeName)((0, _utils_js_1.safeName)(clean)), clean);
    });
    (0, node_test_1.it)('empty input → empty string', () => {
        node_assert_1.strict.equal((0, _utils_js_1.safeName)(''), '');
    });
});
(0, node_test_1.describe)('isAllowedOrigin (CORS predicate, #12)', () => {
    (0, node_test_1.it)('allows the static production + localhost origins', () => {
        node_assert_1.strict.equal((0, _utils_js_1.isAllowedOrigin)('https://theravensark.com'), true);
        node_assert_1.strict.equal((0, _utils_js_1.isAllowedOrigin)('https://www.theravensark.com'), true);
        node_assert_1.strict.equal((0, _utils_js_1.isAllowedOrigin)('http://localhost:5173'), true);
    });
    (0, node_test_1.it)('allows any https *.up.railway.app origin (service + PR-preview subdomains)', () => {
        node_assert_1.strict.equal((0, _utils_js_1.isAllowedOrigin)('https://shinobix.up.railway.app'), true);
        node_assert_1.strict.equal((0, _utils_js_1.isAllowedOrigin)('https://pr-12-shinobix.up.railway.app'), true);
        node_assert_1.strict.equal((0, _utils_js_1.isAllowedOrigin)('https://up.railway.app'), true);
    });
    (0, node_test_1.it)('rejects http (non-TLS) railway + lookalike suffix attacks', () => {
        node_assert_1.strict.equal((0, _utils_js_1.isAllowedOrigin)('http://shinobix.up.railway.app'), false);
        node_assert_1.strict.equal((0, _utils_js_1.isAllowedOrigin)('https://up.railway.app.attacker.com'), false);
        node_assert_1.strict.equal((0, _utils_js_1.isAllowedOrigin)('https://notrailway.com'), false);
    });
    (0, node_test_1.it)('rejects empty / undefined origin', () => {
        node_assert_1.strict.equal((0, _utils_js_1.isAllowedOrigin)(''), false);
        node_assert_1.strict.equal((0, _utils_js_1.isAllowedOrigin)(undefined), false);
        node_assert_1.strict.equal((0, _utils_js_1.isAllowedOrigin)(null), false);
    });
});
(0, node_test_1.describe)('clanRecordKey / clanBareSlug (#19)', () => {
    (0, node_test_1.it)('strips a multi-word clan name to a bare slug (no spaces, no hyphens)', () => {
        node_assert_1.strict.equal((0, _utils_js_1.clanBareSlug)('Storm Clan'), 'stormclan');
        node_assert_1.strict.equal((0, _utils_js_1.clanRecordKey)('Storm Clan'), 'save:clan-stormclan');
    });
    (0, node_test_1.it)('drops punctuation too — matches save/[name].ts clanRecordSlug', () => {
        node_assert_1.strict.equal((0, _utils_js_1.clanRecordKey)("Aka's Crew!"), 'save:clan-akascrew');
    });
    (0, node_test_1.it)('the old hyphenated form would NOT have matched (regression guard)', () => {
        const hyphenated = 'clan-' + 'Storm Clan'.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
        node_assert_1.strict.notEqual(`save:${hyphenated}`, (0, _utils_js_1.clanRecordKey)('Storm Clan'));
    });
});
(0, node_test_1.describe)('mergePreservingImages', () => {
    (0, node_test_1.it)('returns incoming for non-object types', () => {
        node_assert_1.strict.equal((0, _utils_js_1.mergePreservingImages)('foo', { existing: 'val' }), 'foo');
        node_assert_1.strict.equal((0, _utils_js_1.mergePreservingImages)(42, {}), 42);
        node_assert_1.strict.equal((0, _utils_js_1.mergePreservingImages)(null, {}), null);
    });
    (0, node_test_1.it)('preserves existing-only keys when incoming is a partial payload', () => {
        // The critical save-wipe defense: a partial-payload POST must NOT
        // erase keys present on the stored record. Was the bug that let a
        // foreign-save fetch round-tripped back through POST silently wipe
        // 30+ fields of the recipient's save.
        const existing = { ryo: 1000, inventory: ['a', 'b'], equipment: { hand: 'sword' } };
        const incoming = { ryo: 1500 };
        const merged = (0, _utils_js_1.mergePreservingImages)(incoming, existing);
        node_assert_1.strict.equal(merged.ryo, 1500, 'incoming should override');
        node_assert_1.strict.deepEqual(merged.inventory, ['a', 'b'], 'existing-only key inventory should be preserved');
        node_assert_1.strict.deepEqual(merged.equipment, { hand: 'sword' }, 'nested existing-only should be preserved');
    });
    (0, node_test_1.it)('preserves base64 image when incoming sends empty string', () => {
        const existing = { image: 'data:image/png;base64,iVBORw0KGgo=' };
        const incoming = { image: '' };
        const merged = (0, _utils_js_1.mergePreservingImages)(incoming, existing);
        node_assert_1.strict.equal(merged.image, existing.image, 'empty incoming should not wipe stored base64');
    });
    (0, node_test_1.it)('replaces image when incoming sends a real new image', () => {
        const existing = { image: 'data:image/png;base64,OLD=' };
        const incoming = { image: 'data:image/png;base64,NEW=' };
        const merged = (0, _utils_js_1.mergePreservingImages)(incoming, existing);
        node_assert_1.strict.equal(merged.image, 'data:image/png;base64,NEW=');
    });
    (0, node_test_1.it)('handles arrays by taking the incoming sequence verbatim', () => {
        // Intentional deletions in arrays must survive (e.g., a player
        // dropping an item from inventory).
        const existing = ['a', 'b', 'c'];
        const incoming = ['a', 'c']; // dropped 'b'
        const merged = (0, _utils_js_1.mergePreservingImages)(incoming, existing);
        node_assert_1.strict.deepEqual(merged, ['a', 'c']);
    });
    (0, node_test_1.it)('per-item recurses into arrays of objects matched by id', () => {
        // Pets in inventory: incoming may send a partial pet record that
        // shouldn't lose existing pet fields.
        const existing = [
            { id: 'p1', name: 'Wolf', image: 'data:image/png;base64,WOLF=' },
            { id: 'p2', name: 'Bear', image: 'data:image/png;base64,BEAR=' },
        ];
        const incoming = [
            { id: 'p1', name: 'Wolf', image: '' }, // empty-string image
            { id: 'p2', name: 'Bear' }, // missing image entirely
        ];
        const merged = (0, _utils_js_1.mergePreservingImages)(incoming, existing);
        // p1: empty-string image should NOT wipe the stored base64.
        node_assert_1.strict.equal(merged[0].image, 'data:image/png;base64,WOLF=');
        // p2: image missing from incoming should fall back to the existing stored image.
        node_assert_1.strict.equal(merged[1].image, 'data:image/png;base64,BEAR=');
    });
    (0, node_test_1.it)('null incoming preserves nothing — just returns null', () => {
        // Sanity check: the helper is for object/array merge, not a universal preserver.
        node_assert_1.strict.equal((0, _utils_js_1.mergePreservingImages)(null, { foo: 'bar' }), null);
    });
});
