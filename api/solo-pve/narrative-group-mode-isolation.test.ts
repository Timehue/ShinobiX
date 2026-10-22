import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupCombatCases, groupCombatFixture } from '../../scripts/narrative-group-fixtures.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'narrative-mode-isolation-test-secret';

test('authored group PvE sessions never become public Battle Tower runs', async t => {
    const { kv } = await import('../_storage.js');
    const { issuePlayerToken } = await import('../_auth.js');
    const { readSoloPveSession, writeSoloPveSession } = await import('./_store.js');
    const { sessionKey } = await import('../towers/_tower-store.js');
    type Handler = (req: never, res: never) => Promise<unknown>;
    const towerState = (await import('../towers/state.js')).default as unknown as Handler;
    const towerAction = (await import('../towers/action.js')).default as unknown as Handler;
    const towerSettle = (await import('../towers/settle.js')).default as unknown as Handler;
    async function call(handler: Handler, runId: string, method: 'GET' | 'POST') {
        const out = { status: 200, body: {} as Record<string, unknown> };
        const res = { setHeader() { return this; }, status(code: number) { out.status = code; return this; },
            json(value: Record<string, unknown>) { out.body = value; return this; }, end() { return this; } };
        const params = { playerName: 'groupaudit', runId, type: 'wait', expectedVersion: 0, moveToken: 'wrong-mode-request' };
        await handler({ method, query: params, body: params, headers: { 'x-player-token': issuePlayerToken('groupaudit') },
            socket: { remoteAddress: '198.51.100.94' } } as never, res as never);
        return out;
    }
    for (const entry of groupCombatCases) await t.test(entry.key, async () => {
        const { session, character } = groupCombatFixture(entry.key, entry.name, Date.now());
        const saved = { _saveVersion: 1, character };
        await kv.set('save:groupaudit', saved);
        await writeSoloPveSession(session);
        assert.equal(session.huntCombat!.battle.floorProvenance?.kind, 'embedded');
        assert.equal(await kv.get(sessionKey(session.sessionId)), null, 'no public Tower session is minted');
        assert.equal(await kv.get('battle-lock:groupaudit'), null, 'no Tower battle lease is acquired');
        assert.deepEqual(await readSoloPveSession(session.sessionId), session);
        for (const [handler, method] of [[towerState, 'GET'], [towerAction, 'POST'], [towerSettle, 'POST']] as const) {
            const response = await call(handler, session.sessionId, method);
            assert.equal(response.status, 404, JSON.stringify(response.body));
            assert.deepEqual(await readSoloPveSession(session.sessionId), session, 'Tower routes cannot change the PvE actors, health, turns or outcome');
            assert.deepEqual(await kv.get('save:groupaudit'), saved, 'Tower routes cannot grant rewards or advance Tower progression');
            assert.equal(await kv.get(sessionKey(session.sessionId)), null);
        }
    });
});
