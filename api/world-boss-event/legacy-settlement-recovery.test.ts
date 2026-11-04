import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { WorldBossEventRecord, WorldBossMatchRecord } from './_event.js';

const fixtureEnvironment: Record<string, string | undefined> = {
    NODE_ENV: 'test',
    SHINOBIX_QA_MEMORY_KV: '1',
    SESSION_SECRET: 'isolated-world-boss-legacy-settlement-test-secret',
    ENABLE_LEGACY: '1',
    DISABLE_REALTIME: '1',
    DISABLE_SCHEDULED_JOBS: '1',
    DISABLE_SNAPSHOT_CRON: '1',
    DATABASE_URL: undefined,
    SUPABASE_POSTGRES_URL: undefined,
    SUPABASE_SERVICE_ROLE_KEY: undefined,
};
const previousEnvironment = Object.fromEntries(Object.keys(fixtureEnvironment).map(key => [key, process.env[key]]));
for (const [key, value] of Object.entries(fixtureEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
}

let storage: typeof import('../_storage.js');
let events: typeof import('./_event.js');
let queue: typeof import('./_queue.js');
let tower: typeof import('../towers/_tower-store.js');
let legacy: typeof import('../_legacy-track.js');
let auth: typeof import('../_auth.js');
let settle: typeof import('./settle.js')['default'];

before(async () => {
    storage = await import('../_storage.js');
    assert.equal(storage.saveStoreKind, 'memory-qa', 'This fixture must never access a persistent store');
    events = await import('./_event.js');
    queue = await import('./_queue.js');
    tower = await import('../towers/_tower-store.js');
    legacy = await import('../_legacy-track.js');
    auth = await import('../_auth.js');
    settle = (await import('./settle.js')).default as unknown as typeof settle;
});

after(async () => {
    await storage?.closeStoragePool();
    for (const [key, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

type SettlementResponse = { error?: string; settled?: boolean; bankedDamage?: number; reward?: { ryo: number } };
async function requestSettlement(slug: string, runId: string, token?: string) {
    let status = 200;
    let body: SettlementResponse = {};
    const res = {
        setHeader() { return res; },
        status(code: number) { status = code; return res; },
        json(value: SettlementResponse) { body = value; return res; },
        end() { return res; },
    };
    await settle({
        method: 'POST', body: { playerName: slug, runId }, query: {},
        headers: { 'x-player-name': slug, ...(token ? { 'x-player-token': token } : {}) },
        socket: { remoteAddress: '127.0.0.81' },
    } as never, res as never);
    return { status, body };
}

test('enabled Legacy settlement recovers pre-publication interruption and cannot credit again after acknowledgement', async t => {
    const { kv } = storage;
    const now = Date.now(), slug = 'fixture-legacy-recovery';
    const event: WorldBossEventRecord = {
        version: 1, eventId: 'fixture-legacy-settlement', bossId: 'hollow-maze-minotaur', bossName: 'Murogane',
        status: 'roaming', startedAt: now - 1000, roamEndsAt: now + 48 * 3600000,
        endsAt: now + 72 * 3600000, endedAt: null, hpMax: 600000, hp: 600000,
        participants: {}, settledMatchIds: [], updatedAt: now,
    };
    const match: WorldBossMatchRecord = {
        eventId: event.eventId, matchId: 'aabbccdd-legacy-recovery', runId: 'wbe-legacy-settlement-recovery',
        status: 'preparing', members: [{ slug, name: slug, village: 'Moonshadow Village', clan: 'Fixture' }],
        createdAt: now, startedAt: now, matchHp: 0,
    };
    const world = await import('../../shared/world-boss-event.js');
    await kv.set(`save:${slug}`, {
        _saveVersion: 1, currentSector: world.worldBossEventPosition(event, now)!.currentSector,
        character: {
            name: slug, level: 100, hp: 12000, maxHp: 12000, chakra: 1000, maxChakra: 1000,
            stamina: 1000, maxStamina: 1000, specialty: 'Taijutsu', inventory: [], ryo: 0,
            unspentStats: 500, spentStats: {}, examsPassed: [], village: 'Moonshadow Village', clan: 'Fixture',
            stats: { strength: 1000, speed: 1000, taijutsuOffense: 2500, taijutsuDefense: 2500 },
        },
    });
    await kv.set(legacy.legacyStatsKey(slug), { bootstrappedAt: now, worldBossOperations: 0 });
    // A normal Sage cooldown keeps unrelated offer randomness outside this receipt regression.
    const { sagePityKey } = await import('../_legacy-sage-roll.js');
    await kv.set(sagePityKey(slug), { declinedUntil: now + 86400000 });
    await events.writeWorldBossEvent(event);
    await events.writeWorldBossMatch(match);
    await events.writeWorldBossQueue(event.eventId, { tickets: [], activeMatchIds: [match.matchId], updatedAt: now });
    assert.equal((await queue.ensureWorldBossMatchStarted(event.eventId, match.matchId, now))?.status, 'active');

    // Seed a server-owned terminal fixture; combat resolution is covered separately.
    const session = (await tower.readSession(match.runId))!;
    const actor = session.actors.find(entry => entry.ownerSlug === slug && !entry.ai)!;
    const boss = session.actors.find(entry => entry.id === session.phaseState.bossId)!;
    session.status = 'done'; session.winner = 'squad';
    for (const enemy of session.actors.filter(entry => entry.side === 'enemy')) enemy.hp = 0;
    session.log = [`${actor.name} strikes ${boss.name} for 5000.`];
    session.worldBossContributions = { [slug]: { actions: 1, damage: 5000, healing: 0, shielding: 0, cleanses: 0, objective: 0 } };
    await tower.writeSession(session);
    assert.equal(legacy.legacyEnabled(), true);
    const token = auth.issuePlayerToken(slug);
    assert.ok(token);
    assert.equal((await requestSettlement(slug, match.runId)).status, 401, 'Real authentication remains enforced');

    const receiptId = `world-boss-operation:${match.runId}:${slug}`;
    const checkpointError = new Error('Synthetic interruption before settled match publication');
    let interrupted = false;
    const originalSet = kv.set.bind(kv);
    const fault = t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        const [key, value] = args;
        if (key === events.worldBossMatchKey(event.eventId, match.matchId)
            && value && typeof value === 'object' && 'status' in value && value.status === 'settled') {
            interrupted = true;
            throw checkpointError;
        }
        return originalSet(...args);
    });
    const diagnostics = t.mock.method(console, 'error', () => undefined);
    try {
        const first = await requestSettlement(slug, match.runId, token);
        assert.equal(first.status, 503, JSON.stringify(first.body));
        assert.deepEqual(first.body, { error: 'World boss settlement could not be confirmed. Try again.' });
    } finally {
        fault.mock.restore();
    }
    assert.equal(interrupted, true);
    assert.ok(diagnostics.mock.calls.some(call => call.arguments[1] === checkpointError));
    const pendingStats = await legacy.getLegacyStats(slug);
    assert.equal(pendingStats.worldBossOperations, 1);
    assert.equal(pendingStats.taijutsuDamage, 5000);
    assert.equal(legacy.hasLegacyActivityReceipt(pendingStats, receiptId), true, 'Proof remains pending before source publication');
    const paidBeforePublication = await kv.get<{ _saveVersion: number; character: { ryo: number } }>(`save:${slug}`);
    assert.equal(paidBeforePublication?.character.ryo, 2500);
    assert.equal((await events.readWorldBossMatch(event.eventId, match.matchId))?.status, 'active');
    assert.notEqual((await tower.readSession(match.runId))?.rewardSettlementState, 'settled');
    const banked = (await events.readWorldBossEvent(event.eventId))!;
    assert.equal(banked.hp, 595000);
    assert.deepEqual(banked.settledMatchIds, [match.matchId]);
    assert.equal(banked.participants[slug].matches, 1);

    const retried = await requestSettlement(slug, match.runId, token);
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.settled, true);
    assert.equal(retried.body.bankedDamage, 5000);
    assert.equal(retried.body.reward?.ryo, 2500);
    assert.equal((await events.readWorldBossMatch(event.eventId, match.matchId))?.status, 'settled');
    assert.equal((await tower.readSession(match.runId))?.rewardSettlementState, 'settled');
    assert.equal(await kv.get(`battle-lock:${slug}`), null);
    assert.equal(await kv.get(`battle-state:${slug}`), null);
    assert.deepEqual(await kv.get(`save:${slug}`), paidBeforePublication, 'Retry preserves the full paid save and version');
    const acknowledgedStats = await legacy.getLegacyStats(slug);
    assert.equal(acknowledgedStats.worldBossOperations, 1);
    assert.equal(acknowledgedStats.taijutsuDamage, 5000);
    assert.equal(legacy.hasLegacyActivityReceipt(acknowledgedStats, receiptId), false);

    const replayed = await requestSettlement(slug, match.runId, token);
    assert.equal(replayed.status, 200, JSON.stringify(replayed.body));
    assert.deepEqual(await legacy.getLegacyStats(slug), acknowledgedStats, 'Settled-source guard prevents credit after proof acknowledgement');
    assert.deepEqual(await kv.get(`save:${slug}`), paidBeforePublication, 'Replay cannot duplicate rewards or advance the save version');
    assert.equal((await events.readWorldBossEvent(event.eventId))!.hp, 595000);
    assert.equal((await events.readWorldBossEvent(event.eventId))!.participants[slug].matches, 1);
});
