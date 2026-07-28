import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { aiStatsForLevel, aiStatBudgetForLevel } from './ai-stats';
import { STAT_KEYS } from './stats';
import type { Jutsu } from '../types/combat';

// The AI curve is FROZEN at the old linear player budget (leveling-without-xp
// map §7) so removing character XP changed zero PvE numbers. These anchors pin
// the frozen values themselves — they must NOT drift with the player level
// curve.

const j = (type: string): Jutsu => ({ type } as unknown as Jutsu);
const sumOverBase = (s: Record<string, number>) => STAT_KEYS.reduce((t, k) => t + (s[k] - 10), 0);

describe('aiStatsForLevel — spends the full FROZEN budget', () => {
    it('the frozen curve keeps the shipped anchors (20 → 29,880 linear)', () => {
        assert.equal(aiStatBudgetForLevel(1), 20);
        assert.equal(aiStatBudgetForLevel(50), 14799);
        assert.equal(aiStatBudgetForLevel(90), 26864);
        assert.equal(aiStatBudgetForLevel(100), 29880);
    });
    it('total allocated points equal the frozen budget at every sampled level', () => {
        for (const L of [1, 10, 20, 50, 80, 95]) {
            const stats = aiStatsForLevel(L, [j('Ninjutsu')]);
            assert.equal(sumOverBase(stats), aiStatBudgetForLevel(L), `budget spent @L${L}`);
        }
    });
    it('higher level → strictly more total stats', () => {
        let prev = -1;
        for (const L of [1, 20, 50, 80, 100]) {
            const total = sumOverBase(aiStatsForLevel(L));
            assert.ok(total > prev, `total rises @L${L}`);
            prev = total;
        }
    });
    it('a level-100 AI is fully maxed (every stat at the cap)', () => {
        const stats = aiStatsForLevel(100, [j('Taijutsu')]);
        for (const k of STAT_KEYS) assert.equal(stats[k], 2500, `${k} maxed`);
    });
});

describe('aiStatsForLevel — archetype shaping', () => {
    it('a Bukijutsu loadout makes bukijutsuOffense the dominant offense', () => {
        const s = aiStatsForLevel(50, [j('Bukijutsu'), j('Bukijutsu')]);
        assert.ok(s.bukijutsuOffense > s.taijutsuOffense, 'buki > tai offense');
        assert.ok(s.bukijutsuOffense > s.ninjutsuOffense, 'buki > nin offense');
        assert.ok(s.strength > s.intelligence, 'physical primary lifts strength over intelligence');
    });
    it('a Ninjutsu loadout lifts ninjutsuOffense + the casting generals', () => {
        const s = aiStatsForLevel(50, [j('Ninjutsu'), j('Ninjutsu')]);
        assert.ok(s.ninjutsuOffense > s.taijutsuOffense, 'nin > tai offense');
        assert.ok(s.intelligence > s.strength, 'caster primary lifts intelligence over strength');
    });
    it('no loadout → balanced, defenses favored over raw offense', () => {
        const s = aiStatsForLevel(50);
        assert.ok(s.ninjutsuDefense > s.ninjutsuOffense, 'defenses weighted above offense');
        // all four offenses are within a tight band (no archetype spike)
        const offs = [s.bukijutsuOffense, s.taijutsuOffense, s.genjutsuOffense, s.ninjutsuOffense];
        assert.ok(Math.max(...offs) - Math.min(...offs) <= 2, 'balanced offenses');
    });
});
