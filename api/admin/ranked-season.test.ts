import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'ranked-season-admin-test-password';

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let handler: Handler;
let kv: typeof import('../_storage.js').kv;

function response() {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function request(method: 'GET' | 'POST', body?: Json, password = process.env.ADMIN_PASSWORD) {
    const { out, res } = response();
    await handler({
        method,
        body,
        headers: password ? { 'x-admin-password': password } : {},
        query: {},
        socket: { remoteAddress: '10.64.1.1' },
    } as never, res);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./ranked-season.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('ranked:*')) await kv.del(key);
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

describe('admin ranked season controls', { concurrency: false }, () => {
    it('reports inactive, starts a season, and exposes its active status to the Admin Panel', async () => {
        const before = await request('GET');
        assert.equal(before.statusCode, 200);
        assert.deepEqual(before.body, { active: false, current: null });

        const started = await request('POST', { action: 'start' });
        assert.equal(started.statusCode, 200, JSON.stringify(started.body));
        assert.deepEqual(started.body, { ok: true, action: 'initialized', seasonId: 1 });

        const after = await request('GET');
        assert.equal(after.statusCode, 200);
        assert.equal(after.body?.active, true);
        assert.equal((after.body?.current as Json)?.id, 1);
    });

    it('requires full admin authority before a start request can mutate the season', async () => {
        const denied = await request('POST', { action: 'start' }, 'wrong-password');
        assert.equal(denied.statusCode, 401);
        assert.equal((await request('GET')).body?.active, false);
    });
});
