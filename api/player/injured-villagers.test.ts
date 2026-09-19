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

async function poll() {
    const out: { status: number; body?: Json; headers: Record<string, string> } = { status: 200, headers: {} };
    const res = { setHeader(key: string, value: string) { out.headers[key.toLowerCase()] = value; return res; }, status(code: number) { out.status = code; return res; },
        json(value: Json) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'GET', query: { healerName: HEALER },
        headers: { 'x-player-name': HEALER, 'x-player-token': token, 'x-forwarded-for': '10.92.0.1' },
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
    const saveReads = mget.mock.calls.flatMap((call) => call.arguments as string[]).filter((key) => key.startsWith('save:'));
    assert.deepEqual(saveReads.sort(), ['save:fineally', 'save:hurtally', 'save:hurtlegacy', `save:${HEALER}`].sort());
    assert.equal(saveReads.includes('save:hurtrival'), false, 'another village\'s save is never read');
});
