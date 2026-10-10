import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { kv } from '../_storage.js';
import {
    readWorldBossEvent,
    worldBossEventKey,
    worldBossMatchKey,
    worldBossQueueKey,
    type WorldBossEventRecord,
    type WorldBossMatchRecord,
} from './_event.js';
import {
    finalizeWorldBossTopCacheRecipients,
    rememberWorldBossTopCacheEvent,
    settlePendingWorldBossTopCaches,
} from './_top-cache.js';

function installMemoryStore(t: TestContext, initial: Array<[string, unknown]>) {
    const records = new Map(initial.map(([key, value]) => [key, structuredClone(value)]));
    t.mock.method(kv, 'get', async <T>(key: string): Promise<T | null> => {
        const value = records.get(key);
        return value === undefined ? null : structuredClone(value) as T;
    });
    t.mock.method(kv, 'set', async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (options?.nx && records.has(key)) return null;
        records.set(key, structuredClone(value));
        return 'OK';
    });
    t.mock.method(kv, 'delIfEqual', async (key: string, expected: string) => {
        if (records.get(key) !== expected) return false;
        records.delete(key);
        return true;
    });
    return records;
}

function victoryEvent(deadline: number): WorldBossEventRecord {
    return {
        version: 1,
        eventId: 'top-cache-event',
        bossId: 'hollow-beast',
        bossName: 'Chicxulub',
        status: 'victory',
        startedAt: 10,
        roamEndsAt: 20,
        endsAt: 30,
        endedAt: 100,
        hpMax: 100,
        hp: 0,
        participants: {
            alpha: { slug: 'alpha', name: 'Alpha', village: '', clan: '', damage: 400, score: 0, hollowShardsDeposited: 0, crystalPoints: 0, actions: 1, matches: 1, firstAt: 50 },
        },
        settledMatchIds: ['winning-match'],
        topCacheSettlementDeadlineAt: deadline,
        updatedAt: 100,
    };
}

function activeMatch(): WorldBossMatchRecord {
    return {
        matchId: 'pending-match',
        eventId: 'top-cache-event',
        runId: 'world-boss-run',
        status: 'active',
        members: [],
        createdAt: 80,
        startedAt: 80,
        matchHp: 20_000,
    };
}

function stored(t: TestContext, deadline: number) {
    return installMemoryStore(t, [
        [worldBossEventKey('top-cache-event'), victoryEvent(deadline)],
        [worldBossQueueKey('top-cache-event'), { tickets: [], activeMatchIds: ['pending-match'], updatedAt: 80 }],
        [worldBossMatchKey('top-cache-event', 'pending-match'), activeMatch()],
    ]);
}

test('top-cache snapshot waits for already-active matches and includes their settled contribution', async t => {
    const records = stored(t, 10_000);
    assert.equal(await finalizeWorldBossTopCacheRecipients('top-cache-event', 200), false);
    assert.equal((await readWorldBossEvent('top-cache-event'))?.topCacheRecipients, undefined);

    const event = structuredClone(records.get(worldBossEventKey('top-cache-event')) as WorldBossEventRecord);
    event.participants.beta = {
        slug: 'beta', name: 'Beta', village: '', clan: '', damage: 2_000, score: 0,
        hollowShardsDeposited: 0, crystalPoints: 0, actions: 1, matches: 1, firstAt: 80,
    };
    records.set(worldBossEventKey('top-cache-event'), event);
    const match = structuredClone(records.get(worldBossMatchKey('top-cache-event', 'pending-match')) as WorldBossMatchRecord);
    match.status = 'settled';
    records.set(worldBossMatchKey('top-cache-event', 'pending-match'), match);

    assert.equal(await finalizeWorldBossTopCacheRecipients('top-cache-event', 250), true);
    const finalized = await readWorldBossEvent('top-cache-event');
    assert.deepEqual(finalized?.topCacheRecipients, [
        { slug: 'beta', name: 'Beta', rank: 1 },
        { slug: 'alpha', name: 'Alpha', rank: 2 },
    ]);
    assert.equal(finalized?.topCacheSnapshotExpired, false);
});

test('top-cache snapshot has a bounded recovery path when an active match is abandoned', async t => {
    const records = stored(t, 500);
    assert.equal(await finalizeWorldBossTopCacheRecipients('top-cache-event', 500), true);
    const finalized = await readWorldBossEvent('top-cache-event');
    assert.deepEqual(finalized?.topCacheRecipients, [{ slug: 'alpha', name: 'Alpha', rank: 1 }]);
    assert.equal(finalized?.topCacheSnapshotExpired, true);
});

test('pending top-cache events survive event rotation and finalize after the recovery cutoff', async t => {
    const event = victoryEvent(500);
    event.participants = {};
    const records = installMemoryStore(t, [
        [worldBossEventKey('top-cache-event'), event],
        [worldBossQueueKey('top-cache-event'), { tickets: [], activeMatchIds: ['pending-match'], updatedAt: 80 }],
        [worldBossMatchKey('top-cache-event', 'pending-match'), activeMatch()],
    ]);
    await rememberWorldBossTopCacheEvent('top-cache-event');
    const pendingKey = 'world-boss-event:pending-top-cache-events';
    assert.deepEqual(records.get(pendingKey), ['top-cache-event']);

    await settlePendingWorldBossTopCaches(499);
    assert.equal((await readWorldBossEvent('top-cache-event'))?.topCacheRecipients, undefined);
    assert.deepEqual(records.get(pendingKey), ['top-cache-event']);

    await settlePendingWorldBossTopCaches(500);
    assert.deepEqual((await readWorldBossEvent('top-cache-event'))?.topCacheRecipients, []);
    assert.deepEqual(records.get(pendingKey), []);
});
