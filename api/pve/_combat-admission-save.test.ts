import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'combat-admission-regression-secret';
let kv: typeof import('../_storage.js').kv;
let admission: typeof import('./_combat-admission-save.js').withCombatAdmissionSave;
let elapsed: typeof import('../_elapsed-state.js');
let mutations: typeof import('../save/_mutate-player-save.js');
type Json = Record<string, unknown>;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ withCombatAdmissionSave: admission } = await import('./_combat-admission-save.js'));
    elapsed = await import('../_elapsed-state.js');
    mutations = await import('../save/_mutate-player-save.js');
});
const NOW = Date.UTC(2026, 9, 29, 12);
const tired = (name: string) => ({ _saveVersion: 1, _saveAt: NOW - 60_000, _regenAt: NOW - 60_000,
    character: { name, level: 100, rank: 'Special Jonin', hp: 5000, maxHp: 10000, chakra: 4000, maxChakra: 10000,
        stamina: 3000, maxStamina: 10000, stats: {}, equipment: {}, inventory: [], itemStacks: [], jutsu: [] } });

test('combat snapshot settles elapsed vitals, persists them and holds the save lease through publication', async t => {
    t.mock.method(Date, 'now', () => NOW);
    const name = 'admissionelapsed';
    await kv.set(`save:${name}`, tired(name));
    await admission(name, async save => {
        assert.ok(await kv.get(`lock:save:${name}`));
        const character = save.character as Json;
        const gain = 60 * elapsed.vitalRegenPerTick(10000);
        assert.equal(character.hp, 5000 + gain);
        assert.equal(character.chakra, 4000 + gain);
        assert.equal(character.stamina, 3000 + gain);
        assert.equal(save._regenAt, NOW);
        assert.deepEqual(await kv.get(`save:${name}`), save);
    });
    assert.equal(await kv.get(`lock:save:${name}`), null);
});

test('solo battle projections exclude idle healing on owner reads and authoritative mutations', async t => {
    t.mock.method(Date, 'now', () => NOW);
    for (const expiresAt of [NOW + 60000, NOW - 1000]) {
        const name = `admissionsolo${expiresAt > NOW ? 'active' : 'lapsed'}`;
        const record = tired(name);
        await kv.set(`save:${name}`, record);
        await kv.set(`battle-state:${name}`, { version: 1, kind: 'solo-pve', sessionId: 'sealed-session', startedAt: NOW - 60000, expiresAt });
        const read = await elapsed.settleSaveRecordForRead(name, record);
        assert.equal((read.record.character as Json).hp, 5000);
        const settled = await mutations.settleIdleRecovery(kv, name, record);
        assert.equal(settled.character.hp, 5000);
        assert.equal(settled.regen.excluded, true);
        const write = await mutations.mutatePlayerSave(name, ({ character }) => ({ ok: true, character: { ...character, ryo: 1 }, value: null }));
        assert.ok(write.ok);
        assert.equal(write.character.hp, 5000);
        assert.equal(write.record._regenAt, NOW);
    }
});

test('admission carries the settled cursor including its subsecond remainder at full vitals', async t => {
    t.mock.method(Date, 'now', () => NOW);
    const name = 'admissionfullcursor';
    const save = tired(name);
    await kv.set(`save:${name}`, { ...save, _regenAt: NOW - 60_500,
        character: { ...save.character, hp: 10000, chakra: 10000, stamina: 10000 } });
    await admission(name, async committed => {
        assert.equal(committed._regenAt, NOW - 500);
        assert.equal((committed.character as Json).hp, 10000);
    });
});

test('S-rank combat starts with regenerated HP and resumes the sealed fight without healing again', async t => {
    let now = NOW;
    t.mock.method(Date, 'now', () => now);
    const name = 'admissionmission';
    await kv.set(`save:${name}`, tired(name));
    const { issuePlayerToken } = await import('../_auth.js');
    const handler = (await import('../missions/combat-start.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    const call = async () => {
        const result = { status: 200, body: {} as Json };
        const res = { setHeader: () => res, status: (status: number) => { result.status = status; return res; },
            json: (body: Json) => { result.body = body; return res; }, end: () => res };
        await handler({ method: 'POST', body: { playerName: name, missionId: 'combat-s-crisis' },
            headers: { 'x-player-token': issuePlayerToken(name) }, socket: { remoteAddress: '203.0.113.171' } } as never, res as never);
        return result;
    };
    const first = await call();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body._saveVersion, 2);
    const session = first.body.session as { player: { hp: number }; sessionId: string };
    assert.equal(session.player.hp, 5000 + 60 * elapsed.vitalRegenPerTick(10000));
    const save = await kv.get(`save:${name}`);
    now += 60_000;
    const resumed = await call();
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.resumed, true);
    assert.deepEqual(resumed.body.session, first.body.session);
    assert.deepEqual(await kv.get(`save:${name}`), save);
});

