import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'relic-war-crate-integration';
let kv: typeof import('../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./open-war-crate.js')).default as unknown as typeof handler;
});
beforeEach(async () => {
    await kv.set('save:relic-winner', { _saveVersion: 1, character: {
        name: 'relic-winner', level: 100, inventory: ['legendary-war-crate'],
        ryo: 100, honorSeals: 0, boneCharms: 0, fateShards: 2,
    } });
});
async function open(extra: Record<string, unknown> = {}) {
    const out: { status: number; body: Record<string, unknown> } = { status: 200, body: {} };
    const res = {
        setHeader() { return res; }, status(code: number) { out.status = code; return res; },
        json(body: Record<string, unknown>) { out.body = body; return res; }, end() { return res; },
    };
    await handler({ method: 'POST', body: { playerName: 'relic-winner', ...extra },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}
async function character() {
    return (await kv.get<{ character: Record<string, unknown> }>('save:relic-winner'))!.character;
}

test('concurrent opens consume one authoritative crate and publish one bonus relic', async () => {
    const random = Math.random;
    Math.random = () => 0;
    try {
        const replies = await Promise.all([open(), open()]);
        assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 400]);
        const winner = replies.find(reply => reply.status === 200)!;
        assert.equal((winner.body.rewards as Record<string, unknown>).equippableRelicId, 'relic-duelists-red-cord');
        const saved = await character();
        assert.deepEqual(saved.inventory, ['relic-duelists-red-cord']);
        assert.equal(saved.ryo, 600);
        assert.equal(saved.fateShards, 2);
        assert.deepEqual(saved.itemStacks, [{ itemId: 'warforged-relic', count: 1 }, { itemId: 'dungeon-key', count: 1 }]);
        assert.equal((await open()).status, 400);
        assert.deepEqual(await character(), saved);
    } finally { Math.random = random; }
});

test('an equipped duplicate publishes shard compensation in the locked snapshot', async () => {
    const before = await character();
    await kv.set('save:relic-winner', { _saveVersion: 1, character: { ...before, equipment: { relic: 'relic-duelists-red-cord' } } });
    const random = Math.random;
    Math.random = () => 0;
    try {
        const reply = await open();
        assert.equal(reply.status, 200);
        assert.equal((reply.body.rewards as Record<string, unknown>).fateShards, 15);
        assert.equal((reply.body.rewards as Record<string, unknown>).equippableRelicId, undefined);
        assert.equal((await character()).fateShards, 17);
        assert.deepEqual((await character()).inventory, []);
    } finally { Math.random = random; }
});

test('request fields cannot override a losing roll or the stored level gate', async () => {
    const random = Math.random;
    try {
        Math.random = () => 0.9;
        const miss = await open({ relicRoll: 0, equippableRelicId: 'relic-duelists-red-cord' });
        assert.equal(miss.status, 200);
        assert.equal((miss.body.rewards as Record<string, unknown>).equippableRelicId, undefined);
        await kv.set('save:relic-winner', { _saveVersion: 2, character: { ...await character(), level: 99, inventory: ['legendary-war-crate'] } });
        Math.random = () => 0;
        const locked = await open({ level: 100, relicRoll: 0 });
        assert.equal(locked.status, 200);
        assert.equal((locked.body.rewards as Record<string, unknown>).equippableRelicId, undefined);
        assert.deepEqual((await character()).inventory, []);
    } finally { Math.random = random; }
});
