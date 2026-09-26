import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    applyTreasuryCredit,
    applyTreasuryDonation,
    cleanTreasuryItems,
    treasuryCreditPlan,
    type DonationRules,
    type TreasuryDonation,
} from './_treasury-donate.js';
import { routeStoresDonation } from './_treasury-stores-donate.js';

describe('treasury credit plan (retry-safe donations, api/_save-debit-saga.ts)', () => {
    // The saga records the plan at debit time and applies it at credit time.
    // Applied to the treasury the debit read, it must be byte-for-byte the
    // nextTreasury the donation rules computed, or the refactor changed what
    // a donation credits.
    const RULES_ALL: DonationRules = {
        allowedCurrencies: ['ryo', 'honorSeals'],
        currencyCaps: { ryo: 200_000, honorSeals: 100_000 },
        itemCountCap: 1_000,
    };
    const treasury = { ryo: 12, honorSeals: 3, provisions: 7, items: [{ itemId: 'item-smoke-bomb', count: 1 }, { itemId: 'x', count: 0 }] };
    const donor = { ryo: 50_000, honorSeals: 50, inventory: ['item-smoke-bomb'], itemStacks: [{ itemId: 'ration-pack', count: 9 }, { itemId: 'hunt-torn-hide', count: 9 }] };
    const cases: Array<[string, TreasuryDonation, boolean]> = [
        ['currency', { kind: 'currency', currency: 'ryo', amount: 1_234 }, false],
        ['other currency', { kind: 'currency', currency: 'honorSeals', amount: 5 }, false],
        ['loose item', { kind: 'item', itemId: 'item-smoke-bomb', count: 1 }, false],
        ['routed rations', { kind: 'item', itemId: 'ration-pack', count: 4 }, true],
        ['routed material', { kind: 'item', itemId: 'hunt-torn-hide', count: 3 }, true],
    ];
    for (const [label, donation, routes] of cases) {
        it(`reproduces the donation rules' nextTreasury for a ${label} donation`, () => {
            const outcome = applyTreasuryDonation(treasury, donor, donation, RULES_ALL);
            assert.ok(outcome.ok);
            let expected = outcome.nextTreasury;
            let routed = null;
            if (routes) {
                const r = routeStoresDonation(treasury, outcome, donation, { 'hunt-torn-hide': 3 }, { materialPoints: true, now: Date.UTC(2026, 8, 25) });
                assert.ok(r.ok && r.routed, 'the case really routes');
                expected = r.nextTreasury;
                routed = r.routed;
            }
            assert.deepEqual(applyTreasuryCredit(treasury, treasuryCreditPlan(donation, routed)), expected);
        });
    }

    it('adds the same amounts to a LATER treasury without re-checking the donor', () => {
        const later = { ryo: 999, items: [{ itemId: 'item-smoke-bomb', count: 4 }] };
        assert.equal(applyTreasuryCredit(later, { kind: 'currency', currency: 'ryo', amount: 1 }).ryo, 1_000);
        assert.deepEqual(applyTreasuryCredit(later, { kind: 'item', itemId: 'item-smoke-bomb', count: 2 }).items, [{ itemId: 'item-smoke-bomb', count: 6 }]);
        assert.equal(applyTreasuryCredit(later, { kind: 'store', store: 'provisions', amount: 3 }).provisions, 3);
    });
});

// Pure decision core shared by api/clan/treasury/donate.ts and
// api/village/treasury/donate.ts. No IO — exercises the economic rules
// (allowed currency, per-call caps, sufficient balance / item ownership) and
// the resulting debit/credit math. Membership + auth live in the handlers and
// are out of scope here.

const RULES: DonationRules = {
    allowedCurrencies: ['ryo', 'fateShards', 'mythicSeals'],
    currencyCaps: { ryo: 1_000_000, fateShards: 1_000, mythicSeals: 100 },
    itemCountCap: 500,
};

describe('applyTreasuryDonation — currency', () => {
    it('debits donor and credits treasury on a valid donation', () => {
        const out = applyTreasuryDonation(
            { ryo: 100 },
            { ryo: 500 },
            { kind: 'currency', currency: 'ryo', amount: 200 },
            RULES,
        );
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal(out.nextDonorChar.ryo, 300);
        assert.equal(out.nextTreasury.ryo, 300);
    });

    it('starts from zero when the treasury lacks the currency yet', () => {
        const out = applyTreasuryDonation(null, { mythicSeals: 5 }, { kind: 'currency', currency: 'mythicSeals', amount: 5 }, RULES);
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal(out.nextTreasury.mythicSeals, 5);
        assert.equal(out.nextDonorChar.mythicSeals, 0);
    });

    it('rejects an unsupported currency', () => {
        const out = applyTreasuryDonation({}, { honorSeals: 10 }, { kind: 'currency', currency: 'honorSeals', amount: 1 }, RULES);
        assert.equal(out.ok, false);
        if (out.ok) return;
        assert.equal(out.status, 400);
    });

    it('rejects amounts below 1', () => {
        const out = applyTreasuryDonation({}, { ryo: 10 }, { kind: 'currency', currency: 'ryo', amount: 0 }, RULES);
        assert.equal(out.ok, false);
    });

    it('rejects amounts over the per-call cap', () => {
        const out = applyTreasuryDonation({}, { ryo: 5_000_000 }, { kind: 'currency', currency: 'ryo', amount: 2_000_000 }, RULES);
        assert.equal(out.ok, false);
        if (out.ok) return;
        assert.match(out.error, /cap/);
    });

    it('rejects when the donor cannot afford it (no partial debit)', () => {
        const out = applyTreasuryDonation({ ryo: 50 }, { ryo: 30 }, { kind: 'currency', currency: 'ryo', amount: 100 }, RULES);
        assert.equal(out.ok, false);
        if (out.ok) return;
        assert.equal(out.status, 400);
        assert.match(out.error, /Insufficient/);
    });

    it('floors fractional amounts', () => {
        const out = applyTreasuryDonation({ fateShards: 0 }, { fateShards: 10 }, { kind: 'currency', currency: 'fateShards', amount: 3.9 }, RULES);
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal(out.nextTreasury.fateShards, 3);
        assert.equal(out.nextDonorChar.fateShards, 7);
    });
});

