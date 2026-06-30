import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { daysSince, applyPlayerTax } from './_war-tax.js';

const TODAY = '2026-06-29';

describe('war-tax: daysSince', () => {
    it('empty last date counts as 1 day owed (never taxed)', () => {
        assert.equal(daysSince('', TODAY), 1);
    });
    it('same day → 0, three days ago → 3', () => {
        assert.equal(daysSince('2026-06-29', TODAY), 0);
        assert.equal(daysSince('2026-06-26', TODAY), 3);
    });
    it('clock skew (future) → negative', () => {
        assert.ok(daysSince('2026-07-01', TODAY) < 0);
    });
});

describe('war-tax: applyPlayerTax', () => {
    it('Academy Students (level < 15) are a total no-op (no stamp, no write)', () => {
        const o = applyPlayerTax({ ryo: 10_000_000, bankRyo: 0, level: 14, lastTaxDate: '' }, { sectorsControlled: 0, today: TODAY });
        assert.equal(o.taxed, false);
        assert.equal(o.noWrite, true);
        assert.equal(o.nextRyo, 10_000_000);
        assert.equal(o.nextLastTaxDate, ''); // unchanged
    });

    it('a full-8 village (0% tier) debits nothing but stamps the day', () => {
        const o = applyPlayerTax({ ryo: 2_000_000, bankRyo: 0, level: 80, lastTaxDate: '2026-06-28' }, { sectorsControlled: 8, today: TODAY });
        assert.equal(o.taxed, false);
        assert.equal(o.nextRyo, 2_000_000);
        assert.equal(o.nextLastTaxDate, TODAY);
        assert.equal(o.noWrite, false); // stamp changed → write
    });

    it('a 0% tier already stamped today is a true no-op', () => {
        const o = applyPlayerTax({ ryo: 2_000_000, bankRyo: 0, level: 80, lastTaxDate: TODAY }, { sectorsControlled: 8, today: TODAY });
        assert.equal(o.noWrite, true);
    });

    it('taxes a conquered village (3 sectors → 3.5%) from the wallet, 50/50 split', () => {
        // base = 600k − 5k = 595k; perDay = floor(595k·0.035)=20,825; 3 days → 62,475.
        const o = applyPlayerTax({ ryo: 600_000, bankRyo: 0, level: 50, lastTaxDate: '2026-06-26' }, { sectorsControlled: 3, today: TODAY });
        assert.equal(o.taxed, true);
        assert.equal(o.owed, 62_475);
        assert.equal(o.fromWallet, 62_475);
        assert.equal(o.fromBank, 0);
        assert.equal(o.nextRyo, 600_000 - 62_475);
        assert.equal(o.toBurn + o.toTreasury, 62_475);
        assert.equal(o.toBurn, Math.round(62_475 * 0.5));
        assert.equal(o.noWrite, false);
    });

    it('spills into bank ryo when the wallet cannot cover the bill', () => {
        // 0 sectors → 5%; base = (10k+1M)−5k = 1,005,000; perDay = 50,250; 1 day.
        const o = applyPlayerTax({ ryo: 10_000, bankRyo: 1_000_000, level: 80, lastTaxDate: '' }, { sectorsControlled: 0, today: TODAY });
        assert.equal(o.owed, 50_250);
        assert.equal(o.fromWallet, 10_000);
        assert.equal(o.fromBank, 40_250);
        assert.equal(o.nextRyo, 0);
        assert.equal(o.nextBankRyo, 1_000_000 - 40_250);
    });

    it('catch-up is capped at 3 days even after a long absence', () => {
        // last = 19 days ago, but only 3 days are charged.
        const o = applyPlayerTax({ ryo: 600_000, bankRyo: 0, level: 50, lastTaxDate: '2026-06-10' }, { sectorsControlled: 3, today: TODAY });
        assert.equal(o.owed, 62_475); // == the 3-day bill, not 19 days
    });

    it('a player under the wealth exemption pays nothing but is stamped', () => {
        const o = applyPlayerTax({ ryo: 3_000, bankRyo: 1_000, level: 20, lastTaxDate: '2026-06-26' }, { sectorsControlled: 0, today: TODAY });
        assert.equal(o.taxed, false);
        assert.equal(o.nextLastTaxDate, TODAY);
    });
});
