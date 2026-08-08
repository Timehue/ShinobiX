import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { territoryVillageOwnershipError } from './_territory-ownership.js';

describe('territory village ownership authority', () => {
    it('allows an unchanged owner and a legitimate unprotected capture', () => {
        assert.equal(territoryVillageOwnershipError({
            sector: 2,
            actorVillage: 'Moonshadow Village',
            previousOwnerVillage: 'Stormveil Village',
            requestedOwnerVillage: 'Stormveil Village',
        }), null);
        assert.equal(territoryVillageOwnershipError({
            sector: 2,
            actorVillage: 'Moonshadow Village',
            previousOwnerVillage: 'Stormveil Village',
            requestedOwnerVillage: 'Moonshadow Village',
        }), null);
    });

    it('rejects clearing an owner or capturing for a different village', () => {
        assert.match(territoryVillageOwnershipError({
            sector: 2,
            actorVillage: 'Moonshadow Village',
            previousOwnerVillage: 'Stormveil Village',
            requestedOwnerVillage: '',
        }) ?? '', /cannot be cleared/i);
        assert.match(territoryVillageOwnershipError({
            sector: 2,
            actorVillage: 'Moonshadow Village',
            previousOwnerVillage: 'Stormveil Village',
            requestedOwnerVillage: 'Frostfang Village',
        }) ?? '', /own village/i);
        // The old bypass omitted ownerVillage (so it stayed equal to the
        // previous owner) while planting the attacker's clan banner.
        assert.match(territoryVillageOwnershipError({
            sector: 2,
            actorVillage: 'Moonshadow Village',
            previousOwnerVillage: 'Stormveil Village',
            requestedOwnerVillage: 'Stormveil Village',
            claimingClanChanges: true,
        }) ?? '', /own village/i);
    });

    it('pins a protected gate to its home village, including legacy foreign state', () => {
        assert.match(territoryVillageOwnershipError({
            sector: 1,
            actorVillage: 'Moonshadow Village',
            previousOwnerVillage: 'Stormveil Village',
            requestedOwnerVillage: 'Moonshadow Village',
        }) ?? '', /protected village gate/i);
        assert.match(territoryVillageOwnershipError({
            sector: 1,
            actorVillage: 'Moonshadow Village',
            previousOwnerVillage: 'Moonshadow Village',
            requestedOwnerVillage: 'Moonshadow Village',
        }) ?? '', /protected village gate/i);
        assert.equal(territoryVillageOwnershipError({
            sector: 1,
            actorVillage: 'Stormveil Village',
            previousOwnerVillage: 'Moonshadow Village',
            requestedOwnerVillage: 'Stormveil Village',
        }), null);
    });
});
