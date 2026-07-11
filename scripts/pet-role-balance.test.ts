/*
 * Balance ratchet for the LIVE pet-arena role matrix (runPetArenaBattle), per
 * docs/balance-ci-gates-plan.md. Turns the print-only `pet-role-balance.ts`
 * harness into a hard CI assertion: if a commit makes a role dominate the field
 * or a matchup an auto-win, `npm test` fails — exactly how App.size.test.ts
 * ratchets line count.
 *
 * Release bands are deliberately wider for an individual matchup than for a
 * role's aggregate record: element and kit counters may create a 30–70% cell,
 * but no role may leave the healthy 40–60% overall range.
 *
 * The report is deterministic (fixed seeds in pet-role-balance.ts), so these
 * assertions are exact and non-flaky.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { roleBalanceReport, ROLES } from './pet-role-balance.ts';

// One deterministic run shared by every assertion (full default sample).
const report = roleBalanceReport();

const OVERALL_MIN = 0.40, OVERALL_MAX = 0.60;
const PAIR_MIN = 0.30, PAIR_MAX = 0.70;

test('role-balance ratchet: no role escapes the overall win-rate band', () => {
    for (const role of ROLES) {
        const wr = report.overall[role];
        assert.ok(
            wr >= OVERALL_MIN && wr <= OVERALL_MAX,
            `${role} overall win rate ${(wr * 100).toFixed(1)}% left [${OVERALL_MIN * 100}%, ${OVERALL_MAX * 100}%] — role balance is outside the release band.`,
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
