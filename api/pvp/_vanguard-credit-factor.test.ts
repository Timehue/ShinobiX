import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { _makeMemoryKv, kv } from '../_storage.js';
import type { PvpSession } from './session.js';
import { grantVanguardRewardsForSession } from './_vanguard-rewards.js';
import { pvpPairCounterKey, pvpUtcDay } from './_valid-fight.js';

// The legacy grant (no V2 stamp) reads the shared kv, which picks its backend
// on first use, so these flags still apply despite the hoisted imports.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
delete process.env.ENABLE_VANGUARD_REWARD_V2;

// I-17: Vanguard profession XP follows the fight's PvP credit, so one willing
// friend can no longer level a Vanguard (rank 10 used to take ~38 wins in a day).

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const lock = async <T>(_key: string, action: () => Promise<T>): Promise<T> => action();

async function setup() {
    const store = _makeMemoryKv();
    await store.set('save:alice', { _saveVersion: 1, character: {
        name: 'Alice', profession: 'vanguard', professionRank: 1, professionXp: 0, level: 50, honorSeals: 0,
    } });
    await store.set('save:bob', { _saveVersion: 1, character: { name: 'Bob', level: 50 } });
    const session = (id: string, o: { round?: number; fleed?: boolean; durationMs?: number } = {}) => ({
        battleId: `pvp-vanguard-factor-${id}`,
        status: 'done', winner: 'p1', rewardAuthority: 'challenge',
        vanguardRewardAuthorityVersion: 2,
        round: o.round ?? 4,
        ...(o.fleed ? { fleedBy: 'p2' } : {}),
        p1: { name: 'Alice', hp: 900, maxHp: 1000, character: { profession: 'vanguard', professionRank: 1, level: 50 } },
        p2: { name: 'Bob', hp: o.fleed ? 800 : 0, maxHp: 1000, character: { level: 50 } },
        joined: { p1: true, p2: true }, realFighters: { p1: true, p2: true },
        baseRewards: true, createdAt: NOW - (o.durationMs ?? 70_000), endedAt: NOW, lastMoveAt: NOW,
    } as unknown as PvpSession);
    const grant = (battle: PvpSession) => grantVanguardRewardsForSession(battle, {
        store, lock, now: NOW + 1, overlap: async () => false,
    });
    return { store, session, grant };
}

test('Vanguard XP beating one friend five times in a day pays x 1, 1, 0.5, 0.25, 0', async () => {
    const { store, session, grant } = await setup();
    const xp: number[] = [];
    for (let i = 0; i < 5; i += 1) xp.push(Number((await grant(session(`repeat-${i}`))).xp ?? 0));
    // vanguardXpForLevel(50) = 300 at rank 1.
    assert.deepEqual(xp, [300, 300, 150, 75, 0]);
    assert.equal(await store.get(pvpPairCounterKey('alice', 'bob', '2026-10-21')), 5);
    // The later claim of the same battle reads the same slot, not a new one.
    assert.equal(await store.get('pvp:pairslot:pvp-vanguard-factor-repeat-2'), 3);
});

test('a pair-exhausted win pays no Vanguard XP but keeps its seals (seals have their own caps)', async () => {
    const { store, session, grant } = await setup();
    // Four fights with Bob already today: this is the fifth, weight 0.
    await store.set(pvpPairCounterKey('alice', 'bob', '2026-10-21'), 4);
    const out = await grant(session('exhausted'));
    assert.equal(out.xp ?? 0, 0);
    assert.equal(out.seals, 1, 'rank 1 still earns its 1 seal: the owner seal table is not scaled');
    const saved = (await store.get<Record<string, any>>('save:alice'))!.character;
    assert.equal(saved.professionXp, 0);
    assert.equal(saved.honorSeals, 1);
});

test('a short flee win pays no Vanguard XP', async () => {
    const { grant, session } = await setup();
    const out = await grant(session('flee', { round: 1, fleed: true, durationMs: 20_000 }));
    assert.equal(out.xp ?? 0, 0);
});

test('a V2 replay pays the sealed XP even after the pair has been fought out', async () => {
    const { store, session, grant } = await setup();
    const battle = session('sealed');
    const first = await grant(battle);
    assert.equal(first.xp, 300);
    // A fresh pricing of this battle would now be the pair's 11th fight (weight 0).
    await store.del('pvp:pairslot:pvp-vanguard-factor-sealed');
    await store.set(pvpPairCounterKey('alice', 'bob', '2026-10-21'), 10);
    await grant(battle);
    const saved = (await store.get<Record<string, any>>('save:alice'))!.character;
    assert.equal(saved.professionXp, 300, 'the replay neither re-pays nor re-prices the sealed XP');
});

