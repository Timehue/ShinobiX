import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { towerLevelEligible } from './_story-eligibility.js';
import { towerActionVersion } from './_action-idempotency.js';
import { activeActor, type TowerSession } from './_tower-session.js';
import { battleLockKey } from './_battle-lease.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'tower-level-gate-test';
let kv: typeof import('../_storage.js').kv;
let issueToken: typeof import('../_auth.js').issuePlayerToken;
let partyHandler: typeof import('./party.js').default;
let startHandler: typeof import('./start.js').default;
let parties: typeof import('./_party.js');
before(async () => {
    ({ kv } = await import('../_storage.js'));
    issueToken = (await import('../_auth.js')).issuePlayerToken;
    partyHandler = (await import('./party.js')).default as unknown as typeof partyHandler;
    startHandler = (await import('./start.js')).default as unknown as typeof startHandler;
    parties = await import('./_party.js');
});

async function seed(name: string, level: number) {
    await kv.set(`auth:${name}`, { salt: 's', hash: 'scrypt:16384:8:1:00' });
    await kv.set(`save:${name}`, { _saveVersion: 1, character: {
        name, level, ryo: 100000, maxHp: 3400, hp: 3400, maxChakra: 3600, chakra: 3600,
        maxStamina: 3600, stamina: 3600, stats: {}, inventory: [], equipped: {},
    } });
}
async function call(handler: typeof partyHandler, player: string, body: Record<string, unknown>, method = 'POST') {
    const output: { status: number; headers: Record<string, unknown>; body?: Record<string, any> } = { status: 200, headers: {} };
    const res = { setHeader: (key: string, value: unknown) => { output.headers[key] = value; return res; }, status: (value: number) => { output.status = value; return res; },
        json: (value: Record<string, any>) => { output.body = value; return res; }, end: () => res };
    await handler({ method, body, query: body, headers: { 'x-player-name': player, 'x-player-token': issueToken(player) },
        socket: { remoteAddress: '127.0.0.35' } } as never, res as never);
    return output;
}
test('the shared server level gate fails closed for malformed levels', () => {
    for (const level of [undefined, null, NaN, Infinity, -1, 29, 'bad', [30]]) assert.equal(towerLevelEligible({ level }), false);
    for (const level of [30, 100, '30']) assert.equal(towerLevelEligible({ level }), true);
});
test('level 29 cannot create either ready room; exactly 30 can create', async () => {
    for (const mode of ['story', 'spire']) {
        const name = `gate-create-${mode}`;
        await seed(name, 29);
        const body = { playerName: name, action: 'create', mode, floor: 1, ascensionTier: 1, requestId: `create-room-${mode}-001` };
        const rejected = await call(partyHandler, name, body);
        assert.equal(rejected.status, 403);
        assert.equal(rejected.body?.requiredLevel, 30);
        assert.equal(await parties.activeTowerPartyForPlayer(name), null);
        await seed(name, 30);
        assert.equal((await call(partyHandler, name, body)).status, 200);
    }
});
test('an underlevel member cannot join or ready, but can leave a legacy room', async () => {
    const host = 'gate-host', guest = 'gate-guest';
    await seed(host, 30); await seed(guest, 29);
    const created = await parties.createTowerParty({ hostSlug: host, binding: { mode: 'story', floor: 1 } });
    assert.ok(created.ok); if (!created.ok) return;
    const rejected = await call(partyHandler, guest, { playerName: guest, action: 'join', inviteCode: created.party.inviteCode, requestId: 'gate-join-request-001' });
    assert.equal(rejected.status, 403);
    const joined = await parties.joinTowerParty({ partyId: created.party.id, actor: guest, requestId: 'legacy-join-001', fingerprint: 'legacy', expectedVersion: created.party.version });
    assert.ok(joined.ok); if (!joined.ok) return;
    const body = { playerName: guest, partyId: joined.party.id, expectedVersion: joined.party.version };
    assert.equal((await call(partyHandler, guest, { ...body, action: 'ready', requestId: 'gate-ready-request-001' })).status, 403);
    assert.equal((await call(partyHandler, guest, { ...body, action: 'leave', requestId: 'gate-leave-request-001' })).status, 200);
});
for (const mode of ['story', 'spire'] as const) test(`${mode} launch rechecks every member's saved level before charging or claiming battle leases`, async () => {
    const names = Array.from({ length: 4 }, (_, i) => `gate-${mode}-${i}`);
    for (const name of names) await seed(name, 30);
    const binding = mode === 'story' ? { mode, floor: 1 } : { mode, ascensionTier: 1 };
    const created = await parties.createTowerParty({ hostSlug: names[0]!, binding });
    assert.ok(created.ok); if (!created.ok) return;
    let party = created.party;
    for (const name of names.slice(1)) {
        const result = await parties.joinTowerParty({ partyId: party.id, actor: name, requestId: `join-${name}`, fingerprint: name, expectedVersion: party.version });
        assert.ok(result.ok); if (!result.ok) return; party = result.party;
    }
    for (const name of names) {
        const result = await parties.setTowerPartyReady({ partyId: party.id, actor: name, ready: true, requestId: `ready-${name}`, fingerprint: name, expectedVersion: party.version });
        assert.ok(result.ok); if (!result.ok) return; party = result.party;
    }
    await seed(names[3]!, 29);
    const before = await Promise.all(names.map(name => kv.get(`save:${name}`)));
    const body = { hostName: names[0], mode, floor: 1, ascensionTier: 1, partyId: party.id, expectedVersion: party.version, requestId: `launch-${mode}-gate-001` };
    const rejected = await call(startHandler, names[0]!, body);
    assert.equal(rejected.status, 403, JSON.stringify(rejected.body));
    assert.deepEqual(rejected.body?.members, [names[3]]);
    assert.equal(rejected.body?.requiredLevel, 30);
    assert.deepEqual(await Promise.all(names.map(name => kv.get(`save:${name}`))), before);
    assert.equal((await parties.loadTowerParty(party.id))?.status, 'forming');
    for (const name of names) assert.equal(await kv.get(battleLockKey(name)), null);
    await seed(names[3]!, 30);
    const launched = await call(startHandler, names[0]!, body);
    assert.equal(launched.status, 200, JSON.stringify(launched.body));
    assert.equal(launched.body?.session.partySize, 4);
    assert.equal(launched.body?.session.actors.filter((actor: { side: string; ai: boolean }) => actor.side === 'squad' && !actor.ai).length, 4);
});

