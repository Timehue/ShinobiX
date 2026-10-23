import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { computeBankInterest, bankInterestPercent, bankInterestPrincipalCap, BANK_INTEREST_PRINCIPAL_CAP_DIAL, BANK_INTEREST_WINDOW_MS } from './_bank-interest.js';
import { projectedBankInterest } from '../shared/bank-interest.js';

// Independent inline replica of the client (shinobij.client/src/screens/Bank.tsx
// + lib/village-upgrades.ts), kept SEPARATE from the port so a drift on either
// side fails the sweep below. If the client formula changes, both must change.
const C_PER_LEVEL = 0.01, C_MAX_LEVEL = 50, C_WINDOW = 24 * 60 * 60 * 1000;
// Mirror of Bank.tsx BANK_INTEREST_PRINCIPAL_CAP (M-2; 1M since the 2026-10
// rebalance #14): interest is paid on at most this much banked ryo.
const C_PRINCIPAL_CAP = 1_000_000;
function cInterestPercent(char: Record<string, unknown>): number {
    const up = (char.villageUpgrades && typeof char.villageUpgrades === 'object') ? char.villageUpgrades as Record<string, unknown> : {};
    const lvl = Math.min(C_MAX_LEVEL, Math.max(0, Math.floor(Number(up.bank ?? 0)) || 0));
    return lvl * C_PER_LEVEL;
}
// Bank.tsx: projectedInterest = max(0, floor(bankRyo * (interestPercent/100)));
//           canClaimInterest = bankRyo > 0 && interestPercent > 0 && now >= nextClaimAt
function cClaim(char: Record<string, unknown>, now: number) {
    const bankRyo = Number(char.bankRyo ?? 0) || 0;
    const interestPercent = cInterestPercent(char);
    const nextClaimAt = (Number(char.lastBankInterestAt ?? 0) || 0) + C_WINDOW;
    const projected = Math.max(0, Math.floor(Math.min(bankRyo, C_PRINCIPAL_CAP) * (interestPercent / 100)));
    const canClaim = bankRyo > 0 && interestPercent > 0 && now >= nextClaimAt && projected > 0;
    return { canClaim, projected, interestPercent, nextClaimAt };
}

describe('bankInterestPercent (verbatim villageUpgradeBonus bank)', () => {
    it('0.01% per bank level, clamped to 50 (max 0.5%/day)', () => {
        assert.equal(bankInterestPercent({}), 0);
        assert.equal(bankInterestPercent({ villageUpgrades: { bank: 0 } }), 0);
        assert.equal(bankInterestPercent({ villageUpgrades: { bank: 1 } }), 0.01);
        assert.equal(bankInterestPercent({ villageUpgrades: { bank: 20 } }), 0.2);
        assert.equal(bankInterestPercent({ villageUpgrades: { bank: 50 } }), 0.5);
        assert.equal(bankInterestPercent({ villageUpgrades: { bank: 999 } }), 0.5); // clamp
        assert.equal(bankInterestPercent({ villageUpgrades: { bank: -3 } }), 0);     // floor at 0
    });
});

describe('computeBankInterest matches the client across a sweep', () => {
    it('interest amount + eligibility equal the client for every case', () => {
        const banks = [0, 1, 7, 100, 399, 1000, 1_000_000, 12_345_678];
        const levels = [0, 1, 4, 20, 50, 999];
        const lasts = [0, 1_000_000, 5_000_000];
        const now = 100_000_000; // fixed server clock for the sweep
        let cases = 0;
        for (const bankRyo of banks) for (const bank of levels) for (const lastBankInterestAt of lasts) {
            const char = { bankRyo, lastBankInterestAt, villageUpgrades: { bank } };
            const server = computeBankInterest(char, now);
            const client = cClaim(char, now);
            assert.equal(projectedBankInterest(bankRyo, client.interestPercent), client.projected,
                'shared projection must preserve the independent pre-extraction formula');
            assert.equal(server.eligible, client.canClaim, `eligible @ bankRyo=${bankRyo} lvl=${bank} last=${lastBankInterestAt}`);
            // The credited amount must equal the client's projected interest whenever claimable.
            assert.equal(server.eligible ? server.interest : 0, client.canClaim ? client.projected : 0,
                `interest @ bankRyo=${bankRyo} lvl=${bank} last=${lastBankInterestAt}`);
            assert.equal(server.interestPercent, client.interestPercent);
            assert.equal(server.nextClaimAt, client.nextClaimAt);
            cases++;
        }
        assert.ok(cases >= 100, `swept ${cases} cases`);
    });
});

