import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { activeCarriedPetIds, activeCarriedPets, canCustomAvatar, maxLoadout, maxPets, maxStoredBloodlines } from './_entitlements.js';

describe('supporter entitlement caps', () => {
    it('keeps three additional jutsu slots as a supporter perk', () => {
        assert.equal(maxLoadout({}), 12);
        assert.equal(maxLoadout({ patreon: { active: true } }), 15);
    });

    it('keeps two additional carried pets as a supporter perk', () => {
        assert.equal(maxPets({}), 4);
        assert.equal(maxPets({ patreon: { active: true } }), 6);
    });

    it('keeps custom avatars and a second stored bloodline as supporter perks', () => {
        assert.equal(canCustomAvatar({}), false);
        assert.equal(canCustomAvatar({ patreon: { active: true } }), true);
        assert.equal(maxStoredBloodlines({}), 1);
        assert.equal(maxStoredBloodlines({ patreon: { active: true } }), 2);
    });

    it('projects preserved overflow out of current use without deleting ownership', () => {
        const pets = Array.from({ length: 6 }, (_, index) => ({ id: `pet-${index + 1}` }));
        const character = { pets, activePetId: 'pet-6', activePetId2v2: 'pet-5' };
        assert.deepEqual(activeCarriedPetIds(character), ['pet-6', 'pet-5', 'pet-1', 'pet-2']);
        assert.deepEqual(activeCarriedPets<{ id: string }>(character).map(({ id }) => id), ['pet-6', 'pet-5', 'pet-1', 'pet-2']);
        assert.deepEqual(activeCarriedPetIds({ ...character, patreon: { active: true } }), ['pet-6', 'pet-5', 'pet-1', 'pet-2', 'pet-3', 'pet-4']);
        assert.equal(character.pets.length, 6);
    });
});