test('four authenticated humans share one run through reconnect, turn authorization and duplicate command recovery', async () => {
    const join = (await import('./join.js')).default as unknown as typeof partyHandler;
    const action = (await import('./action.js')).default as unknown as typeof partyHandler;
    const state = (await import('./state.js')).default as unknown as typeof partyHandler;
    const party = await parties.activeTowerPartyForPlayer('gate-story-0');
    assert.ok(party?.launch);
    const runId = party.launch.runId;
    const names = Array.from({ length: 4 }, (_, i) => `gate-story-${i}`);
    const views = await Promise.all(names.map(name => call(join, name, { runId, playerName: name, loadout: { maxHp: 999999 } })));
    for (const view of views) { assert.equal(view.status, 200); assert.deepEqual(view.body?.session, views[0]!.body?.session); }
    const before = views[0]!.body!.session as TowerSession;
    assert.equal(before.actors.find(actor => actor.side === 'squad')!.maxHp, 3400, 'rejoining cannot overwrite a sealed loadout');
    const current = activeActor(before)!;
    const wrongPlayer = names.find(name => name !== current.ownerSlug)!;
    const command = { runId, type: 'wait', expectedVersion: towerActionVersion(before), moveToken: 'four-human-wait-token-001' };
    const rejected = await call(action, wrongPlayer, { ...command, playerName: wrongPlayer });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body?.reason, 'not-your-turn');
    const body = { ...command, playerName: current.ownerSlug };
    const accepted = await call(action, current.ownerSlug!, body);
    assert.equal(accepted.body?.applied, true);
    const repeated = await call(action, current.ownerSlug!, body);
    assert.equal(repeated.body?.replayed, true);
    assert.equal(towerActionVersion(repeated.body?.session), towerActionVersion(before) + 1);
    for (const name of names) {
        const recovered = await call(state, name, { runId, playerName: name }, 'GET');
        assert.equal(recovered.status, 200);
        assert.deepEqual(recovered.body?.session, repeated.body?.session);
    }
});