describe('computeBankInterest gate + reasons', () => {
    it('blocks within the 24h window, allows exactly at the boundary', () => {
        const char = { bankRyo: 1000, lastBankInterestAt: 1_000_000, villageUpgrades: { bank: 20 } }; // 0.2%
        assert.equal(computeBankInterest(char, 1_000_000 + BANK_INTEREST_WINDOW_MS - 1).eligible, false);
        assert.equal(computeBankInterest(char, 1_000_000 + BANK_INTEREST_WINDOW_MS - 1).reason, 'cooldown');
        const ok = computeBankInterest(char, 1_000_000 + BANK_INTEREST_WINDOW_MS);
        assert.equal(ok.eligible, true);
        assert.equal(ok.interest, 2); // floor(1000 * 0.2/100)
    });
    it('caps the interest-earning principal at 1M ryo (rebalance #14 passive ceiling)', () => {
        const t = 10 * BANK_INTEREST_WINDOW_MS;
        // At max bank (0.5%): under the cap scales linearly; at/above the cap the
        // payout flattens to floor(1M * 0.5%) = 5,000 regardless of balance.
        assert.equal(computeBankInterest({ bankRyo: 800_000, villageUpgrades: { bank: 50 } }, t).interest, 4_000);
        assert.equal(computeBankInterest({ bankRyo: 1_000_000, villageUpgrades: { bank: 50 } }, t).interest, 5_000);
        assert.equal(computeBankInterest({ bankRyo: 50_000_000, villageUpgrades: { bank: 50 } }, t).interest, 5_000);
    });
    it('the BANK_INTEREST_PRINCIPAL_CAP dial restores the old ceiling and ignores junk', () => {
        const t = 10 * BANK_INTEREST_WINDOW_MS;
        const rich = { bankRyo: 50_000_000, villageUpgrades: { bank: 50 } };
        const saved = process.env[BANK_INTEREST_PRINCIPAL_CAP_DIAL];
        try {
            delete process.env[BANK_INTEREST_PRINCIPAL_CAP_DIAL];
            assert.equal(bankInterestPrincipalCap(), 1_000_000, 'code default');
            process.env[BANK_INTEREST_PRINCIPAL_CAP_DIAL] = '10000000';
            assert.equal(bankInterestPrincipalCap(), 10_000_000, 'kill value');
            assert.equal(computeBankInterest(rich, t).interest, 50_000);
            // Out of range or unparseable falls back to the default rather than
            // zeroing or exploding the payout.
            for (const junk of ['0', '-5', '99999', '10000001', 'lots']) {
                process.env[BANK_INTEREST_PRINCIPAL_CAP_DIAL] = junk;
                assert.equal(computeBankInterest(rich, t).interest, 5_000, `dial=${junk}`);
            }
        } finally {
            if (saved === undefined) delete process.env[BANK_INTEREST_PRINCIPAL_CAP_DIAL];
            else process.env[BANK_INTEREST_PRINCIPAL_CAP_DIAL] = saved;
        }
    });
    it('reasons: no-upgrade / empty / too-small', () => {
        const t = 10 * BANK_INTEREST_WINDOW_MS;
        assert.equal(computeBankInterest({ bankRyo: 1000, villageUpgrades: { bank: 0 } }, t).reason, 'no-upgrade');
        assert.equal(computeBankInterest({ bankRyo: 0, villageUpgrades: { bank: 20 } }, t).reason, 'empty');
        // 19 ryo * 0.01% = 0.0019 -> floor 0 -> too-small
        assert.equal(computeBankInterest({ bankRyo: 19, villageUpgrades: { bank: 1 } }, t).reason, 'too-small');
    });
    it('never mints on garbage input', () => {
        assert.equal(computeBankInterest({}, 10 * BANK_INTEREST_WINDOW_MS).interest, 0);
        assert.equal(computeBankInterest({ bankRyo: 'oops', villageUpgrades: { bank: 'x' } } as unknown as Record<string, unknown>, 10 * BANK_INTEREST_WINDOW_MS).interest, 0);
    });
});
