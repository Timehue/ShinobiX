// Pins the stat-derived level curve (docs/leveling-without-xp-map.md): the
// calibrated milestones, monotonicity, the curve inverse, the band-capacity
// reachability invariant (the anti-wall guard), the conserved earned-points
// sum, and applyDerivedLevel (rise-only + full refill on level-up + exam
// holds). Server-vs-client parity uses the same inline-replica pattern as
// _xp-engine.test.ts; _cross-build-parity.test.ts pins the source text on both
// sides.
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    earnedForLevel, levelForEarned, earnedStatPoints,
    applyDerivedLevel, maxHpForLevel, maxChakraForLevel, maxStaminaForLevel,
    MAX_LEVEL, MAX_STAT,
} from './_xp-engine.js';
import { statCapForLevel } from './combat-core/formulas.js';

// ── Inline client replica (shinobij.client/src/lib/stats.ts) ────────────────
const C_CURVE = [
    191.67876990268087,
    1.1074354304268461,
    -0.02226330146888855,
    0.00021623956441357866,
] as const;
function cEarnedForLevel(level: number): number {
    const clamped = Math.max(1, Math.min(100, Math.floor(level)));
    const n = clamped - 1;
    return Math.round(C_CURVE[0] * n + C_CURVE[1] * n * n + C_CURVE[2] * n * n * n + C_CURVE[3] * n * n * n * n);
}

const baseStatsObj = () => ({
    strength: 10, speed: 10, intelligence: 10, willpower: 10,
    bukijutsuOffense: 10, bukijutsuDefense: 10,
    taijutsuOffense: 10, taijutsuDefense: 10,
    genjutsuOffense: 10, genjutsuDefense: 10,
    ninjutsuOffense: 10, ninjutsuDefense: 10,
});

describe('level curve — progressive thresholds', () => {
    it('matches the calibrated curve milestones', () => {
        assert.deepEqual(
            [1, 10, 15, 20, 30, 39, 50, 80, 90, 100].map((level) => earnedForLevel(level)),
            [0, 1800, 2848, 3917, 6100, 8112, 10679, 19500, 23704, 29000],
        );
    });
    it('clamps out-of-range levels', () => {
        assert.equal(earnedForLevel(1), 0);
        assert.equal(earnedForLevel(0), 0);
        assert.equal(earnedForLevel(999), 29000);
    });
    it('is strictly increasing across all 100 levels', () => {
        for (let L = 1; L < MAX_LEVEL; L++) {
            assert.ok(earnedForLevel(L) < earnedForLevel(L + 1), `increasing at L${L}`);
        }
    });
    it('levelForEarned is the exact inverse (roundtrip + one-below)', () => {
        for (let L = 1; L <= MAX_LEVEL; L++) {
            assert.equal(levelForEarned(earnedForLevel(L)), L, `roundtrip L${L}`);
            if (L >= 2) assert.equal(levelForEarned(earnedForLevel(L) - 1), L - 1, `one-below L${L}`);
        }
        assert.equal(levelForEarned(0), 1);
        assert.equal(levelForEarned(-10), 1);
        assert.equal(levelForEarned(10_000_000), MAX_LEVEL);
    });
    it('REACHABILITY (anti-wall): every rank boundary fits inside the previous band caps', () => {
        // A boundary needing more than ~80% of what the prior band can produce
        // (12 stats to the per-rank cap, plus the 20 starting pool) is a wall —
        // the exact failure a naive inversion of the old linear budget had at
        // L15 (4,243 needed vs 4,100 producible) and L30 (8,767 vs 8,300).
        for (const b of [15, 30, 50, 80]) {
            const capacity = 20 + 12 * (statCapForLevel(b - 1) - 10);
            assert.ok(earnedForLevel(b) <= 0.8 * capacity, `L${b}: ${earnedForLevel(b)} within 80% of ${capacity}`);
        }
        const fullCapacity = 20 + 12 * (MAX_STAT - 10);
        assert.ok(earnedForLevel(MAX_LEVEL) <= 0.98 * fullCapacity, `L100 within 98% of ${fullCapacity}`);
    });
    it('server curve === client replica at every level', () => {
        for (let L = 0; L <= 120; L++) {
            assert.equal(earnedForLevel(L), cEarnedForLevel(L), `parity at L${L}`);
        }
    });
});

