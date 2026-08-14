import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { Pet } from '../_pet-sim/pet-types.js';
import { petArenaRyoRewardForTeam, sealedPetThreat } from './_arena-reward.js';

const pet = (level: number, scale = 1): Pet => ({
    id: `p-${level}-${scale}`, name: 'Test Pet', rarity: 'standard', level, xp: 0, maxLevel: 100,
    hp: 150 * scale, attack: 30 * scale, defense: 20 * scale, speed: 25 * scale,
    jutsus: [{ name: 'Strike', power: 30 * scale, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
} as Pet);

describe('sealed Pet Coliseum reward', () => {
    it('scales from sealed combat strength, not an owner/account level', () => {
        assert.ok(sealedPetThreat(pet(20, 5)) > sealedPetThreat(pet(80, 0.5)));
        assert.ok(petArenaRyoRewardForTeam([pet(20, 5)]) > petArenaRyoRewardForTeam([pet(80, 0.5)]));
    });

    it('prices a reserve without doubling the faucet and clamps extremes', () => {
        const one = petArenaRyoRewardForTeam([pet(30, 1)]);
        const two = petArenaRyoRewardForTeam([pet(30, 1), pet(30, 1)]);
        assert.ok(two > one);
        assert.ok(two < one * 2);
        assert.equal(petArenaRyoRewardForTeam([]), 20);
        assert.equal(petArenaRyoRewardForTeam([pet(100, 100)]), 250);
    });
});
