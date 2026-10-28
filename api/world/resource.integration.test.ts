import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, beforeEach, test } from 'node:test';
import { resourceNode, RETIRED_RESOURCE_NODE_IDS } from '../../shared/resource-nodes.js';
import { readResourceGathering, resourceActionsToday } from '../../shared/resource-gathering.js';
import { kunaiFish, kunaiFlightMs, kunaiSeed } from '../../shared/kunai-fishing.js';
import { countOwned } from '../craft/_forge.js';
import { sectorPoolKey, cleanSectorPoolRow } from './_sector-pool.js';
process.env.NODE_ENV = 'test'; process.env.SHINOBIX_QA_MEMORY_KV = '1'; process.env.SESSION_SECRET = 'resource-integration-secret';
type Json = Record<string, unknown>;

test('retrying a replaced uncommitted claim refunds only its own node and pool reservations', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const name = 'uncommittedowner', rival = 'replacementowner';
    await seed(name); await seed(rival);
    const poolKey = sectorPoolKey(29, Date.now()), beforePool = cleanSectorPoolRow(await kv.get(poolKey)).explores;
    const body = { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: 'replaced-uncommitted-start' };
    const original = kv.compareSet;
    kv.compareSet = async (key, expected, value, options) => {
        if (key === `save:${name}`) throw new Error('fixture-save-write-unavailable');
        return original.call(kv, key, expected, value, options);
    };
    try { assert.equal((await post(name, body)).status, 503); } finally { kv.compareSet = original; }
    online.startTravel(name, 2, Date.now(), 29, 99);
    assert.equal((await post(rival, { ...body, requestId: 'replacement-admitted-start' })).status, 200);
    online.startTravel(name, 29, Date.now(), 2, resourceNode('resource-17')!.approach);
    assert.equal((await post(name, body)).status, 409);
    const view = ((await post(rival, { action: 'nodes' })).body.nodes as Record<string, Json>)['resource-17'];
    assert.equal(view.remaining, 2, 'only the admitted replacement spends a shared charge');
    assert.equal(view.gatherer, rival, 'refund must preserve the replacement claim');
    assert.equal(cleanSectorPoolRow(await kv.get(poolKey)).explores, beforePool + 1);
    assert.equal(resourceActionsToday((await kv.get<Json>(`save:${name}`))!.character as Json), 0);
    assert.equal((await post(name, body)).status, 409, 'refund is terminal and idempotent');
    assert.equal(cleanSectorPoolRow(await kv.get(poolKey)).explores, beforePool + 1);
});
test('a late admission refund preserves a shared refill that has already elapsed', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const { withKvLock } = await import('../_lock.js');
    const { sharedResourceNodeKey, sharedResourceViews, finishSharedResourceAdmission } = await import('./_shared-resource-nodes.js');
    const key = sharedResourceNodeKey('resource-17'), txId = 'late-uncommitted-admission';
    await kv.set(key, { generation: 0, attempts: 3, refillAt: Date.now() + 600_000,
        reservations: { [txId]: { generation: 0, committed: false } } });
    assert.equal((await sharedResourceViews(29, Date.now()))['resource-17'].remaining, 0);
    t.mock.timers.tick(600_001);
    assert.equal((await sharedResourceViews(29, Date.now()))['resource-17'].remaining, 3);
    await withKvLock(key, () => finishSharedResourceAdmission('resource-17', txId, false), { failClosed: true });
    assert.equal((await sharedResourceViews(29, Date.now()))['resource-17'].remaining, 3);
    assert.equal((await kv.get<Json>(key))!.generation, 1);
});

test('contesting a gatherer creates and joins a real PvP session with gathering locked for both fighters', async () => {
    await seed('realnodeattacker'); await seed('realnodedefender');
    const attemptId = 'real-node-defender-attempt';
    assert.equal((await post('realnodedefender', { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: attemptId })).status, 200);
    const attack = (await import('../player/attack.js')).default as unknown as Handler;
    const sessions = (await import('../pvp/session.js')).default as unknown as Handler;
    const move = (await import('../pvp/move.js')).default as unknown as Handler;
    const attacked = await post('realnodeattacker', { targetName: 'realnodedefender' }, true, attack);
    assert.equal(attacked.status, 200, JSON.stringify(attacked.body));
    const created = await post('realnodeattacker', { p1Character: { name: 'realnodeattacker' },
        p2Character: { name: 'realnodedefender' }, useCurrentVitals: true, requireWorldCoLocation: true,
        baseRewards: true, rewardSector: 29 }, true, sessions);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const battleId = String(created.body.battleId);
    for (const [name, role] of [['realnodeattacker', 'p1'], ['realnodedefender', 'p2']]) {
        const joined = await post(name, { battleId, role, action: 'join' }, true, move);
        assert.equal(joined.status, 200, JSON.stringify(joined.body));
        assert.equal((await post(name, { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: `blocked-${name}-attempt` })).status, 409);
    }
    // A process restart or missed presence hook cannot erase the persisted
    // combat pointer. No client heartbeat is sent between restore and resolve.
    online.remove('realnodedefender');
    online.upsert({ name: 'realnodedefender', sector: 29, tile: resourceNode('resource-17')!.approach, character: { level: 100 } });
    assert.equal(online.get('realnodedefender')?.inBattle, undefined);
    const interrupted = await post('realnodedefender', { action: 'resolve', requestId: attemptId });
    assert.equal(interrupted.status, 200);
    assert.equal((interrupted.body.receipt as Json).outcome, 'cancelled');
    assert.equal(online.get('realnodedefender')?.inBattle, true);
    const cancelled = await post('realnodedefender', { action: 'cancel', requestId: attemptId });
    assert.equal(cancelled.status, 200); assert.equal((cancelled.body.receipt as Json).outcome, 'cancelled');
    const availability = (await post('realnodeattacker', { action: 'nodes' })).body.nodes as Record<string, Json>;
    assert.equal(availability['resource-17'].gatherer, undefined);
    assert.equal(availability['resource-17'].remaining, 2);
    assert.equal(countOwned((await kv.get<Json>('save:realnodedefender'))!.character as Json, 'gather-iron-sand'), 0);
});

