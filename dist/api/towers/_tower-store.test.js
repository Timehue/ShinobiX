"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _tower_store_js_1 = require("./_tower-store.js");
const _tower_rewards_js_1 = require("./_tower-rewards.js");
const _floor_catalog_js_1 = require("./_floor-catalog.js");
const NOW = 1_700_000_000_000;
const now = () => NOW;
function fakeKv() {
    const store = new Map();
    return {
        store,
        async get(key) { return (store.has(key) ? store.get(key) : null); },
        async set(key, value, opts) {
            if (opts?.nx && store.has(key))
                return null;
            store.set(key, value);
            return 'OK';
        },
        async del(...keys) { let n = 0; for (const k of keys)
            if (store.delete(k))
                n++; return n; },
        async incr(key) { const v = (Number(store.get(key)) || 0) + 1; store.set(key, v); return v; },
    };
}
const passLock = async (_t, fn) => fn();
const failLock = async (_t, fn, opts) => { if (opts?.failClosed)
    throw new Error('contended'); return fn(); };
// Floor 1 (catalog "Foothold") = { ryo: 400, xp: 150 }. settle resolves the floor from the
// catalog by session.floor, so tests use a real catalog floor id (never a client floor).
const F1 = (0, _floor_catalog_js_1.getFloor)(1);
function squadActor(slug) {
    return {
        id: 'sq-0', side: 'squad', name: 'A', ownerSlug: slug, ai: false,
        hp: 800, maxHp: 1000, chakra: 0, maxChakra: 0, stamina: 0, maxStamina: 0,
        shield: 0, statuses: [], cooldowns: {}, pos: 0, character: {},
    };
}
function makeSession(runId, floorId, memberSlug, over = {}) {
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
function seedSave(kv, slug, char = {}) {
    kv.store.set(`save:${slug}`, {
        character: { level: 30, xp: 0, ryo: 0, fateShards: 0, boneCharms: 0, maxHp: 1000, maxChakra: 100, maxStamina: 100, stats: {}, unspentStats: 0, ...char },
    });
}
const charOf = (kv, slug) => kv.store.get(`save:${slug}`).character;
(0, node_test_1.describe)('Battle Towers reward computation', () => {
    (0, node_test_1.it)('reward is the SEALED floor reward (cloned), never a client input', () => {
        const r = (0, _tower_rewards_js_1.computeFloorReward)(F1);
        node_assert_1.strict.deepEqual(r, { ryo: 400, xp: 150 });
        r.ryo = 999999;
        node_assert_1.strict.equal(F1.firstClearReward.ryo, 400);
    });
    (0, node_test_1.it)('Floor Clear Score rewards speed, survival, and no deaths', () => {
        const f = { ...F1, roundBudget: 10 };
        const fast = (0, _tower_rewards_js_1.computeFloorClearScore)({ roundsUsed: 1, squadHpRemaining: 1000, squadHpMax: 1000, deaths: 0 }, f);
        const slow = (0, _tower_rewards_js_1.computeFloorClearScore)({ roundsUsed: 10, squadHpRemaining: 1000, squadHpMax: 1000, deaths: 0 }, f);
        const hurt = (0, _tower_rewards_js_1.computeFloorClearScore)({ roundsUsed: 1, squadHpRemaining: 100, squadHpMax: 1000, deaths: 0 }, f);
        const died = (0, _tower_rewards_js_1.computeFloorClearScore)({ roundsUsed: 1, squadHpRemaining: 1000, squadHpMax: 1000, deaths: 1 }, f);
        node_assert_1.strict.ok(fast > slow && fast > hurt && fast > died && fast > 0);
    });
});
(0, node_test_1.describe)('Battle Towers run token (single-use, atomic)', () => {
    (0, node_test_1.it)('mints, consumes once, refuses a second consume (del-gated)', async () => {
        const kv = fakeKv();
        const data = { host: 'host', members: ['host', 'a'], seed: 1, floor: 5, partySize: 2, mintedAt: NOW };
        await (0, _tower_store_js_1.storeRunToken)('tok1', data, { kv });
        node_assert_1.strict.deepEqual(await (0, _tower_store_js_1.consumeRunToken)('host', 'tok1', { kv }), data);
        node_assert_1.strict.equal(await (0, _tower_store_js_1.consumeRunToken)('host', 'tok1', { kv }), null);
    });
    (0, node_test_1.it)('daily start counter increments atomically', async () => {
        const kv = fakeKv();
        node_assert_1.strict.equal(await (0, _tower_store_js_1.bumpDailyStartCount)('host', { kv, now }), 1);
        node_assert_1.strict.equal(await (0, _tower_store_js_1.bumpDailyStartCount)('host', { kv, now }), 2);
    });
});
(0, node_test_1.describe)('Battle Towers per-member settlement (server-authoritative, idempotent)', () => {
    (0, node_test_1.it)('credits the sealed floor reward + score once', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice', { ryo: 50 });
        const res = await (0, _tower_store_js_1.settleFloorForMember)({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, { kv, lock: passLock, now });
        node_assert_1.strict.equal(res.paid, true);
        const c = charOf(kv, 'alice');
        node_assert_1.strict.equal(c.ryo, 450, 'ryo += sealed 400');
        node_assert_1.strict.equal(c.battleTowerBestFloor, 1);
        node_assert_1.strict.equal(c.battleTowerRating, res.score);
        node_assert_1.strict.ok((res.score ?? 0) > 0);
        node_assert_1.strict.deepEqual(c.battleTowerClearedFloors, [1]);
        node_assert_1.strict.ok(kv.store.has((0, _tower_store_js_1.firstClearKey)('alice', 1)), 'permanent first-clear receipt placed');
    });
    (0, node_test_1.it)('a second settle of the SAME run pays nothing (per-run NX receipt)', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice');
        await (0, _tower_store_js_1.settleFloorForMember)({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, { kv, lock: passLock, now });
        const ryo1 = charOf(kv, 'alice').ryo;
        const res2 = await (0, _tower_store_js_1.settleFloorForMember)({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, { kv, lock: passLock, now });
        node_assert_1.strict.equal(res2.reason, 'already-paid');
        node_assert_1.strict.equal(charOf(kv, 'alice').ryo, ryo1);
    });
    (0, node_test_1.it)('the one-time gate is FORGERY-PROOF: emptying the client cleared-array does NOT re-pay (C1)', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice');
        await (0, _tower_store_js_1.settleFloorForMember)({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, { kv, lock: passLock, now });
        const after1 = { ...charOf(kv, 'alice') };
        // simulate the C1 exploit: client POSTs a save that empties the cleared/claimed arrays
        charOf(kv, 'alice').battleTowerClearedFloors = [];
        charOf(kv, 'alice').battleTowerClaimedRewards = [];
        // re-run a NEW run for the same floor — the PERMANENT server receipt still blocks it
        const res3 = await (0, _tower_store_js_1.settleFloorForMember)({ session: makeSession('run2', 1, 'alice'), slug: 'alice' }, { kv, lock: passLock, now });
        node_assert_1.strict.equal(res3.paid, false);
        node_assert_1.strict.equal(res3.reason, 'already-first-cleared');
        node_assert_1.strict.equal(charOf(kv, 'alice').ryo, after1.ryo, 'no extra ryo despite the forged array');
        node_assert_1.strict.equal(charOf(kv, 'alice').battleTowerRating, after1.battleTowerRating, 'rating not re-added');
    });
    (0, node_test_1.it)('rejects an un-cleared session, a non-member, and an unknown floor', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice');
        const active = await (0, _tower_store_js_1.settleFloorForMember)({ session: makeSession('r', 1, 'alice', { status: 'active', winner: null }), slug: 'alice' }, { kv, lock: passLock, now });
        node_assert_1.strict.equal(active.reason, 'not-cleared');
        const nonMember = await (0, _tower_store_js_1.settleFloorForMember)({ session: makeSession('r', 1, 'alice'), slug: 'mallory' }, { kv, lock: passLock, now });
        node_assert_1.strict.equal(nonMember.reason, 'not-a-member');
        const badFloor = await (0, _tower_store_js_1.settleFloorForMember)({ session: makeSession('r', 999, 'alice'), slug: 'alice' }, { kv, lock: passLock, now });
        node_assert_1.strict.equal(badFloor.reason, 'no-floor');
    });
    (0, node_test_1.it)('lock contention pays nothing AND leaves no receipts (clean retry)', async () => {
        const kv = fakeKv();
        seedSave(kv, 'alice');
        const res = await (0, _tower_store_js_1.settleFloorForMember)({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, { kv, lock: failLock, now });
        node_assert_1.strict.equal(res.reason, 'contended');
        node_assert_1.strict.equal(kv.store.has((0, _tower_store_js_1.floorPaidKey)('run1', 1, 'alice')), false);
        node_assert_1.strict.equal(kv.store.has((0, _tower_store_js_1.firstClearKey)('alice', 1)), false);
        const retry = await (0, _tower_store_js_1.settleFloorForMember)({ session: makeSession('run1', 1, 'alice'), slug: 'alice' }, { kv, lock: passLock, now });
        node_assert_1.strict.equal(retry.paid, true);
    });
});
(0, node_test_1.describe)('Battle Towers borrowed-ally assist (capped, once per run)', () => {
    (0, node_test_1.it)('pays a capped fraction once per run', async () => {
        const kv = fakeKv();
        seedSave(kv, 'ally');
        const res = await (0, _tower_store_js_1.settleAssistForAlly)({ session: makeSession('run1', 1, 'ally'), slug: 'ally' }, { kv, lock: passLock, now });
        node_assert_1.strict.equal(res.paid, true);
        node_assert_1.strict.equal(charOf(kv, 'ally').ryo, 100, '25% of sealed 400');
        const again = await (0, _tower_store_js_1.settleAssistForAlly)({ session: makeSession('run1', 1, 'ally'), slug: 'ally' }, { kv, lock: passLock, now });
        node_assert_1.strict.equal(again.reason, 'assist-already-paid');
    });
    (0, node_test_1.it)('enforces the daily assist cap and does NOT burn the per-run receipt', async () => {
        const kv = fakeKv();
        seedSave(kv, 'ally');
        kv.store.set((0, _tower_store_js_1.assistCountKey)('ally', '2023-11-14'), _tower_store_js_1.MAX_ASSISTS_PER_DAY);
        const res = await (0, _tower_store_js_1.settleAssistForAlly)({ session: makeSession('runX', 1, 'ally'), slug: 'ally' }, { kv, lock: passLock, now });
        node_assert_1.strict.equal(res.reason, 'assist-daily-cap');
        node_assert_1.strict.equal(kv.store.has('tower-assist-paid:runX:ally'), false, 'denied cap rolls back the receipt');
    });
});
