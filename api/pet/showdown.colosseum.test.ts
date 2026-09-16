import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { PET_CATALOG } from './_catalog.js';
import { SHOWDOWN_DAILY_WIN_CAP, SHOWDOWN_FORMAT_SIZE, type ShowdownFormat } from '../../shared/pet-showdown-contract.js';
import type { ShowdownSession } from '../_pet-showdown/engine.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'colosseum-lifecycle-offline-test-secret';
process.env.ENABLE_LEGACY = '1';
let handler: typeof import('./showdown.js').default;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let player: string, token: string, caseIndex = 0;
const ids = ['pet-a', 'pet-b', 'pet-c', 'pet-d', 'pet-e'];

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    // Keep initialization after the isolated QA environment is configured. This
    // server test compiles to CommonJS, whose dynamic import wraps the module.
    handler = require('./showdown.js').default;
});
beforeEach(async () => {
    player = `colosseumlifecycle${++caseIndex}`;
    token = issuePlayerToken(player)!;
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    const template = PET_CATALOG['standard-0'];
    await kv.set(`save:${player}`, { _saveVersion: 1, character: {
        name: player, level: 50, ryo: 1000, dailyPetWins: 0, totalPetWins: 0,
        lastDailyReset: new Date().toISOString().slice(0, 10),
        pets: ids.map(id => ({ ...template, id, templateId: template.id, level: 25, unlockedForPve: true })),
    } });
});
after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.ENABLE_LEGACY;
});
async function post(body: Record<string, unknown>, authToken = token) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader() { return res; }, status(value: number) { out.status = value; return res; },
        json(value: Record<string, unknown>) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'POST', body: { playerName: player, ...body },
        headers: { 'x-player-token': authToken }, socket: { remoteAddress: '127.0.0.81' },
    } as never, res as never);
    return out;
}
async function start(action = 'start', format: ShowdownFormat = '3v3') {
    const result = await post({ action, format, sparring: true, petIds: ids.slice(0, SHOWDOWN_FORMAT_SIZE[format] + 2) });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.state;
}
const key = (id: string) => `pet:showdown:${player}:${id}`;

test('practice seals owned field and reserve teams in every format and ignores forged reward/opponent data', async () => {
    for (const format of ['1v1', '2v2', '3v3'] as const) {
        const size = SHOWDOWN_FORMAT_SIZE[format];
        const result = await post({ action: 'start', format, sparring: true, petIds: ids.slice(0, size + 2),
            rewardEligible: true, enemyPets: [{ id: 'forged', hp: 1 }], pets: [{ id: ids[0], attack: 999999 }] });
        assert.equal(result.status, 200);
        const session = (await kv.get<ShowdownSession>(key(result.body.state.sessionId)))!;
        assert.equal(session.rewardEligible, false);
        assert.equal(session.player.filter(pet => !pet.benched).length, size);
        assert.equal(session.enemy.filter(pet => !pet.benched).length, size);
        assert.equal(session.player.length, size + 2);
        assert.equal(session.enemy.length, size + 2);
        assert.ok(session.enemy.every(pet => pet.id !== 'forged'));
        assert.ok(session.player.every(pet => Number.isFinite(pet.attack) && pet.attack < 999999));
    }
});

test('authentication and session ownership reject cross-player reads and turns without changing the bout', async () => {
    const state = await start();
    const before = await kv.get(key(state.sessionId));
    assert.equal((await post({ action: 'turn', sessionId: state.sessionId, commands: [] }, '')).status, 401);
    const foreignToken = issuePlayerToken('colosseumotherplayer')!;
    assert.ok([401, 403].includes((await post({ action: 'state', sessionId: state.sessionId }, foreignToken)).status));
    assert.equal((await post({ action: 'turn', playerName: 'colosseumotherplayer', sessionId: state.sessionId, commands: [] }, foreignToken)).status, 404);
    assert.deepEqual(await kv.get(key(state.sessionId)), before);
    assert.equal((await post({ action: 'state', sessionId: state.sessionId })).status, 200);
});

test('admission rejects duplicate, missing, and busy owned pets before creating a session', async () => {
    assert.equal((await post({ action: 'start', format: '2v2', petIds: [ids[0], ids[0]] })).status, 400);
    assert.equal((await post({ action: 'arena', format: '1v1', petIds: ['not-owned'] })).status, 409);
    const save = (await kv.get<Record<string, any>>(`save:${player}`))!;
    save.character.pets[0].training = { endsAt: Date.now() + 60_000 };
    await kv.set(`save:${player}`, save);
    assert.equal((await post({ action: 'arena', format: '1v1', petIds: [ids[0]] })).status, 409);
    assert.equal((await kv.keys(`pet:showdown:${player}:*`)).length, 0);
});

