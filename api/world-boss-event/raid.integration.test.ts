import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import actionHandler from '../towers/action.js';
import settleHandler from './settle.js';
import stateHandler from '../towers/state.js';
import type { WorldBossEventRecord, WorldBossMatchRecord } from './_event';
import type { WorldBossId } from '../../shared/world-boss-event';

let kv: typeof import('../_storage.js')['kv'];
let eventStore: typeof import('./_event.js');
let queue: typeof import('./_queue.js');
let towerStore: typeof import('../towers/_tower-store.js');
let world: typeof import('../../shared/world-boss-event.js');

before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.ADMIN_PASSWORD = 'world-boss-local-integration-test';
    ({ kv } = await import('../_storage.js'));
    eventStore = await import('./_event.js');
    queue = await import('./_queue.js');
    towerStore = await import('../towers/_tower-store.js');
    world = await import('../../shared/world-boss-event.js');
});

async function post(handler: typeof settleHandler, body: Record<string, unknown>, method = 'POST') {
    let status = 200;
    let result: any;
    const res = {
        setHeader() { return res; },
        status(code: number) { status = code; return res; },
        json(value: unknown) { result = value; return res; },
        end() { return res; },
    };
    await handler({ method, body, query: method === 'GET' ? body : {}, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, socket: { remoteAddress: '127.0.0.91' } } as never, res as never);
    return { status, body: result };
}

async function startRaid(id: string, bossId: WorldBossId, hp = 600_000, finish = true) {
    const now = Date.now();
    const slug = `raider-${id}`;
    const event: WorldBossEventRecord = {
        version: 1, eventId: `integration-${id}`, bossId, bossName: world.worldBossDefinition(bossId).name,
        status: 'roaming', startedAt: now - 1000, roamEndsAt: now + 48 * 60 * 60 * 1000,
        endsAt: now + 72 * 60 * 60 * 1000, endedAt: null, hpMax: hp, hp,
        participants: {}, settledMatchIds: [], updatedAt: now,
    };
    const sector = world.worldBossEventPosition(event, now)!.currentSector;
    const match: WorldBossMatchRecord = {
        eventId: event.eventId, matchId: `aabbccdd-${id}`, runId: `wbe-integration-${id}`, status: 'preparing',
        members: [{ slug, name: slug, village: '', clan: '' }], createdAt: now, startedAt: now, matchHp: 0,
    };
    await kv.set(`save:${slug}`, { currentSector: sector, _saveVersion: 1, character: {
        name: slug, level: 100, hp: 12_000, maxHp: 12_000, maxChakra: 1000, chakra: 1000, maxStamina: 1000, stamina: 1000,
        specialty: 'Taijutsu', inventory: [], ryo: 0, unspentStats: 500, spentStats: {}, examsPassed: [],
        stats: { strength: 1000, speed: 1000, taijutsuOffense: 2500, taijutsuDefense: 2500 },
    } });
    await eventStore.writeWorldBossEvent(event);
    await eventStore.writeWorldBossMatch(match);
    await eventStore.writeWorldBossQueue(event.eventId, { tickets: [], activeMatchIds: [match.matchId], updatedAt: now });
    const started = await queue.ensureWorldBossMatchStarted(event.eventId, match.matchId, now);
    assert.equal(started?.status, 'active', started?.error ?? 'Raid did not start');
    const session = (await towerStore.readSession(match.runId))!;
    assert.equal(session.worldBossEvent?.eventId, event.eventId);
    assert.equal(session.encounterFloor?.name, `${event.bossName}: Raid`);
    const boss = session.actors.find(actor => actor.id === session.phaseState.bossId)!;
    const player = session.actors.find(actor => actor.side === 'squad')!;
    assert.equal(boss.character.towerDmgScale, 1);
    assert.ok(Array.isArray(boss.character.jutsuMastery));
    assert.equal(session.actors.find(actor => actor.id === 'en-0')?.character.visual, world.worldBossGuardVisual(bossId));
    // Put a sealed, deterministic finishing attack in range. The real action
    // endpoint must resolve it, record contribution and persist the terminal raid.
    player.character.jutsu = [{ id: 'integration-finish', name: 'Finishing blow', type: 'Taijutsu', ap: 60, range: 1, effectPower: finish ? 100_000 : 20 }];
    player.character.jutsuMastery = [{ jutsuId: 'integration-finish', level: 50 }];
    boss.pos = player.pos + (player.pos % session.map.width === session.map.width - 1 ? -1 : 1);
    // Expose Murogane only after his guards have been cleared.
    for (const actor of session.actors) if (actor.side === 'enemy' && actor.id !== boss.id) actor.hp = 0;
    session.activeIndex = session.turnQueue.indexOf(player.id);
    session.activeAp = 100;
    await towerStore.writeSession(session);
    const action = await post(actionHandler, { runId: match.runId, playerName: slug, type: 'jutsu', jutsuId: 'integration-finish', targetId: boss.id });
    assert.equal(action.status, 200, JSON.stringify(action.body));
    assert.equal(action.body.applied, true, JSON.stringify(action.body));
    if (finish) {
        assert.equal(action.body.session.status, 'done');
        assert.equal(action.body.session.worldBossContributions[slug].damage, started!.matchHp);
    }
    return { event, match, slug, matchHp: started!.matchHp };
}

