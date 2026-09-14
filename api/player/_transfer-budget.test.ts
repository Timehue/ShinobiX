process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * F8: player-to-player transfers were capped per CALL but not in aggregate, so
 * at 20 calls/60s the real ryo ceiling was 4,000,000 a minute.
 *
 * The ceiling is SEND-side and tiered, and receiving is deliberately untouched
 * at every tier. RuneScape's 2008 trade limit capped what players could give
 * away, broke legitimate play, and was removed in 2011 — the genre's conclusion
 * is that RMT controls belong on the sender and on untrusted accounts, never on
 * everyone.
 */

let kv: typeof import('../_storage.js').kv;
let mod: typeof import('./_transfer-budget.js');

const SENDER = 'bigspender';
const NOW = 1_800_000_000_000;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    mod = await import('./_transfer-budget.js');
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

describe('the rolling window', () => {
    it('counts only what is still inside 24 hours', () => {
        const stamps = [
            [NOW - 30 * 60 * 60 * 1000, 500_000],  // aged out
            [NOW - 2 * 60 * 60 * 1000, 100_000],
            [NOW - 60_000, 50_000],
        ];
        const { spent, kept } = mod.sumWindow(stamps, NOW);
        assert.equal(spent, 150_000, 'the 30-hour-old transfer no longer counts');
        assert.equal(kept.length, 2);
    });

    it('is a rolling window, not a UTC day', () => {
        // A day boundary is doubled for free by sending at 23:59 and again at
        // 00:01, which selects for players who know the trick.
        const justInside = mod.sumWindow([[NOW - mod.TRANSFER_WINDOW_MS + 1_000, 900_000]], NOW);
        assert.equal(justInside.spent, 900_000, 'still counted at 23h59m');
        const justOutside = mod.sumWindow([[NOW - mod.TRANSFER_WINDOW_MS - 1_000, 900_000]], NOW);
        assert.equal(justOutside.spent, 0);
    });

    it('ignores malformed entries rather than trusting them', () => {
        const { spent } = mod.sumWindow([null, 'x', [NOW], [NOW, -5], [NOW, 'abc'], [NOW, 10]], NOW);
        assert.equal(spent, 10);
    });
});