test('crystal settlement recovers event credit after a lost write without exposing a second harvest', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const { WORLD_BOSS_CRYSTAL_NODES, validResourceNodeTerrain } = await import('../../shared/resource-nodes.js');
    const { WORLD_BOSS_ACTIVE_KEY, worldBossEventKey } = await import('../world-boss-event/_event.js');
    const node = WORLD_BOSS_CRYSTAL_NODES.find(validResourceNodeTerrain)!;
    const eventId = 'shared-crystal-recovery', eventKey = worldBossEventKey(eventId), now = Date.now();
    await kv.set(WORLD_BOSS_ACTIVE_KEY, eventId);
    await kv.set(eventKey, { version: 1, eventId, bossId: 'hollow-beast', bossName: 'Chicxulub', status: 'roaming',
        startedAt: now - 1000, roamEndsAt: now + 600_000, endsAt: now + 900_000, endedAt: null,
        hpMax: 100000, hp: 100000, participants: {}, settledMatchIds: [], updatedAt: now });
    for (const name of ['crystalowner', 'crystalrival']) {
        await seed(name, { resourceGathering: { ...readResourceGathering(null), miningXp: 3200 } });
        online.startTravel(name, node.sector, now, 29, node.approach);
    }
    const id = 'shared-crystal-recovery-001';
    const started = await post('crystalowner', { action: 'start', nodeId: node.id, mode: 'relaxed', requestId: id });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const txKey = `economy-tx:resource-gathering:${createHash('sha256').update(`crystalowner:${id}`).digest('hex')}`;
    const journal = (await kv.get<{ meta: Json }>(txKey))!;
    await kv.set(txKey, { ...journal, meta: { ...journal.meta, seal: { ...(journal.meta.seal as Json), successDraw: 0 } } });
    t.mock.timers.tick(4000);
    const originalSet = kv.set;
    kv.set = async (key, value, options) => {
        if (key === eventKey) throw new Error('fixture-event-write-unavailable');
        return originalSet.call(kv, key, value, options);
    };
    try { assert.equal((await post('crystalowner', { action: 'resolve', requestId: id })).status, 503); }
    finally { kv.set = originalSet; }
    const blocked = await post('crystalrival', { action: 'start', nodeId: node.id, mode: 'relaxed', requestId: 'shared-crystal-rival-001' });
    assert.equal(blocked.status, 409);
    const recovered = await post('crystalowner', { action: 'status', requestId: id });
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.equal((recovered.body.worldBossHollowShard as Json).heldHollowShards, 1);
    const replay = await post('crystalowner', { action: 'resolve', requestId: id });
    assert.equal(replay.status, 200); assert.equal((replay.body.worldBossHollowShard as Json).heldHollowShards, 1);
    assert.equal((await post('crystalrival', { action: 'start', nodeId: node.id, mode: 'relaxed', requestId: 'shared-crystal-rival-002' })).status, 409);
    await kv.del(WORLD_BOSS_ACTIVE_KEY);
});

test('two players racing for one node admit exactly one and expose its gatherer', async () => {
    await seed('nodealice'); await seed('nodebob');
    const results = await Promise.all(['nodealice', 'nodebob'].map(name => post(name, {
        action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: `shared-race-${name}-001`,
    })));
    assert.equal(results.filter(result => result.status === 200).length, 1);
    assert.equal(results.filter(result => result.status === 409).length, 1);
    const winner = results[0].status === 200 ? 'nodealice' : 'nodebob';
    const loser = winner === 'nodealice' ? 'nodebob' : 'nodealice';
    const status = await post(loser, { action: 'nodes', sector: 2 });
    assert.equal(status.body.sector, 29, 'client cannot inspect a forged sector');
    const view = (status.body.nodes as Record<string, Json>)['resource-17'];
    assert.equal(view.remaining, 2); assert.equal(view.gatherer, winner);
    assert.equal(JSON.stringify(status.body).includes('successDraw'), false);
    const saved = (await kv.get<Json>(`save:${loser}`))!.character as Json;
    assert.equal(resourceActionsToday(saved), 0);
});

