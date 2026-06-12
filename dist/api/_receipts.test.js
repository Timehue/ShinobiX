"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _receipts_js_1 = require("./_receipts.js");
// ─── In-memory KV double (get/set/incr/keys/mget with NX semantics) ──────────
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
        async incr(key) {
            const next = (Number(store.get(key)) || 0) + 1;
            store.set(key, next);
            return next;
        },
        async keys(pattern) {
            const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
            return [...store.keys()].filter((k) => re.test(k));
        },
        async mget(...keys) {
            return keys.map((k) => (store.has(k) ? store.get(k) : null));
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
// ─── Per-action combat receipts ───────────────────────────────────────────────
function activeSession(over = {}) {
    return {
        battleId: 'b1',
        p1: fighter('Alice', 1000),
        p2: fighter('Bob', 1000),
        round: 1,
        activePlayer: 'p1',
        ap: { p1: 100, p2: 100 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: ['⚔️ Alice vs Bob — Battle begins!'],
        status: 'active',
        winner: null,
        createdAt: 500,
        ...over,
    };
}
// A standard "Alice casts a 60-AP jutsu at Bob for 320 damage" transition.
function castInput(over = {}) {
    const pre = activeSession();
    const post = {
        ...pre,
        p1: { ...pre.p1, pos: 5 }, // actor moved a tile
        p2: { ...pre.p2, hp: 680 }, // target took 320
        ap: { p1: 40, p2: 100 }, // spent 60 AP
        log: [...pre.log, 'Alice uses Fireball: flames roar to life!', 'Bob takes 320 damage.'],
    };
    return { pre, post, role: 'p1', actionId: 'fireball', actionName: 'Fireball', actionType: 'jutsu', ...over };
}
(0, node_test_1.describe)('buildActionReceipt (pure)', () => {
    (0, node_test_1.it)('captures the action name, its narrative lines, and compact deltas', () => {
        const r = (0, _receipts_js_1.buildActionReceipt)(castInput({ moveToken: 'mt1' }), 1, 9999);
        node_assert_1.strict.equal(r.battleId, 'b1');
        node_assert_1.strict.equal(r.seq, 1);
        node_assert_1.strict.equal(r.round, 1);
        node_assert_1.strict.equal(r.moveToken, 'mt1');
        node_assert_1.strict.equal(r.actorRole, 'p1');
        node_assert_1.strict.equal(r.actorName, 'Alice');
        node_assert_1.strict.equal(r.targetRole, 'p2');
        node_assert_1.strict.equal(r.targetName, 'Bob');
        node_assert_1.strict.equal(r.actionId, 'fireball');
        node_assert_1.strict.equal(r.actionName, 'Fireball');
        node_assert_1.strict.equal(r.actionType, 'jutsu');
        node_assert_1.strict.equal(r.result, 'applied');
        // Flavor/cast line first, then what it did — exactly this action's suffix.
        node_assert_1.strict.deepEqual(r.summaryLines, ['Alice uses Fireball: flames roar to life!', 'Bob takes 320 damage.']);
        node_assert_1.strict.equal(r.targetDelta.hp, -320);
        node_assert_1.strict.equal(r.actorDelta.pos, 5);
        node_assert_1.strict.equal(r.actorDelta.hp, undefined, 'unchanged vitals are omitted');
        node_assert_1.strict.equal(r.apSpent, 60);
        node_assert_1.strict.equal(r.winner, undefined, 'winner only set on the terminal action');
        node_assert_1.strict.equal(r.createdAt, 9999);
    });
    (0, node_test_1.it)('classifies the terminal action as battle_end and records the winner', () => {
        const input = castInput();
        input.post = { ...input.post, p2: { ...input.post.p2, hp: 0 }, status: 'done', winner: 'p1' };
        const r = (0, _receipts_js_1.buildActionReceipt)(input, 7, 1);
        node_assert_1.strict.equal(r.result, 'battle_end');
        node_assert_1.strict.equal(r.winner, 'p1');
    });
});
(0, node_test_1.describe)('writeActionReceipt (append-only, idempotent, best-effort)', () => {
    (0, node_test_1.it)('assigns a monotonic seq and stores one receipt per committed action', async () => {
        const kv = makeFakeKv();
        const first = await (0, _receipts_js_1.writeActionReceipt)(castInput({ moveToken: 'mt1' }), { now: 1, kv });
        const second = await (0, _receipts_js_1.writeActionReceipt)(castInput({ moveToken: 'mt2', role: 'p2', actionName: 'Counter' }), { now: 2, kv });
        node_assert_1.strict.equal(first?.seq, 1);
        node_assert_1.strict.equal(second?.seq, 2);
        node_assert_1.strict.equal(kv.store.get((0, _receipts_js_1.actionSeqKey)('b1')), 2);
        node_assert_1.strict.ok(kv.store.has((0, _receipts_js_1.actionReceiptKey)('b1', 1)));
        node_assert_1.strict.ok(kv.store.has((0, _receipts_js_1.actionReceiptKey)('b1', 2)));
    });
    (0, node_test_1.it)('is idempotent per moveToken — a retried move does NOT append twice', async () => {
        const kv = makeFakeKv();
        await (0, _receipts_js_1.writeActionReceipt)(castInput({ moveToken: 'mt1' }), { now: 1, kv });
        const retry = await (0, _receipts_js_1.writeActionReceipt)(castInput({ moveToken: 'mt1' }), { now: 2, kv });
        node_assert_1.strict.equal(retry, null, 'the NX token marker blocks the duplicate');
        node_assert_1.strict.equal(kv.store.get((0, _receipts_js_1.actionSeqKey)('b1')), 1, 'seq did not advance on the retry');
        node_assert_1.strict.ok(kv.store.has((0, _receipts_js_1.actionTokenKey)('b1', 'mt1')));
    });
    (0, node_test_1.it)('still records tokenless actions (e.g. auto-wait), incrementing seq each time', async () => {
        const kv = makeFakeKv();
        const a = await (0, _receipts_js_1.writeActionReceipt)(castInput(), { now: 1, kv });
        const b = await (0, _receipts_js_1.writeActionReceipt)(castInput(), { now: 2, kv });
        node_assert_1.strict.equal(a?.seq, 1);
        node_assert_1.strict.equal(b?.seq, 2);
    });
    (0, node_test_1.it)('no-ops when DISABLE_COMBAT_RECEIPTS=1', async () => {
        process.env.DISABLE_COMBAT_RECEIPTS = '1';
        const kv = makeFakeKv();
        const r = await (0, _receipts_js_1.writeActionReceipt)(castInput({ moveToken: 'mt1' }), { now: 1, kv });
        node_assert_1.strict.equal(r, null);
        node_assert_1.strict.equal(kv.store.size, 0);
    });
});
(0, node_test_1.describe)('readActionReceipts (ordered by seq)', () => {
    (0, node_test_1.it)('returns every action receipt for a battle in seq order', async () => {
        const kv = makeFakeKv();
        await (0, _receipts_js_1.writeActionReceipt)(castInput({ moveToken: 'mt1' }), { now: 1, kv });
        await (0, _receipts_js_1.writeActionReceipt)(castInput({ moveToken: 'mt2' }), { now: 2, kv });
        await (0, _receipts_js_1.writeActionReceipt)(castInput({ moveToken: 'mt3' }), { now: 3, kv });
        const entries = await (0, _receipts_js_1.readActionReceipts)('b1', { kv });
        node_assert_1.strict.equal(entries.length, 3);
        node_assert_1.strict.deepEqual(entries.map((e) => e.seq), [1, 2, 3]);
    });
    (0, node_test_1.it)('returns [] for a battle with no receipts', async () => {
        const kv = makeFakeKv();
        node_assert_1.strict.deepEqual(await (0, _receipts_js_1.readActionReceipts)('nope', { kv }), []);
    });
});
