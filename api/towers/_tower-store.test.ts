import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    consumeRunToken,
    storeRunToken,
    bumpDailyStartCount,
    settleFloorForMember,
    settleAssistForAlly,
    settleConsumedItemsForMember,
    floorPaidKey,
    firstClearKey,
    consumedItemsKey,
    assistCountKey,
    type TowerKv,
    type TowerLock,
    type RunTokenData,
    MAX_ASSISTS_PER_DAY,
    isPublicTowerRun,
} from './_tower-store.js';
import { computeFloorReward, computeFloorClearScore } from './_tower-rewards.js';
import { getFloor, type TowerFloor } from './_floor-catalog.js';
import type { TowerSession, TowerActor } from './_tower-session.js';

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

// Floor 1 (catalog "Foothold") = { ryo: 400, xp: 150 }. settle resolves the floor from the
// catalog by session.floor, so tests use a real catalog floor id (never a client floor).
const F1 = getFloor(1)!;

function squadActor(slug: string): TowerActor {
    return {
        id: 'sq-0', side: 'squad', name: 'A', ownerSlug: slug, ai: false,
        hp: 800, maxHp: 1000, chakra: 0, maxChakra: 0, stamina: 0, maxStamina: 0,
        shield: 0, statuses: [], cooldowns: {}, pos: 0, character: {},
    };
}
function makeSession(runId: string, floorId: number, memberSlug: string, over: Partial<TowerSession> = {}): TowerSession {
    return {
        towerId: 'celestial', runId, floor: floorId, seed: 1, partySize: 1,
        map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [squadActor(memberSlug)],
        turnQueue: [], activeIndex: 0, round: 3, activeAp: 0, actionsThisTurn: 0,
        groundEffects: [], objectiveState: { kind: 'defeat-all', completed: true, failed: false },
        phaseState: { pendingPhases: [], triggeredPhases: [] },
        status: 'done', winner: 'squad', recentMoveTokens: [], rewardSettlementState: 'pending',
        log: [], createdAt: 0, lastActionAt: 0, ...over,
    };
}
function seedSave(kv: TowerKv & { store: Map<string, unknown> }, slug: string, char: Record<string, unknown> = {}) {
    kv.store.set(`save:${slug}`, {
        character: { level: 30, xp: 0, ryo: 0, fateShards: 0, boneCharms: 0, maxHp: 1000, maxChakra: 100, maxStamina: 100, stats: {}, unspentStats: 0, ...char },
    });
}
const charOf = (kv: TowerKv & { store: Map<string, unknown> }, slug: string) =>
    (kv.store.get(`save:${slug}`) as { character: Record<string, unknown> }).character;

describe('Battle Towers reward computation', () => {
    it('reward is the SEALED floor reward (cloned), never a client input', () => {
        const r = computeFloorReward(F1);
        assert.deepEqual(r, { ryo: 400, xp: 150 });
        r.ryo = 999999;
        assert.equal(F1.firstClearReward.ryo, 400);
    });
    it('Floor Clear Score rewards speed, survival, and no deaths', () => {
        const f: TowerFloor = { ...F1, roundBudget: 10 };
        const fast = computeFloorClearScore({ roundsUsed: 1, squadHpRemaining: 1000, squadHpMax: 1000, deaths: 0 }, f);
        const slow = computeFloorClearScore({ roundsUsed: 10, squadHpRemaining: 1000, squadHpMax: 1000, deaths: 0 }, f);
        const hurt = computeFloorClearScore({ roundsUsed: 1, squadHpRemaining: 100, squadHpMax: 1000, deaths: 0 }, f);
        const died = computeFloorClearScore({ roundsUsed: 1, squadHpRemaining: 1000, squadHpMax: 1000, deaths: 1 }, f);
        assert.ok(fast > slow && fast > hurt && fast > died && fast > 0);
    });
});

describe('Battle Towers run token (single-use, atomic)', () => {
    it('mints, consumes once, refuses a second consume (del-gated)', async () => {
        const kv = fakeKv();
        const data: RunTokenData = { host: 'host', members: ['host', 'a'], seed: 1, floor: 5, partySize: 2, mintedAt: NOW };
        await storeRunToken('tok1', data, { kv });
        assert.deepEqual(await consumeRunToken('host', 'tok1', { kv }), data);
        assert.equal(await consumeRunToken('host', 'tok1', { kv }), null);
    });
    it('daily start counter increments atomically', async () => {
        const kv = fakeKv();
        assert.equal(await bumpDailyStartCount('host', { kv, now }), 1);
        assert.equal(await bumpDailyStartCount('host', { kv, now }), 2);
    });
});