test('depletion and refill belong to the world, including failures and cancellations', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    for (let i = 0; i < 3; i++) {
        const name = `sharedempty${i}`, id = `shared-empty-attempt-00${i}`;
        await seed(name);
        assert.equal((await post(name, { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: id })).status, 200);
        assert.equal((await post(name, { action: 'cancel', requestId: id })).status, 200);
    }
    await seed('sharedfourth');
    const start = { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: 'shared-fourth-attempt-001' };
    const denied = await post('sharedfourth', start);
    assert.equal(denied.status, 409); assert.match(String(denied.body.error), /shared node is empty/);
    t.mock.timers.tick(600_001);
    online.upsert({ name: 'sharedfourth', sector: 29, tile: resourceNode('resource-17')!.approach, character: { level: 100 } });
    assert.equal((await post('sharedfourth', { ...start, requestId: 'shared-fourth-after-refill' })).status, 200);
    assert.equal(((await post('sharedfourth', { action: 'nodes' })).body.nodes as Record<string, Json>)['resource-17'].remaining, 2);
});

test('a real world attack can target a gatherer; entering combat releases the node without paying the interrupted attempt', async () => {
    const attack = (await import('../player/attack.js')).default as unknown as Handler;
    await seed('nodefighter'); await seed('nodedefender');
    const id = 'shared-defender-attempt-001';
    assert.equal((await post('nodedefender', { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: id })).status, 200);
    const challenged = await post('nodefighter', { targetName: 'nodedefender' }, true, attack);
    assert.equal(challenged.status, 200, JSON.stringify(challenged.body));
    online.setInBattle('nodedefender', true);
    const view = await post('nodefighter', { action: 'nodes' });
    assert.equal((view.body.nodes as Record<string, Json>)['resource-17'].gatherer, undefined);
    assert.equal((await post('nodefighter', { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: 'shared-fighter-attempt-001' })).status, 200);
    online.setInBattle('nodedefender', false);
    const closed = await post('nodedefender', { action: 'resolve', requestId: id });
    assert.equal(closed.status, 200);
    assert.equal((closed.body.receipt as Json).outcome, 'cancelled');
    assert.equal((closed.body.receipt as Json).xp, 0);
    assert.equal(countOwned(closed.body.character as Json, 'gather-iron-sand'), 0);
    assert.equal(((await post('nodefighter', { action: 'nodes' })).body.nodes as Record<string, Json>)['resource-17'].gatherer, 'nodefighter',
        'late settlement cannot release the replacement claim');
});

test('a gatherer who leaves cannot collect from a replaced claim', async () => {
    await seed('nodewalker'); await seed('nodereplacement');
    const id = 'shared-walker-attempt-001';
    assert.equal((await post('nodewalker', { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: id })).status, 200);
    online.startTravel('nodewalker', 2, Date.now(), 29, 99);
    assert.equal((await post('nodereplacement', { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: 'shared-replacement-001' })).status, 200);
    online.startTravel('nodewalker', 29, Date.now(), 2, resourceNode('resource-17')!.approach);
    const closed = await post('nodewalker', { action: 'resolve', requestId: id });
    assert.equal(closed.status, 200); assert.equal((closed.body.receipt as Json).outcome, 'cancelled');
});

