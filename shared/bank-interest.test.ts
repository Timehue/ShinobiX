import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { BANK_INTEREST_PRINCIPAL_CAP, BANK_INTEREST_WINDOW_MS, projectedBankInterest } from './bank-interest.js';

describe('public bank interest projection', () => {
    it('preserves the principal cap, whole-ryo rounding, and claim window', () => {
        // 2026-10 rebalance #14: 10M -> 1M, so a max Bank pays at most 5,000/day.
        assert.equal(BANK_INTEREST_PRINCIPAL_CAP, 1_000_000);
        assert.equal(BANK_INTEREST_WINDOW_MS, 86_400_000);
        const cases = [
            [-1, 0.5, 0], [0, 0.5, 0], [199, 0.5, 0], [200, 0.5, 1], [201, 0.5, 1],
            [1_000, 0.2, 2], [19_999, 0.01, 1], [20_000, 0.01, 2],
            [999_999, 0.5, 4_999], [1_000_000, 0.5, 5_000],
            [1_000_001, 0.5, 5_000], [50_000_000, 0.5, 5_000],
            [1_000_000, 0, 0], [200, -0.5, 0],
        ];
        for (const [balance, rate, expected] of cases) {
            assert.equal(projectedBankInterest(balance, rate), expected, `balance=${balance}, rate=${rate}`);
        }
    });

    it('an explicit principal cap (the server dial) replaces the default only where it binds', () => {
        assert.equal(projectedBankInterest(50_000_000, 0.5, 10_000_000), 50_000, 'kill value restores the old ceiling');
        assert.equal(projectedBankInterest(800_000, 0.5, 10_000_000), 4_000, 'below either cap the rate is unchanged');
        assert.equal(projectedBankInterest(800_000, 0.5), 4_000);
    });

    it('leaves non-finite input handling with the existing callers', () => {
        assert.equal(projectedBankInterest(Infinity, 0.5), 5_000);
        assert.equal(projectedBankInterest(-Infinity, 0.5), 0);
        assert.ok(Number.isNaN(projectedBankInterest(NaN, 0.5)));
        assert.ok(Number.isNaN(projectedBankInterest(200, NaN)));
        assert.ok(Number.isNaN(projectedBankInterest(0, Infinity)));
    });
});
