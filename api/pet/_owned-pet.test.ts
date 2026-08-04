import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    BRED_ULTRA_TRAIT_DENOMINATOR,
    applyOwnedPetTrait,
    createOwnedPet,
    deterministicLegacyBreedingUses,
    migrateCharacterOwnedPets,
    resolvePetTemplateId,
    rollBredOwnedPetTrait,
    rollOwnedPetTrait,
} from './_owned-pet.js';
import { ULTRA_PET_TRAITS } from '../../shared/shrines.js';

function queuedSecureInt(...values: number[]) {
    return (min: number, max: number) => {
        const value = values.shift();
        assert.notEqual(value, undefined, `missing injected roll for [${min}, ${max})`);
        assert.ok(value! >= min && value! < max, `${value} is outside [${min}, ${max})`);
        return value!;
    };
}

describe('bred apex trait roll', () => {
    it('uses one exact 1-in-200 roll followed by an even one-of-three choice', () => {
        assert.equal(BRED_ULTRA_TRAIT_DENOMINATOR, 200);
        assert.deepEqual(ULTRA_PET_TRAITS, ['Fateweaver', 'Hollowborn', 'Boonbringer']);
        for (let index = 0; index < ULTRA_PET_TRAITS.length; index += 1) {
            assert.equal(rollBredOwnedPetTrait('standard', queuedSecureInt(0, index)), ULTRA_PET_TRAITS[index]);
        }
    });

    it('keeps every non-winning boundary in the ordinary rarity pool', () => {
        assert.equal(rollBredOwnedPetTrait('standard', queuedSecureInt(1, 0)), 'Loyal');
        assert.equal(rollBredOwnedPetTrait('standard', queuedSecureInt(199, 4)), 'Battleborn');
        for (let i = 0; i < 30; i += 1) {
            assert.ok(!ULTRA_PET_TRAITS.includes(rollOwnedPetTrait('mythic', queuedSecureInt(i % 6)) as typeof ULTRA_PET_TRAITS[number]));
        }
    });

    it('applies the authored apex spawn-stat packages once', () => {
        const base = { hp: 100, attack: 100, defense: 100, speed: 100 };
        assert.deepEqual(applyOwnedPetTrait(base, 'Fateweaver'), { ...base, trait: 'Fateweaver', hp: 120, attack: 120, defense: 120, speed: 120 });
        assert.deepEqual(applyOwnedPetTrait(base, 'Hollowborn'), { ...base, trait: 'Hollowborn', hp: 105, attack: 105, defense: 105, speed: 105 });
        assert.deepEqual(applyOwnedPetTrait(base, 'Boonbringer'), { ...base, trait: 'Boonbringer' });
    });
});

describe('owned pet identity and breeding-use migration', () => {
    it('creates a fresh instance with bounded secure uses and reset progression', () => {
        const pet = createOwnedPet('standard-0', {
            origin: 'bred',
            instanceId: 'standard-0:child',
            secureInt: (min) => min,
            generation: 2,
            parentInstanceIds: ['p1', 'p2'],
            parentTemplateIds: ['standard-0', 'standard-6'],
        });
        assert.equal(pet.id, 'standard-0:child');
        assert.equal(pet.templateId, 'standard-0');
        assert.equal(pet.level, 1);
        assert.equal(pet.xp, 0);
        assert.equal(pet.breedingUsesMax, 5);
        assert.equal(pet.breedingUsesRemaining, 5);
        assert.equal(pet.generation, 2);
        assert.deepEqual(pet.parentInstanceIds, ['p1', 'p2']);
    });

    it('assigns stable deterministic counters to legacy pets exactly once', () => {
        const legacy = { id: 'standard-0-1700000000000', name: 'Fox', element: 'Fire', rarity: 'standard' };
        const first = migrateCharacterOwnedPets('Kakashi', { pets: [legacy] });
        const second = migrateCharacterOwnedPets('Kakashi', first.character);
        const pet = (first.character.pets as Array<Record<string, unknown>>)[0];
        assert.equal(pet.templateId, 'standard-0');
        assert.equal(pet.breedingUsesMax, deterministicLegacyBreedingUses('Kakashi', String(legacy.id)));
        assert.equal(pet.breedingUsesRemaining, pet.breedingUsesMax);
        assert.equal(first.changed, true);
        assert.equal(second.changed, false);
    });

    it('uses catalog-aware longest-prefix template resolution', () => {
        assert.equal(resolvePetTemplateId({ id: 'starter-fire-r:legacy-instance' }), 'starter-fire-r');
        assert.equal(resolvePetTemplateId({ id: 'not-a-catalog-pet' }), null);
    });
});