test('each boss is wired from queue start through action, shared HP, reward and retry', async t => {
    t.mock.method(console, 'error', () => {});
    for (const boss of world.WORLD_BOSS_DEFINITIONS) {
        const raid = await startRaid(boss.id, boss.id);
        const body = { runId: raid.match.runId, playerName: raid.slug };
        const first = await post(settleHandler, body);
        assert.equal(first.status, 200, JSON.stringify(first.body));
        assert.equal(first.body.settled, true);
        assert.equal(first.body.bankedDamage, raid.matchHp);
        assert.equal(first.body.hpRemaining, 600_000 - raid.matchHp);
        assert.equal(first.body.reward.ryo, 2500);
        assert.equal(await kv.get(`battle-lock:${raid.slug}`), null, 'settlement must release the player for other battles');
        assert.equal((await towerStore.readSession(raid.match.runId))!.rewardSettlementState, 'settled');
        const save = await kv.get<any>(`save:${raid.slug}`);
        const retry = await post(settleHandler, body);
        assert.equal(retry.status, 200, JSON.stringify(retry.body));
        assert.equal(retry.body.hpRemaining, first.body.hpRemaining);
        assert.equal(retry.body.bankedDamage, first.body.bankedDamage);
        assert.deepEqual(await kv.get(`save:${raid.slug}`), save, 'retry must not pay twice');
        const event = (await eventStore.readWorldBossEvent(raid.event.eventId))!;
        assert.equal(event.participants[raid.slug].matches, 1);
        assert.equal(event.hp, first.body.hpRemaining);
        assert.equal(eventStore.publicWorldBossEvent(event, event.status, world.worldBossEventPosition(event, Date.now())).active, false);
        const returnedQueue = await queue.worldBossQueueView(event, raid.slug);
        assert.equal(returnedQueue.match?.status, 'settled');
        assert.deepEqual(returnedQueue.match?.reward, first.body.reward);
        // A missing event must be a retryable failure, never a false zero-HP victory.
        await kv.del(eventStore.worldBossEventKey(event.eventId));
        assert.equal((await post(settleHandler, body)).status, 503);
    }
});

test('the last raid closes the world event and returns a zero-HP receipt', async () => {
    const raid = await startRaid('last-health', 'hollow-maze-minotaur', 1000);
    const settled = await post(settleHandler, { runId: raid.match.runId, playerName: raid.slug });
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    assert.equal(settled.body.hpRemaining, 0);
    const event = (await eventStore.readWorldBossEvent(raid.event.eventId))!;
    assert.equal(event.status, 'victory');
    assert.equal(eventStore.publicWorldBossEvent(event, event.status, world.worldBossEventPosition(event, Date.now())).active, false);
    assert.ok(settled.body.character.itemStacks.some((stack: { itemId: string; count: number }) => stack.itemId === 'hollow-beast-cache' && stack.count === 1));
    const save = await kv.get(`save:${raid.slug}`);
    const retry = await post(settleHandler, { runId: raid.match.runId, playerName: raid.slug });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.hpRemaining, 0);
    assert.deepEqual(await kv.get(`save:${raid.slug}`), save, 'victory retries must not duplicate the cache');
});

