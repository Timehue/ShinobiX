import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { STRONGHOLD_VAULT, type StrongholdVisit } from '../../shared/sector-stronghold.js';
import { assertEmptyDisposablePg, configureDisposablePgTest, finishDisposablePgTest } from '../_disposable-pg-test-support.js';

const realPostgres = configureDisposablePgTest('anbu');
process.env.SESSION_SECRET = 'anbu-async-recovery-test-secret-32chars';
let kv: typeof import('../_storage.js').kv;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let handler: typeof import('./anbu-infiltration.js').default;
let token: typeof import('../_auth.js').issuePlayerToken;
const sector = 33;
before(async () => {
    if (realPostgres) await assertEmptyDisposablePg();
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    handler = (await import('./anbu-infiltration.js')).default as unknown as typeof handler;
    ({ issuePlayerToken: token } = await import('../_auth.js'));
});
after(async () => { if (realPostgres) await finishDisposablePgTest(); });
async function post(name: string, action: string, fields: Record<string, unknown> = {}) {
    const out = { status: 200, body: {} as Record<string, unknown> };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; },
        json(body: Record<string, unknown>) { out.body = body; return res; }, end() { return res; } };
    await handler({ method: 'POST', query: {}, body: { action, playerName: name, sector, presenceId: `async-tab-${name}`, ...fields },
        headers: { 'x-player-name': name, 'x-player-token': token(name), 'x-forwarded-for': '10.98.0.1' },
        socket: { remoteAddress: '10.98.0.1' } } as never, res as never);
    return out;
}
async function seed(name: string) {
    const character = { name, village: 'Moonshadow Village', level: 100, hp: 12000, maxHp: 12000,
        chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000, ryo: 500,
        stats: {}, jutsu: [], pets: [], equipment: {}, inventory: [], itemStacks: [] };
    await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: sector, character });
    onlineStore.upsert({ name, sector, character });
    await kv.set('game:village-state:frostfangvillage', { anbuAppointees: ['asyncrecoveryanbu'] });
    await kv.set('save:asyncrecoveryanbu', { character: { ...character, name: 'Frostfang Anbu', village: 'Frostfang Village' } });
    const entry = await post(name, 'stronghold-enter'); assert.equal(entry.status, 200, JSON.stringify(entry.body));
    const visit = entry.body.visit as StrongholdVisit;
    await kv.set(`stronghold:${name}:${sector}`, { ...visit, tile: STRONGHOLD_VAULT - 1 });
    assert.equal((await post(name, 'stronghold-state')).status, 200);
}

test('a lost start response recovers the exact admitted Anbu run without its browser run ID', async () => {
    const name = 'anbuloststart'; await seed(name);
    const started = await post(name, 'start'); assert.equal(started.status, 200, JSON.stringify(started.body));
    const counts = await kv.keys(`infil-start-count:${name}:*`), before = await kv.mget(...counts);
    const recovered = await post(name, 'recover'); assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.equal(recovered.body.runId, started.body.runId);
    assert.deepEqual(recovered.body.session, started.body.session);
    assert.deepEqual(await kv.mget(...counts), before, 'recovery spends no second daily attempt');
    assert.equal((await post('anotheraccount', 'recover')).status, 404, 'an active pointer is scoped to its authenticated account');
});

test('recovery distinguishes no saved fight from an invalid sector', async () => {
    assert.equal((await post('anbunoactive', 'recover')).status, 404);
    assert.equal((await post('anbunoactive', 'recover', { sector: 99 })).status, 400);
    assert.equal((await post('anbunoactive', 'recover', { playerName: 'somebodyelse' })).status, 403);
});

test('a committed combat write with a lost acknowledgement keeps a recoverable prepared start', async () => {
    const name = 'anbulostcombatwrite'; await seed(name);
    const original = kv.set; let failed = false;
    kv.set = async (...args) => {
        const result = await original.apply(kv, args);
        if (!failed && args[0].startsWith('solo-pve:infil-')) { failed = true; throw new Error('simulated lost combat write acknowledgement'); }
        return result;
    };
    let started;
    try { started = await post(name, 'start'); } finally { kv.set = original; }
    assert(failed); assert.equal(started.status, 500);
    const runId = await kv.get<string>(`infil-active:${name}:${sector}`); assert(runId, 'context is registered before combat publication');
    const recovered = await post(name, 'recover'); assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.equal(recovered.body.runId, runId);
    const projection = await kv.get<{ sessionId: string }>(`battle-state:${name}`); assert.equal(projection?.sessionId, runId);
    const counts = await kv.keys(`infil-start-count:${name}:*`);
    assert.equal((await kv.get<{ count: number }>(counts[0]))?.count, 1);
    assert.equal((await post(name, 'recover')).body.runId, runId);
    assert.equal((await kv.get<{ count: number }>(counts[0]))?.count, 1);
});