describe('sender trust tier', () => {
    it('restricts an account below the PvP newcomer floor', async () => {
        assert.equal(await mod.senderTrustTier(SENDER, { level: 5 }), 'restricted');
    });

    it('restricts an account younger than the Vanguard account-age floor', async () => {
        assert.equal(await mod.senderTrustTier(SENDER, { level: 40, createdAt: Date.now() - 60_000 }), 'restricted');
    });

    it('trusts a settled account', async () => {
        assert.equal(
            await mod.senderTrustTier(SENDER, { level: 40, createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
            'trusted',
        );
    });

    it('fails OPEN for a legacy save with no createdAt', async () => {
        // Legacy records predate the field; an unknowable age must never strand
        // a real player's transfer.
        assert.equal(await mod.senderTrustTier(SENDER, { level: 40 }), 'trusted');
        assert.equal(await mod.senderTrustTier(SENDER, null), 'trusted');
    });
});

describe('the outbound budget', () => {
    it('lets an ordinary transfer through and reports what is left', async () => {
        const out = await mod.checkOutboundBudget(SENDER, 'ryo', 50_000, 'trusted', NOW);
        assert.equal(out.ok, true);
        assert.equal(out.remaining, mod.TRUSTED_OUTBOUND.ryo - 50_000);
    });

    it('refuses the transfer that would cross the ceiling', async () => {
        await mod.chargeOutboundBudget(SENDER, 'ryo', 950_000, NOW);
        const out = await mod.checkOutboundBudget(SENDER, 'ryo', 100_000, 'trusted', NOW);
        assert.equal(out.ok, false);
        assert.match(String(out.ok === false && out.error), /50,000 more ryo/, 'the message says exactly how much is left');
    });

    it('holds an untrusted sender to a far lower ceiling', async () => {
        const ok = await mod.checkOutboundBudget(SENDER, 'ryo', 25_000, 'restricted', NOW);
        assert.equal(ok.ok, true, 'the restricted ceiling is still a usable amount');
        const over = await mod.checkOutboundBudget(SENDER, 'ryo', 25_001, 'restricted', NOW);
        assert.equal(over.ok, false);
    });

    it('frees the budget back up as transfers age out', async () => {
        await mod.chargeOutboundBudget(SENDER, 'ryo', 1_000_000, NOW - 25 * 60 * 60 * 1000);
        const out = await mod.checkOutboundBudget(SENDER, 'ryo', 1_000_000, 'trusted', NOW);
        assert.equal(out.ok, true, 'yesterday\'s transfers do not hold today hostage');
    });

    it('budgets each currency separately', async () => {
        await mod.chargeOutboundBudget(SENDER, 'ryo', 1_000_000, NOW);
        const shards = await mod.checkOutboundBudget(SENDER, 'fateShards', 100, 'trusted', NOW);
        assert.equal(shards.ok, true, 'spending ryo must not lock the premium currencies');
    });

    it('never charges a refused transfer', async () => {
        const before = await mod.checkOutboundBudget(SENDER, 'ryo', 1, 'trusted', NOW);
        await mod.checkOutboundBudget(SENDER, 'ryo', 5_000_000, 'trusted', NOW);
        const after = await mod.checkOutboundBudget(SENDER, 'ryo', 1, 'trusted', NOW);
        assert.equal(after.spent, before.spent, 'checking is not charging');
    });

    it('does not forgive spend when the ledger row overflows', async () => {
        // The row is bounded at 200 stamps, and it used to be bounded with
        // `kept.slice(-200)` — which DROPPED the oldest stamps. Those stamps are
        // still inside the 24h window, so their spend was forgiven: the budget
        // reset itself. At 30 calls/minute a sender reaches 200 stamps in about
        // seven minutes of tiny transfers, and every gift after that erased one
        // of their own earlier, possibly very large, spends.
        const big = 500_000;
        await mod.chargeOutboundBudget(SENDER, 'ryo', big, NOW);
        for (let i = 0; i < 260; i += 1) {
            await mod.chargeOutboundBudget(SENDER, 'ryo', 1, NOW + 1_000 + i);
        }
        const seen = await mod.checkOutboundBudget(SENDER, 'ryo', 1, 'trusted', NOW + 300_000);
        assert.equal(seen.spent, big + 260, 'every ryo spent in the window must still be counted');
        assert.equal(seen.remaining, mod.outboundLimit('ryo', 'trusted') - (big + 260) - 1,
            'the large early spend still eats the sender\'s remaining budget');
        // And the forgiven spend really would have re-opened the door: dropping
        // the oldest stamp would have handed back the whole 500,000.
        assert.ok(seen.spent > big, 'the overflow must not have evicted the big early transfer');
    });

    it('keeps the bounded row from growing without limit', async () => {
        for (let i = 0; i < 400; i += 1) {
            await mod.chargeOutboundBudget(SENDER, 'ryo', 2, NOW + i);
        }
        const row = await kv.get<{ stamps: unknown[] }>(mod.transferBudgetKey(SENDER, 'ryo'));
        assert.ok(Array.isArray(row?.stamps), 'the ledger row is a stamp array');
        assert.ok((row?.stamps.length ?? 0) <= 200, `row stayed bounded, got ${row?.stamps.length}`);
        const seen = await mod.checkOutboundBudget(SENDER, 'ryo', 1, 'trusted', NOW + 1_000);
        assert.equal(seen.spent, 800, 'bounding coalesces spend rather than discarding it');
    });

    it('serialises concurrent charges instead of losing all but one', async () => {
        // Unlocked, this was a read-modify-write race: twenty pipelined gifts
        // each read the same ledger and the last write won, so the budget never
        // accumulated and the cap did nothing. Both treasury doors charge
        // outside any settlement lock, so this is their only protection.
        await Promise.all(Array.from({ length: 20 }, (_, i) =>
            mod.chargeOutboundBudget(SENDER, 'ryo', 10_000, NOW + i)));
        const seen = await mod.checkOutboundBudget(SENDER, 'ryo', 1, 'trusted', NOW + 60_000);
        assert.equal(seen.spent, 200_000, 'all twenty charges must survive');
    });
});
