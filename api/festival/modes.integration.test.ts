import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'sunscar-modes-integration-only';
delete process.env.ADMIN_PASSWORD;
type Obj = Record<string, any>;
type Handler = typeof import('./caravan.js').default;
let kv: typeof import('../_storage.js').kv;
let rally: Handler, caravan: Handler, save: Handler, action: Handler, wildStart: Handler, wildBinding: Handler, befriend: Handler;
let issue: typeof import('../_auth.js').issuePlayerToken;
const realNow = Date.now;
let now = realNow();
const player = 'sunscar-test';
let petId = '';
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken: issue } = await import('../_auth.js'));
    rally = (await import('./rally.js')).default as unknown as Handler;
    caravan = (await import('./caravan.js')).default as unknown as Handler;
    save = (await import('../save/[name].js')).default as unknown as Handler;
    action = (await import('../solo-pve/action.js')).default as unknown as Handler;
    wildStart = (await import('../pet/encounter-start.js')).default as unknown as Handler;
    wildBinding = (await import('../pet/wild-binding.js')).default as unknown as Handler;
    befriend = (await import('../pet/befriend.js')).default as unknown as Handler;
    Date.now = () => now;
});
beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    now += 86_400_000;
    const { createOwnedPet } = await import('../pet/_owned-pet.js');
    const pet = createOwnedPet('starter-fire', { origin: 'starter' }); petId = String(pet.id);
    await kv.set(`save:${player}`, { _saveVersion: 1, _saveAt: now, _regenAt: now, creatorItems: [], creatorJutsus: [], character: {
        name: player, level: 30, ryo: 10_000, hp: 350, maxHp: 1000, chakra: 35, maxChakra: 100, stamina: 45, maxStamina: 100,
        stats: { strength: 70, intelligence: 70, agility: 70, defense: 70 }, inventory: [], itemStacks: [], equipment: {},
        pets: [pet], activePetId: petId, jutsus: [], tileCards: [], village: 'Ashen Leaf Village', element: 'Fire',
    } });
});
after(() => { Date.now = realNow; });
async function call(handler: Handler, body: Obj = {}, options: { as?: string; method?: string; query?: Obj; unauth?: boolean } = {}) {
    const output: { status: number; body: Obj } = { status: 200, body: {} };
    const res = { setHeader() { return this; }, status(code: number) { output.status = code; return this; }, json(data: Obj) { output.body = data; return this; }, end() { return this; } };
    await handler({ method: options.method ?? 'POST', query: options.query ?? {}, body: { playerName: player, ...body }, headers: options.unauth ? {} : { 'x-player-name': options.as ?? player, 'x-player-token': issue(options.as ?? player)! }, socket: { remoteAddress: '127.0.0.91' } } as never, res as never);
    return output;
}
const stored = async () => (await kv.get<Obj>(`save:${player}`))!;
const ok = (result: Awaited<ReturnType<typeof call>>) => { assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; };
async function depart(withPet = true) { return ok(await call(caravan, { action: 'depart', contractId: 'market-goods', tools: ['water', 'repair', 'medicine'], petId: withPet ? petId : '' })); }
async function prepareFight(withPet = true) {
    await depart(withPet);
    // Place the fixture at a real authored combat node; battle generation and
    // every action/settlement below use the production handlers and engine.
    const record = await stored(), run = record.character.sunscarCaravan.current;
    const node = run.map.find((n: Obj) => n.kind === 'combat');
    node.eventId = 'raider-toll';
    run.currentNodeId = node.id; run.visited = [node.id]; run.status = 'encounter'; run.available = [];
    await kv.set(`save:${player}`, record);
    const { caravanEvent } = await import('../../shared/sunscar/caravan-events.js');
    const choice = caravanEvent('raider-toll').choices.find(c => c.effect.combat)!;
    const pending = ok(await call(caravan, { action: 'choose', runId: run.id, version: run.version, requestId: randomUUID(), choiceId: choice.id }));
    assert.equal(pending.progress.current.status, 'combat');
    return ok(await call(caravan, { action: 'combat', runId: run.id }));
}
test('both festival endpoints require a signed session and reject impersonation', async () => {
    for (const handler of [rally, caravan]) {
        assert.equal((await call(handler, {}, { unauth: true })).status, 401);
        assert.equal((await call(handler, {}, { as: 'another-handler' })).status, 403);
        ok(await call(handler, {}, { method: 'GET', query: { playerName: player } }));
    }
});
test('race practice and loading never spend an entry; beginning and checkpoint retries are durable', async () => {
    const initial = await stored();
    const practice = ok(await call(rally, { action: 'practice', petId, trackId: 'grand-circuit' }));
    assert.ok(practice.practice.racers.length === 4);
    assert.deepEqual(await stored(), initial);
    const prepared = ok(await call(rally, { action: 'prepare', petId }));
    assert.equal(prepared.progress.lastEntryDay, null);
    const replay = ok(await call(rally, { action: 'prepare', petId }));
    assert.equal(replay.progress.current.id, prepared.progress.current.id);
    const runId = prepared.progress.current.id;
    ok(await call(rally, { action: 'begin', runId }));
    now += 5000;
    const chunk = { action: 'checkpoint', runId, raceIndex: 0, fromTick: 0, toTick: 300, actions: [{ tick: 20, kind: 'jump' }] };
    const checkpoint = ok(await call(rally, chunk));
    const version = checkpoint._saveVersion;
    assert.equal(ok(await call(rally, chunk))._saveVersion, version);
    assert.equal(ok(await call(rally, {}, { method: 'GET', query: { playerName: player } })).progress.current.race.tick, 300);
    assert.equal((await call(rally, { ...chunk, fromTick: 300, toTick: 5000, winner: 'player' })).status, 409);
    assert.equal((await stored()).character.ryo, initial.character.ryo);
});
test('lost save acknowledgement recovers the same Caravan departure and choices cannot be replayed for gains', async () => {
    const original = kv.compareSet;
    let lost = false;
    kv.compareSet = (async (...args: Parameters<typeof original>) => { const result = await original.apply(kv, args); if (!lost && args[0] === `save:${player}` && result) { lost = true; throw new Error('lost acknowledgement'); } return result; }) as typeof original;
    let departure: Obj;
    try { departure = await depart(); } finally { kv.compareSet = original; }
    const again = await depart();
    assert.equal(again.progress.current.id, departure!.progress.current.id);
    const run = again.progress.current;
    const travel = { action: 'travel', runId: run.id, version: run.version, requestId: randomUUID(), nodeId: run.available[0] };
    const arrived = ok(await call(caravan, travel));
    const replay = ok(await call(caravan, travel));
    assert.equal(replay._saveVersion, arrived._saveVersion);
    assert.deepEqual(replay.progress, arrived.progress);
    assert.equal((await call(caravan, { ...travel, nodeId: '7-0' })).status, 409);
    assert.equal((await call(caravan, { ...travel, requestId: randomUUID() })).status, 409);
});
test('generic saves cannot forge, erase or rewind either festival progression', async () => {
    await depart();
    ok(await call(rally, { action: 'prepare', petId }));
    const record = await stored();
    const forged = { ...record.character, sunscarRally: { reputation: 99999, lastEntryDay: null, current: null }, sunscarCaravan: { reputation: 99999, current: null, lastEntryDay: null } };
    now += 4000;
    ok(await call(save, { ...record, character: forged, _baseSaveVersion: record._saveVersion }, { query: { name: player } }));
    const next = await stored();
    assert.deepEqual(next.character.sunscarRally, record.character.sunscarRally);
    assert.deepEqual(next.character.sunscarCaravan, record.character.sunscarCaravan);
});
test('Caravan opens the main PvE engine with current vitals and companion, resumes the same fight, and applies real defeat once', async () => {
    const opened = await prepareFight(), session = opened.session;
    assert.equal(session.encounter.kind, 'caravan');
    assert.equal(session.encounter.metadata.continuousVitals, true);
    assert.equal(session.player.hp, 350);
    assert.equal(session.player.chakra, 35);
    assert.equal(session.player.stamina, 45);
    assert.equal(session.player.character.activePetId, petId);
    const runId = opened.progress.current.id;
    assert.equal(ok(await call(caravan, { action: 'combat', runId })).session.sessionId, session.sessionId);
    assert.equal((await call(caravan, { action: 'combat-result', runId })).status, 409);
    assert.equal((await call(caravan, { action: 'retire', runId, version: opened.progress.current.version, requestId: randomUUID() })).status, 409);
    const finished = ok(await call(action, { sessionId: session.sessionId, type: 'abandon', expectedVersion: session.version, moveToken: randomUUID() }));
    assert.equal(finished.session.status, 'done');
    const restored = ok(await call(caravan, {}, { method: 'GET', query: { playerName: player } }));
    assert.equal(restored.progress.current.status, 'failed');
    assert.equal(restored.progress.current.result.ryo, 0);
    assert.equal(restored.character.battleHistory.length, 1);
    assert.equal(restored.character.battleHistory[0].id, `arena-${session.sessionId}`);
    assert.equal(restored.character.battleHistory[0].mode, 'Caravan escort');
    assert.equal(restored.character.battleHistory[0].outcome, 'loss');
    assert.ok(restored.character.hp < 350 || restored.character.hospitalized, 'The normal abandon rule charges a real physical cost.');
    const replay = ok(await call(caravan, { action: 'combat-result', runId }));
    assert.deepEqual(replay.progress, restored.progress);
    assert.equal(replay.character.hp, restored.character.hp);
    assert.equal(replay.character.ryo, restored.character.ryo);
    assert.deepEqual(replay.character.battleHistory, restored.character.battleHistory);
});
test('a forged Caravan discovery cannot bypass the world exploration pet proof', async () => {
    await depart();
    const record = await stored();
    const run = record.character.sunscarCaravan.current;
    const denied = await call(wildStart, { sector: 54, requestId: 'caravan_forged_request', caravanRunId: run.id });
    assert.equal(denied.status, 409);
    assert.equal((await stored()).character.pets.length, 1);
});

