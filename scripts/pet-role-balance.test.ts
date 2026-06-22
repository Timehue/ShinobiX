/*
 * Balance ratchet for the LIVE pet-arena role matrix (runPetArenaBattle), per
 * docs/balance-ci-gates-plan.md. Turns the print-only `pet-role-balance.ts`
 * harness into a hard CI assertion: if a commit makes a role dominate the field
 * or a matchup an auto-win, `npm test` fails — exactly how App.size.test.ts
 * ratchets line count.
 *
 * IMPORTANT — these bands are intentionally set to *today's* measured spread plus
 * a ~5-point margin, NOT to the genre-healthy ideal. As of this commit the live
 * arena roles are NOT balanced: tracker ≈27% and assassin ≈64% overall win rate
 * (the ideal is 40–60%). So the gate's job right now is to PREVENT FURTHER DRIFT,
 * not to assert perfection. Once the roles are actually re-balanced, tighten
 * OVERALL_* / PAIR_* toward 40–60% / 30–70% and re-commit (the ratchet).
 *
 * The report is deterministic (fixed seeds in pet-role-balance.ts), so these
 * assertions are exact and non-flaky.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { roleBalanceReport, ROLES } from './pet-role-balance.ts';

// One deterministic run shared by every assertion (full default sample).
const report = roleBalanceReport();

// Today's spread: overall min ≈27.1% (tracker), max ≈63.7% (assassin);
// pair min ≈23% (tracker vs assassin), max ≈79% (sage vs tracker).
const OVERALL_MIN = 0.22, OVERALL_MAX = 0.68;
const PAIR_MIN = 0.18, PAIR_MAX = 0.84;

test('role-balance ratchet: no role escapes the overall win-rate band', () => {
    for (const role of ROLES) {
        const wr = report.overall[role];
        assert.ok(
            wr >= OVERALL_MIN && wr <= OVERALL_MAX,
            `${role} overall win rate ${(wr * 100).toFixed(1)}% left [${OVERALL_MIN * 100}%, ${OVERALL_MAX * 100}%] — role balance regressed (or improved enough to tighten this gate).`,
        );
    }
});

test('role-balance ratchet: no role pair becomes a harder auto-win/auto-loss', () => {
    for (const a of ROLES) for (const b of ROLES) {
        if (a === b) continue;
        const wr = report.matrix[a][b];
        assert.ok(
            wr >= PAIR_MIN && wr <= PAIR_MAX,
            `${a} vs ${b} = ${(wr * 100).toFixed(1)}% left [${PAIR_MIN * 100}%, ${PAIR_MAX * 100}%] — matchup balance regressed.`,
        );
    }
});
