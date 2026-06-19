import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    consumeRunToken,
    storeRunToken,
    bumpDailyStartCount,
    settleFloorForMember,
    settleAssistForAlly,
    assistCountKey,
    type TowerKv,
    type TowerLock,
    type RunTokenData,
    MAX_ASSISTS_PER_DAY,
} from './_tower-store.js';
import { computeFloorReward, computeFloorClearScore, type ClearMetrics } from './_tower-rewards.js';
import type { TowerFloor } from './_floor-catalog.js';

const NOW = 1_700_000_000_000;
const now = () => NOW;

function fakeKv(): TowerKv & { store: Map<string, unknown> } {
    const store = new Map<string, unknown>();
    return {
        store,
        async get<T>(key: string) { return (store.has(key) ? store.get(key) : null) as T | null; },
        async set(key, value, opts) {
            if (opts?.nx && store.has(key)) return null;
            store.set(key, value);
            return 'OK';
        },
        async del(...keys: string[]) { let n = 0; for (const k of keys) if (store.delete(k)) n++; return n; },
        async incr(key: string) { const v = (Number(store.get(key)) || 0) + 1; store.set(key, v); return v; },
    };
}
const passLock: TowerLock = async (_t, fn) => fn();
const failLock: TowerLock = async (_t, fn, opts) => { if (opts?.failClosed) throw new Error('contended'); return fn(); };

function floor(over: Partial<TowerFloor> = {}): TowerFloor {
    return {
        id: 5, name: 'Warden', biome: 'volcano', objective: 'defeat-boss', roundBudget: 10,
        map: { width: 20, height: 16 }, fieldRule: { kind: 'none' }, enemies: [],
        firstClearReward: { ryo: 1000, xp: 500, fateShards: 10 }, ...over,
    };
}
function seedSave(kv: TowerKv & { store: Map<string, unknown> }, slug: string, char: Record<string, unknown> = {}) {
    kv.store.set(`save:${slug}`, { character: { ryo: 0, xp: 0, fateShards: 0, ...char } });
}
const METRICS: ClearMetrics = { roundsUsed: 3, squadHpRemaining: 800, squadHpMax: 1000, deaths: 0 };

describe('Battle Towers reward computation', () => {
    it('reward is the SEALED floor reward (cloned), never a client input', () => {
        const f = floor();
        const r = computeFloorReward(f);
        assert.deepEqual(r, { ryo: 1000, xp: 500, fateShards: 10 });
        r.ryo = 999999; // mutating the result must not affect the catalog
        assert.equal(f.firstClearReward.ryo, 1000);
    });

    it('Floor Clear Score rewards speed, survival, and no deaths', () => {
        const f = floor({ roundBudget: 10 });
        const fast = computeFloorClearScore({ roundsUsed: 1, squadHpRemaining: 1000, squadHpMax: 1000, deaths: 0 }, f);
        const slow = computeFloorClearScore({ roundsUsed: 10, squadHpRemaining: 1000, squadHpMax: 1000, deaths: 0 }, f);
        const hurt = computeFloorClearScore({ roundsUsed: 1, squadHpRemaining: 100, squadHpMax: 1000, deaths: 0 }, f);
        const died = computeFloorClearScore({ roundsUsed: 1, squadHpRemaining: 1000, squadHpMax: 1000, deaths: 1 }, f);
        assert.ok(fast > slow, 'faster scores higher');
        assert.ok(fast > hurt, 'more HP left scores higher');
        assert.ok(fast > died, 'no deaths scores higher');
        assert.ok(fast > 0);
    });
});

describe('Battle Towers run token (single-use)', () => {
    it('mints, consumes once, and refuses a second consume', async () => {
        const kv = fakeKv();
        const data: RunTokenData = { host: 'host', members: ['host', 'a'], seed: 1, floor: 5, partySize: 2, mintedAt: NOW };
        await storeRunToken('tok1', data, { kv });
        const first = await consumeRunToken('host', 'tok1', { kv });
        assert.deepEqual(first, data);
        const second = await consumeRunToken('host', 'tok1', { kv });
        assert.equal(second, null, 'token is single-use');
    });

    it('daily start counter increments atomically', async () => {
        const kv = fakeKv();
        assert.equal(await bumpDailyStartCount('host', { kv, now }), 1);
        assert.equal(await bumpDailyStartCount('host', { kv, now }), 2);
    });
});

