import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _makeMemoryKv } from '../_storage.js';
import type { TowerKv, TowerLock } from './_tower-store.js';
import { battleLockKey, TOWER_BATTLE_PUBLICATION_GRACE_MS } from './_battle-lease.js';
import {
    TOWER_PVP_QUEUE_TTL,
    TOWER_PVP_QUEUE_KEY,
    joinTowerPvpQueue,
    readTowerPvpMatch,
    readTowerPvpQueue,
    setTowerPvpReady,
    towerPvpMatchKey,
    towerPvpPlayerKey,
    towerPvpPresence,
    type TowerPvpStoreDeps,
} from './_pvp-store.js';
import { TOWER_PVP_READY_MS, type TowerPvpFighterSeed } from './_pvp-session.js';

const NOW = 1_800_000_000_000;
const MATCH_ID = `tpvp-${'b'.repeat(32)}`;

function keyedLock(): TowerLock {
    const tails = new Map<string, Promise<void>>();
    return async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
        const prior = tails.get(key) ?? Promise.resolve();
        let release = () => {};
        const hold = new Promise<void>(resolve => { release = resolve; });
        const tail = prior.then(() => hold);
        tails.set(key, tail);
        await prior;
        try { return await fn(); }
        finally {
            release();
            if (tails.get(key) === tail) tails.delete(key);
        }
    };
}

function fighter(slug: string, skill: number): TowerPvpFighterSeed {
    return {
        slug,
        displayName: slug.toUpperCase(),
        skill,
        character: {
            name: slug,
            level: 30,
            specialty: 'Taijutsu',
            maxHp: 1_000,
            maxChakra: 100,
            maxStamina: 100,
            stats: { strength: 200, speed: 160, defense: 140 },
            jutsu: [],
            pvpItems: [],
        },
    };
}

const roster = [fighter('alpha', 400), fighter('bravo', 300), fighter('charlie', 200), fighter('delta', 100)];
const request = (slug: string, suffix = '') => `queue-request-${slug}-${suffix || '0001'}`;

function setup(kvInput?: TowerKv): TowerPvpStoreDeps & { kv: TowerKv; clock: { now: number } } {
    const kv = kvInput ?? _makeMemoryKv() as unknown as TowerKv;
    const clock = { now: NOW };
    return {
        kv,
        clock,
        lock: keyedLock(),
        now: () => clock.now,
        id: () => MATCH_ID,
        seed: () => 12345,
        loadFighter: async slug => roster.find(entry => entry.slug === slug) ?? null,
    };
}

async function joinFour(deps: TowerPvpStoreDeps) {
    const results = [];
    for (const seed of roster) results.push(await joinTowerPvpQueue({ fighter: seed, requestId: request(seed.slug) }, deps));
    return results;
}

