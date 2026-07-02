import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    xpNeeded, statBudgetAtLevel, statPointBudgetForProgress,
    reconcileCharacterStatBudget, allocatedStatPoints, normalizeStats, baseStats, STAT_KEYS,
} from './stats';
import { statCapForLevel, perRankStatCap } from '../constants/game';
import type { Character } from '../types/character';

// Progression redesign guardrails (Phase 0). These pin the *design intent* of the
// new XP curve + linear stat budget so a later reward/coefficient tweak can't
// silently break the 90-day pacing or the "maxed at L100" guarantee.

const MAX_LEVEL = 100;
const FULL_BUDGET = 12 * (2500 - 10); // 29,880

describe('xpNeeded — 6·L² curve', () => {
    it('matches the published anchors and zeroes at the cap', () => {
        assert.equal(xpNeeded(1), 6);
        assert.equal(xpNeeded(10), 600);
        assert.equal(xpNeeded(20), 2400);
        assert.equal(xpNeeded(50), 15000);
        assert.equal(xpNeeded(90), 48600);
        assert.equal(xpNeeded(99), 58806);
        assert.equal(xpNeeded(100), 0);
    });
    it('is strictly increasing below the cap (no flat/declining levels)', () => {
        for (let L = 1; L < MAX_LEVEL - 1; L++) assert.ok(xpNeeded(L) < xpNeeded(L + 1), `xpNeeded(${L}) < xpNeeded(${L + 1})`);
    });
});

describe('statBudgetAtLevel — linear, maxed at L100', () => {
    it('runs from the starting points to the full cap', () => {
        assert.equal(statBudgetAtLevel(1), 20);
        assert.equal(statBudgetAtLevel(50), 14799);
        assert.equal(statBudgetAtLevel(90), 26864);
        assert.equal(statBudgetAtLevel(100), FULL_BUDGET); // 29,880 → every stat to 2,500
    });
    it('clamps out-of-range levels', () => {
        assert.equal(statBudgetAtLevel(0), 20);
        assert.equal(statBudgetAtLevel(999), FULL_BUDGET);
    });
    it('is monotonic non-decreasing', () => {
        for (let L = 1; L < MAX_LEVEL; L++) assert.ok(statBudgetAtLevel(L) <= statBudgetAtLevel(L + 1));
    });
});

describe('statPointBudgetForProgress — interpolates within a level', () => {
    it('equals the level budget at xp 0 and stays bounded by the next level', () => {
        for (const L of [1, 5, 20, 50, 89]) {
            assert.equal(statPointBudgetForProgress(L, 0), statBudgetAtLevel(L), `floor of L${L}`);
            // mid-level never undershoots this level's budget or overshoots the next's
            const ceil = statPointBudgetForProgress(L, xpNeeded(L) - 1);
            assert.ok(ceil >= statBudgetAtLevel(L) && ceil <= statBudgetAtLevel(L + 1), `bounded at L${L}: ${ceil}`);
        }
    });
    it('rises with in-level xp (a partial training tick still earns points)', () => {
        // at L50 the level is large enough that one tick of xp moves the budget up
        assert.ok(statPointBudgetForProgress(50, 0) < statPointBudgetForProgress(50, xpNeeded(50) - 1));
    });
    it('caps at the full budget for maxed characters', () => {
        assert.equal(statPointBudgetForProgress(100, 0), FULL_BUDGET);
        assert.equal(statPointBudgetForProgress(150, 0), FULL_BUDGET);
    });
});

