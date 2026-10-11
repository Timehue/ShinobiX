import test from 'node:test';
import assert from 'node:assert/strict';
import { createTacticsHandler } from './tactics.js';
import { tacticsPreset } from '../../shared/pet-tactics-roster.js';
import type { TacticsView } from '../../shared/pet-tactics-contract.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { tacticsRoomKey, type TacticsSession } from '../_pet-tactics/session.js';

function harness() {
    const data = new Map<string, unknown>(), queues = new Map<string, Promise<unknown>>();
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
const builds = () => ['starter-fire', 'starter-water', 'starter-lightning', 'starter-earth'].map(id => tacticsPreset(id));
test('two authenticated seats resolve simultaneous HTTP locks once, including concurrent retries across fresh handlers', async () => {
    const h = harness();
    const created = await h.call('alice', { action: 'create', builds: builds() }); assert.equal(created.status, 200);
    const roomId = created.result.roomId;
    assert.equal((await h.call('bob', { action: 'join', roomId, builds: builds() })).status, 200);
    await Promise.all([h.call('alice', { action: 'leads', roomId, leads: [0, 1] }), h.call('bob', { action: 'leads', roomId, leads: [0, 1] })]);
    const a = [{ actorId: 'a-0', kind: 'rest' }, { actorId: 'a-1', kind: 'rest' }];
    const b = [{ actorId: 'b-0', kind: 'rest' }, { actorId: 'b-1', kind: 'rest' }];
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => h.call(i % 2 ? 'alice' : 'bob', { action: 'orders', roomId, round: 1, orders: i % 2 ? a : b }, true)));
    assert.ok(responses.every(r => r.status === 200));
    const saved = h.data.get(tacticsRoomKey(roomId)) as TacticsSession;
    assert.equal(saved.battle!.round, 1); assert.equal(saved.transcript.length, 1);
    assert.equal((await h.call('bob', { action: 'recover' }, true)).result.round, 1);
    assert.equal((await h.call('alice', { action: 'orders', roomId, round: 1, orders: a.map(o => ({ ...o, kind: 'guard' })) })).status, 409);
});
test('HTTP projection rejects outsiders, claimed identities, self-joins and invalid inputs without mutating owned pets or ratings', async () => {
    const h = harness();
    assert.equal((await h.call(null, { action: 'create', builds: builds() })).status, 401);
    const roomId = (await h.call('alice', { action: 'create', builds: builds(), name: 'mallory', winner: 'alice', damage: 9999 })).result.roomId;
    assert.equal((await h.call('alice', { action: 'join', roomId, builds: builds() })).result.seat, 'a'); // Recovers own active room, never claims a second seat.
    assert.equal((await h.call('mallory', { action: 'poll', roomId })).status, 403);
    await h.call('bob', { action: 'join', roomId, builds: builds() });
    await h.call('alice', { action: 'leads', roomId, leads: [2, 3] });
    const bob = (await h.call('bob', { action: 'poll', roomId })).result;
    assert.ok(bob.enemy.every(p => p.slot === null)); assert.equal(bob.ownLeads, null);
    assert.ok([...h.data.keys()].every(key => key.startsWith('pet:tactics:')));
    assert.equal((await h.call('charlie', { action: 'join', roomId, builds: builds() })).status, 409);
});
test('a poll persists deadline resolution even when the accompanying stale action is rejected', async () => {
    const h = harness(); const roomId = (await h.call('alice', { action: 'create', builds: builds() })).result.roomId;
    await h.call('bob', { action: 'join', roomId, builds: builds() });
    await h.call('alice', { action: 'leads', roomId, leads: [0, 1] }); await h.call('bob', { action: 'leads', roomId, leads: [0, 1] });
    h.setNow(46_000);
    const rejected = await h.call('alice', { action: 'orders', roomId, round: 1, orders: [{ kind: 'rest', actorId: 'a-0' }, { kind: 'rest', actorId: 'a-1' }] });
    assert.equal(rejected.status, 409);
    assert.equal((await h.call('bob', { action: 'recover' }, true)).result.round, 1);
});