test('four simultaneous state polls do not contend on healthy account leases', async () => {
    const state = (await import('./state.js')).default as unknown as typeof partyHandler;
    const party = await parties.activeTowerPartyForPlayer('gate-story-0');
    assert.ok(party?.launch);
    const names = Array.from({ length: 4 }, (_, index) => `gate-story-${index}`);
    const heldMutex = `lock:${battleLockKey(names[0]!)}`;
    await kv.set(heldMutex, 'unrelated-in-flight-account-operation', { ex: 10 });
    try {
        const views = await Promise.all(names.map(name => call(state, name, {
            runId: party.launch!.runId, playerName: name,
        }, 'GET')));
        for (const view of views) {
            assert.equal(view.status, 200, JSON.stringify(view.body));
            assert.deepEqual(view.body?.session, views[0]!.body?.session);
        }
    } finally {
        await kv.del(heldMutex);
    }
});

test('a contended lease repair returns a retryable response without publishing combat changes', async () => {
    const state = (await import('./state.js')).default as unknown as typeof partyHandler;
    const discover = (await import('./my-run.js')).default as unknown as typeof partyHandler;
    const { readSession } = await import('./_tower-store.js');
    const { ensureTowerBattleLeases } = await import('./_battle-lease.js');
    const party = await parties.activeTowerPartyForPlayer('gate-story-0');
    assert.ok(party?.launch);
    const runId = party.launch.runId;
    const names = Array.from({ length: 4 }, (_, index) => `gate-story-${index}`);
    const before = await readSession(runId);
    await kv.del(battleLockKey(names[3]!));
    const heldMutex = `lock:${battleLockKey(names[0]!)}`;
    await kv.set(heldMutex, 'in-flight-repair', { ex: 10 });
    try {
        for (const handler of [state, discover]) {
            const response = await call(handler, names[0]!, { runId, playerName: names[0] }, 'GET');
            assert.equal(response.status, 503);
            assert.equal(response.body?.errorCode, 'tower-session-busy');
            assert.equal(response.headers['Retry-After'], '1');
        }
        assert.deepEqual(await readSession(runId), before);
        assert.equal(await kv.get(battleLockKey(names[3]!)), null);
    } finally {
        await kv.del(heldMutex);
        await ensureTowerBattleLeases({ runId, members: names, partyId: party.id });
    }
    assert.equal((await call(state, names[0]!, { runId, playerName: names[0] }, 'GET')).status, 200);
});

test('concurrent settlement lease contention requests a retry without changing rewards', async () => {
    const settle = (await import('./settle.js')).default as unknown as typeof partyHandler;
    const { readSession, writeSession } = await import('./_tower-store.js');
    const party = await parties.activeTowerPartyForPlayer('gate-story-0');
    assert.ok(party?.launch);
    const runId = party.launch.runId;
    const session = await readSession(runId);
    assert.ok(session);
    session.status = 'done';
    session.winner = 'enemy';
    await writeSession(session);
    const names = Array.from({ length: 4 }, (_, index) => `gate-story-${index}`);
    const before = await Promise.all(names.map(name => kv.get(`save:${name}`)));
    const heldMutex = `lock:${battleLockKey(names[0]!)}`;
    await kv.set(heldMutex, 'another-settlement-caller', { ex: 10 });
    try {
        const response = await call(settle, names[0]!, { runId, playerName: names[0] });
        assert.equal(response.status, 503);
        assert.equal(response.body?.settled, false);
        assert.equal(response.body?.errorCode, 'tower-session-busy');
        assert.equal(response.headers['Retry-After'], '1');
        assert.deepEqual(await Promise.all(names.map(name => kv.get(`save:${name}`))), before);
        assert.deepEqual(await readSession(runId), session);
    } finally {
        await kv.del(heldMutex);
    }
});