describe('Tower MPvP queue and ready coordinator', () => {
    it('publishes one exact 2v2 match and recoverable player pointers/leases', async () => {
        const deps = setup();
        const joined = await joinFour(deps);
        assert.deepEqual(joined.slice(0, 3).map(result => result.presence.state), ['queued', 'queued', 'queued']);
        assert.equal(joined[3]?.presence.state, 'matched');
        assert.deepEqual(await readTowerPvpQueue(deps), []);
        const match = await readTowerPvpMatch(MATCH_ID, deps);
        assert.ok(match);
        assert.equal(match.roster.length, 4);
        for (const seed of roster) {
            const pointer = await deps.kv.get<{ state: string; matchId: string }>(towerPvpPlayerKey(seed.slug));
            assert.deepEqual(pointer, { state: 'match', matchId: MATCH_ID });
            const lease = await deps.kv.get<{ battleId: string; meta: { mode?: string } }>(battleLockKey(seed.slug));
            assert.equal(lease?.battleId, MATCH_ID);
            assert.equal(lease?.meta.mode, 'mpvp');
            assert.equal((await towerPvpPresence(seed.slug, deps)).state, 'matched');
        }
    });

    it('recovers a lost player pointer from the exact MPvP battle lease', async () => {
        const deps = setup();
        await joinFour(deps);
        await deps.kv.del(towerPvpPlayerKey('charlie'));
        const recovered = await towerPvpPresence('charlie', deps);
        assert.equal(recovered.state, 'matched');
        assert.deepEqual(await deps.kv.get(towerPvpPlayerKey('charlie')), { state: 'match', matchId: MATCH_ID });
    });

    it('replays any original queue command after its matched response is lost', async () => {
        const deps = setup();
        await joinFour(deps);
        await deps.kv.del(towerPvpPlayerKey('alpha'));
        const replay = await joinTowerPvpQueue({ fighter: roster[0]!, requestId: request('alpha') }, deps);
        assert.equal(replay.replayed, true);
        assert.equal(replay.presence.state, 'matched');
        await assert.rejects(
            joinTowerPvpQueue({ fighter: roster[0]!, requestId: request('alpha', 'different') }, deps),
            /already-matched/,
        );
    });

    it('releases a confirmed-missing MPvP publication lease after grace', async () => {
        const deps = setup();
        await deps.kv.set(battleLockKey('alpha'), {
            battleId: MATCH_ID,
            kind: 'battleTowers',
            screen: 'battleTowers',
            startedAt: NOW - TOWER_BATTLE_PUBLICATION_GRACE_MS - 1,
            meta: { runId: MATCH_ID, mode: 'mpvp' },
        });
        assert.equal((await towerPvpPresence('alpha', deps)).state, 'idle');
        assert.equal(await deps.kv.get(battleLockKey('alpha')), null);
    });

    it('makes same-request join a replay and rejects request-ID drift', async () => {
        const deps = setup();
        const first = await joinTowerPvpQueue({ fighter: roster[0]!, requestId: request('alpha') }, deps);
        assert.equal(first.replayed, false);
        const replay = await joinTowerPvpQueue({ fighter: roster[0]!, requestId: request('alpha') }, deps);
        assert.equal(replay.replayed, true);
        await assert.rejects(
            joinTowerPvpQueue({ fighter: roster[0]!, requestId: request('alpha', '0002') }, deps),
            /already-queued/,
        );
    });

    it('never matches an individually expired queue entry kept alive by later joins', async () => {
        const deps = setup();
        const joinedAt = NOW - TOWER_PVP_QUEUE_TTL * 1_000 - 1;
        await deps.kv.set(TOWER_PVP_QUEUE_KEY, [{
            slug: 'alpha', displayName: 'ALPHA', skill: 400, joinedAt, requestId: request('alpha'),
        }], { ex: TOWER_PVP_QUEUE_TTL });
        await deps.kv.set(towerPvpPlayerKey('alpha'), { state: 'queued', joinedAt }, { ex: TOWER_PVP_QUEUE_TTL });
        assert.deepEqual(await readTowerPvpQueue(deps), []);
        assert.equal((await towerPvpPresence('alpha', deps)).state, 'idle');
        assert.equal(await deps.kv.get(towerPvpPlayerKey('alpha')), null);
    });

    it('serializes concurrent joins for one account', async () => {
        const deps = setup();
        const outcomes = await Promise.allSettled([
            joinTowerPvpQueue({ fighter: roster[0]!, requestId: request('alpha', 'left') }, deps),
            joinTowerPvpQueue({ fighter: roster[0]!, requestId: request('alpha', 'right') }, deps),
        ]);
        assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
        assert.equal(outcomes.filter(outcome => outcome.status === 'rejected').length, 1);
        assert.equal((await readTowerPvpQueue(deps)).filter(entry => entry.slug === 'alpha').length, 1);
    });

    it('evicts a foreign-battle participant instead of partially claiming a cohort', async () => {
        const deps = setup();
        await deps.kv.set(battleLockKey('bravo'), { kind: 'other-mode', battleId: 'foreign' });
        for (const seed of roster) await joinTowerPvpQueue({ fighter: seed, requestId: request(seed.slug) }, deps);
        assert.equal(await readTowerPvpMatch(MATCH_ID, deps), null);
        assert.deepEqual((await readTowerPvpQueue(deps)).map(entry => entry.slug), ['alpha', 'charlie', 'delta']);
        assert.equal(await deps.kv.get(towerPvpPlayerKey('bravo')), null);
        for (const slug of ['alpha', 'charlie', 'delta']) assert.equal(await deps.kv.get(battleLockKey(slug)), null);
    });

    it('recovers a match publication that committed before its acknowledgement was lost', async () => {
        const base = _makeMemoryKv() as unknown as TowerKv;
        let dropped = false;
        const kv: TowerKv = {
            ...base,
            set: async (key, value, options) => {
                const result = await base.set(key, value, options);
                if (!dropped && key === towerPvpMatchKey(MATCH_ID)) {
                    dropped = true;
                    throw new Error('lost acknowledgement');
                }
                return result;
            },
        };
        const deps = setup(kv);
        await joinFour(deps);
        assert.ok(await readTowerPvpMatch(MATCH_ID, deps));
        assert.deepEqual(await readTowerPvpQueue(deps), []);
        assert.equal(dropped, true);
    });

    it('releases every lease when match publication definitely fails', async () => {
        const base = _makeMemoryKv() as unknown as TowerKv;
        const kv: TowerKv = {
            ...base,
            set: async (key, value, options) => key === towerPvpMatchKey(MATCH_ID)
                ? null
                : base.set(key, value, options),
        };
        const deps = setup(kv);
        for (const seed of roster.slice(0, 3)) await joinTowerPvpQueue({ fighter: seed, requestId: request(seed.slug) }, deps);
        await assert.rejects(joinTowerPvpQueue({ fighter: roster[3]!, requestId: request('delta') }, deps), /ID collision/);
        for (const seed of roster) assert.equal(await deps.kv.get(battleLockKey(seed.slug)), null);
        assert.equal(await readTowerPvpMatch(MATCH_ID, deps), null);
    });

    it('never overwrites an existing match on an injected ID collision', async () => {
        const deps = setup();
        const sentinel = { sentinel: 'older-match' };
        await deps.kv.set(towerPvpMatchKey(MATCH_ID), sentinel, { ex: 60 });
        for (const seed of roster.slice(0, 3)) await joinTowerPvpQueue({ fighter: seed, requestId: request(seed.slug) }, deps);
        await assert.rejects(joinTowerPvpQueue({ fighter: roster[3]!, requestId: request('delta') }, deps), /ID collision/);
        assert.deepEqual(await deps.kv.get(towerPvpMatchKey(MATCH_ID)), sentinel);
        for (const seed of roster) assert.equal(await deps.kv.get(battleLockKey(seed.slug)), null);
    });

    it('requires monotonic ready versions and activates on the fourth acknowledgement', async () => {
        const deps = setup();
        await joinFour(deps);
        let match = (await readTowerPvpMatch(MATCH_ID, deps))!;
        const stale = await setTowerPvpReady({
            matchId: MATCH_ID, slug: 'alpha', ready: true,
            requestId: 'ready-alpha-stale-0001', expectedVersion: 99,
        }, deps);
        assert.equal(stale.ok, false);
        if (!stale.ok) assert.equal(stale.code, 'stale-version');

        for (const slug of ['alpha', 'delta', 'bravo', 'charlie']) {
            const result = await setTowerPvpReady({
                matchId: MATCH_ID, slug, ready: true,
                requestId: `ready-${slug}-request-1`, expectedVersion: match.version,
            }, deps);
            assert.equal(result.ok, true);
            if (!result.ok || !result.match) assert.fail('ready failed');
            match = result.match;
        }
        assert.equal(match.status, 'active');
        assert.ok(match.roster.every(member => member.ready));
        assert.equal(match.combat.turnQueue.length, 4);
        assert.equal(match.version, 4);
    });

    it('acknowledges a lost ready response by request ID even with a stale version', async () => {
        const deps = setup();
        await joinFour(deps);
        const command = {
            matchId: MATCH_ID, slug: 'alpha', ready: true,
            requestId: 'ready-alpha-replay-001', expectedVersion: 0,
        };
        const first = await setTowerPvpReady(command, deps);
        assert.equal(first.ok, true);
        const replay = await setTowerPvpReady(command, deps);
        assert.equal(replay.ok, true);
        if (replay.ok) assert.equal(replay.replayed, true);
        assert.equal((await readTowerPvpMatch(MATCH_ID, deps))?.version, 1);
    });

    it('cancels an expired ready check and releases all four battle leases', async () => {
        const deps = setup();
        await joinFour(deps);
        deps.clock.now += TOWER_PVP_READY_MS + 1;
        const result = await setTowerPvpReady({
            matchId: MATCH_ID, slug: 'alpha', ready: true,
            requestId: 'ready-alpha-expired-01', expectedVersion: 0,
        }, deps);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.code, 'ready-timeout');
        assert.equal((await readTowerPvpMatch(MATCH_ID, deps))?.status, 'cancelled');
        for (const seed of roster) assert.equal(await deps.kv.get(battleLockKey(seed.slug)), null);
    });

    it('keeps MPvP state outside the reward-bearing tower session namespace', async () => {
        const deps = setup();
        await joinFour(deps);
        assert.ok(await deps.kv.get(towerPvpMatchKey(MATCH_ID)));
        assert.equal(await deps.kv.get(`tower:${MATCH_ID}`), null);
        assert.equal(await deps.kv.get(TOWER_PVP_QUEUE_KEY), null);
    });
});
