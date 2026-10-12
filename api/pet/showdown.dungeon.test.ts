import assert from 'node:assert/strict';
import { before, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'dungeon-command-test-secret-32chars';
type Json = Record<string, any>;
let kv: typeof import('../_storage.js').kv;
let token: typeof import('../_auth.js').issuePlayerToken;
let handler: typeof import('./showdown.js').default;
let sequence = 0;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken: token } = await import('../_auth.js'));
    handler = (await import('./showdown.js')).default as unknown as typeof handler;
});
async function call(name: string, body: Json) {
    const out: { status: number; body: Json } = { status: 200, body: {} };
    const res = { setHeader() { return res; }, status(value: number) { out.status = value; return res; }, json(value: Json) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'POST', body: { playerName: name, ...body }, headers: { 'x-player-token': token(name), 'content-type': 'application/json' }, socket: { remoteAddress: `127.3.0.${++sequence}` } } as never, res as never);
    return out;
}
async function fixture(label: string) {
    const name = `dungeoncommand${label}`;
    const runToken = `runcommand${label}01`;
    const character: Json = {
        name, level: 80, ryo: 321, totalPetWins: 7, dailyPetWins: 2,
        pets: [{ id: 'hero', name: 'Dungeon Sentinel', element: 'Water', rarity: 'rare', level: 80, xp: 0, maxLevel: 100,
            hp: 10000, attack: 10000, defense: 10000, speed: 1000, unlockedForPve: true,
            jutsus: [{ name: 'Tidal Verdict', power: 500, cooldown: 1, currentCooldown: 0, kind: 'damage' }] }],
        activeDungeonRun: { token: runToken, startedAt: 1, entry: 'key', combatAuthorityVersion: 1,
            wardenDefeated: true, wardenProofId: 'wardenproof0001', cardAuthorityVersion: 1,
            cardLastOutcome: 'player', cardLastProofId: 'cardproof000001', cardSettledAt: 2,
            cardDefeated: true, cardProofId: 'cardproof000001', cardDefeatedAt: 2 },
    };
    await kv.set(`save:${name}`, { _saveVersion: 1, character });
    const start = () => call(name, { action: 'encounter', petIds: ['hero'], encounter: { kind: 'dungeon-seal', runToken }, enemyPets: [{ hp: 1 }], seed: 0 });
    return { name, runToken, character, start };
}
test('Dungeon command admission binds exact parent proof and resumes one immutable battle', async () => {
    const f = await fixture('resume');
    const denied = await call(f.name, { action: 'encounter', petIds: ['hero'], encounter: { kind: 'dungeon-seal', runToken: 'otherrun0001' } });
    assert.equal(denied.status, 409);
    const [a, b] = await Promise.all([f.start(), f.start()]);
    assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(b.status, 200);
    assert.equal(a.body.state.sessionId, b.body.state.sessionId);
    assert.equal(a.body._saveVersion, 2);
    assert.equal(a.body.state.damageRules, 'response-v2');
    const stored = await kv.get<Json>(`pet:showdown:${f.name}:${a.body.state.sessionId}`);
    const { sealShowdownPet } = await import('../_pet-showdown/engine.js');
    const { buildDungeonCommandBeast } = await import('./_dungeon-command-beast.js');
    const expected = sealShowdownPet(buildDungeonCommandBeast());
    assert.equal(stored!.enemy[0].maxHp, expected.maxHp);
    assert.deepEqual(stored!.enemy[0].moves, expected.moves, 'art selection cannot change the fixed boss kit');
    assert.equal(stored!.enemy[0].name, 'Sealed Rare Beast');
    assert.deepEqual(stored!.dungeonRun, { runToken: f.runToken, petId: 'hero' });
    assert.equal(stored!.rewardEligible, false);
});
test('a commanded win writes the parent once, pays nothing, and lost replies recover', async () => {
    const f = await fixture('win'); const opened = await f.start();
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    let state = opened.body.state;
    let final: Awaited<ReturnType<typeof call>> | undefined;
    for (let round = 0; round < 30 && !state.finished; round++) {
        final = await call(f.name, { action: 'turn', sessionId: state.sessionId, expectedRound: state.round,
            commands: [{ kind: 'move', petId: 'hero', moveIndex: 0, targetId: state.enemy[0].id }] });
        assert.equal(final.status, 200, JSON.stringify(final.body)); state = final.body.state;
    }
    assert.equal(state.outcome, 'win'); assert.equal(final!.body.reward, 0);
    const save = await kv.get<Json>(`save:${f.name}`);
    assert.equal(save!.character.activeDungeonRun.petProofId, state.sessionId);
    assert.equal(save!.character.activeDungeonRun.petDefeated, true);
    assert.equal(save!.character.ryo, 321); assert.equal(save!.character.totalPetWins, 7);
    assert.equal(save!.character.dailyPetWins, 2);
    const retry = await call(f.name, { action: 'turn', sessionId: state.sessionId, expectedRound: state.round, commands: [] });
    assert.equal(retry.status, 200); assert.equal(retry.body._saveVersion, save!._saveVersion);
    const recovered = await f.start(); assert.equal(recovered.body.completed, true);
    assert.equal(recovered.body._saveVersion, save!._saveVersion);
});
test('abandoning the parent blocks old turns, concession, and completion', async () => {
    const f = await fixture('stale'); const opened = await f.start();
    const id = opened.body.state.sessionId;
    const save = await kv.get<Json>(`save:${f.name}`);
    await kv.set(`save:${f.name}`, { ...save, character: { ...save!.character, activeDungeonRun: { ...f.character.activeDungeonRun, token: 'replacementrun01' } } });
    for (const action of ['state', 'turn', 'forfeit']) {
        const denied = await call(f.name, { action, sessionId: id, commands: [] });
        assert.ok(denied.status >= 400, `${action} cannot mutate a replaced parent`);
    }
    assert.equal((await kv.get<Json>(`pet:showdown:${f.name}:${id}`))!.round, 0);
    assert.equal((await kv.get<Json>(`save:${f.name}`))!.character.activeDungeonRun.petDefeated, undefined);
});
test('concessions remain losses and cannot grant a parent win or restart the same run', async () => {
    const f = await fixture('loss'); const opened = await f.start();
    const lost = await call(f.name, { action: 'forfeit', sessionId: opened.body.state.sessionId });
    assert.equal(lost.status, 200); assert.equal(lost.body.state.outcome, 'loss');
    assert.equal(lost.body.character.activeDungeonRun.petLastOutcome, 'loss');
    assert.notEqual(lost.body.character.activeDungeonRun.petDefeated, true);
    const resumed = await f.start(); assert.equal(resumed.body.state.sessionId, opened.body.state.sessionId);
    assert.equal(resumed.body.state.outcome, 'loss');
    assert.equal(resumed.body._saveVersion, lost.body._saveVersion);
});

test('a saved terminal session repairs an interrupted parent write on reopening', async () => {
    const f = await fixture('repair'); const opened = await f.start();
    const key = `pet:showdown:${f.name}:${opened.body.state.sessionId}`;
    const session = (await kv.get<Json>(key))!;
    // Crash after terminal combat persistence, before the parent save commit.
    await kv.set(key, { ...session, finished: true, outcome: 'win' });
    const recovered = await f.start();
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.equal(recovered.body.character.activeDungeonRun.petDefeated, true);
    assert.equal(recovered.body._saveVersion, 3);
    assert.equal(recovered.body.character.ryo, 321);
    const retry = await f.start(); assert.equal(retry.body.completed, true);
    assert.equal(retry.body._saveVersion, 3);
});
