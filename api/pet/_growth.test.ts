import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyGrowthAllocation,
    derivePetGrowthStats,
    growthAttributeCap,
    growthPointsEarned,
    normalizePetGrowth,
    resetGrowthAllocation,
} from './_growth.js';

const pet = (level = 1) => ({
    id: 'growth-test', level, maxLevel: 100, trait: 'Lucky',
    hp: 320, attack: 40, defense: 28, speed: 30,
    growthBaseStats: { hp: 320, attack: 40, defense: 28, speed: 30 },
    growthAllocation: { vitality: 0, power: 0, guard: 0, agility: 0 },
});

describe('authoritative pet Growth Points', () => {
    it('earns one point per level and caps one attribute at half the budget', () => {
        assert.equal(growthPointsEarned(1), 0);
        assert.equal(growthPointsEarned(100), 99);
        assert.equal(growthAttributeCap(10), 5);
        assert.equal(growthAttributeCap(100), 50);
    });

    it('applies legal allocations from immutable species stats', () => {
        const result = applyGrowthAllocation(pet(10), { vitality: 0, power: 5, guard: 4, agility: 0 });
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.pet.growthPoints, 0);
        assert.equal(result.pet.attack, 45);
        assert.equal(result.pet.defense, 31);
    });

    it('rejects over-cap and over-budget builds', () => {
        const overCap = applyGrowthAllocation(pet(10), { vitality: 0, power: 6, guard: 3, agility: 0 });
        const overBudget = applyGrowthAllocation(pet(10), { vitality: 5, power: 5, guard: 0, agility: 0 });
        assert.deepEqual(overCap, { ok: false, error: 'Each attribute must be a whole number from 0 to 5.' });
        assert.deepEqual(overBudget, { ok: false, error: 'Not enough Growth Points.' });
    });

    it('prices speed at half-rate because initiative supplies intrinsic value', () => {
        const normalized = normalizePetGrowth({ ...pet(100), growthAllocation: { vitality: 0, power: 0, guard: 49, agility: 50 } });
        const stats = derivePetGrowthStats(normalized);
        assert.equal(stats.speed, 60); // 30 × (1 + .7425 core + .25 agility)
        assert.equal(stats.defense, 63);
    });

    it('returns every committed point on a respec', () => {
        const built = normalizePetGrowth({ ...pet(10), growthAllocation: { vitality: 5, power: 4, guard: 0, agility: 0 } });
        const reset = resetGrowthAllocation(built);
        assert.deepEqual(reset.growthAllocation, { vitality: 0, power: 0, guard: 0, agility: 0 });
        assert.equal(reset.growthPoints, 9);
    });
});
