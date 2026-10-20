import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'gauntlet-recovery-test-secret-at-least-32';
let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./gauntlet.js').default;
let token: string;
let player = '';
before(async () => { ({ kv } = await import('../_storage.js')); handler = (await import('./gauntlet.js')).default as unknown as typeof handler; });
beforeEach(async () => {
    player = `gauntletrecover${Math.random().toString(36).slice(2, 10)}`;
    token = (await import('../_auth.js')).issuePlayerToken(player)!;
    await kv.set(`save:${player}`, { _saveVersion: 1, character: { name: player, ryo: 1000, fateShards: 4, boneCharms: 3 } });
});
async function post(body: Record<string, unknown>) {
    const result = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader() { return res; }, status(code: number) { result.status = code; return res; }, json(value: Record<string, any>) { result.body = value; return res; }, end() { return res; } };
    await handler({ method: 'POST', body, headers: { 'x-player-token': token }, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return result;
}
test('a lost completed reply recovers its own saved receipt without paying again', async () => {
    const start = await post({ action: 'start' }); assert.equal(start.status, 200);
    const sealKey = `petgauntlet:tok:${start.body.runToken}`;
    await kv.set(sealKey, { ...(await kv.get<Record<string, unknown>>(sealKey)), seed: 42 });
    const place = [{ row: 0, col: 0 }, { row: 2, col: 1 }, { row: 1, col: 2 }, { row: 0, col: 3 }, { row: 2, col: 4 }];
    // A legal draft and five real simulated battles end in a two-round clear.
    const transcript = [{ k: 'buy', i: 0 }, { k: 'buy', i: 0 }, { k: 'buy', i: 0 }, ...Array.from({ length: 5 }, () => ({ k: 'fight', place }))];
    const body = { action: 'report', runToken: start.body.runToken, transcript };
    const first = await post(body); assert.equal(first.status, 200);
    assert.equal(first.body.roundsCleared, 2);
    assert.equal(first.body.heartsLeft, 0);
    assert.equal(first.body.ryo, 500);
    assert.equal(first.body.character.ryo, 1500);
    assert.ok(first.body.character); assert.ok(first.body._saveVersion > 1);
    const saved = await kv.get(`save:${player}`);
    assert.equal(await kv.get(`petgauntlet:tok:${start.body.runToken}`), null);
    const retry = await post(body); assert.equal(retry.status, 200);
    assert.equal(retry.body.ryo, first.body.ryo);
    assert.equal(retry.body.score, null, 'old receipt does not invent a weekly score');
    assert.deepEqual(retry.body.character, first.body.character);
    assert.deepEqual(await kv.get(`save:${player}`), saved);
});
test('a leaderboard failure keeps an unpaid seal and the retry pays once', async () => {
    const start = await post({ action: 'start' });
    const before = await kv.get(`save:${player}`);
    const body = { action: 'report', runToken: start.body.runToken, transcript: [] };
    const realSet = kv.set.bind(kv);
    kv.set = (async (key: string, ...args: unknown[]) => {
        if (key.startsWith('petgauntlet:lb:')) throw new Error('Controlled leaderboard outage');
        return (realSet as (...values: unknown[]) => Promise<unknown>)(key, ...args);
    }) as typeof kv.set;
    let failed: Awaited<ReturnType<typeof post>>;
    try { failed = await post(body); } finally { kv.set = realSet; }
    assert.equal(failed!.status, 500);
    assert.ok(await kv.get(`petgauntlet:tok:${start.body.runToken}`));
    assert.deepEqual(await kv.get(`save:${player}`), before, 'an unavailable leaderboard cannot strand a paid seal');
    const retry = await post(body); assert.equal(retry.status, 200);
    assert.equal(retry.body.score, 300);
    const paid = await kv.get(`save:${player}`);
    assert.equal((await post(body)).status, 200);
    assert.deepEqual(await kv.get(`save:${player}`), paid);
    assert.equal(await kv.get(`petgauntlet:tok:${start.body.runToken}`), null);
});
test('another player or a fabricated token cannot recover someone else’s reward', async () => {
    assert.equal((await post({ action: 'report', runToken: 'not-a-receipt', transcript: [] })).status, 409);
    await kv.set('petgauntlet:tok:foreign', { player: 'someoneelse' });
    assert.equal((await post({ action: 'report', runToken: 'foreign', transcript: [] })).status, 403);
});
