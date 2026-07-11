import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';
import { bloodlinePoints } from '../_jutsu-points.js';

// Integration coverage for the bloodline rank-entitlement (P0.1 sub-3) and
// point-budget (P0.1 sub-1) clamps wired into the save sanitizer. Both are
// PERMANENTLY ON (owner decision 2026-07-11 — server-side anti-cheat is not
// optional): they no longer read the old BLOODLINE_RANK_ENTITLEMENT /
// BLOODLINE_BUDGET_SERVER env flags. Every test below runs with those env vars
// explicitly CLEARED to prove enforcement cannot be switched off, and forged
// saves must be CLAMPED (never rejected).

type Char = Record<string, unknown>;
const sanitizeChar = (incoming: Char, existing: Char | null) =>
    sanitizeCharacterSave({ character: incoming }, existing ? { character: existing } : null).character as Record<string, any>;

const mkForgedBloodline = () => ({
    id: 'bl-forged', name: 'Forged', rank: 'S Rank', totalPoints: 99,
    // 5 jutsu x {Copy 3, Mirror 3, Stun 2} = 40 pts, vs a B-rank budget of 7.
    jutsus: Array.from({ length: 5 }, (_, i) => ({
        id: `bf-${i}`, name: 'X', type: 'Ninjutsu', ap: 60, range: 4, effectPower: 50, cooldown: 7,
        tags: [{ name: 'Copy' }, { name: 'Mirror' }, { name: 'Stun' }],
    })),
});
const mkChar = (): Char => ({ name: 'Tester', level: 50, savedBloodlines: [mkForgedBloodline()] });

/** Run with the retired env flags explicitly CLEARED — enforcement must not depend on them. */
function withFlagsCleared(fn: () => void) {
    const keys = ['BLOODLINE_RANK_ENTITLEMENT', 'BLOODLINE_BUDGET_SERVER'];
    const prev = keys.map((k) => process.env[k]);
    keys.forEach((k) => { delete process.env[k]; });
    try { fn(); } finally {
        keys.forEach((k, i) => { if (prev[i] === undefined) delete process.env[k]; else process.env[k] = prev[i]!; });
    }
}

test('enforcement is permanent: env flags cleared, forged S-rank + over-budget tags are STILL clamped', () => {
    withFlagsCleared(() => {
        const bl = sanitizeChar(mkChar(), null).savedBloodlines[0];
        assert.equal(bl.rank, 'B Rank', 'forged rank must clamp even with the retired env flags unset');
        assert.ok(bloodlinePoints(bl.jutsus, 'B Rank') <= 7, 'over-budget tags must strip even with the retired env flags unset');
    });
});

test('new bloodline clamps rank to B (entitlement) + strips tags to budget, never rejected', () => {
    withFlagsCleared(() => {
        const c = sanitizeChar(mkChar(), null);
        assert.ok(Array.isArray(c.savedBloodlines), 'save was not rejected');
        const bl = c.savedBloodlines[0];
        assert.equal(bl.rank, 'B Rank', 'forged S clamped to B (no prior entitlement)');
        assert.equal(bl.jutsus.length, 5, 'jutsu are never dropped — only tags');
        assert.ok(bloodlinePoints(bl.jutsus, 'B Rank') <= 7, 'clamped within the B-rank budget');
    });
});

test('an existing A-rank entitlement is preserved (claimed S clamped DOWN to A)', () => {
    withFlagsCleared(() => {
        const existing: Char = { savedBloodlines: [{ id: 'bl-forged', name: 'Forged', rank: 'A Rank', jutsus: [], totalPoints: 0 }] };
        const bl = sanitizeChar(mkChar(), existing).savedBloodlines[0];
        assert.equal(bl.rank, 'A Rank', 'rank only goes DOWN to the stored entitlement, never up to the claimed S');
        assert.ok(bloodlinePoints(bl.jutsus, 'A Rank') <= 10, 'clamped within the A-rank budget');
    });
});
