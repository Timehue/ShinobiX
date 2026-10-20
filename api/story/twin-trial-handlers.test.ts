import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SoloPveSession } from '../solo-pve/_session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'twin-trial-handler-test-secret-32-bytes';

// Exercise the registered routes themselves, including authentication, actual
// session/binding storage, automatic physical settlement and reward receipts.
test('twin trial API lifecycle in both villages', async t => {
    const { kv } = await import('../_storage.js');
    const { issuePlayerToken } = await import('../_auth.js');
    type Handler = (req: never, res: never) => Promise<unknown>;
    const start = (await import('./boss-start.js')).default as unknown as Handler;
    const action = (await import('../solo-pve/action.js')).default as unknown as Handler;
    const settle = (await import('./settle.js')).default as unknown as Handler;
    const { readSoloPveSession, writeSoloPveSession } = await import('../solo-pve/_store.js');
    const { STORY_REWARDS } = await import('./_settle.js');
    async function call(handler: Handler, playerName: string, body: Record<string, unknown>, token = issuePlayerToken(playerName)!) {
        const out = { status: 200, body: {} as Record<string, unknown> };
        const res = { setHeader() { return this; }, status(code: number) { out.status = code; return this; },
            json(value: Record<string, unknown>) { out.body = value; return this; }, end() { return this; } };
        await handler({ method: 'POST', body: { playerName, ...body }, headers: { 'x-player-token': token }, socket: { remoteAddress: '198.51.100.91' } } as never, res as never);
        return out;
    }
    for (const village of ['Stormveil Village', 'Frostfang Village']) await t.test(village, async () => {
        const name = `twintest${village.startsWith('Storm') ? 'storm' : 'frost'}`;
        await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: 1, character: {
            name, village, level: 50, storyProgress: 4, specialty: 'Ninjutsu',
            hp: 20000, maxHp: 20000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
            stats: { ninjutsuOffense: 2000, ninjutsuDefense: 1000, bukijutsuDefense: 1000 },
            jutsu: [], inventory: [], equipment: {}, pets: [], ryo: 100, unspentStats: 0, starterCardsClaimed: true, tileCards: [],
        } });
        const begun = await call(start, name, {});
        assert.equal(begun.status, 200, JSON.stringify(begun.body));
        let s = begun.body.session as SoloPveSession;
        const ids = s.huntCombat!.battle.actors.filter(a => a.side === 'enemy').map(a => a.id);
        assert.equal(ids.length, 2, 'the real start handler seals both twins');
        const runId = s.sessionId;
        const wrong = await call(action, name, { sessionId: runId, expectedVersion: 1, moveToken: 'wrong-account-1', type: 'huntAction', action: { type: 'wait' } }, issuePlayerToken('otheraccount')!);
        assert.ok([401, 403].includes(wrong.status));
        s.huntCombat!.battle.actors[0].character.jutsu = [{ id: 'test-finisher', name: 'Finisher', type: 'Ninjutsu', ap: 60, range: 30, effectPower: 10000, chakraCost: 0, staminaCost: 0, cooldown: 0, target: 'OPPONENT', method: 'SINGLE', tags: [] }];
        await writeSoloPveSession(s);
        let seq = 0;
        const move = async (intent: Record<string, unknown>) => {
            const result = await call(action, name, { sessionId: runId, expectedVersion: s.version, moveToken: `handler-move-${++seq}`, type: 'huntAction', action: intent });
            assert.equal(result.status, 200, JSON.stringify(result.body));
            assert.equal(result.body.applied, true, JSON.stringify(result.body));
            s = result.body.session as SoloPveSession;
        };
        await move({ type: 'jutsu', jutsuId: 'test-finisher', targetId: ids[1] });
        assert.equal(s.status, 'active', 'caster-first KO also leaves the blade fighting');
        const early = await call(settle, name, { kind: 'storyBoss', runId });
        assert.equal(early.status, 409);
        const beforeInvalid = structuredClone(s);
        const dead = await call(action, name, { sessionId: runId, expectedVersion: s.version, moveToken: 'dead-target-0001', type: 'huntAction', action: { type: 'attack', targetId: ids[1] } });
        assert.equal(dead.body.applied, false);
        assert.deepEqual(await readSoloPveSession(runId), beforeInvalid, 'invalid targets charge no AP/resources/version');
        await move({ type: 'wait' });
        await move({ type: 'jutsu', jutsuId: 'test-finisher', targetId: ids[0] });
        assert.equal(s.winner, 'player');
        assert.ok(s.log.includes('Both twins are defeated. Trial won!'));
        const paid = await call(settle, name, { kind: 'storyBoss', runId });
        assert.equal(paid.status, 200, JSON.stringify(paid.body));
        const awarded = paid.body.character as Record<string, unknown>;
        assert.equal(awarded.storyProgress, 5);
        assert.equal(awarded.ryo, 100 + STORY_REWARDS[4].ryo);
        const replay = await call(settle, name, { kind: 'storyBoss', runId });
        assert.equal(replay.status, 200);
        assert.equal(replay.body.replayed, true);
        assert.equal((replay.body.character as Record<string, unknown>).ryo, awarded.ryo);
        // Retry after a defeat uses a new run, keeps the chapter open, and writes
        // the same 10% max-HP forfeit cost exactly once through the real handler.
        const saved = await kv.get<{ character: Record<string, unknown> }>(`save:${name}`);
        saved!.character.storyProgress = 4;
        await kv.set(`save:${name}`, saved);
        const retry = await call(start, name, {});
        assert.equal(retry.status, 200, JSON.stringify(retry.body));
        const retrySession = retry.body.session as SoloPveSession;
        assert.notEqual(retrySession.sessionId, runId);
        const abandonBody = { sessionId: retrySession.sessionId, expectedVersion: retrySession.version, moveToken: 'forfeit-trial-0001', type: 'abandon' };
        const forfeited = await call(action, name, abandonBody);
        assert.equal(forfeited.status, 200, JSON.stringify(forfeited.body));
        const terminal = forfeited.body.session as SoloPveSession;
        assert.equal(terminal.winner, 'enemy');
        assert.equal(terminal.player.hp, Math.max(0, retrySession.player.hp - Math.floor(retrySession.player.maxHp * .1)));
        const lossSave = await kv.get<{ character: Record<string, unknown> }>(`save:${name}`);
        assert.equal(lossSave!.character.storyProgress, 4);
        assert.equal(lossSave!.character.hp, terminal.player.hp);
        await call(action, name, abandonBody);
        assert.equal((await kv.get<{ character: Record<string, unknown> }>(`save:${name}`))!.character.hp, terminal.player.hp);
        assert.equal((await call(settle, name, { kind: 'storyBoss', runId: terminal.sessionId })).status, 409);
        const lastStart = await call(start, name, {});
        assert.equal(lastStart.status, 200);
        const last = lastStart.body.session as SoloPveSession;
        const actors = last.huntCombat!.battle.actors;
        actors[0].hp = 1; actors[0].pos = 0; actors[1].pos = 1; actors[2].pos = 12;
        last.player.hp = 1;
        await writeSoloPveSession(last);
        const knockedOut = await call(action, name, { sessionId: last.sessionId, expectedVersion: last.version,
            moveToken: 'knockout-trial-0001', type: 'huntAction', action: { type: 'wait' } });
        assert.equal(knockedOut.status, 200, JSON.stringify(knockedOut.body));
        assert.equal((knockedOut.body.session as SoloPveSession).player.hp, 0);
        const down = await kv.get<{ character: Record<string, unknown> }>(`save:${name}`);
        assert.equal(down!.character.hp, 0);
        assert.equal(down!.character.storyProgress, 4);
        assert.equal((await call(start, name, {})).status, 409, 'a real knockout requires recovery before another trial');
    });
});
