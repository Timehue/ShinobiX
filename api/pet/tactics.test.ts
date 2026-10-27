import test from 'node:test';
import assert from 'node:assert/strict';
import { createTacticsHandler } from './tactics.js';
import type { TacticsView } from '../../shared/pet-tactics-contract.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { tacticsRoomKey, type TacticsSession } from '../_pet-tactics/session.js';

// Pet Arena fights with each player's real companions (owner ruling
// 2026-10-26): the browser sends four carried pet ids, never a stat.
const PET_IDS = ['p1', 'p2', 'p3', 'p4'];
const save = (name: string) => ({ character: { name, level: 40, pets: PET_IDS.map((id, i) => ({
    id, name: `${name} pet ${i}`, element: 'Water', role: 'defender', rarity: 'rare', level: 35,
    hp: 900, attack: 110, defense: 110, speed: 90, jutsus: [{ name: 'Tide Slap', power: 90, kind: 'damage' }],
})) } });

function harness() {
    const data = new Map<string, unknown>(), queues = new Map<string, Promise<unknown>>();
    for (const name of ['alice', 'bob', 'charlie', 'mallory']) data.set(`save:${name}`, save(name));
    let now = 1000, code = 0;
    const deps = {
        store: { get: async (key: string) => structuredClone(data.get(key) ?? null), set: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); } },
        lock: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
            const prior = queues.get(key) ?? Promise.resolve();
            const next = prior.catch(() => undefined).then(fn); queues.set(key, next);
            try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
        },
        authenticate: async (req: VercelRequest) => typeof req.headers['x-test-player'] === 'string' ? req.headers['x-test-player'] : null,
        limit: async () => true, now: () => now, roomId: () => (++code).toString(16).padStart(8, '0'), seed: () => 13,
    };
    const handler = createTacticsHandler(deps);
    const call = async (name: string | null, body: Record<string, unknown>, fresh = false) => {
        let status = 200, result: unknown;
        const req = { method: 'POST', headers: name ? { 'x-test-player': name } : {}, body } as unknown as VercelRequest;
        const res = { setHeader() {}, status(n: number) { status = n; return this; }, json(value: unknown) { result = value; return this; }, end() {} } as unknown as VercelResponse;
        await (fresh ? createTacticsHandler(deps) : handler)(req, res);
        return { status, result: result as TacticsView & { error?: string } };
    };
    return { call, data, setNow: (value: number) => { now = value; } };
}
const rest = (seat: 'a' | 'b') => [{ petId: `${seat}:p1`, kind: 'rest' }, { petId: `${seat}:p2`, kind: 'rest' }];

test('two authenticated seats resolve simultaneous HTTP locks once, including concurrent retries across fresh handlers', async () => {
    const h = harness();
    const created = await h.call('alice', { action: 'create', petIds: PET_IDS }); assert.equal(created.status, 200);
    assert.equal(created.result.engine, 'showdown-v1');
    const roomId = created.result.roomId;
    assert.equal((await h.call('bob', { action: 'join', roomId, petIds: PET_IDS })).status, 200);
    await Promise.all([h.call('alice', { action: 'leads', roomId, leads: [0, 1] }), h.call('bob', { action: 'leads', roomId, leads: [0, 1] })]);
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => h.call(i % 2 ? 'alice' : 'bob', { action: 'orders', roomId, round: 1, orders: i % 2 ? rest('a') : rest('b') }, true)));
    assert.ok(responses.every(r => r.status === 200), JSON.stringify(responses.map(r => r.result?.error)));
    const saved = h.data.get(tacticsRoomKey(roomId)) as TacticsSession;
    assert.equal(saved.arena!.round, 1); assert.equal(saved.arenaTranscript!.length, 1);
    assert.equal((await h.call('bob', { action: 'recover' }, true)).result.round, 1);
    assert.equal((await h.call('alice', { action: 'orders', roomId, round: 1, orders: rest('a').map(o => ({ ...o, kind: 'guard' })) })).status, 409);
});

test('HTTP projection rejects outsiders, claimed identities, self-joins and invalid inputs without touching saves', async () => {
    const h = harness();
    const before = structuredClone([...h.data.entries()].filter(([key]) => key.startsWith('save:')));
    assert.equal((await h.call(null, { action: 'create', petIds: PET_IDS })).status, 401);
    assert.equal((await h.call('alice', { action: 'create', petIds: ['p1', 'p2', 'p3'] })).status, 400);
    assert.equal((await h.call('alice', { action: 'create', petIds: ['p1', 'p2', 'p3', 'stolen'] })).status, 409);
    const roomId = (await h.call('alice', { action: 'create', petIds: PET_IDS, name: 'mallory', winner: 'alice', damage: 9999, stats: { attack: 1e9 } })).result.roomId;
    assert.equal((await h.call('alice', { action: 'join', roomId, petIds: PET_IDS })).result.seat, 'a'); // Recovers own active room, never claims a second seat.
    assert.equal((await h.call('mallory', { action: 'poll', roomId })).status, 403);
    await h.call('bob', { action: 'join', roomId, petIds: PET_IDS });
    await h.call('alice', { action: 'leads', roomId, leads: [2, 3] });
    const bob = (await h.call('bob', { action: 'poll', roomId })).result;
    assert.ok(bob.battle.enemy.every(p => !p.benched), 'a locked lead stays private until both seats lock');
    assert.equal(bob.ownLeads, null);
    assert.ok(bob.battle.enemy.every(p => p.maxHp < 1e6), 'stats come from the save, not the request');
    assert.equal((await h.call('bob', { action: 'orders', roomId, round: 1, orders: rest('a') })).status, 409);
    assert.equal((await h.call('charlie', { action: 'join', roomId, petIds: PET_IDS })).status, 409);
    assert.deepEqual([...h.data.entries()].filter(([key]) => key.startsWith('save:')), before, 'Pet Arena never writes a save');
});

test('a poll persists deadline resolution even when the accompanying stale action is rejected', async () => {
    const h = harness(); const roomId = (await h.call('alice', { action: 'create', petIds: PET_IDS })).result.roomId;
    await h.call('bob', { action: 'join', roomId, petIds: PET_IDS });
    await h.call('alice', { action: 'leads', roomId, leads: [0, 1] }); await h.call('bob', { action: 'leads', roomId, leads: [0, 1] });
    h.setNow(46_000);
    const rejected = await h.call('alice', { action: 'orders', roomId, round: 1, orders: rest('a') });
    assert.equal(rejected.status, 409);
    assert.equal((await h.call('bob', { action: 'recover' }, true)).result.round, 1);
});
