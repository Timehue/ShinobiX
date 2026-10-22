import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'broker-certificate-journeys-only';
delete process.env.ADMIN_PASSWORD;

type Obj = Record<string, any>;
type Handler = typeof import('./black-market.js').default;
let kv: typeof import('../_storage.js').kv;
let issue: typeof import('../_auth.js').issuePlayerToken;
let rally: Handler, caravan: Handler, broker: Handler;
let now = Date.UTC(2026, 9, 18, 12);
const realNow = Date.now, player = 'certificate-journey';
let petId = '';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken: issue } = await import('../_auth.js'));
    rally = (await import('./rally.js')).default as unknown as Handler;
    caravan = (await import('./caravan.js')).default as unknown as Handler;
    broker = (await import('./black-market.js')).default as unknown as Handler;
    Date.now = () => now;
});
beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    now += 86_400_000;
    const { createOwnedPet } = await import('../pet/_owned-pet.js');
    const pet = createOwnedPet('starter-fire', { origin: 'starter' }); petId = String(pet.id);
    await kv.set(`save:${player}`, { _saveVersion: 1, _saveAt: now, _regenAt: now, creatorItems: [], creatorJutsus: [], character: {
        name: player, level: 30, ryo: 0, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        stats: {}, inventory: [], itemStacks: [], equipment: {}, pets: [pet], jutsus: [], village: 'Ashen Leaf Village', element: 'Fire',
    } });
});
after(() => { Date.now = realNow; });

async function call(handler: Handler, body: Obj) {
    const output: { status: number; body: Obj } = { status: 200, body: {} };
    await handler({ method: 'POST', query: {}, body: { playerName: player, ...body }, headers: { 'x-player-name': player, 'x-player-token': issue(player)! }, socket: { remoteAddress: '127.0.2.1' } } as never,
        { setHeader() { return this; }, status(code: number) { output.status = code; return this; }, json(data: Obj) { output.body = data; return this; }, end() { return this; } } as never);
    return output;
}
const stored = async () => (await kv.get<Obj>(`save:${player}`))!;
const ok = (response: Awaited<ReturnType<typeof call>>) => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };

for (const [place, expected] of [[1, 2], [2, 1]]) test(`Rally place ${place}: actual checkpoint response grants ${expected} certificates and Broker redeems them`, async () => {
    const prepared = ok(await call(rally, { action: 'prepare', petId }));
    const runId = prepared.progress.current.id;
    ok(await call(rally, { action: 'begin', runId }));
    // Seed the saved final-race finish. The endpoint still replays its own
    // checkpoint and calculates final standings; no client placement is trusted.
    const save = await stored(), run = save.character.sunscarRally.current;
    const order = run.race.racers.filter((r: Obj) => r.id !== 'player');
    order.splice(place - 1, 0, run.race.racers[0]);
    order.forEach((r: Obj, index: number) => { r.finishTick = index + 1; });
    const { rallyResult } = await import('../../shared/sunscar/rally-simulation.js');
    const result = rallyResult({ ...run.race, finished: true });
    run.results = [structuredClone(result), structuredClone(result)]; run.raceIndex = 2;
    await kv.set(`save:${player}`, save);
    now += 5000;
    const action = { action: 'checkpoint', runId, raceIndex: 2, fromTick: 0, toTick: 300, actions: [] };
    const original = kv.compareSetMany;
    kv.compareSetMany = async () => false;
    try { assert.equal((await call(rally, action)).status, 503); } finally { kv.compareSetMany = original; }
    assert.equal((await stored()).character.brokerCertificates ?? 0, 0, 'a failed award save grants nothing');
    const awarded = ok(await call(rally, action));
    assert.equal(awarded.progress.current.reward.brokerCertificates, expected);
    assert.equal(awarded.character.brokerCertificates, expected);
    assert.equal(ok(await call(rally, action)).character.brokerCertificates, expected, 'retry awards nothing again');
    for (let index = 0; index < expected; index++) {
        const before = await stored();
        const pulled = ok(await call(broker, { payment: 'certificate', requestId: `${new Date(now).toISOString().slice(0, 10)}_${randomUUID()}` }));
        assert.equal(pulled.cost, 0);
        assert.equal(pulled.character.ryo, before.character.ryo + pulled.reward.ryo);
        assert.equal(pulled.character.brokerCertificates, expected - index - 1);
        assert.equal(pulled.dailyUsed, index + 1);
    }
});

for (const success of [true, false]) test(`Caravan actual ${success ? 'delivery' : 'retirement'} response: certificate reward is saved and redeemable only on success`, async () => {
    const departed = ok(await call(caravan, { action: 'depart', contractId: 'market-goods', tools: ['water', 'repair', 'medicine'] }));
    const save = await stored(), run = save.character.sunscarCaravan.current;
    let action: Obj = { action: 'retire' };
    if (success) {
        const destination = run.map.find((node: Obj) => node.kind === 'destination');
        const preceding = run.map.find((node: Obj) => node.next.includes(destination.id));
        run.currentNodeId = preceding.id; run.available = [destination.id]; run.visited = [preceding.id];
        action = { action: 'travel', nodeId: destination.id };
    }
    await kv.set(`save:${player}`, save);
    action = { ...action, runId: departed.progress.current.id, version: run.version, requestId: randomUUID() };
    if (success) {
        const original = kv.compareSetMany;
        kv.compareSetMany = async () => false;
        try { assert.equal((await call(caravan, action)).status, 503); } finally { kv.compareSetMany = original; }
        assert.equal((await stored()).character.brokerCertificates ?? 0, 0);
    }
    const ended = ok(await call(caravan, action));
    assert.equal(ended.progress.current.status, success ? 'complete' : 'failed');
    assert.equal(ended.progress.current.result.brokerCertificates, success ? 1 : 0);
    assert.equal(ended.character.brokerCertificates ?? 0, success ? 1 : 0);
    assert.equal(ok(await call(caravan, action)).character.brokerCertificates ?? 0, success ? 1 : 0);
    const pull = await call(broker, { payment: 'certificate', requestId: `${new Date(now).toISOString().slice(0, 10)}_${randomUUID()}` });
    assert.equal(pull.status, success ? 200 : 400, JSON.stringify(pull.body));
    if (success) {
        assert.equal(pull.body.cost, 0);
        assert.equal(pull.body.character.brokerCertificates, 0);
        assert.equal(pull.body.dailyUsed, 1);
    }
});