let kv: typeof import('../_storage.js').kv, token: typeof import('../_auth.js').issuePlayerToken;
let online: typeof import('../_realtime/online-store.js').onlineStore;
type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler, purchaseHandler: Handler;
let reconcile: typeof import('./_resource-reconcile.js').reconcileResourceAdmission;
before(async () => {
    ({ kv } = await import('../_storage.js')); ({ issuePlayerToken: token } = await import('../_auth.js'));
    ({ onlineStore: online } = await import('../_realtime/online-store.js'));
    handler = (await import('./resource.js')).default as unknown as Handler;
    purchaseHandler = (await import('../shop/purchase.js')).default as unknown as Handler;
    ({ reconcileResourceAdmission: reconcile } = await import('./_resource-reconcile.js'));
});
async function post(name: string, body: Json, auth = true, target = handler) {
    const out = { status: 200, body: {} as Json };
    const res = { setHeader() { return res; }, status(value: number) { out.status = value; return res; }, json(value: Json) { out.body = value; return res; }, end() { return res; } };
    await target({ method: 'POST', body, query: {}, headers: auth ? { 'x-player-token': token(name) } : {}, socket: { remoteAddress: '127.4.8.9' } } as never, res as never);
    return out;
}
beforeEach(async () => {
    for (const key of await kv.keys('world:resource-node:*')) await kv.del(key);
});
async function seed(name: string, patch: Json = {}) {
    const node = resourceNode('resource-17')!;
    const character = { name, level: 100, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        inventory: [], itemStacks: [], ryo: 9999, fateShards: 100, village: 'Frostfang', equipment: { pickaxe: 'tool-golden-pickaxe' }, ...patch };
    await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: Date.now(), currentSector: node.sector, character });
    online.upsert({ name, sector: node.sector, tile: node.approach, character: { level: 100 } });
}
test('new mining formations recover only in supported clients without restarting or spending twice', async () => {
    const name = 'veincompatibility'; await seed(name);
    const requestId = 'vein-compatible-attempt-001', nodeId = 'resource-17';
    const started = await post(name, { action: 'start', nodeId, mode: 'active', requestId, miningGameVersion: 2 });
    assert.equal(started.status, 200);
    // Trusted fixture selects an appended formation deterministically. The
    // browser never gets to choose or replace the server's admitted template.
    const saved = (await kv.get<Json>(`save:${name}`))!, character = saved.character as Json;
    const state = readResourceGathering(character.resourceGathering);
    const active = { ...state.active!, template: 3 };
    await kv.set(`save:${name}`, { ...saved, character: { ...character, resourceGathering: { ...state, active } } });
    const journalKey = `economy-tx:resource-gathering:${createHash('sha256').update(`${name}:${requestId}`).digest('hex')}`;
    const journal = (await kv.get<{ meta: Json }>(journalKey))!;
    await kv.set(journalKey, { ...journal, meta: { ...journal.meta, seal: { ...(journal.meta.seal as Json), template: 3 } } });
    const before = await kv.get(`save:${name}`);
    for (const action of ['status', 'start']) {
        const oldTab = await post(name, { action, nodeId, mode: 'active', requestId });
        assert.equal(oldTab.status, 409); assert.match(String(oldTab.body.error), /Refresh the page/);
        assert.deepEqual(await kv.get(`save:${name}`), before);
    }
    const recovered = await post(name, { action: 'status', nodeId, requestId, miningGameVersion: 2 });
    assert.equal(recovered.status, 200);
    const restored = readResourceGathering((recovered.body.character as Json).resourceGathering);
    assert.equal(restored.active?.id, requestId); assert.equal(restored.active?.template, 3);
    assert.equal(restored.attemptsToday, 1);
    const retry = await post(name, { action: 'start', nodeId, mode: 'active', requestId, miningGameVersion: 2 });
    assert.equal(retry.status, 200); assert.equal(retry.body.replayed, true);
    assert.equal(readResourceGathering((retry.body.character as Json).resourceGathering).attemptsToday, 1);
    assert.equal((await post(name, { action: 'cancel', requestId })).status, 200);
});
test('all retired building and ruin sites reject new starts without spending resources', async () => {
    for (const [i, id] of RETIRED_RESOURCE_NODE_IDS.entries()) {
        const name = `retiredsite${i}`, node = resourceNode(id)!;
        await seed(name, { equipment: { pickaxe: 'tool-basic-pickaxe' }, gatheringToolUses: { 'tool-basic-pickaxe': 0 } });
        const key = `save:${name}`, saved = (await kv.get<Json>(key))!;
        await kv.set(key, { ...saved, currentSector: node.sector });
        online.upsert({ name, sector: node.sector, tile: node.approach, character: { level: 100 } });
        online.startTravel(name, node.sector, Date.now(), 29, node.approach);
        const poolKey = sectorPoolKey(node.sector, Date.now());
        const beforeSave = await kv.get(key), beforePool = await kv.get(poolKey);
        const requestId = `retired-node-start-${i}`;
        const result = await post(name, { action: 'start', nodeId: id, mode: 'relaxed', requestId });
        assert.equal(result.status, 409, id);
        assert.match(String(result.body.error), /no longer available/, id);
        assert.deepEqual(await kv.get(key), beforeSave, `${id}: no action, charge, inventory or currency spent`);
        assert.deepEqual(await kv.get(poolKey), beforePool, `${id}: no shared pool slot spent`);
        const journalKey = `economy-tx:resource-gathering:${createHash('sha256').update(`${name}:${requestId}`).digest('hex')}`;
        assert.equal(await kv.get(journalKey), null, `${id}: no admission journal reserved`);
    }
});
for (const activity of ['mining', 'fishing'] as const) {
    for (const interruption of ['heartbeat', 'battle', 'expiry'] as const) {
        test(`${activity} status recovery reports ${interruption} and preserves admission accounting on replay`, async (t) => {
            // resource.ts dates the admitted action from its own Date.now(), and
            // resourceActionsToday() below counts the day of the test's
            // Date.now(). A run that straddles UTC midnight between the start
            // and that check would count the action on the wrong day, so it
            // would read as 0. Freeze Date (Date.now and new Date alike) for the
            // whole check.
            t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
            const name = `resumestatus${activity}${interruption}`, node = resourceNode(activity === 'mining' ? 'resource-17' : 'resource-1')!;
            await seed(name, { equipment: { pickaxe: 'tool-basic-pickaxe', fishingPole: 'tool-basic-fishing-pole' },
                gatheringToolUses: { 'tool-basic-pickaxe': 0, 'tool-basic-fishing-pole': 0 } });
            if (activity === 'fishing') online.startTravel(name, node.sector, Date.now(), 29, node.approach);
            online.setInBattle(name, true); online.setInBattle(name, false);
            const epoch = online.get(name)!.resourceEpoch!; assert.ok(epoch > 0);
            const id = `recover-status-${activity}-${interruption}`;
            const started = await post(name, { action: 'start', nodeId: node.id, mode: 'relaxed', requestId: id });
            assert.equal(started.status, 200);
            const saved = (await kv.get<Json>(`save:${name}`))!, character = saved.character as Json;
            const state = readResourceGathering(character.resourceGathering), startedAt = Date.now() - 4000;
            const expiresAt = interruption === 'expiry' ? Date.now() - 1 : startedAt + 90_000;
            await kv.set(`save:${name}`, { ...saved, character: { ...character, resourceGathering: { ...state, active: { ...state.active, startedAt, expiresAt } } } });
            const key = `economy-tx:resource-gathering:${createHash('sha256').update(`${name}:${id}`).digest('hex')}`;
            const journal = (await kv.get<{ meta: Json }>(key))!;
            await kv.set(key, { ...journal, meta: { ...journal.meta, seal: { ...(journal.meta.seal as Json), startedAt, expiresAt, successDraw: 0, traceDraw: 1 } } });
            if (interruption === 'battle') { online.setInBattle(name, true); online.setInBattle(name, false); }
            online.upsert({ name, sector: node.sector, tile: node.approach, character: null });
            const status = await post(name, { action: 'status' }); assert.equal(status.status, 200);
            if (interruption === 'heartbeat') {
                assert.equal(online.get(name)!.resourceEpoch, epoch);
                assert.equal(readResourceGathering((status.body.character as Json).resourceGathering).active?.id, id);
                assert.equal(status.body.receipt, undefined);
            } else {
                assert.equal((status.body.receipt as Json).outcome, interruption === 'expiry' ? 'expired' : 'cancelled');
                assert.equal((status.body.receipt as Json).xp, 0); assert.equal(status.body.nodeId, node.id);
                assert.equal(readResourceGathering((status.body.character as Json).resourceGathering).active, undefined);
            }
            const settlement = await post(name, { action: 'resolve', requestId: id }); assert.equal(settlement.status, 200);
            const settled = settlement.body.character as Json, receipt = settlement.body.receipt as Json;
            assert.equal(receipt.xp, interruption === 'heartbeat' ? 10 : 0);
            assert.equal(resourceActionsToday(settled), 1);
            assert.equal(readResourceGathering(settled.resourceGathering).nodes[node.id].attempts, 1);
            assert.equal((settled.gatheringToolUses as Json)[activity === 'mining' ? 'tool-basic-pickaxe' : 'tool-basic-fishing-pole'], 1);
            const replay = await post(name, { action: 'cancel', requestId: id });
            assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
            assert.deepEqual(replay.body.character, settled); assert.deepEqual(replay.body.receipt, receipt);
            const recovered = await post(name, { action: 'status', requestId: id, nodeId: node.id });
            assert.equal(recovered.status, 200); assert.deepEqual(recovered.body.receipt, receipt);
            assert.equal(recovered.body.nodeId, node.id); assert.deepEqual(recovered.body.character, settled);
        });
    }
}
test('authenticated mixed action #100 admits once, shares one pool slot and refuses #101', async (t) => {
    // The seeded serverExploreDate comes from a no-argument `new Date()`, and the
    // handler counts today's actions from its own Date.now(). A run that straddles
    // UTC midnight would reset that count, so #101 would be admitted. Freeze Date
    // (Date.now and new Date alike) for the whole check.
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const name = 'resourcehundred'; await seed(name, { serverExploreDate: new Date().toISOString().slice(0, 10), serverExploresToday: 99 });
    const body = { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: 'resource-shared-hundred-001' };
    assert.equal((await post(name, body, false)).status, 401);
    const attempts = await Promise.all([post(name, body), post(name, body)]);
    assert.ok(attempts.some(result => result.status === 200));
    const replay = await post(name, body); assert.equal(replay.status, 200);
    const char = replay.body.character as Json;
    assert.equal(resourceActionsToday(char), 100); assert.equal(readResourceGathering(char.resourceGathering).nodes['resource-17'].attempts, 1);
    const cancel = await post(name, { action: 'cancel', requestId: body.requestId }); assert.equal(cancel.status, 200);
    assert.equal((await post(name, { ...body, requestId: 'resource-shared-hundred-002' })).status, 409);
    assert.equal((await post(name, { ...body, nodeId: 'resource-18' })).status, 409);
});
test('server-owned outcome ignores forged amounts and replay never credits twice', async () => {
    const name = 'resourcereward'; await seed(name);
    const id = 'resource-reward-attempt-001';
    const start = await post(name, { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: id }); assert.equal(start.status, 200);
    // Trusted fixture advances the admitted timeline and fixes the random draw;
    // the request below still cannot supply or change either sealed value.
    const saved = (await kv.get<Json>(`save:${name}`))!;
    const char = saved.character as Json, state = readResourceGathering(char.resourceGathering);
    for (const publicAttempt of [start.body.attempt, state.active]) {
        for (const privateKey of ['successDraw', 'qualityDraw', 'traceDraw', 'rules', 'authorityEpoch'])
            assert.equal(Object.hasOwn(publicAttempt as Json, privateKey), false, `${privateKey} stays in the server journal`);
    }
    const startedAt = Date.now() - 4000;
    await kv.set(`save:${name}`, { ...saved, character: { ...char, resourceGathering: { ...state, active: { ...state.active, startedAt } } } });
    const journalKey = `economy-tx:resource-gathering:${createHash('sha256').update(`${name}:${id}`).digest('hex')}`;
    const sealedJournal = (await kv.get<{ meta: Json }>(journalKey))!;
    await kv.set(journalKey, { ...sealedJournal, meta: { ...sealedJournal.meta,
        seal: { ...(sealedJournal.meta.seal as Json), startedAt, successDraw: 0, qualityDraw: .999 } } });
    const forged = { action: 'resolve', requestId: id,nodeId:'resource-0', success: true, grade: 3, amount: 999, itemId: 'tool-golden-pickaxe' };
    const result = await post(name, forged); assert.equal(result.status, 200);
    const {readHarvestGround,harvestGroundKey}=await import('./_harvest-ground.js');
    const ground=await readHarvestGround(resourceNode('resource-17')!.sector);assert(ground.length>0,'the real mined seam leaves worked ground');
    const groundRow=await kv.get(harvestGroundKey(resourceNode('resource-17')!.sector));
    assert.equal(countOwned(result.body.character as Json, 'gather-iron-sand'), 1);
    assert.equal(countOwned(result.body.character as Json, 'gather-iron-sand-pristine'), 0);
    const replay = await post(name, forged); assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
    assert.deepEqual(await kv.get(harvestGroundKey(resourceNode('resource-17')!.sector)),groundRow,'replay cannot refresh the mined ground');
    assert.equal(countOwned(replay.body.character as Json, 'gather-iron-sand'), 1);
    const persisted = (await kv.get<Json>(`save:${name}`))!.character as Json;
    assert.equal(readResourceGathering(persisted.resourceGathering).active, undefined, 'settlement must clear the stored attempt');
    const nextId = 'resource-reward-attempt-002';
    assert.equal((await post(name, { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: nextId })).status, 200);
    assert.equal((await post(name, { action: 'cancel', requestId: nextId })).status, 200);
    assert.equal(readResourceGathering(((await kv.get<Json>(`save:${name}`))!.character as Json).resourceGathering).active, undefined);
    const journals = await kv.keys('economy-tx:resource-gathering:*');
    const journal = (await Promise.all(journals.map(key => kv.get<{ id: string; meta: Json }>(key)))).find(tx => tx?.meta.playerName === name)!;
    assert.equal((await reconcile(journal.id)).ok, true);
});
test('refining uses exact units and cooking/refining request IDs cannot be repurposed', async () => {
    const name = 'resourcerefine'; await seed(name, { itemStacks: [{ itemId: 'gather-rime-crystal-pristine', count: 2 }] });
    const body = { action: 'refine', itemId: 'gather-rime-crystal-pristine', quantity: 1, requestId: 'refine-resource-attempt-001' };
    const first = await post(name, body); assert.equal(first.status, 200);
    assert.equal(countOwned(first.body.character as Json, 'gather-rime-crystal'), 4);
    assert.equal(countOwned(first.body.character as Json, 'gather-rime-crystal-pristine'), 1);
    const replay = await post(name, body); assert.equal(replay.status, 200);
    assert.equal(countOwned(replay.body.character as Json, 'gather-rime-crystal'), 4);
    assert.equal((await post(name, { ...body, quantity: 2 })).status, 409);
});

