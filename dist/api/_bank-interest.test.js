"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _bank_interest_js_1 = require("./_bank-interest.js");
// Independent inline replica of the client (shinobij.client/src/screens/Bank.tsx
// + lib/village-upgrades.ts), kept SEPARATE from the port so a drift on either
// side fails the sweep below. If the client formula changes, both must change.
const C_PER_LEVEL = 0.01, C_MAX_LEVEL = 50, C_WINDOW = 24 * 60 * 60 * 1000;
// Mirror of Bank.tsx BANK_INTEREST_PRINCIPAL_CAP (M-2): interest is paid on at
// most this much banked ryo.
const C_PRINCIPAL_CAP = 10_000_000;
function cInterestPercent(char) {
    const up = (char.villageUpgrades && typeof char.villageUpgrades === 'object') ? char.villageUpgrades : {};
    const lvl = Math.min(C_MAX_LEVEL, Math.max(0, Math.floor(Number(up.bank ?? 0)) || 0));
    return lvl * C_PER_LEVEL;
}
// Bank.tsx: projectedInterest = max(0, floor(bankRyo * (interestPercent/100)));
//           canClaimInterest = bankRyo > 0 && interestPercent > 0 && now >= nextClaimAt
function cClaim(char, now) {
    const bankRyo = Number(char.bankRyo ?? 0) || 0;
    const interestPercent = cInterestPercent(char);
    const nextClaimAt = (Number(char.lastBankInterestAt ?? 0) || 0) + C_WINDOW;
    const projected = Math.max(0, Math.floor(Math.min(bankRyo, C_PRINCIPAL_CAP) * (interestPercent / 100)));
    const canClaim = bankRyo > 0 && interestPercent > 0 && now >= nextClaimAt && projected > 0;
    return { canClaim, projected, interestPercent, nextClaimAt };
}
(0, node_test_1.describe)('bankInterestPercent (verbatim villageUpgradeBonus bank)', () => {
    (0, node_test_1.it)('0.01% per bank level, clamped to 50 (max 0.5%/day)', () => {
        node_assert_1.strict.equal((0, _bank_interest_js_1.bankInterestPercent)({}), 0);
        node_assert_1.strict.equal((0, _bank_interest_js_1.bankInterestPercent)({ villageUpgrades: { bank: 0 } }), 0);
        node_assert_1.strict.equal((0, _bank_interest_js_1.bankInterestPercent)({ villageUpgrades: { bank: 1 } }), 0.01);
        node_assert_1.strict.equal((0, _bank_interest_js_1.bankInterestPercent)({ villageUpgrades: { bank: 20 } }), 0.2);
        node_assert_1.strict.equal((0, _bank_interest_js_1.bankInterestPercent)({ villageUpgrades: { bank: 50 } }), 0.5);
        node_assert_1.strict.equal((0, _bank_interest_js_1.bankInterestPercent)({ villageUpgrades: { bank: 999 } }), 0.5); // clamp
        node_assert_1.strict.equal((0, _bank_interest_js_1.bankInterestPercent)({ villageUpgrades: { bank: -3 } }), 0); // floor at 0
    });
});
(0, node_test_1.describe)('computeBankInterest matches the client across a sweep', () => {
    (0, node_test_1.it)('interest amount + eligibility equal the client for every case', () => {
        const banks = [0, 1, 7, 100, 399, 1000, 1_000_000, 12_345_678];
        const levels = [0, 1, 4, 20, 50, 999];
        const lasts = [0, 1_000_000, 5_000_000];
        const now = 100_000_000; // fixed server clock for the sweep
        let cases = 0;
        for (const bankRyo of banks)
            for (const bank of levels)
                for (const lastBankInterestAt of lasts) {
                    const char = { bankRyo, lastBankInterestAt, villageUpgrades: { bank } };
                    const server = (0, _bank_interest_js_1.computeBankInterest)(char, now);
                    const client = cClaim(char, now);
                    node_assert_1.strict.equal(server.eligible, client.canClaim, `eligible @ bankRyo=${bankRyo} lvl=${bank} last=${lastBankInterestAt}`);
                    // The credited amount must equal the client's projected interest whenever claimable.
                    node_assert_1.strict.equal(server.eligible ? server.interest : 0, client.canClaim ? client.projected : 0, `interest @ bankRyo=${bankRyo} lvl=${bank} last=${lastBankInterestAt}`);
                    node_assert_1.strict.equal(server.interestPercent, client.interestPercent);
                    node_assert_1.strict.equal(server.nextClaimAt, client.nextClaimAt);
                    cases++;
                }
        node_assert_1.strict.ok(cases >= 100, `swept ${cases} cases`);
    });
});
(0, node_test_1.describe)('computeBankInterest gate + reasons', () => {
    (0, node_test_1.it)('blocks within the 24h window, allows exactly at the boundary', () => {
        const char = { bankRyo: 1000, lastBankInterestAt: 1_000_000, villageUpgrades: { bank: 20 } }; // 0.2%
        node_assert_1.strict.equal((0, _bank_interest_js_1.computeBankInterest)(char, 1_000_000 + _bank_interest_js_1.BANK_INTEREST_WINDOW_MS - 1).eligible, false);
        node_assert_1.strict.equal((0, _bank_interest_js_1.computeBankInterest)(char, 1_000_000 + _bank_interest_js_1.BANK_INTEREST_WINDOW_MS - 1).reason, 'cooldown');
        const ok = (0, _bank_interest_js_1.computeBankInterest)(char, 1_000_000 + _bank_interest_js_1.BANK_INTEREST_WINDOW_MS);
        node_assert_1.strict.equal(ok.eligible, true);
        node_assert_1.strict.equal(ok.interest, 2); // floor(1000 * 0.2/100)
    });
    (0, node_test_1.it)('caps the interest-earning principal at 10M ryo (M-2 anti-inflation guardrail)', () => {
        const t = 10 * _bank_interest_js_1.BANK_INTEREST_WINDOW_MS;
        // At max bank (0.5%): under the cap scales linearly; at/above the cap the
        // payout flattens to floor(10M * 0.5%) = 50,000 regardless of balance.
        node_assert_1.strict.equal((0, _bank_interest_js_1.computeBankInterest)({ bankRyo: 8_000_000, villageUpgrades: { bank: 50 } }, t).interest, 40_000);
        node_assert_1.strict.equal((0, _bank_interest_js_1.computeBankInterest)({ bankRyo: 10_000_000, villageUpgrades: { bank: 50 } }, t).interest, 50_000);
        node_assert_1.strict.equal((0, _bank_interest_js_1.computeBankInterest)({ bankRyo: 50_000_000, villageUpgrades: { bank: 50 } }, t).interest, 50_000);
    });
    (0, node_test_1.it)('reasons: no-upgrade / empty / too-small', () => {
        const t = 10 * _bank_interest_js_1.BANK_INTEREST_WINDOW_MS;
        node_assert_1.strict.equal((0, _bank_interest_js_1.computeBankInterest)({ bankRyo: 1000, villageUpgrades: { bank: 0 } }, t).reason, 'no-upgrade');
        node_assert_1.strict.equal((0, _bank_interest_js_1.computeBankInterest)({ bankRyo: 0, villageUpgrades: { bank: 20 } }, t).reason, 'empty');
        // 19 ryo * 0.01% = 0.0019 -> floor 0 -> too-small
        node_assert_1.strict.equal((0, _bank_interest_js_1.computeBankInterest)({ bankRyo: 19, villageUpgrades: { bank: 1 } }, t).reason, 'too-small');
    });
    (0, node_test_1.it)('never mints on garbage input', () => {
        node_assert_1.strict.equal((0, _bank_interest_js_1.computeBankInterest)({}, 10 * _bank_interest_js_1.BANK_INTEREST_WINDOW_MS).interest, 0);
        node_assert_1.strict.equal((0, _bank_interest_js_1.computeBankInterest)({ bankRyo: 'oops', villageUpgrades: { bank: 'x' } }, 10 * _bank_interest_js_1.BANK_INTEREST_WINDOW_MS).interest, 0);
    });
});
