import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { BANK_INTEREST_PRINCIPAL_CAP, BANK_INTEREST_WINDOW_MS, projectedBankInterest } from './bank-interest.js';

describe('public bank interest projection', () => {
    it('preserves the principal cap, whole-ryo rounding, and claim window', () => {
        assert.equal(BANK_INTEREST_PRINCIPAL_CAP, 10_000_000);
        assert.equal(BANK_INTEREST_WINDOW_MS, 86_400_000);
        const cases = [
            [-1, 0.5, 0], [0, 0.5, 0], [199, 0.5, 0], [200, 0.5, 1], [201, 0.5, 1],
            [1_000, 0.2, 2], [19_999, 0.01, 1], [20_000, 0.01, 2],
            [9_999_999, 0.5, 49_999], [10_000_000, 0.5, 50_000],
            [10_000_001, 0.5, 50_000], [50_000_000, 0.5, 50_000],
            [1_000_000, 0, 0], [200, -0.5, 0],
        ];
        for (const [balance, rate, expected] of cases) {
            assert.equal(projectedBankInterest(balance, rate), expected, `balance=${balance}, rate=${rate}`);
        }
    });

    it('leaves non-finite input handling with the existing callers', () => {
        assert.equal(projectedBankInterest(Infinity, 0.5), 50_000);
        assert.equal(projectedBankInterest(-Infinity, 0.5), 0);
        assert.ok(Number.isNaN(projectedBankInterest(NaN, 0.5)));
        assert.ok(Number.isNaN(projectedBankInterest(200, NaN)));
        assert.ok(Number.isNaN(projectedBankInterest(0, Infinity)));
    });
});
