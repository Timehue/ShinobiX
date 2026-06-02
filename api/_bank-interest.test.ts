import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { computeBankInterest, bankInterestPercent, BANK_INTEREST_WINDOW_MS } from './_bank-interest.js';

// Independent inline replica of the client (shinobij.client/src/screens/Bank.tsx
// + lib/village-upgrades.ts), kept SEPARATE from the port so a drift on either
// side fails the sweep below. If the client formula changes, both must change.
const C_PER_LEVEL = 0.25, C_MAX_LEVEL = 50, C_WINDOW = 24 * 60 * 60 * 1000;
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
    const projected = Math.max(0, Math.floor(bankRyo * (interestPercent / 100)));
    const canClaim = bankRyo > 0 && interestPercent > 0 && now >= nextClaimAt && projected > 0;
    return { canClaim, projected, interestPercent, nextClaimAt };
}

describe('bankInterestPercent (verbatim villageUpgradeBonus bank)', () => {
    it('0.25% per bank level, clamped to 50', () => {
        assert.equal(bankInterestPercent({}), 0);
        assert.equal(bankInterestPercent({ villageUpgrades: { bank: 0 } }), 0);
        assert.equal(bankInterestPercent({ villageUpgrades: { bank: 1 } }), 0.25);
        assert.equal(bankInterestPercent({ villageUpgrades: { bank: 20 } }), 5);
        assert.equal(bankInterestPercent({ villageUpgrades: { bank: 50 } }), 12.5);
        assert.equal(bankInterestPercent({ villageUpgrades: { bank: 999 } }), 12.5); // clamp
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
        const char = { bankRyo: 1000, lastBankInterestAt: 1_000_000, villageUpgrades: { bank: 20 } }; // 5%
        assert.equal(computeBankInterest(char, 1_000_000 + BANK_INTEREST_WINDOW_MS - 1).eligible, false);
        assert.equal(computeBankInterest(char, 1_000_000 + BANK_INTEREST_WINDOW_MS - 1).reason, 'cooldown');
        const ok = computeBankInterest(char, 1_000_000 + BANK_INTEREST_WINDOW_MS);
        assert.equal(ok.eligible, true);
        assert.equal(ok.interest, 50); // floor(1000 * 5/100)
    });
    it('reasons: no-upgrade / empty / too-small', () => {
        const t = 10 * BANK_INTEREST_WINDOW_MS;
        assert.equal(computeBankInterest({ bankRyo: 1000, villageUpgrades: { bank: 0 } }, t).reason, 'no-upgrade');
        assert.equal(computeBankInterest({ bankRyo: 0, villageUpgrades: { bank: 20 } }, t).reason, 'empty');
        // 19 ryo * 0.25% = 0.0475 -> floor 0 -> too-small
        assert.equal(computeBankInterest({ bankRyo: 19, villageUpgrades: { bank: 1 } }, t).reason, 'too-small');
    });
    it('never mints on garbage input', () => {
        assert.equal(computeBankInterest({}, 10 * BANK_INTEREST_WINDOW_MS).interest, 0);
        assert.equal(computeBankInterest({ bankRyo: 'oops', villageUpgrades: { bank: 'x' } } as unknown as Record<string, unknown>, 10 * BANK_INTEREST_WINDOW_MS).interest, 0);
    });
});
