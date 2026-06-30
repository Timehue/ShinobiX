import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';
import { bloodlinePoints } from '../_jutsu-points.js';

// Integration coverage for the bloodline rank-entitlement (P0.1 sub-3) and
// point-budget (P0.1 sub-1) clamps wired into the save sanitizer. Both are
// gated by env flags (default OFF → legacy behavior), so flag-off must be
// unchanged and flag-on must CLAMP (never reject) a forged save.

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

function withFlags(on: boolean, fn: () => void) {
    const keys = ['BLOODLINE_RANK_ENTITLEMENT', 'BLOODLINE_BUDGET_SERVER'];
    const prev = keys.map((k) => process.env[k]);
    keys.forEach((k) => { if (on) process.env[k] = '1'; else delete process.env[k]; });
    try { fn(); } finally {
        keys.forEach((k, i) => { if (prev[i] === undefined) delete process.env[k]; else process.env[k] = prev[i]!; });
    }
}

test('flags OFF: forged S-rank + over-budget tags pass through (legacy behavior)', () => {
    withFlags(false, () => {
        const bl = sanitizeChar(mkChar(), null).savedBloodlines[0];
        assert.equal(bl.rank, 'S Rank');                 // rank not clamped
        assert.equal(bl.jutsus[0].tags.length, 3);       // tags not stripped
    });
});

test('flags ON: new bloodline clamps rank to B (entitlement) + strips tags to budget, never rejected', () => {
    withFlags(true, () => {
        const c = sanitizeChar(mkChar(), null);
        assert.ok(Array.isArray(c.savedBloodlines), 'save was not rejected');
        const bl = c.savedBloodlines[0];
        assert.equal(bl.rank, 'B Rank', 'forged S clamped to B (no prior entitlement)');
        assert.equal(bl.jutsus.length, 5, 'jutsu are never dropped — only tags');
        assert.ok(bloodlinePoints(bl.jutsus, 'B Rank') <= 7, 'clamped within the B-rank budget');
    });
});

test('flags ON: an existing A-rank entitlement is preserved (claimed S clamped DOWN to A)', () => {
    withFlags(true, () => {
        const existing: Char = { savedBloodlines: [{ id: 'bl-forged', name: 'Forged', rank: 'A Rank', jutsus: [], totalPoints: 0 }] };
        const bl = sanitizeChar(mkChar(), existing).savedBloodlines[0];
        assert.equal(bl.rank, 'A Rank', 'rank only goes DOWN to the stored entitlement, never up to the claimed S');
        assert.ok(bloodlinePoints(bl.jutsus, 'A Rank') <= 10, 'clamped within the A-rank budget');
    });
});
