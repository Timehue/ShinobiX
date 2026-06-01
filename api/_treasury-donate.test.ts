import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyTreasuryDonation, cleanTreasuryItems, type DonationRules } from './_treasury-donate.js';

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
