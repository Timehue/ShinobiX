import assert from 'node:assert/strict';
import { test } from 'node:test';
import { petLoadoutPreview } from './pet-loadout-preview';
import { petProgressionPresentation } from './pet-progression-presentation';
import { tacticsPreset } from '../../../shared/pet-tactics-roster';
import type { Pet } from '../types/pet';

const nativePet = (): Pet => ({ id: 'preview-owned', templateId: 'starter-water', level: 30, jutsus: [] }) as unknown as Pet;

test('an absent saved build keeps actual native admission rather than the editor default', () => {
    const pet = nativePet();
    const before = JSON.stringify(pet);
    const preview = petLoadoutPreview(pet);
    assert.equal(preview.preferenceState, 'default');
    assert.equal(preview.unsaved, false);
    assert.strictEqual(preview.previewPet, pet);
    assert.equal(preview.previewPet.rankedBuild, undefined);
    assert.deepEqual(petProgressionPresentation(preview.previewPet).active, petProgressionPresentation(pet).active);
    assert.ok(preview.build, 'an editor default remains available for an explicit first save');
    assert.equal(JSON.stringify(pet), before);
});

test('saved preferences and explicit edited drafts are distinct and never mutate ownership', () => {
    const pet = { ...nativePet(), rankedBuild: { ...tacticsPreset('starter-water'), ownedPetId: 'preview-owned' } };
    const saved = petLoadoutPreview(pet);
    assert.equal(saved.preferenceState, 'saved');
    assert.strictEqual(saved.previewPet, pet);
    const before = JSON.stringify(pet);
    const draft = { ...saved.build!, moveIds: ['undertow', 'mend', 'purify', 'aegis'] };
    const preview = petLoadoutPreview(pet, { baseKey: saved.baseKey, build: draft });
    assert.equal(preview.preferenceState, 'draft');
    assert.equal(preview.unsaved, true);
    assert.equal(preview.previewingDraft, true);
    assert.strictEqual(preview.previewPet.rankedBuild, draft);
    assert.equal(JSON.stringify(pet), before);
    assert.deepEqual(petProgressionPresentation(preview.previewPet).savedInactive.map(move => move.id), ['aegis']);
});

test('first default save requires explicit intent and stale or incomplete drafts cannot replace current admission', () => {
    const pet = nativePet();
    const initial = petLoadoutPreview(pet);
    const firstDraft = petLoadoutPreview(pet, { baseKey: initial.baseKey, build: initial.build! });
    assert.equal(firstDraft.unsaved, true, 'even the identical default is unsaved before its first save');
    assert.equal(firstDraft.previewingDraft, true);
    const savedPet = { ...pet, rankedBuild: initial.build! };
    const saved = petLoadoutPreview(savedPet, { baseKey: initial.baseKey, build: initial.build! });
    assert.notEqual(saved.baseKey, initial.baseKey, 'absence is part of the ownership key');
    assert.strictEqual(saved.previewPet, savedPet);
    assert.equal(saved.unsaved, false);
    const otherPet = { ...pet, id: 'another-owned-pet' };
    assert.strictEqual(petLoadoutPreview(otherPet, { baseKey: initial.baseKey, build: initial.build! }).previewPet, otherPet);
    const incomplete = petLoadoutPreview(pet, { baseKey: initial.baseKey, build: { ...initial.build!, moveIds: ['water-strike'] } });
    assert.equal(incomplete.unsaved, true);
    assert.equal(incomplete.previewingDraft, false);
    assert.strictEqual(incomplete.previewPet, pet);
});
