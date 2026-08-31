import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
    bumpImageVersion,
    imageVersionKey,
    isValidImageVersion,
    readImageVersion,
} from './_image-version.js';

type Stub = {
    get: (key: string) => Promise<unknown>;
    incr: (key: string) => Promise<number>;
};

function stubKv(over: Partial<Stub> = {}) {
    const incremented: string[] = [];
    const kv = {
        get: over.get ?? (async () => null),
        incr: over.incr ?? (async (key: string) => { incremented.push(key); return 1; }),
    } as unknown as Parameters<typeof readImageVersion>[1] extends { kv?: infer K } ? K : never;
    return { kv, incremented };
}

describe('image version token', () => {
    it('accepts only the narrow numeric shape', () => {
        for (const good of ['0', '1', '9007199254740993', '1'.repeat(20)]) {
            assert.equal(isValidImageVersion(good), true, `expected ${good} to be accepted`);
        }
        // `v` is attacker-supplied on a public endpoint and lands in the CDN cache
        // key, so anything that would let one image mint unbounded distinct cache
        // entries has to be refused.
        for (const bad of ['', '-1', '1.0', 'abc', ' 1', '1 ', '1'.repeat(21), '0x1', '1e3']) {
            assert.equal(isValidImageVersion(bad), false, `expected ${JSON.stringify(bad)} to be refused`);
        }
        for (const bad of [null, undefined, 1, {}, []]) {
            assert.equal(isValidImageVersion(bad), false);
        }
    });

    it('namespaces the counter per category', () => {
        assert.equal(imageVersionKey('pet'), 'shared:imgver:pet');
        assert.notEqual(imageVersionKey('pet'), imageVersionKey('jutsu'));
    });
});

describe('reading the image version', () => {
    it('reports 0 for a category that has never been bumped', async () => {
        const { kv } = stubKv({ get: async () => null });
        assert.equal(await readImageVersion('pet', { kv }), '0');
    });

    it('returns the stored counter as a token the server will accept back', async () => {
        const { kv } = stubKv({ get: async () => 12 });
        const version = await readImageVersion('pet', { kv });
        assert.equal(version, '12');
        assert.equal(isValidImageVersion(version), true, 'a read version must round-trip through /api/img');
    });

    it('normalizes a stored value that is not a clean integer', async () => {
        for (const [stored, expected] of [[12.9, '12'], ['3', '3'], [-1, '0'], ['junk', '0']] as const) {
            const { kv } = stubKv({ get: async () => stored });
            assert.equal(await readImageVersion('pet', { kv }), expected, `stored ${JSON.stringify(stored)}`);
        }
    });

    it('returns null — not a guessed 0 — when storage throws', async () => {
        // A guessed '0' would be handed out as a real version and pin the art for
        // a year under a URL that does not correspond to any generation. null makes
        // the manifest omit the field, degrading to the pre-versioning short TTL.
        const { kv } = stubKv({ get: async () => { throw new Error('supabase down'); } });
        assert.equal(await readImageVersion('pet', { kv }), null);
    });
});

describe('bumping the image version', () => {
    it('increments only the touched category', async () => {
        const { kv, incremented } = stubKv();
        await bumpImageVersion('pet', { kv });
        assert.deepEqual(incremented, ['shared:imgver:pet']);
    });

    it('never throws, so it cannot fail an upload or a delete', async () => {
        // The image writes are authoritative; the counter is a cache hint. A
        // failed bump costs one stale window, which is what shipped for the whole
        // life of the endpoint — losing the upload would be a real regression.
        const { kv } = stubKv({ incr: async () => { throw new Error('supabase down'); } });
        await assert.doesNotReject(() => bumpImageVersion('pet', { kv }));
    });
});

describe('image cache contracts', () => {
    // api/ compiles to CommonJS, so import.meta is unavailable here; the runner
    // always executes from the repo root (see scripts/run-tests.mjs).
    const img = readFileSync(join(process.cwd(), 'api', 'img.ts'), 'utf8');
    const images = readFileSync(join(process.cwd(), 'api', 'images.ts'), 'utf8');

    it('serves immutable ONLY behind a validated version', () => {
        assert.match(img, /const versioned = isValidImageVersion\(req\.query\.v\)/u,
            'the version must be validated, never trusted raw from the query string');
        assert.match(img, /const artCache = versioned \? IMMUTABLE_CACHE : REVALIDATED_CACHE/u,
            'immutable must be gated on a valid version');
        assert.match(img, /IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'/u);
        // The unversioned path must keep its original TTL: old cached clients and
        // hand-typed URLs still arrive without a version and must not be pinned.
        assert.match(img, /REVALIDATED_CACHE = 'public, max-age=300, stale-while-revalidate=86400'/u);
    });

    it('bumps the version on every write that changes what an id resolves to', () => {
        // Upload and delete both retire cached immutable URLs. The lazy legacy
        // copies in img.ts must NOT bump — identical bytes, different key.
        assert.equal((images.match(/await bumpImageVersion\(cat\)/g) ?? []).length, 2,
            'both the upload and delete paths must bump the category');
        assert.doesNotMatch(img, /bumpImageVersion/u,
            'the lazy per-image migration moves identical bytes and must not invalidate caches');
    });

    it('keeps the bare-array manifest contract for callers that did not opt in', () => {
        assert.match(images, /if \(req\.query\.ver\)/u,
            'the versioned manifest shape must be opt-in so the legacy array contract holds');
    });
});
