import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kv } from '../_storage.js';
import { worldBossEventKey, type WorldBossEventRecord } from './_event.js';
import { depositWorldBossHollowShards, type WorldBossCrystalDepositResult } from './_crystals.js';

test('Hollow Shard turn-in request replays award points exactly once', async t => {
    const now = 1_000_000;
    const event: WorldBossEventRecord = {
        version: 1,
        eventId: 'crystal-deposit-event',
        bossId: 'hollow-beast',
        bossName: 'Chicxulub',
        status: 'roaming',
        startedAt: now - 1_000,
        roamEndsAt: now + 10_000,
        endsAt: now + 20_000,
        endedAt: null,
        hpMax: 100_000,
        hp: 100_000,
        participants: {},
        settledMatchIds: [],
        hollowShardsHeldByPlayer: { miner: 2 },
        updatedAt: now,
    };
    const records = new Map<string, unknown>([[worldBossEventKey(event.eventId), structuredClone(event)]]);
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

    const player = { slug: 'miner', name: 'Miner', village: '', clan: '' };
    const attempts = await Promise.all([
        depositWorldBossHollowShards(event.eventId, player, 'repeatable-request-1234', now),
        depositWorldBossHollowShards(event.eventId, player, 'repeatable-request-1234', now + 1),
    ]);
    const successful = attempts.filter((result): result is Extract<WorldBossCrystalDepositResult, { ok: true }> => result.ok);
    assert.equal(successful.length, 2);
    assert.deepEqual(successful.map(result => result.replayed).sort(), [false, true]);
    assert.equal(successful[0]!.deposited, 2);
    assert.equal(successful[1]!.points, successful[0]!.points);

    const persisted = records.get(worldBossEventKey(event.eventId)) as WorldBossEventRecord;
    assert.equal(persisted.hollowShardsHeldByPlayer?.miner, 0);
    assert.equal(persisted.hollowShardsDeposited, 2);
    assert.equal(persisted.crystalDepositReceipts?.['miner:repeatable-request-1234']?.points, 2_000);
    assert.equal(persisted.participants.miner?.crystalPoints, 2_000);
    const secondRequest = await depositWorldBossHollowShards(event.eventId, player, 'different-request-12345', now + 2);
    assert.deepEqual(secondRequest, { ok: false, error: 'You have no Hollow Shards ready to turn in.' });
});
