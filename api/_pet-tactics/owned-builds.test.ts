import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownedTacticsSpeciesId, tacticsPreset } from '../../shared/pet-tactics-roster.js';
import { validateOwnedRankedBuilds } from './owned-builds.js';
import { sealTeam, createTacticsBattle, petSheets } from './engine.js';

const pets = () => ['standard-0', 'rare-24', 'mythic-9', 'starter-fire'].map((templateId, i) => ({
    id: `${templateId}:instance-${i}`, templateId, rarity: i === 3 ? 'legendary' : templateId.split('-')[0], evolutionStage: i === 3 ? 2 : 0,
}));
const builds = (p = pets()) => p.map(pet => ({ ...tacticsPreset(ownedTacticsSpeciesId(pet)!), ownedPetId: pet.id }));
test('ranked preserves carried instance identities and evolved forms across the full roster', () => {
    const valid = validateOwnedRankedBuilds({ pets: pets() }, builds());
    assert.equal(valid[3].speciesId, 'starter-fire-l');
    assert.equal(sealTeam(valid, 'a')[2].ownedPetId, pets()[2].id);
    assert.equal(petSheets(createTacticsBattle('test', valid, valid, 1), 'a')[2].ownedPetId, pets()[2].id);
});
test('ranked rejects loan species, foreign instances, duplicate pets and form spoofing', () => {
    const p = pets(), team = builds();
    for (const invalid of [team.map(({ ownedPetId, ...b }) => b), [...team.slice(0, 3), team[0]],
        team.map((b, i) => i === 0 ? { ...b, ownedPetId: 'foreign' } : b),
        team.map((b, i) => i === 0 ? { ...tacticsPreset('starter-water'), ownedPetId: b.ownedPetId } : b)]) {
        assert.throws(() => validateOwnedRankedBuilds({ pets: p }, invalid));
    }
});
test('ranked refuses Sanctuary and expedition pets, including uncollected returns', () => {
    const p = pets();
    assert.throws(() => validateOwnedRankedBuilds({ pets: [{ id: 'rare-1' }, { id: 'rare-2' }, ...p] }, builds()), /carrying/);
    assert.throws(() => validateOwnedRankedBuilds({ pets: p.map((pet, i) => i === 0 ? { ...pet, expedition: { endsAt: 1 } } : pet) }, builds()), /expedition/);
});
test('two separately owned pets of the same species can enter together', () => {
    const p = pets(); p[1] = { ...p[0], id: 'standard-0:second' };
    assert.equal(validateOwnedRankedBuilds({ pets: p }, builds(p)).length, 4);
});
