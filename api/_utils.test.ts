import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { safeName, mergePreservingImages, isAllowedOrigin, clanBareSlug, clanRecordKey } from './_utils.js';

describe('safeName', () => {
    it('lowercases', () => {
        assert.equal(safeName('RILL'), 'rill');
    });

    it('strips non-alphanumeric except - and _', () => {
        assert.equal(safeName("a'b<c>d!"), 'abcd');
        assert.equal(safeName('foo-bar_baz'), 'foo-bar_baz');
    });

    it('caps at 32 characters', () => {
        // SAFE_NAME_MAX_LEN. A longer input gets truncated rather than rejected.
        const long = 'a'.repeat(100);
        assert.equal(safeName(long).length, 32);
    });

    it('idempotent', () => {
        const clean = 'rill';
        assert.equal(safeName(safeName(clean)), clean);
    });

    it('empty input → empty string', () => {
        assert.equal(safeName(''), '');
    });
});

describe('isAllowedOrigin (CORS predicate, #12)', () => {
    it('allows the static production + localhost origins', () => {
        // Player-facing site (pinned in code so realtime CORS no longer depends
        // on the EXTRA_ALLOWED_ORIGINS env var being set).
        assert.equal(isAllowedOrigin('https://shinobijourney.com'), true);
        assert.equal(isAllowedOrigin('https://www.shinobijourney.com'), true);
        assert.equal(isAllowedOrigin('https://theravensark.com'), true);
        assert.equal(isAllowedOrigin('https://www.theravensark.com'), true);
        assert.equal(isAllowedOrigin('http://localhost:5173'), true);
    });

    it('allows any https *.up.railway.app origin (service + PR-preview subdomains)', () => {
        assert.equal(isAllowedOrigin('https://shinobix.up.railway.app'), true);
        assert.equal(isAllowedOrigin('https://pr-12-shinobix.up.railway.app'), true);
        assert.equal(isAllowedOrigin('https://up.railway.app'), true);
    });

    it('rejects http (non-TLS) railway + lookalike suffix attacks', () => {
        assert.equal(isAllowedOrigin('http://shinobix.up.railway.app'), false);
        assert.equal(isAllowedOrigin('https://up.railway.app.attacker.com'), false);
        assert.equal(isAllowedOrigin('https://notrailway.com'), false);
    });

    it('rejects empty / undefined origin', () => {
        assert.equal(isAllowedOrigin(''), false);
        assert.equal(isAllowedOrigin(undefined), false);
        assert.equal(isAllowedOrigin(null), false);
    });
});

describe('clanRecordKey / clanBareSlug (#19)', () => {
    it('strips a multi-word clan name to a bare slug (no spaces, no hyphens)', () => {
        assert.equal(clanBareSlug('Storm Clan'), 'stormclan');
        assert.equal(clanRecordKey('Storm Clan'), 'save:clan-stormclan');
    });
    it('drops punctuation too — matches save/[name].ts clanRecordSlug', () => {
        assert.equal(clanRecordKey("Aka's Crew!"), 'save:clan-akascrew');
    });
    it('the old hyphenated form would NOT have matched (regression guard)', () => {
        const hyphenated = 'clan-' + 'Storm Clan'.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
        assert.notEqual(`save:${hyphenated}`, clanRecordKey('Storm Clan'));
    });
});

describe('mergePreservingImages', () => {
    it('returns incoming for non-object types', () => {
        assert.equal(mergePreservingImages('foo', { existing: 'val' }), 'foo');
        assert.equal(mergePreservingImages(42, {}), 42);
        assert.equal(mergePreservingImages(null, {}), null);
    });

    it('preserves existing-only keys when incoming is a partial payload', () => {
        // The critical save-wipe defense: a partial-payload POST must NOT
        // erase keys present on the stored record. Was the bug that let a
        // foreign-save fetch round-tripped back through POST silently wipe
        // 30+ fields of the recipient's save.
        const existing = { ryo: 1000, inventory: ['a', 'b'], equipment: { hand: 'sword' } };
        const incoming = { ryo: 1500 };
        const merged = mergePreservingImages(incoming, existing) as Record<string, unknown>;
        assert.equal(merged.ryo, 1500, 'incoming should override');
        assert.deepEqual(merged.inventory, ['a', 'b'], 'existing-only key inventory should be preserved');
        assert.deepEqual(merged.equipment, { hand: 'sword' }, 'nested existing-only should be preserved');
    });

    it('preserves base64 image when incoming sends empty string', () => {
        const existing = { image: 'data:image/png;base64,iVBORw0KGgo=' };
        const incoming = { image: '' };
        const merged = mergePreservingImages(incoming, existing) as Record<string, unknown>;
        assert.equal(merged.image, existing.image, 'empty incoming should not wipe stored base64');
    });

    it('replaces image when incoming sends a real new image', () => {
        const existing = { image: 'data:image/png;base64,OLD=' };
        const incoming = { image: 'data:image/png;base64,NEW=' };
        const merged = mergePreservingImages(incoming, existing) as Record<string, unknown>;
        assert.equal(merged.image, 'data:image/png;base64,NEW=');
    });

    it('handles arrays by taking the incoming sequence verbatim', () => {
        // Intentional deletions in arrays must survive (e.g., a player
        // dropping an item from inventory).
        const existing = ['a', 'b', 'c'];
        const incoming = ['a', 'c']; // dropped 'b'
        const merged = mergePreservingImages(incoming, existing) as string[];
        assert.deepEqual(merged, ['a', 'c']);
    });

    it('per-item recurses into arrays of objects matched by id', () => {
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
        const merged = mergePreservingImages(incoming, existing) as Array<Record<string, unknown>>;
        // p1: empty-string image should NOT wipe the stored base64.
        assert.equal(merged[0]!.image, 'data:image/png;base64,WOLF=');
        // p2: image missing from incoming should fall back to the existing stored image.
        assert.equal(merged[1]!.image, 'data:image/png;base64,BEAR=');
    });

    it('null incoming preserves nothing — just returns null', () => {
        // Sanity check: the helper is for object/array merge, not a universal preserver.
        assert.equal(mergePreservingImages(null, { foo: 'bar' }), null);
    });
});