test('generic AI admission settles HP and an explicit resume keeps the sealed combat and save version', async t => {
    let now = NOW;
    t.mock.method(Date, 'now', () => now);
    const name = 'admissiongeneric';
    await kv.set(`save:${name}`, tired(name));
    const { issuePlayerToken } = await import('../_auth.js');
    const handler = (await import('../missions/ai-fight-start.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    const call = async (resume = false) => {
        const out = { status: 200, body: {} as Json };
        const res = { setHeader: () => res, status: (status: number) => { out.status = status; return res; },
            json: (body: Json) => { out.body = body; return res; }, end: () => res };
        await handler({ method: 'POST', body: { playerName: name, battleKind: 'practice', opponentId: 'builtin-ai-academy-sparring', ...(resume ? { resumeAiFight: true } : {}) },
            headers: { 'x-player-token': issuePlayerToken(name) }, socket: { remoteAddress: '203.0.113.173' } } as never, res as never);
        return out;
    };
    const first = await call();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal((first.body.session as { player: { hp: number } }).player.hp, 5000 + 60 * elapsed.vitalRegenPerTick(10000));
    assert.equal(first.body._saveVersion, 2);
    const saved = await kv.get(`save:${name}`);
    now += 60_000;
    const resumed = await call(true);
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.resumed, true);
    assert.equal(resumed.body._saveVersion, 2);
    assert.deepEqual(resumed.body.session, first.body.session);
    assert.deepEqual(await kv.get(`save:${name}`), saved);

    const { writeSoloPveSession, repairSoloPveTerminalPublication } = await import('../solo-pve/_store.js');
    const live = first.body.session as import('../solo-pve/_session.js').SoloPveSession;
    const done = { ...live, status: 'done' as const, winner: 'enemy' as const, outcome: 'fled' as const, version: live.version + 1 };
    const originalGet = kv.get.bind(kv);
    let failFence = true;
    t.mock.method(kv, 'get', async (...args: Parameters<typeof kv.get>) => {
        if (failFence && args[0] === `save:${name}`) { failFence = false; throw new Error('recovery fence unavailable'); }
        return originalGet(...args);
    });
    await assert.rejects(writeSoloPveSession(done), /recovery fence unavailable/);
    assert.equal((await kv.get<Json>(`battle-state:${name}`))?.sessionId, live.sessionId, 'a failed fence keeps recovery blocked');
    await repairSoloPveTerminalPublication(done);
    assert.equal(await kv.get(`battle-state:${name}`), null);
    const fenced = await kv.get<Json>(`save:${name}`);
    assert.equal((fenced?.character as Json).hp, ((saved as Json).character as Json).hp);
    assert.equal(fenced?._regenAt, now, 'the minute spent fighting is discarded before retiring the projection');
    await writeSoloPveSession(done);
    assert.deepEqual(await kv.get(`save:${name}`), fenced, 'a repeated terminal write does not fence a second time');
    now += 2000;
    const idle = await elapsed.settleSaveRecordForRead(name, fenced!);
    assert.equal((idle.record.character as Json).hp, Number((fenced?.character as Json).hp) + 2 * elapsed.vitalRegenPerTick(10000));
});

test('prepared Solo-PvE charges settle only their own pre-publication recovery', async t => {
    t.mock.method(Date, 'now', () => NOW);
    const name = 'admissionprepared';
    await kv.set(`save:${name}`, tired(name));
    await kv.set(`battle-state:${name}`, { version: 1, kind: 'solo-pve', sessionId: 'prepared', startedAt: NOW - 30_000, expiresAt: NOW + 60000 });
    const other = await mutations.mutatePlayerSave(name, ({ character }) => {
        assert.equal(character.hp, 5000, 'an unrelated start cannot claim the prepared run’s recovery');
        return { ok: true, character, value: null, write: false };
    }, { ownSoloBattle: 'other-run' });
    assert.ok(other.ok);
    const charged = await mutations.mutatePlayerSave(name, ({ character }) => ({
        ok: true, character: { ...character, stamina: Number(character.stamina) - 20 }, value: null,
    }), { ownSoloBattle: 'prepared' });
    assert.ok(charged.ok);
    assert.equal(charged.character.hp, 5000 + 30 * elapsed.vitalRegenPerTick(10000));
    assert.equal(charged.record._regenAt, NOW);
});

test('concurrent starts of different missions admit only one fight after both read an empty held index', async t => {
    t.mock.method(Date, 'now', () => NOW);
    const name = 'admissionconcurrent';
    await kv.set(`save:${name}`, tired(name));
    const { heldFightsKey } = await import('../solo-pve/_held-fight-index.js');
    const { issuePlayerToken } = await import('../_auth.js');
    const handler = (await import('../missions/combat-start.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    const original = kv.hgetall.bind(kv);
    let reads = 0;
    let release!: () => void;
    const bothRead = new Promise<void>(resolve => { release = resolve; });
    t.mock.method(kv, 'hgetall', async (...args: Parameters<typeof kv.hgetall>) => {
        const result = await original(...args);
        if (args[0] === heldFightsKey(name) && ++reads <= 2) {
            if (reads === 2) release();
            await bothRead;
        }
        return result;
    });
    const call = async (missionId: string) => {
        const out = { status: 200, body: {} as Json };
        const res = { setHeader: () => res, status: (status: number) => { out.status = status; return res; },
            json: (body: Json) => { out.body = body; return res; }, end: () => res };
        await handler({ method: 'POST', body: { playerName: name, missionId },
            headers: { 'x-player-token': issuePlayerToken(name) }, socket: { remoteAddress: '203.0.113.172' } } as never, res as never);
        return out;
    };
    const results = await Promise.all([call('combat-a-hunt'), call('combat-s-crisis')]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409], JSON.stringify(results));
    const accepted = results.find(result => result.status === 200)!;
    assert.equal(results.find(result => result.status === 409)!.body.errorCode, 'combat-active');
    const held = await original(heldFightsKey(name));
    assert.deepEqual(Object.keys(held ?? {}), [accepted.body.runId]);
    assert.equal((await kv.get<Json>(`save:${name}`))?._saveVersion, 2, 'the refused start does not commit again');
    assert.equal((await kv.get<Json>(`battle-state:${name}`))?.sessionId, accepted.body.runId);
});