test('a paid terminal win settles once and replay cannot mint another reward or save version', async () => {
    const state = await start('arena');
    const session = (await kv.get<ShowdownSession>(key(state.sessionId)))!;
    assert.equal(session.rewardEligible, true);
    await kv.set(key(state.sessionId), { ...session, finished: true, outcome: 'win' });
    const first = await post({ action: 'turn', sessionId: state.sessionId, commands: [], reward: 999999 });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.ok(first.body.reward > 0 && first.body.reward < 999999);
    const paidSave = await kv.get(`save:${player}`);
    const replay = await post({ action: 'turn', sessionId: state.sessionId, commands: [] });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.reward, 0);
    assert.deepEqual(replay.body.events, []);
    assert.deepEqual(await kv.get(`save:${player}`), paidSave);
    assert.equal(replay.body.state.outcome, 'win');
});

test('practice terminals, concessions, and daily-capped paid admission never change balances', async () => {
    const state = await start();
    const saved = await kv.get(`save:${player}`);
    const session = (await kv.get<ShowdownSession>(key(state.sessionId)))!;
    await kv.set(key(state.sessionId), { ...session, finished: true, outcome: 'win' });
    const won = await post({ action: 'turn', sessionId: state.sessionId, commands: [], rewardEligible: true });
    assert.equal(won.status, 200);
    assert.equal(won.body.reward, 0);
    assert.equal(won.body.practice, true);
    assert.deepEqual(await kv.get(`save:${player}`), saved);
    const paid = await start('arena');
    assert.equal((await post({ action: 'forfeit', sessionId: paid.sessionId })).body.conceded, true);
    assert.equal((await post({ action: 'state', sessionId: paid.sessionId })).status, 404);
    assert.equal((await post({ action: 'forfeit', sessionId: paid.sessionId })).status, 200);
    assert.deepEqual(await kv.get(`save:${player}`), saved);
    const capped = structuredClone(saved) as Record<string, any>;
    capped.character.dailyPetWins = SHOWDOWN_DAILY_WIN_CAP;
    await kv.set(`save:${player}`, capped);
    const refused = await post({ action: 'arena', format: '1v1', petIds: [ids[0]] });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.capped, true);
});

test('retrying a resolved round refreshes its state without resolving another combat round', async () => {
    const state = await start();
    const request = { action: 'turn', sessionId: state.sessionId, expectedRound: state.round,
        commands: state.player.filter((pet: { benched: boolean }) => !pet.benched).map((pet: { id: string }) => ({ kind: 'rest', petId: pet.id })) };
    const first = await post(request);
    assert.equal(first.status, 200);
    assert.equal(first.body.state.round, state.round + 1);
    const sealed = await kv.get(key(state.sessionId));
    const retry = await post(request);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.state.round, first.body.state.round, 'a dropped reply must not spend another round');
    assert.deepEqual(retry.body.events, []);
    assert.deepEqual(await kv.get(key(state.sessionId)), sealed);
});

test('malformed or future round markers cannot mutate an active bout', async () => {
    const state = await start();
    const sealed = await kv.get(key(state.sessionId));
    for (const expectedRound of [-1, 0.5, '0', null, Number.MAX_SAFE_INTEGER + 1]) {
        const result = await post({ action: 'turn', sessionId: state.sessionId, expectedRound, commands: [] });
        assert.equal(result.status, 400);
        assert.deepEqual(await kv.get(key(state.sessionId)), sealed);
    }
    const future = await post({ action: 'turn', sessionId: state.sessionId, expectedRound: state.round + 1, commands: [] });
    assert.equal(future.status, 200);
    assert.equal(future.body.state.round, state.round);
    assert.deepEqual(future.body.events, []);
    assert.deepEqual(await kv.get(key(state.sessionId)), sealed);
});

test('concurrent submissions for one displayed round resolve combat at most once', async () => {
    const state = await start();
    const request = { action: 'turn', sessionId: state.sessionId, expectedRound: state.round, commands: [] };
    const responses = await Promise.all([post(request), post(request)]);
    for (const response of responses) assert.ok([200, 503].includes(response.status));
    assert.ok(responses.some(response => response.status === 200));
    const recovered = await post(request);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.state.round, state.round + 1);
    assert.deepEqual(recovered.body.events, []);
    const session = (await kv.get<ShowdownSession>(key(state.sessionId)))!;
    assert.equal(session.round, state.round + 1);
});
