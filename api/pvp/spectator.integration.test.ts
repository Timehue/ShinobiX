import { before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'sector-spectator-integration-test-secret-32-bytes';
delete process.env.DISABLE_GUEST_SOCIAL_LOCK;

type Handler = (req: never, res: never) => Promise<unknown>;
let chat: Handler;
let spectate: Handler;
let issuePlayerToken: (name: string) => string | null;
let kv: typeof import('../_storage.js').kv;
const battleId = 'sector-spectator-integration';

function response() {
    const out: { statusCode: number; body?: unknown } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: unknown) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function call(handler: Handler, player: string | null, method: string, body: Record<string, unknown> = {}) {
    const result = response();
    await handler({ method, body, query: { id: battleId },
        headers: { 'content-type': 'application/json', ...(player ? { 'x-player-token': issuePlayerToken(player)! } : {}) },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, result.res);
    return result.out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    chat = (await import('./chat.js')).default as unknown as Handler;
    spectate = (await import('./spectate.js')).default as unknown as Handler;
    for (const name of ['sectorviewer', 'sectorfighter', 'sectorguest', 'sectormuted'])
        await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, village: 'Frostfang', level: 40 } });
    await kv.set(`pvp:${battleId}`, { battleId, p1: { name: 'sectorfighter' }, p2: { name: 'opponent' } });
    await kv.set('auth:sectorguest', { guest: true });
    await kv.set('mod:silence:sectormuted', { until: Date.now() + 60_000, reason: 'fixture', by: 'test', at: Date.now() });
});

test('spectator heartbeat joins, refreshes and leaves using the signed-in identity', async () => {
    assert.equal((await call(spectate, null, 'GET')).statusCode, 401);
    assert.equal((await call(spectate, 'sectorviewer', 'POST', { name: 'sectorfighter', action: 'join' })).statusCode, 401);
    for (let i = 0; i < 2; i++) {
        const joined = await call(spectate, 'sectorviewer', 'POST', { name: 'sectorviewer', action: 'join' });
        assert.equal(joined.statusCode, 200);
        assert.deepEqual((joined.body as Array<{ name: string }>).map(s => s.name), ['sectorviewer']);
    }
    const read = await call(spectate, 'sectorviewer', 'GET');
    assert.equal(read.statusCode, 200);
    assert.equal((read.body as unknown[]).length, 1);
    const left = await call(spectate, 'sectorviewer', 'POST', { name: 'sectorviewer', action: 'leave' });
    assert.equal(left.statusCode, 200);
    assert.deepEqual(left.body, []);
});

test('battle chat derives fighter and spectator roles and returns the confirmed shared feed', async () => {
    assert.equal((await call(chat, null, 'GET')).statusCode, 401);
    assert.equal((await call(chat, 'sectorviewer', 'POST', { author: 'sectorfighter', text: 'Not my identity' })).statusCode, 401);
    const viewer = await call(chat, 'sectorviewer', 'POST', { author: 'sectorviewer', text: 'Watching this fight', role: 'fighter' });
    assert.equal(viewer.statusCode, 200);
    assert.equal((viewer.body as Array<{ role: string }>).at(-1)?.role, 'spectator');
    const fighter = await call(chat, 'sectorfighter', 'POST', { author: 'sectorfighter', text: 'Welcome to the fight', role: 'spectator' });
    assert.equal(fighter.statusCode, 200);
    assert.equal((fighter.body as Array<{ role: string }>).at(-1)?.role, 'fighter');
    const read = await call(chat, 'sectorviewer', 'GET');
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.body, fighter.body);
});

test('guests and silenced spectators can watch but cannot bypass chat restrictions', async () => {
    for (const player of ['sectorguest', 'sectormuted']) {
        assert.equal((await call(spectate, player, 'POST', { name: player, action: 'join' })).statusCode, 200);
        const before = await call(chat, player, 'GET');
        assert.equal(before.statusCode, 200);
        assert.equal((await call(chat, player, 'POST', { author: player, text: 'This must not be sent', role: 'spectator' })).statusCode, 403);
        assert.deepEqual((await call(chat, player, 'GET')).body, before.body);
    }
});
