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
