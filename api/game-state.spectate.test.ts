import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'spectator-board-test-secret-at-least-32-bytes';

test('ranked fights are published individually and a fighter leaving preserves other fights', async () => {
    const { kv } = await import('./_storage.js');
    const { issuePlayerToken } = await import('./_auth.js');
    const handler = (await import('./game-state.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    const now = Date.now();
    const boardKey = 'game:arena:active-fights';
    await kv.del(boardKey);
    for (const [id, p1, p2] of [['ranked-one', 'alpha', 'bravo'], ['ranked-two', 'charlie', 'delta']]) {
        await kv.set(`pvp:${id}`, { battleId: id, status: 'active', ranked: true, createdAt: now, p1: { name: p1 }, p2: { name: p2 } });
    }
    async function write(action: 'register' | 'remove', id: string, actor: string) {
        let status = 200;
        const res = { setHeader() {}, status(code: number) { status = code; return this; }, json() { return this; }, end() { return this; } };
        await handler({ method: 'POST', query: {}, headers: { 'x-player-token': issuePlayerToken(actor) }, body: {
            kind: 'arenaActiveFight', action,
            ...(action === 'register' ? { fight: { id: `pvp-${id}`, battleId: id, mode: 'PvP', startedAt: now, fighters: [] } } : { fightId: `pvp-${id}` }),
        } } as never, res as never);
        return status;
    }
    async function writeLegacy(fights: unknown[], actor: string) {
        let status = 200;
        const res = { setHeader() {}, status(code: number) { status = code; return this; }, json() { return this; }, end() { return this; } };
        await handler({ method: 'POST', query: {}, headers: { 'x-player-token': issuePlayerToken(actor) },
            body: { kind: 'arenaActiveFights', fights } } as never, res as never);
        return status;
    }
    async function readFights() {
        let status = 200;
        let body: { arenaActiveFights?: Array<{ id: string }> } = {};
        const headers: Record<string, string> = {};
        const res = { setHeader(name: string, value: string) { headers[name] = value; return this; },
            status(code: number) { status = code; return this; },
            json(value: typeof body) { body = value; return this; }, end() { return this; } };
        await handler({ method: 'GET', query: { activeFights: '1' }, headers: {} } as never, res as never);
        assert.equal(status, 200);
        assert.equal(headers['Cache-Control'], 'no-store');
        return body.arenaActiveFights ?? [];
    }
    assert.equal(await write('register', 'ranked-one', 'alpha'), 200);
    assert.equal(await write('register', 'ranked-two', 'charlie'), 200);
    assert.equal(await write('register', 'ranked-one', 'viewer'), 403);
    assert.equal(await write('remove', 'ranked-one', 'viewer'), 403);
    let fights = await kv.get<Array<{ id: string; mode: string; fighters: string[] }>>(boardKey);
    assert.deepEqual(fights?.map(f => f.id), ['pvp-ranked-two', 'pvp-ranked-one']);
    assert.ok(fights?.every(f => f.mode === 'Ranked'));
    assert.deepEqual(fights?.[0].fighters, ['charlie', 'delta']);
    assert.deepEqual((await readFights()).map(f => f.id), ['pvp-ranked-two', 'pvp-ranked-one']);
    assert.equal(await writeLegacy([{ id: 'pvp-ranked-one', fighters: ['alpha', 'bravo'], battleId: 'ranked-one', startedAt: now }], 'alpha'), 200);
    fights = await kv.get(boardKey);
    assert.deepEqual(new Set(fights?.map(f => f.id)), new Set(['pvp-ranked-one', 'pvp-ranked-two']));
    assert.equal(await write('remove', 'ranked-one', 'alpha'), 200);
    fights = await kv.get(boardKey);
    assert.deepEqual(fights?.map(f => f.id), ['pvp-ranked-two']);
    assert.deepEqual((await readFights()).map(f => f.id), ['pvp-ranked-two']);
    await kv.set('pvp:ranked-two', { battleId: 'ranked-two', status: 'active', ranked: true, rankedCloseFence: { version: 'player-ranked-session-close-fence-v1' }, p1: { name: 'charlie' }, p2: { name: 'delta' } });
    assert.equal(await write('register', 'ranked-two', 'charlie'), 409);
    await kv.set('pvp:ranked-two', { battleId: 'ranked-two', status: 'done', ranked: true, p1: { name: 'charlie' }, p2: { name: 'delta' } });
    assert.equal(await write('register', 'ranked-two', 'charlie'), 409);
    await kv.del('pvp:ranked-two');
    assert.equal(await write('remove', 'ranked-two', 'charlie'), 200);
    assert.deepEqual(await kv.get(boardKey), []);
    await kv.del(boardKey, 'pvp:ranked-one', 'pvp:ranked-two');
});
