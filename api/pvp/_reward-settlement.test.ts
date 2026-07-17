import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _makeMemoryKv } from '../_storage.js';
import { pvpSettlementId, inspectPvpCredit, embedPvpSettlementReceipt } from './_reward-settlement.js';

// Regression for the PvP settlement two-write gap: a crash between the receipt
// write and the save write used to permanently lose a reward/rating. The fix
// puts the idempotency receipt INSIDE the credited save, so credit + receipt land
// in one atomic kv.set. These tests model the exact claim-rewards flow against
// the real in-memory KV and prove exactly-once + crash-recovery.

const BATTLE = 'pvp-550e8400-e29b-41d4-a716-446655440000';

describe('pvpSettlementId', () => {
    it('is deterministic, prefixed, and within the receipt-id charset/length', () => {
        const id = pvpSettlementId('rating', BATTLE);
        assert.equal(id, `pvp-rating-${BATTLE}`);
        assert.equal(id, pvpSettlementId('rating', BATTLE), 'deterministic');
        assert.ok(id.length >= 16 && id.length <= 80);
        assert.match(id, /^[A-Za-z0-9_-]+$/);
    });
    it('strips any out-of-charset characters defensively', () => {
        assert.match(pvpSettlementId('base', 'weird id:with*chars'), /^[A-Za-z0-9_-]+$/);
    });
});

// Model the claim-rewards settlement of one save exactly once. `applyCredit`
// mutates the character; a return of 'credited' means we wrote (fresh),
// 'skipped' means the receipt already existed (replay). `crashBeforeWrite`
// simulates a process death after computing the credit but before persisting it.
async function settleOnce(
    kv: ReturnType<typeof _makeMemoryKv>,
    saveKey: string,
    sid: string,
    fingerprint: string,
    applyCredit: (char: Record<string, unknown>) => Record<string, unknown>,
    opts: { crashBeforeWrite?: boolean } = {},
): Promise<'credited' | 'skipped' | 'crashed'> {
    const record = await kv.get<Record<string, unknown>>(saveKey);
    const char = record?.character as Record<string, unknown> | undefined;
    if (!record || !char) return 'skipped';
    const decision = inspectPvpCredit(char, sid, fingerprint);
    if (!decision.fresh) return 'skipped';
    const credited = applyCredit(char);
    const withReceipt = embedPvpSettlementReceipt(credited, decision.receipts, sid, fingerprint, Date.now());
    if (opts.crashBeforeWrite) return 'crashed'; // never persisted → nothing changed
    await kv.set(saveKey, { ...record, character: withReceipt });
    return 'credited';
}

const addRyo = (n: number) => (char: Record<string, unknown>) => ({ ...char, ryo: (Number(char.ryo) || 0) + n });