describe('Battle Towers per-member settlement (idempotent, server-authoritative)', () => {
    it('credits the sealed reward + score exactly once', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice', { ryo: 50 });
        const res = await settleFloorForMember({ runId: 'run1', floor: floor(), slug: 'alice', metrics: METRICS }, { kv, lock: passLock, now });
        assert.equal(res.paid, true);
        const char = (kv.store.get('save:alice') as { character: Record<string, unknown> }).character;
        assert.equal(char.ryo, 1050);
        assert.equal(char.xp, 500);
        assert.equal(char.fateShards, 10);
        assert.equal(char.battleTowerBestFloor, 5);
        assert.equal(char.battleTowerRating, res.score);
        assert.deepEqual(char.battleTowerClearedFloors, [5]);
        assert.deepEqual(char.battleTowerClaimedRewards, ['floor-5']);
    });

    it('a second settle of the SAME run/floor/member pays nothing (NX receipt)', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice');
        await settleFloorForMember({ runId: 'run1', floor: floor(), slug: 'alice', metrics: METRICS }, { kv, lock: passLock, now });
        const ryoAfterFirst = (kv.store.get('save:alice') as { character: { ryo: number } }).character.ryo;
        const res2 = await settleFloorForMember({ runId: 'run1', floor: floor(), slug: 'alice', metrics: METRICS }, { kv, lock: passLock, now });
        assert.equal(res2.paid, false);
        assert.equal(res2.reason, 'already-paid');
        assert.equal((kv.store.get('save:alice') as { character: { ryo: number } }).character.ryo, ryoAfterFirst);
    });

    it('re-clearing a floor in a NEW run pays nothing (one-time first-clear gate)', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice');
        await settleFloorForMember({ runId: 'run1', floor: floor(), slug: 'alice', metrics: METRICS }, { kv, lock: passLock, now });
        const char1 = (kv.store.get('save:alice') as { character: Record<string, unknown> }).character;
        const ratingAfterFirst = char1.battleTowerRating;
        const res2 = await settleFloorForMember({ runId: 'run2', floor: floor(), slug: 'alice', metrics: METRICS }, { kv, lock: passLock, now });
        assert.equal(res2.paid, false);
        assert.equal(res2.reason, 'already-first-cleared');
        const char2 = (kv.store.get('save:alice') as { character: Record<string, unknown> }).character;
        assert.equal(char2.ryo, char1.ryo, 'no extra ryo on re-clear');
        assert.equal(char2.battleTowerRating, ratingAfterFirst, 'rating not double-added');
    });

    it('lock contention pays nothing AND leaves no receipt (clean retry)', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice');
        const res = await settleFloorForMember({ runId: 'run1', floor: floor(), slug: 'alice', metrics: METRICS }, { kv, lock: failLock, now });
        assert.equal(res.paid, false);
        assert.equal(res.reason, 'contended');
        assert.equal(kv.store.has('tower-paid:run1:5:alice'), false, 'no receipt placed under contention');
        // a retry (now uncontended) settles cleanly
        const retry = await settleFloorForMember({ runId: 'run1', floor: floor(), slug: 'alice', metrics: METRICS }, { kv, lock: passLock, now });
        assert.equal(retry.paid, true);
    });
});

describe('Battle Towers borrowed-ally assist (capped, once per run)', () => {
    it('pays a capped fraction once per run', async () => {
        const kv = fakeKv();
        seedSave(kv, 'ally');
        const res = await settleAssistForAlly({ runId: 'run1', floor: floor(), slug: 'ally' }, { kv, lock: passLock, now });
        assert.equal(res.paid, true);
        const char = (kv.store.get('save:ally') as { character: { ryo: number; xp: number } }).character;
        assert.equal(char.ryo, 250, '25% of 1000');
        assert.equal(char.xp, 125, '25% of 500');
        const again = await settleAssistForAlly({ runId: 'run1', floor: floor(), slug: 'ally' }, { kv, lock: passLock, now });
        assert.equal(again.paid, false);
        assert.equal(again.reason, 'assist-already-paid');
    });

    it('enforces the daily assist cap across runs', async () => {
        const kv = fakeKv();
        seedSave(kv, 'ally');
        kv.store.set(assistCountKey('ally', '2023-11-14'), MAX_ASSISTS_PER_DAY); // already at cap today
        const res = await settleAssistForAlly({ runId: 'runX', floor: floor(), slug: 'ally' }, { kv, lock: passLock, now });
        assert.equal(res.paid, false);
        assert.equal(res.reason, 'assist-daily-cap');
    });
});
