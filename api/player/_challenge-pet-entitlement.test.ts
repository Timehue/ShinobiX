import { test } from 'node:test';
import assert from 'node:assert/strict';
import { petById, projectChallengerCharacter, selectedCombatPetBusyReason } from './challenge.js';

const pets = Array.from({ length: 5 }, (_, index) => ({ id: `pet-${index + 1}`, name: `Pet ${index + 1}` }));

test('direct challenges cannot seal lapsed carried overflow into Tactical combat', () => {
    const lapsed = {
        name: 'Lapsed',
        patreon: { active: false },
        activePetId: 'pet-5',
        activePetId2v2: 'pet-4',
        pets,
    };

    assert.equal(petById(lapsed, 'pet-3'), null, 'preserved overflow is not challenge-eligible');
    assert.equal(petById(lapsed, 'pet-5')?.id, 'pet-5', 'the current active pet remains eligible');
    const projected = projectChallengerCharacter(lapsed) as { pets: Array<{ id: string }> };
    assert.deepEqual(projected.pets.map(({ id }) => id), ['pet-5', 'pet-4', 'pet-1']);
    assert.equal(pets.length, 5, 'challenge projection does not delete ownership data');
});

test('a current Shinobi Supporter can challenge with all five carried pets', () => {
    const supporter = { patreon: { active: true }, pets };
    assert.equal(petById(supporter, 'pet-5')?.id, 'pet-5');
});

test('direct challenge selections share the breeding, training, and expedition combat-busy rule', () => {
    const base = { patreon: { active: true }, pets };
    assert.equal(selectedCombatPetBusyReason({
        ...base,
        petBreeding: { state: 'breeding', parentIds: ['pet-1', 'pet-2'], readyAt: Date.now() + 60_000 },
    }, ['pet-1']), 'pet-is-breeding');
    assert.equal(selectedCombatPetBusyReason({
        ...base,
        pets: pets.map((pet) => pet.id === 'pet-2' ? { ...pet, training: { endsAt: 1 } } : pet),
    }, ['pet-2']), 'pet-is-training');
    assert.equal(selectedCombatPetBusyReason({
        ...base,
        pets: pets.map((pet) => pet.id === 'pet-3' ? { ...pet, expedition: { endsAt: 1 } } : pet),
    }, ['pet-3']), 'pet-is-on-expedition');
});
