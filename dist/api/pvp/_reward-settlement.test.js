"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _storage_js_1 = require("../_storage.js");
const _reward_settlement_js_1 = require("./_reward-settlement.js");
// Regression for the PvP settlement two-write gap: a crash between the receipt
// write and the save write used to permanently lose a reward/rating. The fix
// puts the idempotency receipt INSIDE the credited save, so credit + receipt land
// in one atomic kv.set. These tests model the exact claim-rewards flow against
// the real in-memory KV and prove exactly-once + crash-recovery.
const BATTLE = 'pvp-550e8400-e29b-41d4-a716-446655440000';
(0, node_test_1.describe)('pvpSettlementId', () => {
    (0, node_test_1.it)('is deterministic, prefixed, and within the receipt-id charset/length', () => {
        const id = (0, _reward_settlement_js_1.pvpSettlementId)('rating', BATTLE);
        strict_1.default.equal(id, `pvp-rating-${BATTLE}`);
        strict_1.default.equal(id, (0, _reward_settlement_js_1.pvpSettlementId)('rating', BATTLE), 'deterministic');
        strict_1.default.ok(id.length >= 16 && id.length <= 80);
        strict_1.default.match(id, /^[A-Za-z0-9_-]+$/);
    });
    (0, node_test_1.it)('strips any out-of-charset characters defensively', () => {
        strict_1.default.match((0, _reward_settlement_js_1.pvpSettlementId)('base', 'weird id:with*chars'), /^[A-Za-z0-9_-]+$/);
    });
});
// Model the claim-rewards settlement of one save exactly once. `applyCredit`
// mutates the character; a return of 'credited' means we wrote (fresh),
// 'skipped' means the receipt already existed (replay). `crashBeforeWrite`
// simulates a process death after computing the credit but before persisting it.
async function settleOnce(kv, saveKey, sid, fingerprint, applyCredit, opts = {}) {
    const record = await kv.get(saveKey);
    const char = record?.character;
    if (!record || !char)
        return 'skipped';
    const decision = (0, _reward_settlement_js_1.inspectPvpCredit)(char, sid, fingerprint);
    if (!decision.fresh)
        return 'skipped';
    const credited = applyCredit(char);
    const withReceipt = (0, _reward_settlement_js_1.embedPvpSettlementReceipt)(credited, decision.receipts, sid, fingerprint, Date.now());
    if (opts.crashBeforeWrite)
        return 'crashed'; // never persisted → nothing changed
    await kv.set(saveKey, { ...record, character: withReceipt });
    return 'credited';
}
const addRyo = (n) => (char) => ({ ...char, ryo: (Number(char.ryo) || 0) + n });
(0, node_test_1.describe)('atomic in-save PvP settlement', () => {
    (0, node_test_1.it)('credits exactly once, no matter how many times the claim is retried', async () => {
        const kv = (0, _storage_js_1._makeMemoryKv)();
        await kv.set('save:winner', { character: { ryo: 100 } });
        const sid = (0, _reward_settlement_js_1.pvpSettlementId)('base', BATTLE);
        strict_1.default.equal(await settleOnce(kv, 'save:winner', sid, 'base', addRyo(75)), 'credited');
        for (let i = 0; i < 5; i++) {
            strict_1.default.equal(await settleOnce(kv, 'save:winner', sid, 'base', addRyo(75)), 'skipped', 'retry must not re-credit');
        }
        strict_1.default.equal((await kv.get('save:winner')).character.ryo, 175, 'credited exactly once');
    });
    (0, node_test_1.it)('the credit and the receipt persist together — a crash BEFORE the write loses neither (recovered on retry)', async () => {
        const kv = (0, _storage_js_1._makeMemoryKv)();
        await kv.set('save:winner', { character: { ryo: 100 } });
        const sid = (0, _reward_settlement_js_1.pvpSettlementId)('base', BATTLE);
        // Attempt 1 computes the credit but dies before persisting.
        strict_1.default.equal(await settleOnce(kv, 'save:winner', sid, 'base', addRyo(75), { crashBeforeWrite: true }), 'crashed');
        // Nothing was written — neither the credit nor a blocking receipt.
        const afterCrash = (await kv.get('save:winner')).character;
        strict_1.default.equal(afterCrash.ryo, 100, 'no partial credit');
        strict_1.default.ok(!Array.isArray(afterCrash.serverSettlementReceipts) || afterCrash.serverSettlementReceipts.length === 0, 'no orphan receipt to block the retry');
        // Retry recovers it — credited exactly once thereafter.
        strict_1.default.equal(await settleOnce(kv, 'save:winner', sid, 'base', addRyo(75)), 'credited', 'retry recovers the lost credit');
        strict_1.default.equal(await settleOnce(kv, 'save:winner', sid, 'base', addRyo(75)), 'skipped');
        strict_1.default.equal((await kv.get('save:winner')).character.ryo, 175);
    });
    (0, node_test_1.it)('a crash AFTER the atomic write leaves credit+receipt together, so the retry skips', async () => {
        const kv = (0, _storage_js_1._makeMemoryKv)();
        await kv.set('save:winner', { character: { ryo: 100 } });
        const sid = (0, _reward_settlement_js_1.pvpSettlementId)('base', BATTLE);
        // Normal write = credit + receipt in one kv.set (atomic). A "crash after"
        // is indistinguishable from a normal completed write for the retry.
        strict_1.default.equal(await settleOnce(kv, 'save:winner', sid, 'base', addRyo(75)), 'credited');
        strict_1.default.equal(await settleOnce(kv, 'save:winner', sid, 'base', addRyo(75)), 'skipped');
        strict_1.default.equal((await kv.get('save:winner')).character.ryo, 175);
    });
    (0, node_test_1.it)('two-sided rating: each fighter save tracks its own settlement independently', async () => {
        const kv = (0, _storage_js_1._makeMemoryKv)();
        await kv.set('save:winner', { character: { rankedRating: 1000 } });
        await kv.set('save:loser', { character: { rankedRating: 1000 } });
        const sid = (0, _reward_settlement_js_1.pvpSettlementId)('rating', BATTLE);
        const setRating = (v) => (c) => ({ ...c, rankedRating: v });
        // Winner side settles; loser side crashes before its write.
        strict_1.default.equal(await settleOnce(kv, 'save:winner', sid, 'rating-winner', setRating(1016)), 'credited');
        strict_1.default.equal(await settleOnce(kv, 'save:loser', sid, 'rating-loser', setRating(984), { crashBeforeWrite: true }), 'crashed');
        // Retry: winner already settled (skip), loser recovers.
        strict_1.default.equal(await settleOnce(kv, 'save:winner', sid, 'rating-winner', setRating(1016)), 'skipped');
        strict_1.default.equal(await settleOnce(kv, 'save:loser', sid, 'rating-loser', setRating(984)), 'credited', "loser's side recovers on its own");
        strict_1.default.equal((await kv.get('save:winner')).character.rankedRating, 1016);
        strict_1.default.equal((await kv.get('save:loser')).character.rankedRating, 984);
    });
    (0, node_test_1.it)('different settlement kinds in the same save do not collide', async () => {
        const kv = (0, _storage_js_1._makeMemoryKv)();
        await kv.set('save:winner', { character: { ryo: 100, rankedRating: 1000, itemStacks: [] } });
        const base = (0, _reward_settlement_js_1.pvpSettlementId)('base', BATTLE);
        const rating = (0, _reward_settlement_js_1.pvpSettlementId)('rating', BATTLE);
        const items = (0, _reward_settlement_js_1.pvpSettlementId)('items', BATTLE);
        strict_1.default.equal(await settleOnce(kv, 'save:winner', base, 'base', addRyo(75)), 'credited');
        strict_1.default.equal(await settleOnce(kv, 'save:winner', rating, 'rating-winner', (c) => ({ ...c, rankedRating: 1016 })), 'credited', 'rating is independent of base');
        strict_1.default.equal(await settleOnce(kv, 'save:winner', items, 'items', (c) => ({ ...c, ryo: Number(c.ryo) })), 'credited', 'items is independent');
        // Each is now idempotent on its own.
        strict_1.default.equal(await settleOnce(kv, 'save:winner', base, 'base', addRyo(75)), 'skipped');
        strict_1.default.equal(await settleOnce(kv, 'save:winner', rating, 'rating-winner', (c) => c), 'skipped');
        const finalChar = (await kv.get('save:winner')).character;
        strict_1.default.equal(finalChar.ryo, 175);
        strict_1.default.equal(finalChar.rankedRating, 1016);
    });
});