test('traveling without a companion never seals the globally active pet into combat', async () => {
    const opened = await prepareFight(false);
    assert.equal(opened.session.player.character.activePetId, null);
    assert.equal(opened.session.pendingCompanion, undefined);
    assert.equal(opened.session.companion, undefined);
});

test('a real combat victory resumes the route and charges a summoned companion only once', async () => {
    const record = await stored();
    record.character.pets[0].level = 50;
    record.character.pets[0].loadout = { pve: 'pet-fang-wrap', pveDurability: 5, consumable: 'pet-bond-treat' };
    record.character.inventory = ['potion-rejuvenation'];
    record.character.equipment = { potion: 'potion-rejuvenation' };
    await kv.set(`save:${player}`, record);
    const opened = await prepareFight();
    const { readSoloPveSession, writeSoloPveSession } = await import('../solo-pve/_store.js');
    let session = (await readSoloPveSession(opened.session.sessionId))!;
    // Initial battle fixture: adjacent, wounded opponent. Actions, victory,
    // evidence, companion costs and both settlements remain production code.
    session.player.pos = 62; session.enemy.pos = 63; session.enemy.hp = 1;
    session.enemy.shield = 0;
    await writeSoloPveSession(session);
    const initialPet = structuredClone((await stored()).character.pets[0]);
    session = ok(await call(action, { sessionId: session.sessionId, type: 'summon', expectedVersion: session.version, moveToken: randomUUID() })).session;
    assert.equal(session.companion?.petId, petId);
    session = ok(await call(action, { sessionId: session.sessionId, type: 'item', itemId: 'potion-rejuvenation', expectedVersion: session.version, moveToken: randomUUID() })).session;
    assert.equal(session.itemsUsed['potion-rejuvenation'], 1);
    session = ok(await call(action, { sessionId: session.sessionId, type: 'basicAttack', expectedVersion: session.version, moveToken: randomUUID() })).session;
    assert.equal(session.outcome, 'win');
    const finished = ok(await call(caravan, { action: 'combat-result', runId: opened.progress.current.id }));
    assert.equal(finished.progress.current.status, 'travel');
    assert.equal(finished.progress.current.enemiesDefeated, 1);
    assert.equal(finished.character.battleHistory.length, 1);
    assert.equal(finished.character.battleHistory[0].outcome, 'win');
    assert.ok(finished.character.battleHistory[0].actions.length > 0);
    assert.ok(finished.progress.current.available.length > 0);
    assert.equal(finished.character.hp, session.player.hp);
    assert.equal(finished.character.chakra, session.player.chakra);
    assert.equal(finished.character.stamina, session.player.stamina);
    assert.notDeepEqual(finished.character.pets[0], initialPet, 'Normal summon costs reach the actual owned pet.');
    assert.equal(finished.character.pets[0].loadout.pveDurability, 4);
    assert.equal(finished.character.pets[0].loadout.consumable, undefined);
    assert.ok(!finished.character.inventory.includes('potion-rejuvenation'));
    const replay = ok(await call(caravan, { action: 'combat-result', runId: opened.progress.current.id }));
    assert.deepEqual(replay.character.pets, finished.character.pets);
    assert.deepEqual(replay.character.inventory, finished.character.inventory);
    assert.deepEqual(replay.character.battleHistory, finished.character.battleHistory);
    assert.deepEqual(replay.progress, finished.progress);
});