test('a wiped team still banks its verified partial damage without declaring world victory', async () => {
    const raid = await startRaid('partial-wipe', 'hollow-maze-minotaur', 600_000, false);
    const session = (await towerStore.readSession(raid.match.runId))!;
    const damage = session.worldBossContributions![raid.slug].damage;
    assert.ok(damage > 0 && damage < raid.matchHp);
    session.status = 'done';
    session.winner = 'enemy';
    session.objectiveState.failed = true;
    session.actors.find(actor => actor.side === 'squad')!.hp = 0;
    await towerStore.writeSession(session);
    const settled = await post(settleHandler, { runId: raid.match.runId, playerName: raid.slug });
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    assert.equal(settled.body.bankedDamage, damage);
    assert.equal(settled.body.hpRemaining, 600_000 - damage);
    assert.equal((await eventStore.readWorldBossEvent(raid.event.eventId))!.status, 'roaming');
});

test('a completed legacy raid survives generic recovery and pays its original contribution exactly once', async () => {
    const raid = await startRaid('legacy-recovery', 'hollow-maze-minotaur', 600_000, false);
    const session = (await towerStore.readSession(raid.match.runId))!;
    const damage = session.worldBossContributions![raid.slug].damage;
    session.worldBossEvent!.matchHpAtStart = 28_000;
    delete session.worldBossEvent!.bossId;
    const boss = session.actors.find(actor => actor.id === session.phaseState.bossId)!;
    boss.maxHp = 28_000;
    boss.hp = 10_873;
    session.status = 'done';
    session.winner = 'enemy';
    session.actors.find(actor => actor.side === 'squad')!.hp = 0;
    await towerStore.writeSession(session);
    const body = { runId: raid.match.runId, playerName: raid.slug };
    const recovered = await post(stateHandler, body, 'GET');
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.deepEqual(recovered.body.session.worldBossEvent, session.worldBossEvent);
    const paid = await post(settleHandler, body);
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body.bankedDamage, damage);
    assert.equal(paid.body.hpRemaining, 600_000 - damage);
    assert.equal(await kv.get(`battle-lock:${raid.slug}`), null);
    const save = await kv.get(`save:${raid.slug}`);
    const retry = await post(settleHandler, body);
    assert.equal(retry.status, 200);
    assert.deepEqual(await kv.get(`save:${raid.slug}`), save);
});

test('a lost match write after the killing blow retains banked damage and pays only once',async t=>{
    const raid=await startRaid('banked-crash','hollow-maze-minotaur',1000);
    const matchKey=eventStore.worldBossMatchKey(raid.event.eventId,raid.match.matchId);
    const originalSet=kv.set.bind(kv);
    let fail=true;
    t.mock.method(console,'error',()=>{});
    t.mock.method(kv,'set',async(...args:any[])=>{
        if(args[0]===matchKey && fail){fail=false;throw new Error('Lost match write');}
        return originalSet(...args as Parameters<typeof kv.set>);
    });
    const body={runId:raid.match.runId,playerName:raid.slug};
    assert.equal((await post(settleHandler,body)).status,503);
    assert.equal((await eventStore.readWorldBossEvent(raid.event.eventId))!.hp,0);
    const recovered=await post(settleHandler,body);
    assert.equal(recovered.status,200,JSON.stringify(recovered.body));
    assert.equal(recovered.body.bankedDamage,1000);
    assert.equal(recovered.body.hpRemaining,0);
    const save=await kv.get(`save:${raid.slug}`);
    assert.equal((await post(settleHandler,body)).body.bankedDamage,1000);
    assert.deepEqual(await kv.get(`save:${raid.slug}`),save);
});

test('a wiped raid deducts recorded potions and thrown ammunition exactly once',async()=>{
    const raid=await startRaid('spent-items','hollow-maze-minotaur',600_000,false);
    const saveKey=`save:${raid.slug}`;
    const save=await kv.get<any>(saveKey);
    save.character.inventory=['healing-potion','healing-potion','kunai','kunai','kunai'];
    await kv.set(saveKey,save);
    const session=(await towerStore.readSession(raid.match.runId))!;
    session.actors.find(actor=>actor.side==='squad')!.itemsUsed={'healing-potion':1,'kunai':2};
    session.status='done';session.winner='enemy';
    await towerStore.writeSession(session);
    const body={runId:raid.match.runId,playerName:raid.slug};
    const paid=await post(settleHandler,body);
    assert.equal(paid.status,200,JSON.stringify(paid.body));
    const inventory=paid.body.character.inventory as string[];
    assert.equal(inventory.filter(id=>id==='healing-potion').length,1);
    assert.equal(inventory.filter(id=>id==='kunai').length,1);
    const after=await kv.get(saveKey);
    await post(settleHandler,body);
    assert.deepEqual(await kv.get(saveKey),after);
});
