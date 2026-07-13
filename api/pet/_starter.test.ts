import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { chooseStarterPet, validateStarterPet } from './_starter.js';

const FIRE = {
    id: 'starter-fire', name: 'Cinder Cub', rarity: 'standard', level: 1, xp: 0, maxLevel: 100,
    hp: 280, attack: 56, defense: 22, speed: 38, moveRange: 3, element: 'Fire', trait: 'Aggressive',
    unlockedForPve: false,
    description: "A hot-tempered fox kit whose fur smolders when it's spoiling for a fight.",
    jutsus: [
        { name: 'Cinder Pounce', power: 48, cooldown: 2, currentCooldown: 0, kind: 'damage' },
        { name: 'Searing Wound', power: 30, cooldown: 4, currentCooldown: 0, kind: 'wound', rounds: 2 },
        { name: 'Flame Burst', power: 58, cooldown: 3, currentCooldown: 0, kind: 'damage', signature: true },
        { name: 'Ember Dash', power: 0, cooldown: 3, currentCooldown: 0, kind: 'move' },
    ],
};

describe('starter pet entitlement', () => {
    it('accepts an exact canonical starter and rejects modified payloads', () => {
        assert.ok(validateStarterPet(FIRE));
        assert.equal(validateStarterPet({ ...FIRE, attack: 9999 }), null);
    });
    it('grants once and applies the canonical trait bonus', () => {
        const result = chooseStarterPet({ onboardingStep: 'starter', pets: [] }, FIRE);
        assert.equal(result.ok, true);
        if (result.ok) {
            const pet = (result.character.pets as Array<Record<string, unknown>>)[0];
            assert.equal(pet.attack, Math.round(56 * 1.15));
            assert.equal(result.character.onboardingStep, 'training');
        }
    });
    it('rejects replay and out-of-sequence claims', () => {
        assert.equal(chooseStarterPet({ onboardingStep: 'training', pets: [] }, FIRE).ok, false);
        assert.equal(chooseStarterPet({ onboardingStep: 'starter', pets: [{}] }, FIRE).ok, false);
    });
});
