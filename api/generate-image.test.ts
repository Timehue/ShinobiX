import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'generate-image-tests-secret';
process.env.ENABLE_PLAYER_AI_IMAGE_GENERATION = '1';
// A fake key plus a stubbed OpenAI: a request that clears every gate reaches the
// provider, which answers 502 here, so nothing real is ever spent.
process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'stub' } }), { status: 503 })) as typeof fetch;

let handler: typeof import('./generate-image.js').default;
let kv: typeof import('./_storage.js').kv;
let token: typeof import('./_auth.js').issuePlayerToken;

before(async () => {
    handler = (await import('./generate-image.js')).default as unknown as typeof handler;
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken: token } = await import('./_auth.js'));
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    (await import('./_ratelimit.js')).__resetRateLimitsForTest();
});

let counter = 0;
async function call(player: string) {
    let status = 200; let data: any;
    const res = { setHeader() {}, status(n: number) { status = n; return this; }, json(b: unknown) { data = b; return this; }, end() { return this; } };
    const ip = `10.96.0.${++counter}`;
    await handler({
        method: 'POST',
        body: { prompt: 'a shinobi fox spirit', label: 'Pet Photo' },
        headers: { 'x-player-token': token(player), 'x-forwarded-for': ip },
        query: {},
        socket: { remoteAddress: ip },
    } as never, res as never);
    return { status, data };
}

function dailyKey(name: string): string {
    return `img-gen:daily:${name}:${new Date().toISOString().slice(0, 10)}`;
}

describe('generate-image daily cap + guest gate', () => {
    it('passes the gates under the cap (reaches the provider)', async () => {
        const r = await call('capunder');
        assert.equal(r.status, 502);
        assert.equal(Number(await kv.get(dailyKey('capunder'))), 1);
    });

    it('refuses once the daily cap is reached', async () => {
        await kv.set(dailyKey('capfull'), 40, { ex: 3600 });
        const r = await call('capfull');
        assert.equal(r.status, 429);
    });

    it('is atomic: two concurrent requests at cap-1 spend exactly one slot', async () => {
        await kv.set(dailyKey('caprace'), 39, { ex: 3600 });
        const results = await Promise.all([call('caprace'), call('caprace')]);
        const statuses = results.map(r => r.status).sort();
        assert.deepEqual(statuses, [429, 502], JSON.stringify(results));
    });

    it('a malformed request or a missing key never spends a daily image', async () => {
        let status = 0;
        const res = { setHeader() {}, status(n: number) { status = n; return this; }, json() { return this; }, end() { return this; } };
        await handler({ method: 'POST', body: { prompt: '   ' }, headers: { 'x-player-token': token('capblank'), 'x-forwarded-for': '10.96.1.1' }, query: {}, socket: { remoteAddress: '10.96.1.1' } } as never, res as never);
        assert.equal(status, 400);
        assert.equal(await kv.get(dailyKey('capblank')), null);
        const key = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        try {
            assert.equal((await call('capnokey')).status, 500);
            assert.equal(await kv.get(dailyKey('capnokey')), null);
        } finally {
            process.env.OPENAI_API_KEY = key;
        }
    });

    it('refuses a credential-less guest before touching the cap', async () => {
        await kv.set('auth:guesty', { guest: true, createdAt: Date.now() });
        const r = await call('guesty');
        assert.equal(r.status, 403);
        assert.equal(r.data.guestLocked, true);
        assert.equal(await kv.get(dailyKey('guesty')), null);
    });
});
