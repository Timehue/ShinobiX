import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let projectEligibleRosterPets: typeof import('./roster.js').projectEligibleRosterPets;

before(async () => {
    ({ projectEligibleRosterPets } = await import('./roster.js'));
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

const pets = Array.from({ length: 6 }, (_, index) => ({
    id: `pet-${index + 1}`,
    name: `Pet ${index + 1}`,
    attack: index + 1,
    secretTrainingLedger: `private-${index + 1}`,
}));

test('public roster projects authoritative Base four and Supporter six without Patreon data', () => {
    const base = projectEligibleRosterPets({ activePetId: 'pet-6', activePetId2v2: 'pet-5', pets }) as Array<Record<string, unknown>>;
    const supporter = projectEligibleRosterPets({
        activePetId: 'pet-6',
        activePetId2v2: 'pet-5',
        patreon: { active: true, tier: 'private' },
        pets,
    }) as Array<Record<string, unknown>>;

    assert.deepEqual(base.map(({ id }) => id), ['pet-6', 'pet-5', 'pet-1', 'pet-2']);
    assert.deepEqual(supporter.map(({ id }) => id), ['pet-6', 'pet-5', 'pet-1', 'pet-2', 'pet-3', 'pet-4']);
    assert.equal(base.length >= 4, true, 'the public DTO supports a Base 4v4 team');
    assert.equal(supporter.some((pet) => 'patreon' in pet || 'secretTrainingLedger' in pet), false);
});