describe('applyTreasuryDonation — item', () => {
    it('removes owned copies from inventory and adds a treasury stack', () => {
        const out = applyTreasuryDonation(
            { items: [] },
            { inventory: ['sword', 'sword', 'shield'] },
            { kind: 'item', itemId: 'sword', count: 2 },
            RULES,
        );
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.deepEqual(out.nextDonorChar.inventory, ['shield']);
        assert.deepEqual(out.nextTreasury.items, [{ itemId: 'sword', count: 2 }]);
    });

    it('donates a stackable held in itemStacks (drains the counted stack)', () => {
        const out = applyTreasuryDonation(
            { items: [] },
            { inventory: ['shield'], itemStacks: [{ itemId: 'territory-control-scroll', count: 5 }] },
            { kind: 'item', itemId: 'territory-control-scroll', count: 3 },
            RULES,
        );
        assert.equal(out.ok, true);
        if (!out.ok) return;
        // unique gear untouched, counted stack drained by 3
        assert.deepEqual(out.nextDonorChar.inventory, ['shield']);
        assert.deepEqual(out.nextDonorChar.itemStacks, [{ itemId: 'territory-control-scroll', count: 2 }]);
        assert.deepEqual(out.nextTreasury.items, [{ itemId: 'territory-control-scroll', count: 3 }]);
    });

    it('rejects donating more of a stackable than owned across both stores', () => {
        const out = applyTreasuryDonation(
            { items: [] },
            { inventory: [], itemStacks: [{ itemId: 'pet-treat', count: 1 }] },
            { kind: 'item', itemId: 'pet-treat', count: 2 },
            RULES,
        );
        assert.equal(out.ok, false);
        if (out.ok) return;
        assert.match(out.error, /do not own/);
    });

    it('merges into an existing treasury stack', () => {
        const out = applyTreasuryDonation(
            { items: [{ itemId: 'scroll', count: 3 }] },
            { inventory: ['scroll', 'scroll'] },
            { kind: 'item', itemId: 'scroll', count: 2 },
            RULES,
        );
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.deepEqual(out.nextTreasury.items, [{ itemId: 'scroll', count: 5 }]);
        assert.deepEqual(out.nextDonorChar.inventory, []);
    });

    it('rejects donating more copies than owned (no partial removal)', () => {
        const out = applyTreasuryDonation(
            { items: [] },
            { inventory: ['gem'] },
            { kind: 'item', itemId: 'gem', count: 2 },
            RULES,
        );
        assert.equal(out.ok, false);
        if (out.ok) return;
        assert.match(out.error, /do not own/);
    });

    it('rejects an item count over the per-call cap', () => {
        const inv = Array.from({ length: 600 }, () => 'coin');
        const out = applyTreasuryDonation({ items: [] }, { inventory: inv }, { kind: 'item', itemId: 'coin', count: 600 }, RULES);
        assert.equal(out.ok, false);
        if (out.ok) return;
        assert.match(out.error, /cap/);
    });

    it('defaults count handling: rejects count below 1', () => {
        const out = applyTreasuryDonation({ items: [] }, { inventory: ['x'] }, { kind: 'item', itemId: 'x', count: 0 }, RULES);
        assert.equal(out.ok, false);
    });
});

describe('applyTreasuryDonation — guards', () => {
    it('404s when the donor save is missing', () => {
        const out = applyTreasuryDonation({}, null, { kind: 'currency', currency: 'ryo', amount: 1 }, RULES);
        assert.equal(out.ok, false);
        if (out.ok) return;
        assert.equal(out.status, 404);
    });

    it('does not mutate the inputs', () => {
        const treasury = { ryo: 10 };
        const donor = { ryo: 100 };
        applyTreasuryDonation(treasury, donor, { kind: 'currency', currency: 'ryo', amount: 5 }, RULES);
        assert.equal(treasury.ryo, 10);
        assert.equal(donor.ryo, 100);
    });
});

describe('cleanTreasuryItems', () => {
    it('merges duplicate ids and drops empties / bad entries', () => {
        const out = cleanTreasuryItems([
            { itemId: 'a', count: 1 },
            { itemId: 'a', count: 2 },
            { itemId: 'b', count: 0 },
            { itemId: '', count: 5 },
            null,
        ]);
        assert.deepEqual(out, [{ itemId: 'a', count: 3 }]);
    });
});
