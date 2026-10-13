import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

/*
 * Full-content GET /api/images sends every image's bytes (up to ~18 MB for one
 * category, every category with no `cat`), so only admin tools may use it. The
 * id manifest (`?cat=<cat>&ids=1`) that every client loads stays public and
 * edge-cacheable. Driven through the real handler on the isolated in-memory
 * store.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'images-full-content-session-secret';
process.env.ADMIN_PASSWORD = 'images-full-content-admin';
process.env.ADMIN_CONTENT_PASSWORD = 'images-full-content-content-admin';
process.env.ADMIN_SESSION_SECRET = 'images-full-content-admin-session-secret';
delete process.env.ADMIN_STRICT_TOKEN_ONLY;

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body: unknown; headers: Record<string, string> };

let kv: typeof import('./_storage.js').kv;
let handler: Handler;
let issuePlayerToken: typeof import('./_auth.js').issuePlayerToken;
let issueAdminToken: typeof import('./_auth.js').issueAdminToken;
let clearProcCache: () => void;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    handler = (await import('./images.js')).default as unknown as Handler;
    ({ issuePlayerToken, issueAdminToken } = await import('./_auth.js'));
    ({ __clearProcCache: clearProcCache } = await import('./_proc-cache.js'));
});

const CARD = `data:image/png;base64,${Buffer.from('image-card').toString('base64')}`;
const PUBLIC_MANIFEST_CACHE = 'public, max-age=60, stale-while-revalidate=120';

beforeEach(async () => {
    clearProcCache();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set('shared:img:card:a', CARD);
});

async function get(query: Record<string, string>, headers: Record<string, string> = {}): Promise<Out> {
    const out: Out = { statusCode: 200, body: undefined, headers: {} };
    const res = {
        setHeader: (name: string, value: string) => { out.headers[name.toLowerCase()] = value; return res; },
        status: (code: number) => { out.statusCode = code; return res; },
        json: (body: unknown) => { out.body = body; return res; },
        end: () => res,
    };
    await handler({ method: 'GET', query, headers, socket: { remoteAddress: '10.71.0.1' } } as never, res as never);
    return out;
}

async function playerHeaders(name: string): Promise<Record<string, string>> {
    await kv.set(`auth:${name}`, { salt: 's', hash: 'scrypt:16384:8:1:00' });
    return { 'x-player-name': name, 'x-player-token': issuePlayerToken(name)! };
}

/** Every full-content shape: a category without ids, no category, ids without a category, an empty ids. */
const FULL_CONTENT_QUERIES: Array<Record<string, string>> = [{ cat: 'card' }, {}, { ids: '1' }, { cat: 'card', ids: '' }];

describe('full-content mode needs an admin credential', () => {
    it('refuses an anonymous caller with an uncacheable 403, before any storage read', async (t) => {
        const reads = [
            t.mock.method(kv, 'get'), t.mock.method(kv, 'mget'), t.mock.method(kv, 'keys'),
            t.mock.method(kv, 'hkeys'), t.mock.method(kv, 'hgetall'),
        ];
        for (const query of FULL_CONTENT_QUERIES) {
            const out = await get(query);
            assert.equal(out.statusCode, 403, JSON.stringify(query));
            assert.equal(out.headers['cache-control'], 'private, no-store', 'the edge must not keep the refusal for an admin\'s request');
            assert.match(String((out.body as { error?: unknown }).error), /admin-only/);
        }
        assert.equal(reads.reduce((total, read) => total + read.mock.callCount(), 0), 0, 'a refusal costs no storage read');
    });

    it('refuses a signed-in player with a 403, never the 401 the client counts toward its session-expired prompt', async () => {
        const out = await get({ cat: 'card' }, await playerHeaders('reader'));
        assert.equal(out.statusCode, 403);
        assert.equal(out.body && typeof out.body === 'object' && 'card:a' in out.body, false, 'no bytes in the refusal');
    });

    it('refuses a wrong admin password', async () => {
        assert.equal((await get({ cat: 'card' }, { 'x-admin-password': 'guess' })).statusCode, 403);
        assert.equal((await get({}, { 'x-admin-token': 'av1.full.9999999999999.0.forged' })).statusCode, 403);
    });

    it('serves either admin role, by password or by session token, and never lets a shared cache keep it', async () => {
        const credentials: Array<Record<string, string>> = [
            { 'x-admin-password': 'images-full-content-admin' },
            { 'x-admin-password': 'images-full-content-content-admin' },
            { 'x-admin-token': issueAdminToken('full')! },
            { 'x-admin-token': issueAdminToken('content')! },
        ];
        for (const headers of credentials) {
            const out = await get({ cat: 'card' }, headers);
            assert.equal(out.statusCode, 200, Object.keys(headers).join());
            assert.deepEqual(out.body, { 'card:a': CARD });
            assert.equal(out.headers['cache-control'], 'private, no-store');
        }
        const everything = await get({}, { 'x-admin-password': 'images-full-content-admin' });
        assert.equal(everything.statusCode, 200);
        assert.deepEqual(everything.body, { 'card:a': CARD });
        assert.equal(everything.headers['cache-control'], 'private, no-store');
    });

    it('serves an operator who is also signed in as a player', async () => {
        // authedPlayerOrAdmin would resolve this request to the player; the gate
        // checks the admin credential directly instead.
        const headers = { ...(await playerHeaders('operator')), 'x-admin-token': issueAdminToken('full')! };
        const out = await get({ cat: 'card' }, headers);
        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body, { 'card:a': CARD });
    });
});

describe('the id manifest stays public', () => {
    it('answers anyone, edge-cacheable, in both shapes', async () => {
        const bare = await get({ cat: 'card', ids: '1' });
        assert.equal(bare.statusCode, 200);
        assert.deepEqual(bare.body, ['card:a']);
        assert.equal(bare.headers['cache-control'], PUBLIC_MANIFEST_CACHE);
        const versioned = await get({ cat: 'card', ids: '1', ver: '1' }, await playerHeaders('viewer'));
        assert.equal(versioned.statusCode, 200);
        assert.deepEqual(versioned.body, { version: '0', ids: ['card:a'] });
        assert.equal(versioned.headers['cache-control'], PUBLIC_MANIFEST_CACHE);
    });
});