describe('earnedStatPoints — conserved allocated+pool sum off the raw save', () => {
    it('fresh character (base stats + 20 pool) = 20', () => {
        assert.equal(earnedStatPoints({ stats: baseStatsObj(), unspentStats: 20 }), 20);
    });
    it('counts allocation above base plus the pool; junk-safe', () => {
        const built = { stats: { ...baseStatsObj(), strength: 110, speed: 60 }, unspentStats: 42 };
        assert.equal(earnedStatPoints(built), 100 + 50 + 42);
        assert.equal(earnedStatPoints({ stats: baseStatsObj(), unspentStats: -9 }), 0);
        assert.equal(earnedStatPoints({ stats: undefined, unspentStats: '17' as unknown }), 17);
    });
    it('spend and respec shapes conserve the sum', () => {
        const before = { stats: baseStatsObj(), unspentStats: 100 };
        const spent = { stats: { ...baseStatsObj(), willpower: 70 }, unspentStats: 40 };
        const respec = { stats: baseStatsObj(), unspentStats: 100 };
        assert.equal(earnedStatPoints(before), earnedStatPoints(spent));
        assert.equal(earnedStatPoints(spent), earnedStatPoints(respec));
    });
});

describe('applyDerivedLevel — rise-only recompute with exam holds + full refill', () => {
    it('a fresh character stays level 1', () => {
        const out = applyDerivedLevel({ level: 1, stats: baseStatsObj(), unspentStats: 20, examsPassed: [], hp: 500, maxHp: 500 });
        assert.equal(out.level, 1);
        assert.equal(out.hp, 500); // untouched when level is unchanged
    });
    it('levels up from earned points and fully refills vitals (like the old level-up loop)', () => {
        const out = applyDerivedLevel({
            level: 1, hp: 12, chakra: 3, stamina: 3,
            stats: baseStatsObj(), unspentStats: 2848, examsPassed: [],
        });
        assert.equal(out.level, 15); // 2848 earned → L15; exam cap (20) not yet binding
        assert.equal(out.rankTitle, 'Genin');
        assert.equal(out.maxHp, maxHpForLevel(15));
        assert.equal(out.hp, maxHpForLevel(15));
        assert.equal(out.chakra, maxChakraForLevel(15));
        assert.equal(out.stamina, maxStaminaForLevel(15));
    });
    it('holds at the Genin exam gate (20) no matter how much is earned', () => {
        const out = applyDerivedLevel({ level: 1, stats: baseStatsObj(), unspentStats: 8000, examsPassed: [] });
        assert.equal(out.level, 20);
        assert.equal(out.rankTitle, 'Genin');
    });
    it('leaps past the gate once the exam passes (banked earned, no points lost)', () => {
        const held = { level: 20, stats: baseStatsObj(), unspentStats: 8000, examsPassed: ['genin'] };
        const out = applyDerivedLevel(held);
        assert.equal(out.level, 38); // levelForEarned(8000) = 38, chunin gate (39) not yet binding
    });
    it('holds at the Chunin gate (39), then reaches 100 with both exams passed', () => {
        const heldAt39 = applyDerivedLevel({ level: 20, stats: baseStatsObj(), unspentStats: 27500, examsPassed: ['genin'] });
        assert.equal(heldAt39.level, 39);
        const maxed = applyDerivedLevel({ level: 39, stats: baseStatsObj(), unspentStats: 29000, examsPassed: ['genin', 'chunin'] });
        assert.equal(maxed.level, 100);
        assert.equal(maxed.rankTitle, 'Special Jonin');
    });
    it('RISE-ONLY: never de-levels an unmigrated save (old XP-era level above earned)', () => {
        const unmigrated = { level: 39, hp: 77, maxHp: 4300, stats: baseStatsObj(), unspentStats: 100, examsPassed: ['genin'] };
        const out = applyDerivedLevel(unmigrated);
        assert.equal(out.level, 39); // earned 100 would derive L2 — must NOT drop
        assert.equal(out.hp, 77);    // and vitals stay untouched
    });
});