describe('Battle Towers per-member settlement (server-authoritative, idempotent)', () => {
    it('credits the sealed floor reward + score once', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice', { ryo: 50 });
        const res = await settleFloorForMember({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, { kv, lock: passLock, now });
        assert.equal(res.paid, true);
        const c = charOf(kv, 'alice');
        assert.equal(c.ryo, 450, 'ryo += sealed 400');
        assert.equal(c.battleTowerBestFloor, 1);
        assert.equal(c.battleTowerRating, res.score);
        assert.ok((res.score ?? 0) > 0);
        assert.deepEqual(c.battleTowerClearedFloors, [1]);
        assert.ok(kv.store.has(firstClearKey('alice', 1)), 'permanent first-clear receipt placed');
    });

    it('a second settle of the SAME run pays nothing (per-run NX receipt)', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice');
        await settleFloorForMember({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, { kv, lock: passLock, now });
        const ryo1 = charOf(kv, 'alice').ryo;
        const res2 = await settleFloorForMember({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, { kv, lock: passLock, now });
        assert.equal(res2.reason, 'already-paid');
        assert.equal(charOf(kv, 'alice').ryo, ryo1);
    });

    it('the one-time gate is FORGERY-PROOF: emptying the client cleared-array does NOT re-pay (C1)', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice');
        await settleFloorForMember({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, { kv, lock: passLock, now });
        const after1 = { ...charOf(kv, 'alice') };
        // simulate the C1 exploit: client POSTs a save that empties the cleared/claimed arrays
        charOf(kv, 'alice').battleTowerClearedFloors = [];
        charOf(kv, 'alice').battleTowerClaimedRewards = [];
        // re-run a NEW run for the same floor — the PERMANENT server receipt still blocks it
        const res3 = await settleFloorForMember({ session: makeSession('run2', 1, 'alice'), slug: 'alice' }, { kv, lock: passLock, now });
        assert.equal(res3.paid, false);
        assert.equal(res3.reason, 'already-first-cleared');
        assert.equal(charOf(kv, 'alice').ryo, after1.ryo, 'no extra ryo despite the forged array');
        assert.equal(charOf(kv, 'alice').battleTowerRating, after1.battleTowerRating, 'rating not re-added');
    });

    it('rejects an un-cleared session, a non-member, and an unknown floor', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice');
        const active = await settleFloorForMember({ session: makeSession('r', 1, 'alice', { status: 'active', winner: null }), slug: 'alice' }, { kv, lock: passLock, now });
        assert.equal(active.reason, 'not-cleared');
        const nonMember = await settleFloorForMember({ session: makeSession('r', 1, 'alice'), slug: 'mallory' }, { kv, lock: passLock, now });
        assert.equal(nonMember.reason, 'not-a-member');
        const badFloor = await settleFloorForMember({ session: makeSession('r', 999, 'alice'), slug: 'alice' }, { kv, lock: passLock, now });
        assert.equal(badFloor.reason, 'no-floor');
    });

    it('lock contention pays nothing AND leaves no receipts (clean retry)', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice');
        const res = await settleFloorForMember({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, { kv, lock: failLock, now });
        assert.equal(res.reason, 'contended');
        assert.equal(kv.store.has(floorPaidKey('run1', 1, 'alice')), false);
        assert.equal(kv.store.has(firstClearKey('alice', 1)), false);
        const retry = await settleFloorForMember({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, { kv, lock: passLock, now });
        assert.equal(retry.paid, true);
    });

    it('deducts server-recorded consumables exactly once from stacks then legacy inventory', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice', {
            itemStacks: [
                { itemId: 'kunai', count: 2 },
                { itemId: 'pot', count: 1 },
            ],
            inventory: ['kunai', 'pill', 'pill'],
        });
        const actor = squadActor('alice');
        actor.itemsUsed = { kunai: 3, pill: 1, pot: 1 };
        const session = makeSession('run-items', 1, 'alice', { actors: [actor] });

        const res = await settleConsumedItemsForMember({ session, slug: 'alice' }, { kv, lock: passLock, now });
        assert.equal(res.consumed, true);
        assert.deepEqual(charOf(kv, 'alice').itemStacks, []);
        assert.deepEqual(charOf(kv, 'alice').inventory, ['pill']);
        assert.ok(kv.store.has(consumedItemsKey('run-items', 'alice')));

        const again = await settleConsumedItemsForMember({ session, slug: 'alice' }, { kv, lock: passLock, now });
        assert.equal(again.reason, 'already-consumed');
        assert.deepEqual(charOf(kv, 'alice').inventory, ['pill'], 'retry did not double-deduct');
    });

    it('deducts used consumables after a wipe without paying floor rewards', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice', {
            itemStacks: [{ itemId: 'smoke', count: 1 }],
            inventory: ['kunai'],
        });
        const actor = squadActor('alice');
        actor.itemsUsed = { smoke: 1, kunai: 1 };
        const session = makeSession('run-wipe-items', 1, 'alice', {
            actors: [actor],
            winner: 'enemy',
            objectiveState: { kind: 'defeat-all', completed: false, failed: true },
        });

        const consumed = await settleConsumedItemsForMember({ session, slug: 'alice' }, { kv, lock: passLock, now });
        assert.equal(consumed.consumed, true);
        assert.deepEqual(charOf(kv, 'alice').itemStacks, []);
        assert.deepEqual(charOf(kv, 'alice').inventory, []);

        const reward = await settleFloorForMember({ session, slug: 'alice' }, { kv, lock: passLock, now });
        assert.equal(reward.paid, false);
        assert.equal(reward.reason, 'not-cleared');
        assert.equal(charOf(kv, 'alice').ryo, 0, 'wipe consumed items but paid no clear reward');
    });

    it('does not finalize consumable spends before the run is done', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice', { itemStacks: [{ itemId: 'smoke', count: 1 }] });
        const actor = squadActor('alice');
        actor.itemsUsed = { smoke: 1 };
        const session = makeSession('run-active-items', 1, 'alice', {
            actors: [actor],
            status: 'active',
            winner: null,
        });

        const consumed = await settleConsumedItemsForMember({ session, slug: 'alice' }, { kv, lock: passLock, now });
        assert.equal(consumed.consumed, false);
        assert.equal(consumed.reason, 'not-done');
        assert.deepEqual(charOf(kv, 'alice').itemStacks, [{ itemId: 'smoke', count: 1 }]);
        assert.equal(kv.store.has(consumedItemsKey('run-active-items', 'alice')), false);
    });
});

