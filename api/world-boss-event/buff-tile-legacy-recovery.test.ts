import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { WorldBossEventRecord, WorldBossMatchRecord } from './_event.js';

const fixtureEnvironment: Record<string, string | undefined> = {
    NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1', ENABLE_LEGACY: '1',
    SESSION_SECRET: 'isolated-world-boss-buff-tile-legacy-secret',
    DISABLE_REALTIME: '1', DISABLE_SCHEDULED_JOBS: '1', DISABLE_SNAPSHOT_CRON: '1',
    DATABASE_URL: undefined, SUPABASE_POSTGRES_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined,
};
const previousEnvironment = Object.fromEntries(Object.keys(fixtureEnvironment).map(key => [key, process.env[key]]));
for (const [key, value] of Object.entries(fixtureEnvironment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
type Handler = (req: any, res: any) => Promise<unknown>;
let storage: typeof import('../_storage.js'), events: typeof import('./_event.js');
let queue: typeof import('./_queue.js'), tower: typeof import('../towers/_tower-store.js');
let auth: typeof import('../_auth.js'), legacy: typeof import('../_legacy-track.js');
let action: Handler, settle: Handler;
before(async () => {
    storage = await import('../_storage.js');
    assert.equal(storage.saveStoreKind, 'memory-qa', 'Never use a persistent store for this fixture');
    events = await import('./_event.js'); queue = await import('./_queue.js');
    tower = await import('../towers/_tower-store.js'); auth = await import('../_auth.js');
    legacy = await import('../_legacy-track.js');
    action = (await import('../towers/action.js')).default as unknown as Handler;
    settle = (await import('./settle.js')).default as unknown as Handler;
});
after(async () => {
    await storage?.closeStoragePool();
    for (const [key, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
});
async function request(handler: Handler, slug: string, body: Record<string, unknown>, authenticated = true) {
    let status = 200, value: any;
    const res = {
        setHeader() { return res; }, status(code: number) { status = code; return res; },
        json(result: unknown) { value = result; return res; }, end() { return res; },
    };
    await handler({ method: 'POST', query: {}, body: { playerName: slug, ...body },
        headers: { 'x-player-name': slug, ...(authenticated ? { 'x-player-token': auth.issuePlayerToken(slug) } : {}) },
        socket: { remoteAddress: '127.0.0.82' },
    }, res);
    return { status, body: value };
}

for (const knownOwner of [true, false]) test(`${knownOwner ? 'cast' : 'retained unknown'} Reflect tile preserves damage ownership and once-only Legacy settlement`, async t => {
    const { kv } = storage, now = Date.now(), suffix = knownOwner ? 'cast' : 'old';
    const owner = `tile-owner-${suffix}`, holder = `tile-holder-${suffix}`;
    const event: WorldBossEventRecord = {
        version: 1, eventId: `fixture-buff-tile-${suffix}`, bossId: 'hollow-maze-minotaur', bossName: 'Murogane',
        status: 'roaming', startedAt: now - 1000, roamEndsAt: now + 48 * 3600000,
        endsAt: now + 72 * 3600000, endedAt: null, hpMax: 600000, hp: 600000,
        participants: {}, settledMatchIds: [], updatedAt: now,
    };
    const match: WorldBossMatchRecord = {
        eventId: event.eventId, matchId: `aabbccdd-tile-${suffix}`, runId: `wbe-tile-${suffix}`,
        status: 'preparing', members: [owner, holder].map(slug => ({ slug, name: slug, village: 'Moonshadow Village', clan: 'Fixture' })),
        createdAt: now, startedAt: now, matchHp: 0,
    };
    const world = await import('../../shared/world-boss-event.js');
    const { sagePityKey } = await import('../_legacy-sage-roll.js');
    for (const slug of [owner, holder]) {
        await kv.set(`save:${slug}`, { _saveVersion: 1, currentSector: world.worldBossEventPosition(event, now)!.currentSector,
            character: { name: slug, level: 100, hp: 12000, maxHp: 12000, chakra: 1000, maxChakra: 1000,
                stamina: 1000, maxStamina: 1000, specialty: 'Taijutsu', inventory: [], ryo: 0,
                unspentStats: 500, spentStats: {}, examsPassed: [], village: 'Moonshadow Village', clan: 'Fixture',
                stats: { strength: 1000, speed: 1000, taijutsuOffense: 2500, taijutsuDefense: 2500 } },
        });
        await kv.set(legacy.legacyStatsKey(slug), { bootstrappedAt: now, worldBossOperations: 0 });
        await kv.set(sagePityKey(slug), { declinedUntil: now + 86400000 });
    }
    await events.writeWorldBossEvent(event); await events.writeWorldBossMatch(match);
    await events.writeWorldBossQueue(event.eventId, { tickets: [], activeMatchIds: [match.matchId], updatedAt: now });
    assert.equal((await queue.ensureWorldBossMatchStarted(event.eventId, match.matchId, now))?.status, 'active');
    const session = (await tower.readSession(match.runId))!;
    const caster = session.actors.find(entry => entry.ownerSlug === owner && !entry.ai)!;
    const defender = session.actors.find(entry => entry.ownerSlug === holder && !entry.ai)!;
    const boss = session.actors.find(entry => entry.id === session.phaseState.bossId)!;
    for (const actor of session.actors) if (actor.side === 'enemy' && actor.id !== boss.id) actor.hp = 0;
    for (const actor of [caster, defender]) {
        actor.hp = actor.maxHp = 1000000; actor.character.hp = actor.character.maxHp = 1000000;
        actor.shield = 0; actor.statuses = []; actor.character.itemReflectPct = 0;
    }
    caster.pos = 20; defender.pos = 21; boss.pos = 22; boss.hp = 5000; boss.shield = 0; boss.statuses = [];
    session.map.blockedTiles = []; session.map.hazardTiles = [];
    session.phaseState.pendingPhases = []; session.phaseState.triggeredPhases = [75, 50, 25]; delete session.towerTactics;
    caster.character.jutsu = [{ id: 'fixture-reflect-tile', name: 'Fixture Reflect Tile', type: 'Any', method: 'INSTANT_EFFECT',
        ap: 40, range: 4, target: 'EMPTY_GROUND', tags: [{ name: 'Reflect', percent: 30 }] }];
    caster.character.jutsuMastery = [{ jutsuId: 'fixture-reflect-tile', level: 50 }];
    session.activeIndex = session.turnQueue.indexOf(caster.id); session.activeAp = 100; session.actionsThisTurn = 0;
    session.turnStartedAt = now;
    if (!knownOwner) session.groundEffects = [{ id: 'retained-reflect-tile', name: 'Retained Reflect Tile', kind: 'occupant',
        owner: 'p1', tiles: [defender.pos], rounds: 3, activeRound: session.round, tags: [{ name: 'Reflect', percent: 30 }] }];
    await tower.writeSession(session);
    const cast = await request(action, owner, { runId: match.runId, type: 'jutsu', jutsuId: 'fixture-reflect-tile', tile: knownOwner ? defender.pos : caster.pos });
    assert.equal(cast.status, 200, JSON.stringify(cast.body)); assert.equal(cast.body.applied, true, JSON.stringify(cast.body));
    const moving = (await tower.readSession(match.runId))!;
    moving.activeIndex = moving.turnQueue.indexOf(defender.id); moving.activeAp = 100; moving.actionsThisTurn = 0;
    moving.turnStartedAt = Date.now(); await tower.writeSession(moving);
    for (const tile of [defender.pos - moving.map.width, defender.pos]) {
        const moved = await request(action, holder, { runId: match.runId, type: 'move', tile });
        assert.equal(moved.status, 200, JSON.stringify(moved.body)); assert.equal(moved.body.applied, true, JSON.stringify(moved.body));
    }
    const played = (await tower.readSession(match.runId))!;
    const playedBoss = played.actors.find(entry => entry.id === boss.id)!;
    const playedDefender = played.actors.find(entry => entry.id === defender.id)!;
    const reflect = playedDefender.statuses.find(status => status.name === 'Reflect')!;
    assert.ok(reflect, 'The other player must actually hold the tile Reflect');
    if (knownOwner) assert.equal((played.groundEffects![0] as any).worldBossOwnerSlug, owner);
    playedBoss.character.jutsu = [{ id: 'fixture-boss-hit', name: 'Fixture Boss Hit', type: 'Taijutsu', ap: 60, range: 4, effectPower: 2000 }];
    playedBoss.character.jutsuMastery = [{ jutsuId: 'fixture-boss-hit', level: 50 }];
    played.turnQueue = [playedBoss.id, caster.id, defender.id]; played.activeIndex = 0; played.activeAp = 100; played.actionsThisTurn = 0;
    const beforeHp = playedBoss.hp;
    const { applyAction } = await import('../towers/_engine.js');
    assert.equal(applyAction(played, played.encounterFloor!, { actorId: playedBoss.id, type: 'clear', targetId: playedDefender.id }, () => .5).applied, true);
    assert.ok(playedDefender.statuses.some(status => status.name === 'Reflect'), 'Main ground immunity survives a real Clear');
    played.activeAp = 100; // Isolate the subsequent attack from the Clear's AP charge.
    assert.equal(applyAction(played, played.encounterFloor!, { actorId: playedBoss.id, type: 'jutsu', jutsuId: 'fixture-boss-hit', targetId: playedDefender.id }, () => .5).applied, true);
    const damage = beforeHp - playedBoss.hp;
    assert.ok(damage >= 3000, `The real reflected hit must qualify by existing rules: ${damage}`);
    // The attack is real resolver combat; a nonlethal fixture is sealed terminal for settlement only.
    if (played.status !== 'done') { played.status = 'done'; played.winner = 'enemy'; }
    await tower.writeSession(played);
    assert.equal((await request(settle, owner, { runId: match.runId }, false)).status, 401);
    const receiptId = `world-boss-operation:${match.runId}:${owner}`;
    const originalSet = kv.set.bind(kv), checkpointError = new Error('Synthetic interruption before tile match publication');
    let interrupted = false;
    const fault = t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        const [key, value] = args;
        if (key === events.worldBossMatchKey(event.eventId, match.matchId) && value && typeof value === 'object' && 'status' in value && value.status === 'settled') {
            interrupted = true; throw checkpointError;
        }
        return originalSet(...args);
    });
    const diagnostics = t.mock.method(console, 'error', () => undefined);
    try { assert.equal((await request(settle, owner, { runId: match.runId })).status, 503); }
    finally { fault.mock.restore(); }
    assert.equal(interrupted, true); assert.ok(diagnostics.mock.calls.some(call => call.arguments[1] === checkpointError));
    const pending = await legacy.getLegacyStats(owner), paid = await kv.get(`save:${owner}`);
    const pendingProof = legacy.hasLegacyActivityReceipt(pending, receiptId);
    assert.equal((await events.readWorldBossMatch(event.eventId, match.matchId))!.status, 'active');
    const retried = await request(settle, owner, { runId: match.runId }); assert.equal(retried.status, 200, JSON.stringify(retried.body));
    const acknowledged = await legacy.getLegacyStats(owner);
    assert.equal(legacy.hasLegacyActivityReceipt(acknowledged, receiptId), false);
    assert.deepEqual(await kv.get(`save:${owner}`), paid, 'Retry cannot change the paid save/version');
    const replayed = await request(settle, owner, { runId: match.runId }); assert.equal(replayed.status, 200);
    assert.deepEqual(await legacy.getLegacyStats(owner), acknowledged); assert.deepEqual(await kv.get(`save:${owner}`), paid);
    const banked = (await events.readWorldBossEvent(event.eventId))!;
    const observed = { knownOwner, damage, ownerDamage: played.worldBossContributions?.[owner]?.damage ?? 0,
        holderDamage: played.worldBossContributions?.[holder]?.damage ?? 0, unknownDamage: played.worldBossUnattributedDamage ?? 0,
        legacyOperations: pending.worldBossOperations, pendingProof, ryo: (paid as any)?.character?.ryo,
        eventHp: banked.hp, bankedDamage: retried.body.bankedDamage };
    console.log('BUFF_TILE_LEGACY_RECOVERY', JSON.stringify(observed));
    assert.deepEqual(observed, { knownOwner, damage, ownerDamage: knownOwner ? damage : 0, holderDamage: 0,
        unknownDamage: knownOwner ? 0 : damage, legacyOperations: knownOwner ? 1 : 0, pendingProof: knownOwner,
        ryo: knownOwner ? 2500 : 0, eventHp: 600000 - damage, bankedDamage: damage });
    assert.equal((await legacy.getLegacyStats(holder)).worldBossOperations ?? 0, 0);
    assert.equal((await kv.get<any>(`save:${holder}`))?.character?.ryo, 0);
    assert.equal(banked.participants[owner]?.damage ?? 0, knownOwner ? damage : 0);
});
