import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyCompanionUsageCost } from './report-ai-fight.js';

describe('AI-fight companion settlement cost', () => {
    it('charges only the sealed summoned pet gear and consumable', () => {
        const character = {
            pets: [
                { id: 'pet-1', loadout: { pve: 'pve-crest', pveDurability: 2, consumable: 'pet-tonic', pvp: 'pvp-claw' } },
                { id: 'pet-2', loadout: { pve: 'other', pveDurability: 9, consumable: 'other-tonic' } },
            ],
        };
        const next = applyCompanionUsageCost(character, {
            petId: 'pet-1',
            pveGearId: 'pve-crest',
            consumableId: 'pet-tonic',
        });
        const pets = next.pets as Array<Record<string, unknown>>;
        assert.deepEqual(pets[0]?.loadout, { pve: 'pve-crest', pveDurability: 1, pvp: 'pvp-claw' });
        assert.deepEqual(pets[1], character.pets[1]);
    });

    it('does not spend a newly changed loadout that differs from terminal evidence', () => {
        const character = { pets: [{ id: 'pet-1', loadout: { pve: 'new-gear', pveDurability: 5, consumable: 'new-tonic' } }] };
        const next = applyCompanionUsageCost(character, {
            petId: 'pet-1',
            pveGearId: 'old-gear',
            consumableId: 'old-tonic',
        });
        assert.deepEqual(next, character);
    });
});