async function prepareTrail() {
    await depart();
    const record = await stored(), run = record.character.sunscarCaravan.current;
    const node = run.map[0];
    node.eventId = 'pet-trail'; node.kind = 'rare';
    run.currentNodeId = node.id; run.visited = [node.id]; run.status = 'travel'; run.available = [...node.next];
    run.discoveries = ['The luminous pet trail'];
    run.petEncounter = { requestId: 'caravan_test_trail', state: 'pending' };
    await kv.set(`save:${player}`, record);
    return run;
}

test('a legitimate Caravan trail uses normal wild chance, seals retries, and closes either hit or miss', async () => {
    const run = await prepareTrail();
    const payload = { sector: 54, requestId: run.petEncounter.requestId, caravanRunId: run.id };
    const found = ok(await call(wildStart, payload));
    assert.equal(found.requestId, payload.requestId);
    assert.deepEqual(ok(await call(wildStart, payload)), { ...found, replayed: true });
    if (found.pet) {
        assert.equal((await call(befriend, { token: found.token })).status, 409);
        const save = await stored();
        save.character.itemStacks.push({ itemId: 'beast-seal-reinforced', count: 1 });
        await kv.set(`save:${player}`, save);
        ok(await call(wildBinding, { token: found.token, action: 'start', petId }));
        assert.equal(ok(await call(wildBinding, { token: found.token, action: 'capture',
            sealId: 'beast-seal-reinforced', attemptId: 'caravantrailattempt001' })).capture.success, true);
    }
    const ended = ok(await call(caravan, { action: 'pet-return', runId: run.id }));
    assert.equal(ended.progress.current.petEncounter.state, 'resolved');
    assert.equal(await kv.get(`pet-encounter-active:${player}`), null);
    const count = ended.character.pets.length;
    if (found.pet) {
        const replay = ok(await call(wildBinding, { token: found.token, action: 'capture',
            sealId: 'beast-seal-reinforced', attemptId: 'caravantrailattempt001' }));
        assert.equal(replay.capture.replayed, true);
        assert.equal((await stored()).character.pets.length, count);
    }
    assert.equal((await call(wildStart, { ...payload, requestId: 'different_caravan_trail' })).status, 409);
});

