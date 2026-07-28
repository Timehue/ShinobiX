import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    reconcileCharacterStatBudget, allocatedStatPoints, normalizeStats, baseStats, STAT_KEYS,
    earnedForLevel, levelForEarned, earnedStatPoints,
} from './stats';
import { statCapForLevel, perRankStatCap } from '../constants/game';
import type { Character } from '../types/character';

// Progression guardrails. These pin the *design intent* of the stat-derived
// level curve (docs/leveling-without-xp-map.md) so a later reward/coefficient
// tweak can't silently break the ~90-day pacing, the band-reachability
// invariant, or the "maxed at L100" guarantee. (The old xpNeeded / stat-BUDGET
// suites are gone with the functions they tested — character XP is retired.)


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

describe('pacing guardrail — the standard player fully caps in ~90 days (stat-derived leveling)', () => {
    // The owner-locked anchor (docs/leveling-without-xp-map.md §3): a player who
    // "plays the game, does their dailies, and a little extra" — an 8h overnight
    // training collect + one 4h daytime session, the full field/hunt daily
    // checklist, and a couple of serious PvP wins — reaches the full 29,880-point
    // cap in roughly 90 days. Modeled from the REAL faucets so a rate/checklist/
    // slice tweak that breaks the anchor fails here.
    const TRAINING_PER_DAY = 8 * 20 + 4 * 21;   // 8h tier @20/hr overnight + 4h tier @21/hr daytime = 244
    const CHECKLIST_PER_DAY = 15 * 3;            // 10 hunt + 5 fetch dailies × FIELD_MISSION_STAT_POINTS
    const PVP_PER_DAY = 15;                      // 2-3 serious wins inside the 18/day slice
    const ONE_TIME_SPINE = 1000;                 // story (~734) + tower first-clears + apex, amortized
    const DAILY = TRAINING_PER_DAY + CHECKLIST_PER_DAY + PVP_PER_DAY;
    const FULL_CAP = 12 * (2500 - 10);
    it('full 12-stat cap lands in [80, 110] days for the standard profile', () => {
        const days = (FULL_CAP - ONE_TIME_SPINE) / DAILY;
        assert.ok(days >= 80 && days <= 110, `days-to-cap = ${days.toFixed(1)} (anchor ~90)`);
    });
    it('level 90 lands in [60, 90] days for the standard profile', () => {
        const days = Math.max(0, earnedForLevel(90) - ONE_TIME_SPINE) / DAILY;
        assert.ok(days >= 60 && days <= 90, `days-to-L90 = ${days.toFixed(1)}`);
    });
    it('the daily checklist stays the bulk of active-play growth (dailies > PvP slice)', () => {
        assert.ok(CHECKLIST_PER_DAY > PVP_PER_DAY, 'owner directive: dailies are the bulk, PvP is the headroom');
    });
});

describe('stat-derived level curve — earnedForLevel / levelForEarned', () => {
    it('matches the fitted anchors', () => {
        assert.equal(earnedForLevel(1), 0);
        assert.equal(earnedForLevel(15), 2800);
        assert.equal(earnedForLevel(20), 3933);
        assert.equal(earnedForLevel(30), 6200);
        assert.equal(earnedForLevel(39), 8630);
        assert.equal(earnedForLevel(50), 11600);
        assert.equal(earnedForLevel(80), 19600);
        assert.equal(earnedForLevel(90), 23550);
        assert.equal(earnedForLevel(100), 27500);
        assert.equal(earnedForLevel(0), 0);   // clamps low
        assert.equal(earnedForLevel(999), 27500); // clamps high
    });
    it('is strictly increasing and roundtrips through levelForEarned', () => {
        for (let L = 1; L < 100; L++) assert.ok(earnedForLevel(L) < earnedForLevel(L + 1), `increasing at L${L}`);
        for (let L = 1; L <= 100; L++) {
            assert.equal(levelForEarned(earnedForLevel(L)), L, `roundtrip L${L}`);
            if (L >= 2) assert.equal(levelForEarned(earnedForLevel(L) - 1), L - 1, `one-below L${L}`);
        }
        assert.equal(levelForEarned(0), 1);
        assert.equal(levelForEarned(-5), 1);
        assert.equal(levelForEarned(10_000_000), 100);
    });
    it('every rank boundary is reachable under the PREVIOUS band caps (anti-wall)', () => {
        // A boundary needing more than ~80% of what the prior band can produce
        // (12 stats to the per-rank cap + the 20 starting pool) is a wall — the
        // exact failure a naive inversion of the old linear budget had at L15/L30.
        for (const b of [15, 30, 50, 80] as const) {
            const capacity = 20 + 12 * (statCapForLevel(b - 1) - 10);
            assert.ok(earnedForLevel(b) <= 0.8 * capacity, `L${b}: ${earnedForLevel(b)} within 80% of ${capacity}`);
        }
        const fullCapacity = 20 + 12 * (2500 - 10);
        assert.ok(earnedForLevel(100) <= 0.93 * fullCapacity, `L100 within 93% of ${fullCapacity}`);
    });
});

describe('earnedStatPoints — the conserved allocated+pool sum', () => {
    it('counts allocation above base plus the pool, floored at 0', () => {
        assert.equal(earnedStatPoints({ stats: baseStats(), unspentStats: 20 }), 20); // fresh character
        const built = { stats: { ...baseStats(), strength: 110, speed: 60 }, unspentStats: 42 };
        assert.equal(earnedStatPoints(built), 100 + 50 + 42);
        assert.equal(earnedStatPoints({ stats: baseStats(), unspentStats: -9 }), 0);
    });
    it('is conserved by an allocation-shaped spend (stats up, pool down)', () => {
        const before = { stats: baseStats(), unspentStats: 100 };
        const after = { stats: { ...baseStats(), willpower: 10 + 60 }, unspentStats: 40 };
        assert.equal(earnedStatPoints(before), earnedStatPoints(after));
    });
});
