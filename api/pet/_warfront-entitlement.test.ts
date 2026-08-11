import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pet } from '../_pet-sim/pet-types.js';
import { chooseEligibleWarfrontPets } from './warfront-start.js';

const pets = Array.from({ length: 5 }, (_, index) => ({ id: `pet-${index + 1}` })) as Pet[];

test('Base and lapsed accounts cannot field preserved overflow to reach a four-pet Warfront team', () => {
    const lapsed = { patreon: { active: false }, pets };
    assert.equal(chooseEligibleWarfrontPets(lapsed, ['pet-1', 'pet-2', 'pet-3', 'pet-4']), null);
    assert.equal(chooseEligibleWarfrontPets(lapsed, ['pet-1', 'pet-2', 'pet-3']), null);
    assert.equal(pets.length, 5, 'eligibility never deletes the two preserved records');
});

test('a Shinobi Supporter can field exactly four of five carried pets', () => {
    const supporter = { patreon: { active: true }, pets };
    assert.deepEqual(
        chooseEligibleWarfrontPets(supporter, ['pet-5', 'pet-4', 'pet-3', 'pet-2'])?.map(({ id }) => id),
        ['pet-5', 'pet-4', 'pet-3', 'pet-2'],
    );
    assert.equal(chooseEligibleWarfrontPets(supporter, ['pet-1', 'pet-1', 'pet-2', 'pet-3']), null);
});
