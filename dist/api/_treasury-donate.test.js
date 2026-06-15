"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _treasury_donate_js_1 = require("./_treasury-donate.js");
// Pure decision core shared by api/clan/treasury/donate.ts and
// api/village/treasury/donate.ts. No IO — exercises the economic rules
// (allowed currency, per-call caps, sufficient balance / item ownership) and
// the resulting debit/credit math. Membership + auth live in the handlers and
// are out of scope here.
const RULES = {
    allowedCurrencies: ['ryo', 'fateShards', 'mythicSeals'],
    currencyCaps: { ryo: 1_000_000, fateShards: 1_000, mythicSeals: 100 },
    itemCountCap: 500,
};
(0, node_test_1.describe)('applyTreasuryDonation — currency', () => {
    (0, node_test_1.it)('debits donor and credits treasury on a valid donation', () => {
        const out = (0, _treasury_donate_js_1.applyTreasuryDonation)({ ryo: 100 }, { ryo: 500 }, { kind: 'currency', currency: 'ryo', amount: 200 }, RULES);
        node_assert_1.strict.equal(out.ok, true);
        if (!out.ok)
            return;
        node_assert_1.strict.equal(out.nextDonorChar.ryo, 300);
        node_assert_1.strict.equal(out.nextTreasury.ryo, 300);
    });
    (0, node_test_1.it)('starts from zero when the treasury lacks the currency yet', () => {
        const out = (0, _treasury_donate_js_1.applyTreasuryDonation)(null, { mythicSeals: 5 }, { kind: 'currency', currency: 'mythicSeals', amount: 5 }, RULES);
        node_assert_1.strict.equal(out.ok, true);
        if (!out.ok)
            return;
        node_assert_1.strict.equal(out.nextTreasury.mythicSeals, 5);
        node_assert_1.strict.equal(out.nextDonorChar.mythicSeals, 0);
    });
    (0, node_test_1.it)('rejects an unsupported currency', () => {
        const out = (0, _treasury_donate_js_1.applyTreasuryDonation)({}, { honorSeals: 10 }, { kind: 'currency', currency: 'honorSeals', amount: 1 }, RULES);
        node_assert_1.strict.equal(out.ok, false);
        if (out.ok)
            return;
        node_assert_1.strict.equal(out.status, 400);
    });
    (0, node_test_1.it)('rejects amounts below 1', () => {
        const out = (0, _treasury_donate_js_1.applyTreasuryDonation)({}, { ryo: 10 }, { kind: 'currency', currency: 'ryo', amount: 0 }, RULES);
        node_assert_1.strict.equal(out.ok, false);
    });
    (0, node_test_1.it)('rejects amounts over the per-call cap', () => {
        const out = (0, _treasury_donate_js_1.applyTreasuryDonation)({}, { ryo: 5_000_000 }, { kind: 'currency', currency: 'ryo', amount: 2_000_000 }, RULES);
        node_assert_1.strict.equal(out.ok, false);
        if (out.ok)
            return;
        node_assert_1.strict.match(out.error, /cap/);
    });
    (0, node_test_1.it)('rejects when the donor cannot afford it (no partial debit)', () => {
        const out = (0, _treasury_donate_js_1.applyTreasuryDonation)({ ryo: 50 }, { ryo: 30 }, { kind: 'currency', currency: 'ryo', amount: 100 }, RULES);
        node_assert_1.strict.equal(out.ok, false);
        if (out.ok)
            return;
        node_assert_1.strict.equal(out.status, 400);
        node_assert_1.strict.match(out.error, /Insufficient/);
    });
    (0, node_test_1.it)('floors fractional amounts', () => {
        const out = (0, _treasury_donate_js_1.applyTreasuryDonation)({ fateShards: 0 }, { fateShards: 10 }, { kind: 'currency', currency: 'fateShards', amount: 3.9 }, RULES);
        node_assert_1.strict.equal(out.ok, true);
        if (!out.ok)
            return;
        node_assert_1.strict.equal(out.nextTreasury.fateShards, 3);
        node_assert_1.strict.equal(out.nextDonorChar.fateShards, 7);
    });
});
(0, node_test_1.describe)('applyTreasuryDonation — item', () => {
    (0, node_test_1.it)('removes owned copies from inventory and adds a treasury stack', () => {
        const out = (0, _treasury_donate_js_1.applyTreasuryDonation)({ items: [] }, { inventory: ['sword', 'sword', 'shield'] }, { kind: 'item', itemId: 'sword', count: 2 }, RULES);
        node_assert_1.strict.equal(out.ok, true);
        if (!out.ok)
            return;
        node_assert_1.strict.deepEqual(out.nextDonorChar.inventory, ['shield']);
        node_assert_1.strict.deepEqual(out.nextTreasury.items, [{ itemId: 'sword', count: 2 }]);
    });
    (0, node_test_1.it)('donates a stackable held in itemStacks (drains the counted stack)', () => {
        const out = (0, _treasury_donate_js_1.applyTreasuryDonation)({ items: [] }, { inventory: ['shield'], itemStacks: [{ itemId: 'territory-control-scroll', count: 5 }] }, { kind: 'item', itemId: 'territory-control-scroll', count: 3 }, RULES);
        node_assert_1.strict.equal(out.ok, true);
        if (!out.ok)
            return;
        // unique gear untouched, counted stack drained by 3
        node_assert_1.strict.deepEqual(out.nextDonorChar.inventory, ['shield']);
        node_assert_1.strict.deepEqual(out.nextDonorChar.itemStacks, [{ itemId: 'territory-control-scroll', count: 2 }]);
        node_assert_1.strict.deepEqual(out.nextTreasury.items, [{ itemId: 'territory-control-scroll', count: 3 }]);
    });
    (0, node_test_1.it)('rejects donating more of a stackable than owned across both stores', () => {
        const out = (0, _treasury_donate_js_1.applyTreasuryDonation)({ items: [] }, { inventory: [], itemStacks: [{ itemId: 'pet-treat', count: 1 }] }, { kind: 'item', itemId: 'pet-treat', count: 2 }, RULES);
        node_assert_1.strict.equal(out.ok, false);
        if (out.ok)
            return;
        node_assert_1.strict.match(out.error, /do not own/);
    });
    (0, node_test_1.it)('merges into an existing treasury stack', () => {
        const out = (0, _treasury_donate_js_1.applyTreasuryDonation)({ items: [{ itemId: 'scroll', count: 3 }] }, { inventory: ['scroll', 'scroll'] }, { kind: 'item', itemId: 'scroll', count: 2 }, RULES);
        node_assert_1.strict.equal(out.ok, true);
        if (!out.ok)
            return;
        node_assert_1.strict.deepEqual(out.nextTreasury.items, [{ itemId: 'scroll', count: 5 }]);
        node_assert_1.strict.deepEqual(out.nextDonorChar.inventory, []);
    });
    (0, node_test_1.it)('rejects donating more copies than owned (no partial removal)', () => {
        const out = (0, _treasury_donate_js_1.applyTreasuryDonation)({ items: [] }, { inventory: ['gem'] }, { kind: 'item', itemId: 'gem', count: 2 }, RULES);
        node_assert_1.strict.equal(out.ok, false);
        if (out.ok)
            return;
        node_assert_1.strict.match(out.error, /do not own/);
    });
    (0, node_test_1.it)('rejects an item count over the per-call cap', () => {
        const inv = Array.from({ length: 600 }, () => 'coin');
        const out = (0, _treasury_donate_js_1.applyTreasuryDonation)({ items: [] }, { inventory: inv }, { kind: 'item', itemId: 'coin', count: 600 }, RULES);
        node_assert_1.strict.equal(out.ok, false);
        if (out.ok)
            return;
        node_assert_1.strict.match(out.error, /cap/);
    });
    (0, node_test_1.it)('defaults count handling: rejects count below 1', () => {
        const out = (0, _treasury_donate_js_1.applyTreasuryDonation)({ items: [] }, { inventory: ['x'] }, { kind: 'item', itemId: 'x', count: 0 }, RULES);
        node_assert_1.strict.equal(out.ok, false);
    });
});
(0, node_test_1.describe)('applyTreasuryDonation — guards', () => {
    (0, node_test_1.it)('404s when the donor save is missing', () => {
        const out = (0, _treasury_donate_js_1.applyTreasuryDonation)({}, null, { kind: 'currency', currency: 'ryo', amount: 1 }, RULES);
        node_assert_1.strict.equal(out.ok, false);
        if (out.ok)
            return;
        node_assert_1.strict.equal(out.status, 404);
    });
    (0, node_test_1.it)('does not mutate the inputs', () => {
        const treasury = { ryo: 10 };
        const donor = { ryo: 100 };
        (0, _treasury_donate_js_1.applyTreasuryDonation)(treasury, donor, { kind: 'currency', currency: 'ryo', amount: 5 }, RULES);
        node_assert_1.strict.equal(treasury.ryo, 10);
        node_assert_1.strict.equal(donor.ryo, 100);
    });
});
(0, node_test_1.describe)('cleanTreasuryItems', () => {
    (0, node_test_1.it)('merges duplicate ids and drops empties / bad entries', () => {
        const out = (0, _treasury_donate_js_1.cleanTreasuryItems)([
            { itemId: 'a', count: 1 },
            { itemId: 'a', count: 2 },
            { itemId: 'b', count: 0 },
            { itemId: '', count: 5 },
            null,
        ]);
        node_assert_1.strict.deepEqual(out, [{ itemId: 'a', count: 3 }]);
    });
});