test('a committed admission with a lost save acknowledgement spends one action and pool slot', async (t) => {
    // The pool key and resourceActionsToday() below take their UTC day from the
    // test's Date.now(), and resource.ts takes its day from its own Date.now().
    // A run that straddles UTC midnight between the handler and either check
    // would read the wrong day, so the debited slot or the spent action would
    // show as 0. Freeze Date (Date.now and new Date alike) for the whole check.
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const name = 'resourcelostack'; await seed(name);
    const poolKey = sectorPoolKey(29, Date.now()), beforePool = cleanSectorPoolRow(await kv.get(poolKey)).explores;
    const original = kv.compareSet; let lost = false;
    kv.compareSet = async (key, expected, value, options) => {
        const result = await original.call(kv, key, expected, value, options);
        if (key === `save:${name}` && result && !lost) { lost = true; throw new Error('fixture-lost-save-ack'); }
        return result;
    };
    const body = { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: 'resource-lost-ack-attempt-001' };
    try { assert.equal((await post(name, body)).status, 200); } finally { kv.compareSet = original; }
    const replay = await post(name, body); assert.equal(replay.status, 200);
    assert.equal(resourceActionsToday(replay.body.character as Json), 1);
    assert.equal(cleanSectorPoolRow(await kv.get(poolKey)).explores, beforePool + 1);
    assert.equal(((await post(name, { action: 'nodes' })).body.nodes as Record<string, Json>)['resource-17'].remaining, 2);
});

