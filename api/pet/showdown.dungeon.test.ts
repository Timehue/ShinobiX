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
    assert.equal(stored!.rulesetVersion, 'legacy-v2', 'the authored boss remains under its calibrated gate rules');
});
test('a failed Dungeon admission leaves its parent and charge untouched, then concurrent retries spend once', async t => {
    const f = await fixture('admissionfailure');
    f.character.pets[0].loadout = { consumable: 'consum-smoke-pellet' };
    await kv.set(`save:${f.name}`, { _saveVersion: 1, character: f.character });
    const fault = t.mock.method(kv as typeof kv & { compareSetMany: NonNullable<typeof kv.compareSetMany> }, 'compareSetMany', async () => { throw new Error('fixture-admission-write-failed'); });
    assert.equal((await f.start()).status, 500);
    const unchanged = (await kv.get<Json>(`save:${f.name}`))!;
    assert.equal(unchanged._saveVersion, 1);
    assert.equal(unchanged.character.activeDungeonRun.petArenaSessionId, undefined);
    assert.equal(unchanged.character.pets[0].loadout.consumable, 'consum-smoke-pellet');
    assert.deepEqual(await kv.keys(`pet:showdown:${f.name}:*`), []);
    fault.mock.restore();
    const [a, b] = await Promise.all([f.start(), f.start()]);
    assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal(a.body.state.sessionId, b.body.state.sessionId);
    const committed = (await kv.get<Json>(`save:${f.name}`))!;
    assert.equal(committed._saveVersion, 2);
    assert.equal(committed.character.pets[0].loadout.consumable, undefined);
    assert.equal(committed.character.activeDungeonRun.petArenaSessionId, a.body.state.sessionId);
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

test('Dungeon admission and settlement preserve idle regeneration through canonical save mutations', async () => {
    const f = await fixture('regen');
    const at = Date.now() - 30000;
    const tired = { ...f.character, hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100 };
    await kv.set(`save:${f.name}`, { _saveVersion: 1, _saveAt: at, _regenAt: at, character: tired });
    const opened = await f.start(); assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.ok(opened.body.character.hp >= 40);
    const save = (await kv.get<Json>(`save:${f.name}`))!;
    await kv.set(`save:${f.name}`, { ...save, _saveAt: at, _regenAt: at, character: { ...save.character, hp: 10, chakra: 20, stamina: 0 } });
    const settled = await call(f.name, { action: 'forfeit', sessionId: opened.body.state.sessionId });
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    for (const character of [settled.body.character, (await kv.get<Json>(`save:${f.name}`))!.character]) {
        assert.ok(character.hp >= 40); assert.ok(character.chakra >= 50); assert.ok(character.stamina >= 30);
    }
    assert.equal(settled.body._saveVersion, 3);
});

test('Dungeon admission spends the kickoff item once and preserves a same-ID replacement equipped later', async () => {
    for (const replace of [false, true]) {
        const f = await fixture(replace ? 'newitem' : 'item');
        f.character.pets[0].loadout = { consumable: 'consum-smoke-pellet' };
        await kv.set(`save:${f.name}`, { _saveVersion: 1, character: f.character });
        const opened = await f.start(); assert.equal(opened.status, 200);
        const save = (await kv.get<Json>(`save:${f.name}`))!;
        assert.equal(save.character.pets[0].loadout.consumable, undefined, 'the sealed charge is paid at entry');
        if (replace) {
            save.character.pets[0].loadout.consumable = 'consum-smoke-pellet';
            await kv.set(`save:${f.name}`, save);
        }
        const settled = await call(f.name, { action: 'forfeit', sessionId: opened.body.state.sessionId });
        assert.equal(settled.status, 200);
        assert.equal(settled.body.character.pets[0].loadout.consumable, replace ? 'consum-smoke-pellet' : undefined);
        const retry = await call(f.name, { action: 'forfeit', sessionId: opened.body.state.sessionId });
        assert.equal(retry.body._saveVersion, settled.body._saveVersion);
        assert.equal(retry.body.character.pets[0].loadout.consumable, replace ? 'consum-smoke-pellet' : undefined);
    }
});

test('a retained Dungeon session preserves its legacy terminal charge owner exactly once', async () => {
    const f = await fixture('legacycharge');
    f.character.pets[0].loadout = { consumable: 'consum-smoke-pellet' };
    await kv.set(`save:${f.name}`, { _saveVersion: 1, character: f.character });
    const opened = await f.start(); assert.equal(opened.status, 200);
    const sessionKey = `pet:showdown:${f.name}:${opened.body.state.sessionId}`;
    const session = (await kv.get<Json>(sessionKey))!;
    delete session.consumablesCommitted;
    await kv.set(sessionKey, session);
    const saved = (await kv.get<Json>(`save:${f.name}`))!;
    saved.character.pets[0].loadout.consumable = 'consum-smoke-pellet';
    await kv.set(`save:${f.name}`, saved);
    const terminal = await call(f.name, { action: 'forfeit', sessionId: session.sessionId });
    assert.equal(terminal.status, 200, JSON.stringify(terminal.body));
    assert.equal(terminal.body.character.pets[0].loadout.consumable, undefined);
    const replacement = (await kv.get<Json>(`save:${f.name}`))!;
    replacement.character.pets[0].loadout.consumable = 'consum-smoke-pellet';
    await kv.set(`save:${f.name}`, replacement);
    const retry = await call(f.name, { action: 'forfeit', sessionId: session.sessionId });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.character.pets[0].loadout.consumable, 'consum-smoke-pellet');
});