describe('Battle Towers borrowed-ally assist (capped, once per run)', () => {
    it('pays a capped fraction once per run', async () => {
        const kv = fakeKv();
        seedSave(kv, 'ally');
        const res = await settleAssistForAlly({ session: makeSession('run1', 1, 'ally'), slug: 'ally' }, { kv, lock: passLock, now });
        assert.equal(res.paid, true);
        // 25% of sealed 400 ryo, plus the assist's old XP share folded to ryo
        // at ~0.75:1 (25% of 150 xp → 37 → floor(37 × 0.75) = 27).
        assert.equal(charOf(kv, 'ally').ryo, 100 + 27);
        const again = await settleAssistForAlly({ session: makeSession('run1', 1, 'ally'), slug: 'ally' }, { kv, lock: passLock, now });
        assert.equal(again.reason, 'assist-already-paid');
    });

    it('enforces the daily assist cap and does NOT burn the per-run receipt', async () => {
        const kv = fakeKv();
        seedSave(kv, 'ally');
        kv.store.set(assistCountKey('ally', '2023-11-14'), MAX_ASSISTS_PER_DAY);
        const res = await settleAssistForAlly({ session: makeSession('runX', 1, 'ally'), slug: 'ally' }, { kv, lock: passLock, now });
        assert.equal(res.reason, 'assist-daily-cap');
        assert.equal(kv.store.has('tower-assist-paid:runX:ally'), false, 'denied cap rolls back the receipt');
    });
});