describe('atomic in-save PvP settlement', () => {
    it('credits exactly once, no matter how many times the claim is retried', async () => {
        const kv = _makeMemoryKv();
        await kv.set('save:winner', { character: { ryo: 100 } });
        const sid = pvpSettlementId('base', BATTLE);

        assert.equal(await settleOnce(kv, 'save:winner', sid, 'base', addRyo(75)), 'credited');
        for (let i = 0; i < 5; i++) {
            assert.equal(await settleOnce(kv, 'save:winner', sid, 'base', addRyo(75)), 'skipped', 'retry must not re-credit');
        }
        assert.equal((await kv.get<{ character: { ryo: number } }>('save:winner'))!.character.ryo, 175, 'credited exactly once');
    });

    it('the credit and the receipt persist together — a crash BEFORE the write loses neither (recovered on retry)', async () => {
        const kv = _makeMemoryKv();
        await kv.set('save:winner', { character: { ryo: 100 } });
        const sid = pvpSettlementId('base', BATTLE);

        // Attempt 1 computes the credit but dies before persisting.
        assert.equal(await settleOnce(kv, 'save:winner', sid, 'base', addRyo(75), { crashBeforeWrite: true }), 'crashed');
        // Nothing was written — neither the credit nor a blocking receipt.
        const afterCrash = (await kv.get<{ character: Record<string, unknown> }>('save:winner'))!.character;
        assert.equal(afterCrash.ryo, 100, 'no partial credit');
        assert.ok(!Array.isArray(afterCrash.serverSettlementReceipts) || afterCrash.serverSettlementReceipts.length === 0, 'no orphan receipt to block the retry');

        // Retry recovers it — credited exactly once thereafter.
        assert.equal(await settleOnce(kv, 'save:winner', sid, 'base', addRyo(75)), 'credited', 'retry recovers the lost credit');
        assert.equal(await settleOnce(kv, 'save:winner', sid, 'base', addRyo(75)), 'skipped');
        assert.equal((await kv.get<{ character: { ryo: number } }>('save:winner'))!.character.ryo, 175);
    });

    it('a crash AFTER the atomic write leaves credit+receipt together, so the retry skips', async () => {
        const kv = _makeMemoryKv();
        await kv.set('save:winner', { character: { ryo: 100 } });
        const sid = pvpSettlementId('base', BATTLE);
        // Normal write = credit + receipt in one kv.set (atomic). A "crash after"
        // is indistinguishable from a normal completed write for the retry.
        assert.equal(await settleOnce(kv, 'save:winner', sid, 'base', addRyo(75)), 'credited');
        assert.equal(await settleOnce(kv, 'save:winner', sid, 'base', addRyo(75)), 'skipped');
        assert.equal((await kv.get<{ character: { ryo: number } }>('save:winner'))!.character.ryo, 175);
    });

    it('two-sided rating: each fighter save tracks its own settlement independently', async () => {
        const kv = _makeMemoryKv();
        await kv.set('save:winner', { character: { rankedRating: 1000 } });
        await kv.set('save:loser', { character: { rankedRating: 1000 } });
        const sid = pvpSettlementId('rating', BATTLE);
        const setRating = (v: number) => (c: Record<string, unknown>) => ({ ...c, rankedRating: v });

        // Winner side settles; loser side crashes before its write.
        assert.equal(await settleOnce(kv, 'save:winner', sid, 'rating-winner', setRating(1016)), 'credited');
        assert.equal(await settleOnce(kv, 'save:loser', sid, 'rating-loser', setRating(984), { crashBeforeWrite: true }), 'crashed');

        // Retry: winner already settled (skip), loser recovers.
        assert.equal(await settleOnce(kv, 'save:winner', sid, 'rating-winner', setRating(1016)), 'skipped');
        assert.equal(await settleOnce(kv, 'save:loser', sid, 'rating-loser', setRating(984)), 'credited', "loser's side recovers on its own");

        assert.equal((await kv.get<{ character: { rankedRating: number } }>('save:winner'))!.character.rankedRating, 1016);
        assert.equal((await kv.get<{ character: { rankedRating: number } }>('save:loser'))!.character.rankedRating, 984);
    });

    it('different settlement kinds in the same save do not collide', async () => {
        const kv = _makeMemoryKv();
        await kv.set('save:winner', { character: { ryo: 100, rankedRating: 1000, itemStacks: [] } });
        const base = pvpSettlementId('base', BATTLE);
        const rating = pvpSettlementId('rating', BATTLE);
        const items = pvpSettlementId('items', BATTLE);

        assert.equal(await settleOnce(kv, 'save:winner', base, 'base', addRyo(75)), 'credited');
        assert.equal(await settleOnce(kv, 'save:winner', rating, 'rating-winner', (c) => ({ ...c, rankedRating: 1016 })), 'credited', 'rating is independent of base');
        assert.equal(await settleOnce(kv, 'save:winner', items, 'items', (c) => ({ ...c, ryo: Number(c.ryo) })), 'credited', 'items is independent');
        // Each is now idempotent on its own.
        assert.equal(await settleOnce(kv, 'save:winner', base, 'base', addRyo(75)), 'skipped');
        assert.equal(await settleOnce(kv, 'save:winner', rating, 'rating-winner', (c) => c), 'skipped');
        const finalChar = (await kv.get<{ character: Record<string, unknown> }>('save:winner'))!.character;
        assert.equal(finalChar.ryo, 175);
        assert.equal(finalChar.rankedRating, 1016);
    });
});