test('a refused save CAS releases its reservation without spending a tool use or daily action', async () => {
    const name = 'resourcefailedcas'; await seed(name, { equipment: { pickaxe: 'tool-basic-pickaxe' }, gatheringToolUses: { 'tool-basic-pickaxe': 49 } });
    const poolKey = sectorPoolKey(29, Date.now()), beforePool = cleanSectorPoolRow(await kv.get(poolKey)).explores;
    const original = kv.compareSet;
    kv.compareSet = async (key, expected, value, options) => key === `save:${name}` ? false : original.call(kv, key, expected, value, options);
    const body = { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: 'resource-failed-cas-attempt-001' };
    try { assert.notEqual((await post(name, body)).status, 200); } finally { kv.compareSet = original; }
    const saved = (await kv.get<Json>(`save:${name}`))!.character as Json;
    assert.equal(resourceActionsToday(saved), 0);
    assert.equal((saved.gatheringToolUses as Json)['tool-basic-pickaxe'], 49);
    assert.equal((saved.equipment as Json).pickaxe, 'tool-basic-pickaxe');
    assert.equal(cleanSectorPoolRow(await kv.get(poolKey)).explores, beforePool);
    assert.equal(((await post(name, { action: 'nodes' })).body.nodes as Record<string, Json>)['resource-17'].remaining, 3);
    assert.equal((await post(name, body)).status, 409, 'a refunded admission ID cannot be reused');
});