test('wild daily cap cannot strand an expedition, and skipping cannot mint a later pet', async () => {
    const run = await prepareTrail();
    await kv.set(`pet-encounter-attempt:${player}:${new Date().toISOString().slice(0, 10)}`, 150);
    const payload = { sector: 54, requestId: run.petEncounter.requestId, caravanRunId: run.id };
    assert.equal((await call(wildStart, payload)).status, 429);
    const ended = ok(await call(caravan, { action: 'pet-skip', runId: run.id }));
    assert.equal(ended.progress.current.petEncounter.state, 'resolved');
    assert.equal((await call(wildStart, payload)).status, 409);
    assert.equal(ended.character.pets.length, 1);
    const again = ok(await call(caravan, { action: 'pet-skip', runId: run.id }));
    assert.equal(again._saveVersion, ended._saveVersion);
});

test('pointer-only wild-hit recovery retains Caravan authority and normal befriend placement', async () => {
    const run = await prepareTrail();
    const { PET_CATALOG } = await import('../pet/_catalog.js');
    const token = 'caravanrecoverytoken1234567890';
    await kv.set(`pet-encounter-active:${player}`, { playerName: player, requestId: run.petEncounter.requestId, outcome: 'hit', token,
        pet: { ...structuredClone(PET_CATALOG['standard-0']), id: 'standard-0-caravan-recovered' }, sector: 54, mintedAt: now, caravanRunId: run.id });
    const recovered = ok(await call(wildStart, { sector: 54, requestId: run.petEncounter.requestId, caravanRunId: run.id }));
    assert.equal(recovered.token, token);
    const befriended = ok(await call(befriend, { token }));
    assert.equal(befriended.character.pets.length, 2);
    assert.equal(befriended.character.pets[1].origin, 'wild');
    const ended = ok(await call(caravan, { action: 'pet-return', runId: run.id }));
    assert.equal(ended.progress.current.petEncounter.state, 'resolved');
    ok(await call(befriend, { token }));
    assert.equal((await stored()).character.pets.length, 2);
});