describe('the tower reward channels pay CATALOG floors only', () => {
    // Regression: every solo mode built by buildAuthoritativeSoloEncounter
    // (combat missions, story bosses, the weekly boss, generic AI fights, the
    // Academy spar) EMBEDS a synthetic floor in the session under a reserved id
    // outside the catalog. floorForSession prefers that embedded floor, so those
    // runs reached the tower payout path — and each is a genuinely won,
    // member-owned TowerSession, so no other check refused them.
    //
    // They paid no currency (a dynamic floor's firstClearReward is {}), but the
    // clear still wrote battleTowerBestFloor / battleTowerRating, which are
    // PUBLIC leaderboard fields. Finish any mission, POST its runId to
    // /api/towers/settle, and your public tower standing was whatever you liked.
    const dynamicFloor = (id: number): TowerFloor => ({
        id,
        name: 'academy-spar',
        biome: 'central',
        objective: 'defeat-boss',
        roundBudget: 24,
        map: { width: 12, height: 10 },
        fieldRule: { kind: 'none' },
        enemies: [],
        boss: { aiId: 'academy-spar-dummy' },
        balanceFor: 1,
        firstClearReward: {},
    } as unknown as TowerFloor);

    function dynamicRun(runId: string, slug: string, floorId: number) {
        return makeSession(runId, floorId, slug, { encounterFloor: dynamicFloor(floorId) });
    }

    it('refuses a first-clear settle for an embedded, non-catalog floor', async () => {
        const kv = fakeKv();
        seedSave(kv, 'cheat');
        const res = await settleFloorForMember({ session: dynamicRun('spar-1', 'cheat', 9_250), slug: 'cheat' }, { kv, lock: passLock, now });
        assert.equal(res.paid, false);
        assert.equal(res.reason, 'not-a-catalog-floor');
    });

    it('writes NOTHING to the public tower standing', async () => {
        const kv = fakeKv();
        seedSave(kv, 'cheat', { battleTowerBestFloor: 3, battleTowerRating: 120 });
        await settleFloorForMember({ session: dynamicRun('spar-2', 'cheat', 9_250), slug: 'cheat' }, { kv, lock: passLock, now });
        const char = charOf(kv, 'cheat');
        assert.equal(char.battleTowerBestFloor, 3, 'a mission/spar run must not become your best tower floor');
        assert.equal(char.battleTowerRating, 120, 'nor add to the all-time rating');
        assert.equal(char.battleTowerClearedFloors, undefined, 'nor push a phantom cleared floor');
        assert.equal(kv.store.has(firstClearKey('cheat', 9_250)), false, 'and must not burn a PERMANENT first-clear receipt');
    });

    it('covers every id the solo modes reserve, not just the spar', async () => {
        // combat missions 9_100+, Anbu 9_101, story 9_200+, weekly boss 9_200,
        // the spar 9_250, generic AI fights 9_300.
        for (const id of [9_100, 9_101, 9_200, 9_208, 9_250, 9_300]) {
            const kv = fakeKv();
            seedSave(kv, 'cheat');
            const res = await settleFloorForMember({ session: dynamicRun(`run-${id}`, 'cheat', id), slug: 'cheat' }, { kv, lock: passLock, now });
            assert.equal(res.reason, 'not-a-catalog-floor', `floor ${id} still reaches the tower payout`);
        }
    });

    it('refuses the assist channel too, so it cannot burn a daily assist slot', async () => {
        const kv = fakeKv();
        seedSave(kv, 'ally');
        const res = await settleAssistForAlly({ session: dynamicRun('spar-3', 'ally', 9_250), slug: 'ally' }, { kv, lock: passLock, now });
        assert.equal(res.paid, false);
        assert.equal(res.reason, 'not-a-catalog-floor');
        assert.equal(kv.store.has(assistCountKey('ally', '2023-11-14')), false, 'the day\'s assist count must be untouched');
    });

    it('a REAL tower floor still settles — the guard must not close the tower itself', async () => {
        // The unguarded precondition: if this ever stops paying, the two tests
        // above are passing for the wrong reason.
        const kv = fakeKv();
        seedSave(kv, 'climber');
        const res = await settleFloorForMember({ session: makeSession('tower-1', 1, 'climber'), slug: 'climber' }, { kv, lock: passLock, now });
        assert.equal(res.paid, true, 'floor 1 is a catalog floor and must still pay');
        assert.equal(charOf(kv, 'climber').battleTowerBestFloor, 1);
    });

    it('rejects embedded floors even when they reuse a public catalog id', async () => {
        const kv = fakeKv();
        seedSave(kv, 'climber');
        const session = makeSession('tower-2', 1, 'climber', { encounterFloor: getFloor(1)! });
        const res = await settleFloorForMember({ session, slug: 'climber' }, { kv, lock: passLock, now });
        assert.equal(res.reason, 'not-a-catalog-floor');
        assert.equal(isPublicTowerRun(session), false);
    });
});
