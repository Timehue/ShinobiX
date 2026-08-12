import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pet } from '../_pet-sim/pet-types.js';
import { chooseEligibleWarfrontPets } from './warfront-start.js';

const pets = Array.from({ length: 6 }, (_, index) => ({ id: `pet-${index + 1}` })) as Pet[];

test('Base and lapsed accounts can field four carried pets but cannot substitute preserved overflow', () => {
    const lapsed = { patreon: { active: false }, pets };
    assert.deepEqual(
        chooseEligibleWarfrontPets(lapsed, ['pet-1', 'pet-2', 'pet-3', 'pet-4'])?.map(({ id }) => id),
        ['pet-1', 'pet-2', 'pet-3', 'pet-4'],
    );
    assert.equal(chooseEligibleWarfrontPets(lapsed, ['pet-1', 'pet-2', 'pet-3', 'pet-5']), null);
    assert.equal(chooseEligibleWarfrontPets(lapsed, ['pet-1', 'pet-2', 'pet-3']), null);
    assert.equal(pets.length, 6, 'eligibility never deletes the two preserved records');
});

test('a Shinobi Supporter can field exactly four of six carried pets', () => {
    const supporter = { patreon: { active: true }, pets };
    assert.deepEqual(
        chooseEligibleWarfrontPets(supporter, ['pet-6', 'pet-5', 'pet-4', 'pet-3'])?.map(({ id }) => id),
        ['pet-6', 'pet-5', 'pet-4', 'pet-3'],
    );
    assert.equal(chooseEligibleWarfrontPets(supporter, ['pet-1', 'pet-1', 'pet-2', 'pet-3']), null);
});
