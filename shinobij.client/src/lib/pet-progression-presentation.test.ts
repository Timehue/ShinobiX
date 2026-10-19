import assert from 'node:assert/strict';
import { test } from 'node:test';
import { petProgressionPresentation } from './pet-progression-presentation';
import { tacticsPreset, tacticsSpecies } from '../../../shared/pet-tactics-roster';
import type { Pet } from '../types/pet';
import { PET_ABILITY_SPECIES_IDS } from '../../../shared/pet-ability-progression';

function companion(level: number): Pet {
    return { id: 'starter-water-owned', templateId: 'starter-water', level, rarity: 'standard',
        jutsus: [], rankedBuild: { ...tacticsPreset('starter-water'), ownedPetId: 'starter-water-owned' },
    } as unknown as Pet;
}

test('preview keeps locked saved preferences and displays only eligible defaults', () => {
    const pet = companion(1);
    const before = JSON.stringify(pet);
    const preview = petProgressionPresentation(pet);
    assert.ok(preview.savedLocked.length > 0);
    assert.ok(preview.active.length > 0);
    assert.ok(preview.active.every(move => Number(move.unlockLevel) <= 1));
    assert.equal(preview.active.some(move => move.signature), false);
    assert.equal(JSON.stringify(pet), before);
    assert.equal(preview.nextUnlock?.level, 5);
});

test('earned preferences and signatures appear at their exact boundaries', () => {
    assert.equal(petProgressionPresentation(companion(19)).active.some(move => move.signature), false);
    assert.equal(petProgressionPresentation(companion(20)).active.some(move => move.signature), true);
    const pet = companion(10);
    const preview = petProgressionPresentation(pet);
    const species = tacticsSpecies('starter-water')!;
    assert.ok(preview.active.some(move => move.name === species.signature.name) === false);
    assert.equal(preview.savedLocked.length, 0);
});

test('final mastery is earned at 75 and the preview has no later ability unlock', () => {
    const before = petProgressionPresentation(companion(74));
    const final = petProgressionPresentation(companion(75));
    assert.equal(before.nextUnlock?.level, 75);
    assert.equal(final.nextUnlock, null);
    assert.ok(final.active.some(move => move.abilityId?.endsWith('mastery-75')));
    assert.deepEqual(final.active.map(move => move.abilityId), petProgressionPresentation(companion(100)).active.map(move => move.abilityId));
});

test('every species preview admits only earned moves across authored and saved builds', () => {
    const levels = [1, 4, 5, 9, 10, 19, 20, 29, 30, 49, 50, 74, 75, 100];
    for (const templateId of PET_ABILITY_SPECIES_IDS) {
        for (const level of levels) {
            const pet = { id: templateId + '-review', templateId, level, jutsus: [] } as unknown as Pet;
            const variants = [pet, ...(tacticsSpecies(templateId) ? [{ ...pet, rankedBuild: { ...tacticsPreset(templateId), ownedPetId: pet.id } }] : [])];
            for (const variant of variants) {
                const preview = petProgressionPresentation(variant);
                assert.equal(preview.speciesId, templateId);
                assert.ok(preview.active.length > 0, `${templateId} has a usable preview at ${level}`);
                assert.ok(preview.active.every(move => Number(move.unlockLevel) <= level), `${templateId} has no locked active move at ${level}`);
                assert.equal(preview.active.some(move => move.signature), level >= 20, `${templateId} signature boundary at ${level}`);
                assert.equal(Math.max(...preview.unlocks.map(unlock => unlock.level)), 75);
            }
        }
    }
});