test('the final basic pickaxe use stays unequipped after settlement and a fresh save read', async () => {
    const name = 'resourcebrokenpick';
    await seed(name, { equipment: { pickaxe: 'tool-basic-pickaxe' }, gatheringToolUses: { 'tool-basic-pickaxe': 49 } });
    const id = 'resource-final-pickaxe-use-001';
    assert.equal((await post(name, { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: id })).status, 200);
    const cancelled = await post(name, { action: 'cancel', requestId: id });
    assert.equal(cancelled.status, 200);
    const saved = (await kv.get<Json>(`save:${name}`))!.character as Json;
    assert.equal((saved.equipment as Json).pickaxe, undefined);
    assert.equal((saved.gatheringToolUses as Json)['tool-basic-pickaxe'], 50);
    assert.equal(readResourceGathering(saved.resourceGathering).active, undefined);
    assert.equal((await post(name, { action: 'start', nodeId: 'resource-17', mode: 'relaxed', requestId: 'resource-final-pickaxe-use-002' })).status, 409);
});

for (const challenge of [
    { level: 1, xp: 0, fish: 0, species: 'Silver Dace', requirement: 1, blocked: false },
    { level: 1, xp: 0, fish: 1, species: 'Bronze Carp', requirement: 4, blocked: true },
    { level: 4, xp: 450, fish: 1, species: 'Bronze Carp', requirement: 4, blocked: false },
    { level: 7, xp: 1400, fish: 2, species: 'River Sturgeon', requirement: 10, blocked: true },
    { level: 10, xp: 3200, fish: 2, species: 'River Sturgeon', requirement: 10, blocked: false },
]) {
    test(`ranked fishing HTTP settlement: Fishing ${challenge.level}, ${challenge.species}, final tool use and replay`, async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
        const name = `rankedhttp${challenge.level}${challenge.fish}`, node = resourceNode('resource-1')!;
        await seed(name, { equipment: { fishingPole: 'tool-basic-fishing-pole' },
            gatheringToolUses: { 'tool-basic-fishing-pole': 49 }, resourceGathering: { fishingXp: challenge.xp } });
        online.startTravel(name, node.sector, Date.now(), 29, node.approach);
        const id = `ranked-http-${challenge.level}-${challenge.fish}-attempt`;
        const admitted = await post(name, { action: 'start', nodeId: node.id, mode: 'active', requestId: id });
        assert.equal(admitted.status, 200);
        const active = readResourceGathering((admitted.body.character as Json).resourceGathering).active!;
        assert.equal(active.fishingStyle, 'kunai'); assert.equal(active.fishingShoal, 'ranked');
        assert.equal(active.skillLevel, challenge.level); assert.equal(active.toolBroke, true);
        // Only the trusted fixture fixes this journal's motion seed and random draws.
        const key = `economy-tx:resource-gathering:${createHash('sha256').update(`${name}:${id}`).digest('hex')}`;
        const journal = (await kv.get<{ meta: Json }>(key))!;
        const seal = { ...(journal.meta.seal as Json), hookAt: 2718, template: 0, successDraw: .999, traceDraw: 1 };
        await kv.set(key, { ...journal, meta: { ...journal.meta, seal } });
        const shot = { kind: 'throw' as const, at: 1000, x: 50, y: 45 };
        for (let n = 0; n < 20; n++) {
            const point = kunaiFish(kunaiSeed({ hookAt: 2718, template: 0 }), challenge.fish, shot.at + kunaiFlightMs(shot));
            shot.x = point.x; shot.y = point.y;
        }
        t.mock.timers.tick(Math.ceil(shot.at + kunaiFlightMs(shot) + 1251));
        const settled = await post(name, { action: 'resolve', requestId: id, events: [shot], skillLevel: 10, fishingShoal: undefined, success: true, amount: 99 });
        assert.equal(settled.status, 200);
        const character = settled.body.character as Json, state = readResourceGathering(character.resourceGathering);
        const receipt = state.receipts.at(-1)!;
        assert.equal(receipt.outcome, challenge.blocked ? 'failed' : 'success');
        assert.deepEqual(receipt.fishingCatch, { name: challenge.species, requiredLevel: challenge.requirement,
            fisherLevel: challenge.level, tooStrong: challenge.blocked });
        assert.equal(receipt.xp, challenge.blocked ? 3 : 10);
        assert.equal(state.fishingXp, challenge.xp + receipt.xp); assert.equal(state.active, undefined);
        assert.equal(resourceActionsToday(character), 1); assert.equal(state.nodes[node.id].attempts, 1);
        assert.equal((character.gatheringToolUses as Json)['tool-basic-fishing-pole'], 50);
        assert.equal((character.equipment as Json).fishingPole, undefined);
        assert.equal(receipt.toolBroke, true);
        if (challenge.blocked) { assert.equal(receipt.itemId, undefined); assert.deepEqual(character.itemStacks, []); }
        else assert.equal(countOwned(character, receipt.itemId!), 1);
        const replay = await post(name, { action: 'resolve', requestId: id, events: [] });
        assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
        assert.deepEqual(replay.body.receipt, receipt); assert.deepEqual(replay.body.character, character);
        assert.deepEqual((await kv.get<Json>(`save:${name}`))!.character, character);
        assert.equal((await post(name, { action: 'start', nodeId: node.id, mode: 'active', requestId: `${id}-again` })).status, 409);
    });
}

