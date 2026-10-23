import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    reconcileCharacterStatBudget, allocatedStatPoints, normalizeStats, baseStats, STAT_KEYS,
    earnedForLevel, levelForEarned, earnedStatPoints,
} from './stats';
import { statCapForLevel, perRankStatCap, FIELD_MISSION_STAT_POINTS } from '../constants/game';
import { DAILY_STAT_POINT_CAP } from '../../../shared/combat-growth-rules';
import { TRAINING_TIERS, sealedTrainingGain } from './training-config';
import type { Character } from '../types/character';

// Progression guardrails. These pin the *design intent* of the stat-derived
// level curve (docs/leveling-without-xp-map.md) so a later reward/coefficient
// tweak can't silently break the documented pacing, the band-reachability
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

describe('pacing guardrail — the owner-documented "dailies + a little extra" profile', () => {
    // docs/leveling-without-xp-map.md §3 and §11 item 1: a player who "plays the
    // game, does their dailies, and a little extra" — an 8h overnight training
    // collect + one 4h daytime session at 0% training bonus (~12 h coverage),
    // 10 hunt + 5 fetch dailies, and a couple of serious PvP wins. A day-step
    // loop over the real level curve and the real seal arithmetic (rookie
    // multiplier on the ledger level), so a rate/checklist/slice tweak moves it.
    // The framework regular (8h + 3× 4h, +10%) is pinned by the server replay in
    // api/_progression-pacing-replay.test.ts, which runs the real grant functions.
    const CHECKLIST_PER_DAY = (10 + 5) * FIELD_MISSION_STAT_POINTS; // 45
    const PVP_PER_DAY = 15;                      // 2-3 serious wins
    const ONE_TIME_SPINE = 1000;                 // story (~734) + tower first-clears + apex, at the start
    const tier = (id: string) => TRAINING_TIERS.find((t) => t.id === id)!;
    const daysToLevel = (target: number) => {
        let earned = earnedForLevel(10) + ONE_TIME_SPINE;
        let days = 0;
        while (earned < earnedForLevel(target)) {
            const ledgerLevel = levelForEarned(earned);
            earned += sealedTrainingGain(tier('8h'), 0, ledgerLevel) + sealedTrainingGain(tier('4h'), 0, ledgerLevel)
                + CHECKLIST_PER_DAY + PVP_PER_DAY;
            days += 1;
        }
        return days;
    };

    it('L10 → L90 lands in [108, 132] days for the documented profile (~120 on the rebalanced table)', () => {
        // Pending owner Q12: if the owner confirms the ~90-day anchor for THIS
        // profile, no table in the framework sweep meets it, so a separate
        // ruling is needed. It took ~111 days on the pre-rebalance table.
        const days = daysToLevel(90);
        assert.ok(days >= 108 && days <= 132, `days L10 → L90 = ${days}`);
    });
    it('the daily checklist stays the bulk of active-play growth (dailies > PvP slice)', () => {
        assert.equal(CHECKLIST_PER_DAY, 45);
        assert.ok(CHECKLIST_PER_DAY > PVP_PER_DAY, 'owner directive: dailies are the bulk, PvP is the headroom');
        // Both draw from the one shared daily budget (owner ruling A1), which
        // this profile fills without overflowing.
        assert.ok(CHECKLIST_PER_DAY + PVP_PER_DAY <= DAILY_STAT_POINT_CAP, 'the profile fits the shared daily stat-point budget');
    });
});

describe('stat-derived level curve — earnedForLevel / levelForEarned', () => {
    it('matches the calibrated progressive thresholds', () => {
        assert.equal(earnedForLevel(1), 0);
        assert.equal(earnedForLevel(10), 1800);
        assert.equal(earnedForLevel(15), 2848);
        assert.equal(earnedForLevel(20), 3917);
        assert.equal(earnedForLevel(30), 6100);
        assert.equal(earnedForLevel(39), 8112);
        assert.equal(earnedForLevel(50), 10679);
        assert.equal(earnedForLevel(80), 19500);
        assert.equal(earnedForLevel(90), 23704);
        assert.equal(earnedForLevel(100), 29000);
        assert.equal(earnedForLevel(0), 0);   // clamps low
        assert.equal(earnedForLevel(999), 29000); // clamps high
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
        assert.ok(earnedForLevel(100) <= 0.98 * fullCapacity, `L100 within 98% of ${fullCapacity}`);
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
