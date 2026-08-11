import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    activeCarriedPetIds,
    activeCarriedPets,
    activeStoredBloodlineIds,
    canCustomAvatar,
    maxLoadout,
    maxPets,
    maxStoredBloodlines,
} from './_entitlements.js';

describe('supporter entitlement caps', () => {
    it('keeps three additional jutsu slots as a supporter perk', () => {
        assert.equal(maxLoadout({}), 12);
        assert.equal(maxLoadout({ patreon: { active: true } }), 15);
    });

    it('keeps two additional carried pets as a supporter perk', () => {
        assert.equal(maxPets({}), 3);
        assert.equal(maxPets({ patreon: { active: true } }), 5);
    });

    it('keeps custom avatars and a second stored bloodline as supporter perks', () => {
        assert.equal(canCustomAvatar({}), false);
        assert.equal(canCustomAvatar({ patreon: { active: true } }), true);
        assert.equal(maxStoredBloodlines({}), 1);
        assert.equal(maxStoredBloodlines({ patreon: { active: true } }), 2);
    });

    it('keeps the equipped custom bloodline active and classifies lapse overflow without deleting it', () => {
        const stored = [{ id: 'first' }, { id: 'equipped' }, { id: 'legacy-overflow' }];
        assert.deepEqual(activeStoredBloodlineIds({ equippedBloodlineId: 'equipped' }, stored), ['equipped']);
        assert.deepEqual(
            activeStoredBloodlineIds({ equippedBloodlineId: 'equipped', patreon: { active: true } }, stored),
            ['equipped', 'first'],
        );
        assert.equal(stored.length, 3, 'classification never truncates stored ownership');
    });

    it('keeps five owned pets after lapse but exposes only the authoritative three for combat', () => {
        const pets = Array.from({ length: 5 }, (_, index) => ({ id: `pet-${index + 1}` }));
        const character = {
            patreon: { active: false },
            activePetId: 'pet-5',
            activePetId2v2: 'pet-4',
            pets,
        };
        assert.deepEqual(activeCarriedPetIds(character), ['pet-5', 'pet-4', 'pet-1']);
        assert.deepEqual(activeCarriedPets<{ id: string }>(character).map(({ id }) => id), ['pet-5', 'pet-4', 'pet-1']);
        assert.equal(pets.length, 5, 'eligibility projection never deletes owned pet data');
        assert.deepEqual(
            activeCarriedPetIds({ ...character, patreon: { active: true } }),
            ['pet-5', 'pet-4', 'pet-1', 'pet-2', 'pet-3'],
        );
    });
});
