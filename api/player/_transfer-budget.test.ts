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
});