describe('reconcile (two-axis) — normalizes stats + preserves the stored pool, never negative', () => {
    // Two-axis model: stat points come from training (direct-to-stat) + combat (the
    // pool), NOT a level budget — so reconcile preserves the stored unspentStats and
    // never rolls back spent stats. Spread `allocated` across the 12 stats.
    const mk = (level: number, allocated: number, unspent = 0): Character => {
        const stats: Record<string, number> = { ...baseStats() };
        let rem = allocated;
        for (const k of STAT_KEYS) {
            const add = Math.min(2490, rem);
            stats[k] = 10 + add;
            rem -= add;
            if (rem <= 0) break;
        }
        return { level, xp: 0, stats, unspentStats: unspent } as unknown as Character;
    };
    it('preserves level, spent stats, and the stored pool (points are NOT budget-derived)', () => {
        for (const L of [5, 20, 50, 80]) {
            const before = mk(L, 100, 42);
            const after = reconcileCharacterStatBudget(structuredClone(before));
            assert.equal(after.level, L, `level kept @${L}`);
            assert.equal(allocatedStatPoints(normalizeStats(after.stats)), 100, `spent kept @${L}`);
            assert.equal(after.unspentStats, 42, `stored pool preserved, not re-derived @${L}`);
            assert.ok((after.unspentStats ?? 0) >= 0, `non-negative @${L}`);
        }
    });
    it('a missing/negative pool floors at 0; spent stats untouched', () => {
        const before = mk(2, 5000, -7);
        const after = reconcileCharacterStatBudget(structuredClone(before));
        assert.equal(after.unspentStats, 0);
        assert.equal(allocatedStatPoints(normalizeStats(after.stats)), 5000); // spent stats untouched
    });
});

describe('per-rank stat cap (anti-twink) — clamps the value combat reads, save-safe', () => {
    const all = (v: number) => Object.fromEntries(STAT_KEYS.map((k) => [k, v])) as Record<string, number>;
    it('statCapForLevel bands match rankFromLevel (350/700/1300/2100/2500)', () => {
        for (const [lvl, cap] of [[1, 350], [14, 350], [15, 700], [29, 700], [30, 1300], [49, 1300], [50, 2100], [79, 2100], [80, 2500], [100, 2500]] as const) {
            assert.equal(statCapForLevel(lvl), cap, `L${lvl}`);
        }
    });
    it('clamps every stat to the rank ceiling, returns a NEW object, never mutates the input', () => {
        const maxed = all(2500);
        const capped = perRankStatCap(maxed, 10); // Academy
        for (const k of STAT_KEYS) assert.equal(capped[k], 350, `${k} clamped to Academy`);
        assert.notEqual(capped, maxed);   // new object
        assert.equal(maxed.strength, 2500); // original untouched (save-safe)
    });
    it('is a no-op at Special Jonin (80+) — endgame uncapped', () => {
        const capped = perRankStatCap(all(2500), 90);
        for (const k of STAT_KEYS) assert.equal(capped[k], 2500, `${k} unchanged at endgame`);
    });
    it('leaves stats already under the cap alone', () => {
        const capped = perRankStatCap(all(100), 1); // Academy cap 350
        for (const k of STAT_KEYS) assert.equal(capped[k], 100);
    });
});

describe('pacing guardrail — engaged daily-active reaches L90 in ~120-190 days, slow late', () => {
    // Daily character-XP income modeled from the REAL faucets (api/missions/
    // _mission-catalog.ts), not a synthetic curve — the canary that flags if the
    // xpNeeded curve OR the faucet values drift. An "engaged daily-active" player
    // clears each field + hunt mission once, does a daily training session, ~60
    // explore tiles, and some PvP. Plain-practice AI ("normal battle arena") battles
    // grant NO XP now — progression comes from missions/hunts/raids + real PvP +
    // training — so the old "10 combat fights" term is gone and L90 lands ~150 days.
    const income = (L: number): number => {
        const fetch = [[1, 90], [15, 240], [30, 520], [50, 1100], [70, 2400]].filter(([r]) => L >= r).reduce((s, [, x]) => s + x, 0);
        const hunts = [[1, 80], [15, 200], [30, 420], [50, 900], [70, 2000]].filter(([r]) => L >= r).reduce((s, [, x]) => s + 2 * x, 0);
        return fetch + hunts + 800 /*training*/ + 60 * 28 /*explore*/ + 700 /*pvp*/;
    };
    it('cumulative days to reach L90 sits in [120, 190]', () => {
        let days = 0;
        for (let L = 1; L < 90; L++) days += xpNeeded(L) / income(L);
        assert.ok(days >= 120 && days <= 190, `days-to-90 = ${days.toFixed(1)} (expected 120–190 without plain-practice XP)`);
    });
    it('is strongly slow-late: the back half (L46-90) takes >2x the front half (L1-45)', () => {
        let front = 0, back = 0;
        for (let L = 1; L < 90; L++) { const d = xpNeeded(L) / income(L); if (L <= 45) front += d; else back += d; }
        assert.ok(back > front * 2, `back ${back.toFixed(1)}d should exceed 2x front ${front.toFixed(1)}d (fast early, slow late)`);
    });
});
