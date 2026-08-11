import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activeBreedingParentIds, PET_BREEDING_MIN_LEVEL, petBreedingEligibility, petBusyReason, petCombatBusyReason } from './_pet-busy.js';

const pet = { id: 'p1', templateId: 'standard-0', element: 'Fire', level: PET_BREEDING_MIN_LEVEL, breedingUsesRemaining: 5 };

describe('breeding busy-state contract', () => {
    it('locks parents only while the breeding timer is active', () => {
        const character = { petBreeding: { state: 'breeding', parentIds: ['p1', 'p2'], readyAt: 100 } };
        assert.deepEqual([...activeBreedingParentIds(character, 99)], ['p1', 'p2']);
        assert.equal(activeBreedingParentIds(character, 100).size, 0);
        assert.equal(petBusyReason(character, pet, 99, { includeActive: false, includeReserve: false }), 'pet-is-breeding');
    });

    it('centralizes the three combat-busy states without treating active slots as busy', () => {
        const breeding = { petBreeding: { state: 'breeding', parentIds: ['p1', 'p2'], readyAt: 100 } };
        assert.equal(petCombatBusyReason(breeding, pet, 99), 'pet-is-breeding');
        assert.equal(petCombatBusyReason(breeding, pet, 100), null);
        assert.equal(petCombatBusyReason({}, { ...pet, training: { type: 'strength', endsAt: 1 } }), 'pet-is-training');
        assert.equal(petCombatBusyReason({}, { ...pet, expedition: { type: 'scout', endsAt: 1 } }), 'pet-is-on-expedition');
        assert.equal(petCombatBusyReason({ activePetId: 'p1', activePetId2v2: 'p1' }, pet), null);
    });

    it('rejects protected, spent, active, training, expedition, and assigned pets', () => {
        assert.equal(petBreedingEligibility({}, { ...pet, breedable: false }).ok, false);
        assert.equal(petBreedingEligibility({}, { ...pet, breedingUsesRemaining: 0 }).ok, false);
        assert.equal(petBreedingEligibility({ activePetId: 'p1' }, pet).ok, false);
        assert.equal(petBreedingEligibility({}, { ...pet, training: {} }).ok, false);
        assert.equal(petBreedingEligibility({}, { ...pet, expedition: {} }).ok, false);
        assert.equal(petBreedingEligibility({}, pet, Date.now(), { assignmentIds: ['p1'] }).ok, false);
    });

    it('requires both parents to be level 50 or higher', () => {
        assert.deepEqual(petBreedingEligibility({}, { ...pet, level: 49 }), {
            ok: false,
            code: 'pet-level-too-low',
            message: 'This pet must reach level 50 before breeding.',
        });
        assert.equal(petBreedingEligibility({}, { ...pet, level: 50 }).ok, true);
        assert.equal(petBreedingEligibility({}, { ...pet, level: 100 }).ok, true);
    });
});