test('both shop tool kinds persist their price, lifetime and independent equipment slots', async () => {
    const name = 'resourcealltools'; await seed(name, { equipment: {}, ryo: 100_000, fateShards: 150 });
    for (const [index, id] of ['tool-basic-pickaxe', 'tool-basic-fishing-pole', 'tool-golden-pickaxe', 'tool-golden-fishing-pole'].entries()) {
        const body = { playerName: name, itemId: id, qty: 99, requestId: `resource-shop-tools-00${index}` };
        const purchase = await post(name, body, true, purchaseHandler); assert.equal(purchase.status, 200);
        const premium = id.includes('golden');
        assert.deepEqual(purchase.body.purchase, { id, qty: 1, currency: premium ? 'fateShards' : 'ryo', unitCost: premium ? 50 : 11_250, totalCost: premium ? 50 : 11_250 });
        const replay = await post(name, body, true, purchaseHandler); assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
        assert.equal((await post(name, { action: 'equip', itemId: id })).status, 200);
    }
    const saved = (await kv.get<Json>(`save:${name}`))!.character as Json;
    assert.equal(saved.ryo, 100_000 - 2 * 11_250); assert.equal(saved.fateShards, 50);
    assert.deepEqual(saved.equipment, { pickaxe: 'tool-golden-pickaxe', fishingPole: 'tool-golden-fishing-pole' });
    assert.equal((saved.gatheringToolUses as Json)['tool-basic-pickaxe'], 0);
    assert.equal((saved.gatheringToolUses as Json)['tool-basic-fishing-pole'], 0);
});

test('a retry after an uncommitted admission expires does not charge a daily action or tool use', async () => {
    const name = 'resourceexpiredstart'; await seed(name, { equipment: { pickaxe: 'tool-basic-pickaxe' }, gatheringToolUses: { 'tool-basic-pickaxe': 49 } });
    const id = 'resource-expired-admission-001', node = resourceNode('resource-17')!;
    const { mintResourceSeal } = await import('./_resource-gathering.js');
    const { reserveEconomyTx, economyTxKey } = await import('../_economy-tx.js');
    const character = (await kv.get<Json>(`save:${name}`))!.character as Json;
    const seal = mintResourceSeal(character, node, id, 'relaxed', online.get(name)!, Date.now() - 120_000);
    const txId = `resource-gathering:${createHash('sha256').update(`${name}:${id}`).digest('hex')}`;
    await reserveEconomyTx({ id: txId, kind: 'resource-gathering', debitKey: sectorPoolKey(node.sector, seal.startedAt),
        creditKey: `save:${name}`, resource: 'explores', amount: 1,
        meta: { fingerprint: `${node.id}:relaxed`, nodeId: node.id, playerName: name, poolEnabled: true, seal } });
    const body = { action: 'start', nodeId: node.id, mode: 'relaxed', requestId: id };
    const result = await post(name, body); assert.equal(result.status, 409);
    assert.match(String(result.body.error), /Nothing was spent/);
    assert.equal((await post(name, body)).status, 409);
    const saved = (await kv.get<Json>(`save:${name}`))!.character as Json;
    assert.equal(resourceActionsToday(saved), 0);
    assert.equal((saved.gatheringToolUses as Json)['tool-basic-pickaxe'], 49);
    assert.equal((saved.equipment as Json).pickaxe, 'tool-basic-pickaxe');
    assert.equal((await kv.get<{ state: string }>(economyTxKey(txId)))!.state, 'refunded');
});