test('a committed attempt with a lost acknowledgement completes once on recovery', async () => {
    const name = 'anbulostattempt'; await seed(name);
    const original = kv.set; let failed = false;
    kv.set = async (...args) => {
        const result = await original.apply(kv, args);
        if (!failed && args[0].startsWith(`infil-start-count:${name}:`)) { failed = true; throw new Error('simulated lost attempt acknowledgement'); }
        return result;
    };
    let started;
    try { started = await post(name, 'start'); } finally { kv.set = original; }
    assert(failed); assert.equal(started.status, 500);
    const keys = await kv.keys(`infil-start-count:${name}:*`);
    const before = await kv.mget(...keys);
    const recovered = await post(name, 'recover'); assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.deepEqual(await kv.mget(...keys), before);
    assert.equal((await kv.get<{ startState: string }>(`infil:${recovered.body.runId}`))?.startState, 'ready');
});

test('prepared recovery preserves combat advanced by another request while authority is read', async () => {
    const name = 'anbuconcurrentrecover'; await seed(name);
    const originalSet = kv.set; let failed = false;
    kv.set = async (...args) => {
        const result = await originalSet.apply(kv, args);
        if (!failed && args[0].startsWith('solo-pve:infil-')) { failed = true; throw new Error('simulated interrupted publication'); }
        return result;
    };
    try { assert.equal((await post(name, 'start')).status, 500); } finally { kv.set = originalSet; }
    const runId = (await kv.get<string>(`infil-active:${name}:${sector}`))!;
    const { readSoloPveSession } = await import('../solo-pve/_store.js');
    const before = (await readSoloPveSession(runId))!;
    const advanced = { ...before, version: before.version + 1, eventSeq: before.eventSeq + 1, player: { ...before.player, hp: before.player.hp - 1 } };
    const originalMget = kv.mget; let intervened = false;
    kv.mget = async (...keys) => {
        if (!intervened && keys.includes(`battle-state:${name}`)) { intervened = true; await kv.set(`solo-pve:${runId}`, advanced); }
        return originalMget.apply(kv, keys);
    };
    let recovered;
    try { recovered = await post(name, 'recover'); } finally { kv.mget = originalMget; }
    assert(intervened); assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.deepEqual(await readSoloPveSession(runId), advanced, 'recovery repairs publication, never the combat row');
    assert.equal((recovered.body.session as { version: number }).version, advanced.version);
});

test('retrying the same ready run after UTC midnight does not spend another day’s attempt', async () => {
    const originalNow = Date.now; const day = 24 * 60 * 60 * 1000;
    let now = Math.ceil(originalNow() / day) * day - 1000; Date.now = () => now;
    try {
        const name = 'anbumidnight'; await seed(name);
        const started = await post(name, 'start'); assert.equal(started.status, 200, JSON.stringify(started.body));
        now += 2000;
        const replay = await post(name, 'start'); assert.equal(replay.status, 200, JSON.stringify(replay.body));
        assert.equal(replay.body.runId, started.body.runId);
        assert.equal((await kv.keys(`infil-start-count:${name}:*`)).length, 1);
    } finally { Date.now = originalNow; }
});

async function bossQueue(name: string) {
    const now = Date.now(), id = `asyncqueue-${name}`;
    await kv.set('world-boss-event:active', id);
    await kv.set(`world-boss-event:${id}`, { version: 1, eventId: id, bossId: 'hollow-beast', bossName: 'Chicxulub', status: 'roaming',
        startedAt: now, roamEndsAt: now + 1_800_000, endsAt: now + 3_600_000, hp: 10000, hpMax: 10000, participants: {}, settledMatchIds: [], updatedAt: now });
    await kv.set(`world-boss-event:${id}:queue`, { tickets: [{ ticketId: id, slug: name, name, joinedAt: now, village: 'Moonshadow Village', clan: '' }], activeMatchIds: [], updatedAt: now });
}

test('a queued world-boss player cannot also start an Anbu raid or spend its daily attempt', async () => {
    const name = 'anbuqueued'; await seed(name); await bossQueue(name);
    try {
        const started = await post(name, 'start'); assert.equal(started.status, 409, JSON.stringify(started.body));
        assert.match(String(started.body.error), /world boss queue/);
        assert.equal(await kv.get(`infil-active:${name}:${sector}`), null);
        assert.deepEqual(await kv.keys(`infil-start-count:${name}:*`), []);
    } finally { await kv.del('world-boss-event:active'); }
});

test('an owed patrol waits for a world-boss queue without creating simultaneous combat', async () => {
    const name = 'anbupatrolqueued'; await seed(name); await bossQueue(name);
    try {
        const visit = (await kv.get<StrongholdVisit>(`stronghold:${name}:${sector}`))!;
        await kv.set(`stronghold:${name}:${sector}`, { ...visit, steps: 24, threat: 96 });
        const moved = await post(name, 'stronghold-step', { tile: visit.tile - 1, version: visit.version });
        assert.equal(moved.status, 200, JSON.stringify(moved.body)); assert.equal(moved.body.combatBlocked, true);
        const owed = moved.body.visit as StrongholdVisit; assert.equal(owed.threat, 100); assert(owed.patrolId);
        assert.equal(await kv.get(`solo-pve:${owed.patrolId}`), null);
        await kv.del('world-boss-event:active');
        const resumed = await post(name, 'stronghold-state'); assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
        assert((resumed.body.patrol as { sessionId: string })?.sessionId === owed.patrolId);
    } finally { await kv.del('world-boss-event:active'); }
});
