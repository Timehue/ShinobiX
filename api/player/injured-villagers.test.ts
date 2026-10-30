import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

// GET /api/player/injured-villagers — the Rank 10 Healer's world-wide list.
// It used to read EVERY registered player's full save on every poll; it now
// reads only the saves whose indexed village can match, while the save's own
// village stays the authority.

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
const HEALER = 'mendhealer';
const VILLAGE = 'Stormveil Village';
let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let token: string;

before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.SESSION_SECRET = 'injured-villagers-test-secret-with-enough-entropy';
    ({ kv } = await import('../_storage.js'));
    token = (await import('../_auth.js')).issuePlayerToken(HEALER)!;
    handler = (await import('./injured-villagers.js')).default as unknown as Handler;
    const { buildPublicPlayerIndexEntry } = await import('./_public-index.js');
    const now = Date.now();
    const players: Array<{ slug: string; village: string; hp: number; indexVillage?: string; extra?: Json }> = [
        { slug: HEALER, village: VILLAGE, hp: 100, extra: { profession: 'healer', professionXp: 50_000_000 } },
        { slug: 'hurtally', village: VILLAGE, hp: 30 },
        { slug: 'fineally', village: VILLAGE, hp: 100 },
        { slug: 'hurtrival', village: 'Frostfang Village', hp: 10 },
        // A legacy index row without a village is still read.
        { slug: 'hurtlegacy', village: VILLAGE, hp: 55, indexVillage: '' },
    ];
    const registry: Json = {};
    for (const p of players) {
        const character = { name: p.slug, village: p.village, level: 12, hp: p.hp, maxHp: 100, ...p.extra };
        await kv.set(`save:${p.slug}`, { _saveVersion: 1, _saveAt: now, worldGeoV: 2, currentSector: 0, character });
        registry[p.slug] = buildPublicPlayerIndexEntry({ ...character, village: p.indexVillage ?? p.village }, p.slug, now);
    }
    await kv.hset('player:registry', registry);
});

after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });

async function poll(healer = HEALER, healerToken = token) {
    const out: { status: number; body?: Json; headers: Record<string, string> } = { status: 200, headers: {} };
    const res = { setHeader(key: string, value: string) { out.headers[key.toLowerCase()] = value; return res; }, status(code: number) { out.status = code; return res; },
        json(value: Json) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'GET', query: { healerName: healer },
        headers: { 'x-player-name': healer, 'x-player-token': healerToken, 'x-forwarded-for': '10.92.0.1' },
        socket: { remoteAddress: '10.92.0.1' } } as never, res as never);
    return out;
}

test('lists injured villagers of the healer\'s own village, worst first', async () => {
    const out = await poll();
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const injured = out.body!.injured as Array<{ name: string; hp: number }>;
    assert.deepEqual(injured.map((p) => p.name), ['hurtally', 'hurtlegacy']);
    // Authenticated, per-healer data: a shared cache keyed by URL would hand
    // this list to anyone who asked for ?healerName=<them>.
    assert.equal(out.headers['cache-control'], 'private, no-cache');
});

test('reads only saves whose indexed village can match (plus village-less rows)', async (t) => {
    const mget = t.mock.method(kv, 'mget');
    await poll();
    // On this in-memory store the vitals projection also reads through mget, so
    // compare the set of saves touched, not the call list.
    const saveReads = [...new Set(mget.mock.calls.flatMap((call) => call.arguments as string[]).filter((key) => key.startsWith('save:')))];
    assert.deepEqual(saveReads.sort(), ['save:fineally', 'save:hurtally', 'save:hurtlegacy', `save:${HEALER}`].sort());
    assert.equal(saveReads.includes('save:hurtrival'), false, 'another village\'s save is never read');
});

test('the registry read overlaps the healer read but never changes the healer checks', async (t) => {
    // The registry is fetched alongside the healer's save. A failing registry
    // read must still let a missing healer answer 404 (not 500), and must not
    // surface as an unhandled rejection.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
        const hgetall = t.mock.method(kv, 'hgetall', async () => { throw new Error('registry down'); });
        const ghostToken = (await import('../_auth.js')).issuePlayerToken('ghosthealer')!;
        const missing = await poll('ghosthealer', ghostToken);
        assert.equal(missing.status, 404, JSON.stringify(missing.body));
        assert.deepEqual(missing.body, { error: 'Healer character not found.' });
        assert.equal(hgetall.mock.callCount(), 1, 'the registry read starts with the healer read');
        // With the healer present, the same registry failure is a 500, as before.
        const failed = await poll();
        assert.equal(failed.status, 500);
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(unhandled, []);
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});
