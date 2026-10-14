import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankedBattlePresentationPets, rankedCarriedRoster } from './pet-ranked-roster';
import { petCombatModel } from './pet-3d-models';
import type { Character } from '../types/character';
import { PET_TACTICS_IDENTITIES } from '../../../shared/pet-tactics-catalog';
import { validateBuilds } from '../../../api/_pet-tactics/engine';
import { tacticsPreset } from '../../../shared/pet-tactics-roster';

test('picker shows carried instances, evolved forms and availability without substituting loan pets', () => {
    const character = { pets: Array.from({ length: 7 }, (_, i) => ({ id: `owned-${i}`, templateId: i === 0 ? 'starter-fire' : 'standard-0',
        name: `My pet ${i}`, nickname: i === 0 ? 'Flame' : undefined, rarity: i === 0 ? 'legendary' : 'standard', evolutionStage: i === 0 ? 2 : 0,
        expedition: i === 1 ? { endsAt: 1 } : undefined })) } as unknown as Character;
    const roster = rankedCarriedRoster(character);
    assert.equal(roster.length, 5); assert.equal(roster[0].id, 'starter-fire-l'); assert.equal(roster[0].name, 'Flame');
    assert.equal(roster[0].build.ownedPetId, 'owned-0'); assert.equal(roster[1].unavailable, 'On expedition');
    assert.deepEqual(rankedCarriedRoster(undefined), []);
});
test('every canonical species and evolved form has legal competitive presets', () => {
    for (const [id] of PET_TACTICS_IDENTITIES) for (const preset of [0, 1]) {
        const fill = ['starter-fire', 'starter-water', 'starter-wind', 'starter-earth'].filter(p => p !== id).slice(0, 3);
        assert.equal(validateBuilds([tacticsPreset(id, preset), ...fill.map(p => tacticsPreset(p))]).length, 4, id);
    }
});

test('legacy owned pets retain their sealed evolved art after receiving battle actor ids', () => {
    const character = { pets: [{ id: 'starter-fire', name: 'Inferno Fenrir', rarity: 'legendary', evolutionStage: 2 }] } as unknown as Character;
    const [actor] = rankedBattlePresentationPets(character, [{ id: 'a-0', speciesId: 'starter-fire-l', ownedPetId: 'starter-fire' }]);
    assert.equal(actor.id, 'a-0');
    assert.equal(petCombatModel(actor)?.visualId, 'starter-fire-l');
    assert.deepEqual(rankedBattlePresentationPets(undefined, []), []);
});

test('carried instances load their own saved moves and evolved pets discard outdated kits', () => {
    const custom = { ...tacticsPreset('starter-fire', 1), ownedPetId: 'first', item: 'focus-lens' as const };
    const character = { pets: [
        { id: 'first', templateId: 'starter-fire', rankedBuild: custom },
        { id: 'second', templateId: 'starter-fire', rankedBuild: { ...custom, ownedPetId: 'first' } },
        { id: 'evolved', templateId: 'starter-fire', rarity: 'rare', evolutionStage: 1, rankedBuild: custom },
        { id: 'legacy', templateId: 'starter-fire' },
        { id: 'malformed', templateId: 'starter-fire', rankedBuild: { ...custom, moveIds: ['unknown'] } },
    ] } as unknown as Character;
    const roster = rankedCarriedRoster(character);
    assert.deepEqual(roster[0].build, custom);
    assert.equal(roster[1].build.ownedPetId, 'second');
    assert.deepEqual(roster[2].build.moveIds, tacticsPreset('starter-fire-r').moveIds);
    assert.deepEqual(roster[3].build.moveIds, tacticsPreset('starter-fire').moveIds);
    assert.deepEqual(roster[4].build.moveIds, tacticsPreset('starter-fire').moveIds);
    roster[0].build.moveIds.pop();
    assert.equal(custom.moveIds.length, 4, 'draft edits must not mutate the saved loadout');
});
