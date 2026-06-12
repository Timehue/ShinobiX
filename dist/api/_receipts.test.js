"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _receipts_js_1 = require("./_receipts.js");
// ─── In-memory KV double (get/set with NX semantics) ──────────────────────────
function makeFakeKv() {
    const store = new Map();
    return {
        store,
        async get(key) {
            return (store.has(key) ? store.get(key) : null);
        },
        async set(key, value, options) {
            if (options?.nx && store.has(key))
                return null;
            store.set(key, value);
            return 'OK';
        },
    };
}
function fighter(name, hp, statuses = []) {
    return {
        name, hp, maxHp: 1000, chakra: 0, maxChakra: 0, stamina: 0, maxStamina: 0,
        shield: 0, statuses, character: {}, pos: 0,
    };
}
function doneSession(over = {}) {
    return {
        battleId: 'b1',
        p1: fighter('Alice', 720),
        p2: fighter('Bob', 0, [{ name: 'Poison', rounds: 2, kind: 'negative' }]),
        round: 5,
        activePlayer: 'p1',
        ap: { p1: 100, p2: 100 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: ['Alice uses Fire Jutsu:', '⚔️ Alice wins!'],
        status: 'done',
        winner: 'p1',
        createdAt: 500,
        ranked: true,
        rankedKind: 'player',
        p1Rating: 1000,
        p2Rating: 1000,
        ...over,
    };
}
const PRIOR_FLAG = process.env.DISABLE_COMBAT_RECEIPTS;
(0, node_test_1.beforeEach)(() => { delete process.env.DISABLE_COMBAT_RECEIPTS; });
(0, node_test_1.afterEach)(() => {
    if (PRIOR_FLAG === undefined)
        delete process.env.DISABLE_COMBAT_RECEIPTS;
    else
        process.env.DISABLE_COMBAT_RECEIPTS = PRIOR_FLAG;
});
(0, node_test_1.describe)('buildBattleReceipt (pure)', () => {
    (0, node_test_1.it)('maps session fields, copies the log, and snapshots final statuses', () => {
        const r = (0, _receipts_js_1.buildBattleReceipt)(doneSession(), 9999);
        node_assert_1.strict.equal(r.battleId, 'b1');
        node_assert_1.strict.equal(r.ranked, true);
        node_assert_1.strict.equal(r.rankedKind, 'player');
        node_assert_1.strict.equal(r.startedAt, 500);
        node_assert_1.strict.equal(r.endedAt, 9999);
        node_assert_1.strict.equal(r.rounds, 5);
        node_assert_1.strict.equal(r.winner, 'p1');
        node_assert_1.strict.deepEqual(r.log, ['Alice uses Fire Jutsu:', '⚔️ Alice wins!']);
        node_assert_1.strict.equal(r.p1.name, 'Alice');
        node_assert_1.strict.equal(r.p1.hp, 720);
        node_assert_1.strict.equal(r.p2.hp, 0);
        node_assert_1.strict.deepEqual(r.p2.finalStatuses, [{ name: 'Poison', rounds: 2 }]);
        node_assert_1.strict.equal(r.settlement, undefined);
    });
    (0, node_test_1.it)('does not alias the session log array (copy, not reference)', () => {
        const s = doneSession();
        const r = (0, _receipts_js_1.buildBattleReceipt)(s, 1);
        s.log.push('mutated after build');
        node_assert_1.strict.equal(r.log.length, 2, 'receipt log should be a snapshot, immune to later session mutation');
    });
    (0, node_test_1.it)('floors negative/overshoot hp to a clean non-negative integer', () => {
        const r = (0, _receipts_js_1.buildBattleReceipt)(doneSession({ p2: fighter('Bob', -55) }), 1);
        node_assert_1.strict.equal(r.p2.hp, 0);
    });
});
(0, node_test_1.describe)('writeBattleReceipt (idempotent, best-effort)', () => {
    (0, node_test_1.it)('writes the receipt + NX marker the first time a battle resolves', async () => {
        const kv = makeFakeKv();
        const ok = await (0, _receipts_js_1.writeBattleReceipt)(doneSession(), { now: 1234, kv });
        node_assert_1.strict.equal(ok, true);
        node_assert_1.strict.ok(kv.store.has((0, _receipts_js_1.receiptWroteKey)('b1')));
        const stored = kv.store.get((0, _receipts_js_1.receiptKey)('b1'));
        node_assert_1.strict.equal(stored.battleId, 'b1');
        node_assert_1.strict.equal(stored.endedAt, 1234);
    });
    (0, node_test_1.it)('is idempotent — a second resolve does NOT overwrite the receipt', async () => {
        const kv = makeFakeKv();
        await (0, _receipts_js_1.writeBattleReceipt)(doneSession(), { now: 1000, kv });
        // Simulate a replayed terminal move with a later timestamp + different log.
        const second = await (0, _receipts_js_1.writeBattleReceipt)(doneSession({ log: ['REPLAYED'] }), { now: 5000, kv });
        node_assert_1.strict.equal(second, false, 'NX marker should block the second write');
        const stored = kv.store.get((0, _receipts_js_1.receiptKey)('b1'));
        node_assert_1.strict.equal(stored.endedAt, 1000, 'original receipt is preserved');
        node_assert_1.strict.deepEqual(stored.log, ['Alice uses Fire Jutsu:', '⚔️ Alice wins!']);
    });
    (0, node_test_1.it)('no-ops for an unresolved (still active) session', async () => {
        const kv = makeFakeKv();
        const ok = await (0, _receipts_js_1.writeBattleReceipt)(doneSession({ status: 'active', winner: null }), { now: 1, kv });
        node_assert_1.strict.equal(ok, false);
        node_assert_1.strict.equal(kv.store.size, 0);
    });
    (0, node_test_1.it)('no-ops when DISABLE_COMBAT_RECEIPTS=1', async () => {
        process.env.DISABLE_COMBAT_RECEIPTS = '1';
        const kv = makeFakeKv();
        const ok = await (0, _receipts_js_1.writeBattleReceipt)(doneSession(), { now: 1, kv });
        node_assert_1.strict.equal(ok, false);
        node_assert_1.strict.equal(kv.store.size, 0);
    });
});
(0, node_test_1.describe)('mergeSettlement (pure)', () => {
    (0, node_test_1.it)('merges patch fields and stamps settledAt', () => {
        const base = (0, _receipts_js_1.buildBattleReceipt)(doneSession(), 1);
        const merged = (0, _receipts_js_1.mergeSettlement)(base, { winnerRyo: 500, winnerXp: 120 }, 42);
        node_assert_1.strict.equal(merged.settlement?.winnerRyo, 500);
        node_assert_1.strict.equal(merged.settlement?.winnerXp, 120);
        node_assert_1.strict.equal(merged.settlement?.settledAt, 42);
    });
    (0, node_test_1.it)('preserves prior settlement fields across patches (last-writer-wins per field)', () => {
        const base = (0, _receipts_js_1.buildBattleReceipt)(doneSession(), 1);
        const first = (0, _receipts_js_1.mergeSettlement)(base, { winnerRyo: 500, settledAt: 10 }, 10);
        const second = (0, _receipts_js_1.mergeSettlement)(first, { ratingDelta: 18 }, 20);
        node_assert_1.strict.equal(second.settlement?.winnerRyo, 500, 'earlier field survives');
        node_assert_1.strict.equal(second.settlement?.ratingDelta, 18);
        node_assert_1.strict.equal(second.settlement?.settledAt, 10, 'explicit settledAt is kept');
    });
});
(0, node_test_1.describe)('patchBattleSettlement (best-effort)', () => {
    (0, node_test_1.it)('patches an existing receipt', async () => {
        const kv = makeFakeKv();
        await (0, _receipts_js_1.writeBattleReceipt)(doneSession(), { now: 1, kv });
        await (0, _receipts_js_1.patchBattleSettlement)('b1', { winnerRyo: 750, ratingDelta: 16 }, { now: 99, kv });
        const stored = await (0, _receipts_js_1.readBattleReceipt)('b1', { kv });
        node_assert_1.strict.equal(stored?.settlement?.winnerRyo, 750);
        node_assert_1.strict.equal(stored?.settlement?.ratingDelta, 16);
        node_assert_1.strict.equal(stored?.settlement?.settledAt, 99);
    });
    (0, node_test_1.it)('no-ops when the receipt does not exist', async () => {
        const kv = makeFakeKv();
        await (0, _receipts_js_1.patchBattleSettlement)('missing', { winnerRyo: 1 }, { now: 1, kv });
        node_assert_1.strict.equal(kv.store.size, 0);
    });
});