test('a Caravan wild battle binds once and pet-return recovers after a lost response', async () => {
    const run = await prepareTrail();
    const { PET_CATALOG } = await import('../pet/_catalog.js');
    const token = 'caravanbindingtoken1234567890';
    const pet = { ...structuredClone(PET_CATALOG['standard-1']), templateId: 'standard-1', id: 'caravan-bound-rabbit' };
    const record = await stored();
    record.character.itemStacks.push({ itemId: 'beast-seal-reinforced', count: 1 });
    await kv.set(`save:${player}`, record);
    await kv.set(`pet-encounter-active:${player}`, { playerName: player, requestId: run.petEncounter.requestId,
        outcome: 'hit', token, pet, battleRequired: true, sector: 54, mintedAt: now, caravanRunId: run.id });
    await kv.set(`pet-encounter:${player}:${token}`, { playerName: player, token, requestId: run.petEncounter.requestId,
        pet, battleRequired: true, sector: 54, mintedAt: now, caravanRunId: run.id });
    await kv.set(`pet-encounter-request:${player}:${run.petEncounter.requestId}`, { version: 1, playerName: player,
        requestId: run.petEncounter.requestId, sector: 54, token, pet, battleRequired: true, caravanRunId: run.id,
        mintedAt: now });

    const opened = ok(await call(wildBinding, { token, action: 'start', petId }));
    assert.equal(opened.wild.tutorial, true);
    const captured = ok(await call(wildBinding, { token, action: 'capture',
        sealId: 'beast-seal-reinforced', attemptId: 'caravanboundattempt001' }));
    assert.equal(captured.capture.success, true);
    assert.equal(captured.character.pets.length, 2);
    const returned = ok(await call(caravan, { action: 'pet-return', runId: run.id }));
    assert.equal(returned.progress.current.petEncounter.state, 'resolved');
    const replay = ok(await call(caravan, { action: 'pet-return', runId: run.id }));
    assert.equal(replay._saveVersion, returned._saveVersion);
    assert.equal(replay.character.pets.length, 2);
});
