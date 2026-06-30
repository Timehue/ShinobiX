"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _war_tax_js_1 = require("./_war-tax.js");
const TODAY = '2026-06-29';
(0, node_test_1.describe)('war-tax: daysSince', () => {
    (0, node_test_1.it)('empty last date counts as 1 day owed (never taxed)', () => {
        node_assert_1.strict.equal((0, _war_tax_js_1.daysSince)('', TODAY), 1);
    });
    (0, node_test_1.it)('same day → 0, three days ago → 3', () => {
        node_assert_1.strict.equal((0, _war_tax_js_1.daysSince)('2026-06-29', TODAY), 0);
        node_assert_1.strict.equal((0, _war_tax_js_1.daysSince)('2026-06-26', TODAY), 3);
    });
    (0, node_test_1.it)('clock skew (future) → negative', () => {
        node_assert_1.strict.ok((0, _war_tax_js_1.daysSince)('2026-07-01', TODAY) < 0);
    });
});
(0, node_test_1.describe)('war-tax: applyPlayerTax', () => {
    (0, node_test_1.it)('Academy Students (level < 15) are a total no-op (no stamp, no write)', () => {
        const o = (0, _war_tax_js_1.applyPlayerTax)({ ryo: 10_000_000, bankRyo: 0, level: 14, lastTaxDate: '' }, { sectorsControlled: 0, today: TODAY });
        node_assert_1.strict.equal(o.taxed, false);
        node_assert_1.strict.equal(o.noWrite, true);
        node_assert_1.strict.equal(o.nextRyo, 10_000_000);
        node_assert_1.strict.equal(o.nextLastTaxDate, ''); // unchanged
    });
    (0, node_test_1.it)('a full-8 village (0% tier) debits nothing but stamps the day', () => {
        const o = (0, _war_tax_js_1.applyPlayerTax)({ ryo: 2_000_000, bankRyo: 0, level: 80, lastTaxDate: '2026-06-28' }, { sectorsControlled: 8, today: TODAY });
        node_assert_1.strict.equal(o.taxed, false);
        node_assert_1.strict.equal(o.nextRyo, 2_000_000);
        node_assert_1.strict.equal(o.nextLastTaxDate, TODAY);
        node_assert_1.strict.equal(o.noWrite, false); // stamp changed → write
    });
    (0, node_test_1.it)('a 0% tier already stamped today is a true no-op', () => {
        const o = (0, _war_tax_js_1.applyPlayerTax)({ ryo: 2_000_000, bankRyo: 0, level: 80, lastTaxDate: TODAY }, { sectorsControlled: 8, today: TODAY });
        node_assert_1.strict.equal(o.noWrite, true);
    });
    (0, node_test_1.it)('taxes a conquered village (3 sectors → 3.5%) from the wallet, 50/50 split', () => {
        // base = 600k − 5k = 595k; perDay = floor(595k·0.035)=20,825; 3 days → 62,475.
        const o = (0, _war_tax_js_1.applyPlayerTax)({ ryo: 600_000, bankRyo: 0, level: 50, lastTaxDate: '2026-06-26' }, { sectorsControlled: 3, today: TODAY });
        node_assert_1.strict.equal(o.taxed, true);
        node_assert_1.strict.equal(o.owed, 62_475);
        node_assert_1.strict.equal(o.fromWallet, 62_475);
        node_assert_1.strict.equal(o.fromBank, 0);
        node_assert_1.strict.equal(o.nextRyo, 600_000 - 62_475);
        node_assert_1.strict.equal(o.toBurn + o.toTreasury, 62_475);
        node_assert_1.strict.equal(o.toBurn, Math.round(62_475 * 0.5));
        node_assert_1.strict.equal(o.noWrite, false);
    });
    (0, node_test_1.it)('spills into bank ryo when the wallet cannot cover the bill', () => {
        // 0 sectors → 5%; base = (10k+1M)−5k = 1,005,000; perDay = 50,250; 1 day.
        const o = (0, _war_tax_js_1.applyPlayerTax)({ ryo: 10_000, bankRyo: 1_000_000, level: 80, lastTaxDate: '' }, { sectorsControlled: 0, today: TODAY });
        node_assert_1.strict.equal(o.owed, 50_250);
        node_assert_1.strict.equal(o.fromWallet, 10_000);
        node_assert_1.strict.equal(o.fromBank, 40_250);
        node_assert_1.strict.equal(o.nextRyo, 0);
        node_assert_1.strict.equal(o.nextBankRyo, 1_000_000 - 40_250);
    });
    (0, node_test_1.it)('catch-up is capped at 3 days even after a long absence', () => {
        // last = 19 days ago, but only 3 days are charged.
        const o = (0, _war_tax_js_1.applyPlayerTax)({ ryo: 600_000, bankRyo: 0, level: 50, lastTaxDate: '2026-06-10' }, { sectorsControlled: 3, today: TODAY });
        node_assert_1.strict.equal(o.owed, 62_475); // == the 3-day bill, not 19 days
    });
    (0, node_test_1.it)('a player under the wealth exemption pays nothing but is stamped', () => {
        const o = (0, _war_tax_js_1.applyPlayerTax)({ ryo: 3_000, bankRyo: 1_000, level: 20, lastTaxDate: '2026-06-26' }, { sectorsControlled: 0, today: TODAY });
        node_assert_1.strict.equal(o.taxed, false);
        node_assert_1.strict.equal(o.nextLastTaxDate, TODAY);
    });
});
