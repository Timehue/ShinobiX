import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyCompanionUsageCost } from '../solo-pve/_settlement.js';

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

    // 2026-10 item-use pass: a piece at 0 durability seals as no gear, so the usage
    // never named it and it stayed on the pet for good (loyalty included).
    it('breaks spent PVE gear on the next summon, as the client-run summon cost does', () => {
        const character = { pets: [{ id: 'pet-1', loadout: { pve: 'pve-loyal-companion-bell', pveDurability: 0, pvp: 'pvp-claw' } }] };
        const next = applyCompanionUsageCost(character, { petId: 'pet-1' });
        assert.deepEqual((next.pets as Array<Record<string, unknown>>)[0]?.loadout, { pvp: 'pvp-claw' });
        const last = applyCompanionUsageCost({ pets: [{ id: 'pet-1', loadout: { pve: 'pve-frenzy-claw', pveDurability: 1 } }] }, { petId: 'pet-1', pveGearId: 'pve-frenzy-claw' });
        const worn = applyCompanionUsageCost(last, { petId: 'pet-1' });
        assert.deepEqual((last.pets as Array<Record<string, unknown>>)[0]?.loadout, { pve: 'pve-frenzy-claw', pveDurability: 0 }, 'the 20th summon spends the last point');
        assert.deepEqual((worn.pets as Array<Record<string, unknown>>)[0]?.loadout, {}, 'the next one breaks it');
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
