import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'gauntlet-entry-test-session-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let token = '';
const PLAYER = 'gauntletfeeprobe';

function response() {
    const out: { statusCode: number; body?: Record<string, unknown> } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    token = (await import('../_auth.js')).issuePlayerToken(PLAYER)!;
    handler = (await import('./gauntlet.js')).default as unknown as Handler;
    await kv.set(`save:${PLAYER}`, { _saveVersion: 1, character: { name: PLAYER, ryo: 2_000 } });
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

function request() {
    return {
        method: 'POST', body: { action: 'start' },
        headers: { 'content-type': 'application/json', 'x-player-token': token },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

test('Gauntlet start debits the stored wallet after the daily free run', async () => {
    const first = response();
    await handler(request(), first.res);
    assert.equal(first.out.statusCode, 200);
    assert.equal(first.out.body?.chargedRyo, 0);

    const second = response();
    await handler(request(), second.res);
    assert.equal(second.out.statusCode, 200);
    assert.equal(second.out.body?.chargedRyo, 1_500);
    assert.equal((second.out.body?.balances as { ryo?: number })?.ryo, 500);

    const denied = response();
    await handler(request(), denied.res);
    assert.equal(denied.out.statusCode, 409);
    const stored = await kv.get<{ character?: { ryo?: number; petGauntletEntryCount?: number } }>(`save:${PLAYER}`);
    assert.equal(stored?.character?.ryo, 500);
    assert.equal(stored?.character?.petGauntletEntryCount, 2);
});