/*
 * The legacy grant (casual fights without the V2 authority stamp) applies the
 * same credit factor, and since the 2026-10 rebalance it pays XP on a
 * seal-capped win the way V2 always has. Before, a rank-5+ Vanguard (3 seals a
 * kill fills the 3-per-target cap) earned XP from only the first win over each
 * opponent a day on this path, and every win on V2.
 */
describe('the legacy Vanguard grant', { concurrency: false }, () => {
    const today = () => new Date().toISOString().slice(0, 10);
    const XP_FOR_RANK = { 2: 100, 5: 1850 } as const;
    async function seed(rank: 2 | 5, extra: Record<string, unknown> = {}) {
        await kv.set('save:alice', { _saveVersion: 1, character: {
            name: 'Alice', profession: 'vanguard', professionRank: rank, professionXp: XP_FOR_RANK[rank], level: 50, honorSeals: 10, ...extra,
        } });
        await kv.set('save:bob', { _saveVersion: 1, character: { name: 'Bob', level: 50 } });
    }
    function legacyBattle(id: string): PvpSession {
        const now = Date.now();
        return {
            battleId: `pvp-vanguard-legacy-${id}`,
            status: 'done', winner: 'p1', rewardAuthority: 'challenge', round: 4,
            p1: { name: 'Alice', hp: 900, maxHp: 1000, character: { profession: 'vanguard', level: 50 } },
            p2: { name: 'Bob', hp: 0, maxHp: 1000, character: { level: 50 } },
            joined: { p1: true, p2: true }, realFighters: { p1: true, p2: true },
            baseRewards: true, createdAt: now - 70_000, endedAt: now, lastMoveAt: now,
        } as unknown as PvpSession;
    }
    const alice = async () => (await kv.get<Record<string, any>>('save:alice'))!.character;

    beforeEach(async () => {
        for (const key of await kv.keys('*')) await kv.del(key);
    });

    test('applies the pair weight: the third fight with one friend pays half', async () => {
        await seed(2);
        const battle = legacyBattle('half');
        await kv.set(pvpPairCounterKey('alice', 'bob', pvpUtcDay(Number(battle.endedAt))), 2);
        const out = await grantVanguardRewardsForSession(battle);
        // vanguardXpForLevel(50) = 300, x 1.1 at rank 2 = 330, x 0.5 = 165.
        assert.deepEqual(out, { granted: true, seals: 1, xp: 165 });
        assert.equal((await alice()).professionXp, 100 + 165);
    });

    test('a seal-capped win still pays its XP and leaves the seal counters alone', async () => {
        const counters = { dailyHonorSealsEarned: 3, dailyHonorSealsByTarget: { bob: 3 }, vanguardDailyResetDate: today() };
        await seed(5, counters);
        const out = await grantVanguardRewardsForSession(legacyBattle('capped'));
        assert.deepEqual(out, { granted: true, seals: 0, xp: 330 });
        const saved = await alice();
        assert.equal(saved.professionXp, 1850 + 330);
        assert.equal(saved.honorSeals, 10, 'no seals past the 3-per-target cap');
        assert.equal(saved.dailyHonorSealsEarned, 3);
        assert.deepEqual(saved.dailyHonorSealsByTarget, { bob: 3 });
        assert.equal(saved.vanguardDailyResetDate, today());
    });

    test('a capped win the pair weight zeroes writes nothing', async () => {
        await seed(5, { dailyHonorSealsEarned: 3, dailyHonorSealsByTarget: { bob: 3 }, vanguardDailyResetDate: today() });
        const battle = legacyBattle('zero');
        await kv.set(pvpPairCounterKey('alice', 'bob', pvpUtcDay(Number(battle.endedAt))), 4);
        const before = await kv.get('save:alice');
        const out = await grantVanguardRewardsForSession(battle);
        assert.deepEqual(out, { granted: false, reason: 'capped' });
        assert.deepEqual(await kv.get('save:alice'), before);
        assert.equal(await kv.get(`pvp:vanguard-rewarded:${battle.battleId}`), null, 'no receipt was reserved');
    });
});
