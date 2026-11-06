import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { onlineStore } from './online-store.js';
import { battleStartedWithin, noteBattleStarted, publishBattleProjection, resetRecentBattleStartsForTests,
    retireBattlePresence, retireBattleProjection } from './battle-projection.js';

const name = 'projection-race';
const key = `battle-state:${name}`;
const projection = (sessionId: string) => ({ version: 1 as const, kind: 'solo-pve' as const,
    sessionId, startedAt: 1, expiresAt: 9999999999999 });
function store() {
    const values = new Map<string, unknown>([[key, projection('old')]]);
    return {
        values,
        async get<T>(key: string) { return (values.get(key) as T) ?? null; },
        async set(key: string, value: unknown) { values.set(key, value); },
        async del(key: string) { values.delete(key); },
        async delIfEqual(key: string, expected: unknown) {
            if (JSON.stringify(values.get(key)) !== JSON.stringify(expected)) return false;
            values.delete(key);
            return true;
        },
    };
}
afterEach(() => { onlineStore.remove(name); resetRecentBattleStartsForTests(); });

it('a replacement between projection read and deletion survives with its presence', async () => {
    const kv = store();
    onlineStore.upsert({ name, sector: 20, character: null });
    noteBattleStarted(name, 10);
    const racing = { ...kv, async get<T>(key: string) {
        const old = await kv.get<T>(key);
        await publishBattleProjection(kv, name, projection('new'), 60);
        noteBattleStarted(name, 10); // Same clock tick must still be a different generation.
        return old;
    } };
    assert.equal(await retireBattlePresence(racing, name, 'old'), false);
    assert.deepEqual(kv.values.get(key), projection('new'));
    assert.equal(onlineStore.get(name)?.inBattle, true);
    assert.equal(battleStartedWithin(name, 11), true);
});

it('a publication after successful CAS but before its acknowledgement retains presence', async () => {
    const kv = store();
    onlineStore.upsert({ name, sector: 20, character: null });
    noteBattleStarted(name, 10);
    const racing = { ...kv, async delIfEqual(key: string, expected: unknown) {
        const removed = await kv.delIfEqual(key, expected);
        await publishBattleProjection(kv, name, projection('new'), 60);
        noteBattleStarted(name, 10);
        return removed;
    } };
    assert.equal(await retireBattlePresence(racing, name, 'old'), true);
    assert.deepEqual(kv.values.get(key), projection('new'));
    assert.equal(onlineStore.get(name)?.inBattle, true);
    assert.equal(battleStartedWithin(name, 11), true);
});

it('publication invalidates cleanup before the new host start hook runs', async () => {
    const kv = store();
    onlineStore.upsert({ name, sector: 20, character: null });
    noteBattleStarted(name);
    const racing = { ...kv, async delIfEqual(key: string, expected: unknown) {
        const removed = await kv.delIfEqual(key, expected);
        await publishBattleProjection(kv, name, projection('new'), 60);
        return removed;
    } };
    assert.equal(await retireBattlePresence(racing, name, 'old'), true);
    assert.equal(onlineStore.get(name)?.inBattle, true);
});

it('matching authority and presence retire together', async () => {
    const kv = store();
    onlineStore.upsert({ name, sector: 20, character: null });
    await publishBattleProjection(kv, name, projection('old'), 60);
    noteBattleStarted(name);
    assert.equal(await retireBattlePresence(kv, name, 'old'), true);
    assert.equal(kv.values.has(key), false);
    assert.equal(Boolean(onlineStore.get(name)?.inBattle), false);
    assert.equal(battleStartedWithin(name), false);
});

it('non-atomic stores fail closed, and failed CAS never clears presence', async () => {
    const kv = store();
    onlineStore.upsert({ name, sector: 20, character: null });
    noteBattleStarted(name);
    assert.equal(await retireBattlePresence({ ...kv, delIfEqual: undefined }, name, 'old'), false);
    assert.equal(await retireBattlePresence({ ...kv, delIfEqual: async () => false }, name, 'old'), false);
    assert.equal(kv.values.has(key), true);
    assert.equal(onlineStore.get(name)?.inBattle, true);
    await assert.rejects(retireBattlePresence({ ...kv, delIfEqual: async () => { throw new Error('unavailable'); } }, name, 'old'));
    assert.equal(onlineStore.get(name)?.inBattle, true);
});

it('compare-set-only adapters atomically expire only the exact projection', async () => {
    const kv = store();
    const adapter = { ...kv, delIfEqual: undefined, async compareSet(key: string, expected: unknown, value: unknown) {
        if (JSON.stringify(kv.values.get(key)) !== JSON.stringify(expected)) return false;
        kv.values.set(key, value);
        return true;
    } };
    assert.equal(await retireBattleProjection(adapter, name, 'old'), true);
    assert.deepEqual(kv.values.get(key), { ...projection('old'), expiresAt: 0 });
});
