import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { PET_UNLOCK_WORN_ERROR, petUnlockLeftWithoutCopy, petWearsUnlock, withoutUnbackedPetUnlocks } from './_pet-unlocks.js';
import {
    PET_EVOLUTION_STONE_IDS, PET_SUPPLY_HOLD_CAP, isPetUnlockItem, petCollars, petConsumables, petFeedItems,
    petPveGear, petPvpGear, petSlotAcceptsItem, petSupplyHoldCap,
} from '../_pet-sim/pet-config.js';
import { EVOLUTION_LINES } from './_evolution.js';
import { applyTreasuryDonation } from '../_treasury-donate.js';
import { removeAsset, type SealedExchangeAsset } from '../festival/_exchange-assets.js';

/*
 * 2026-10 item-use pass: collars and PvP pet gear are unlocks (one backpack copy
 * equips on every pet and stays in the backpack), so the last copy cannot leave
 * while a pet still wears it.
 */
const wearing = (itemId: string, slot: 'collar' | 'pvp' = 'pvp') => ({
    pets: [{ id: 'p1', loadout: { [slot]: itemId } }, { id: 'p2', loadout: {} }],
});

describe('pet slots take only their own kind', () => {
    it('maps each slot to its own catalog', () => {
        assert.equal(petSlotAcceptsItem('consumable', 'consum-second-wind'), true);
        assert.equal(petSlotAcceptsItem('consumable', 'pet-treat'), false, 'a Treat is pet food, not a battle consumable');
        assert.equal(petSlotAcceptsItem('pve', 'pve-frenzy-claw'), true);
        assert.equal(petSlotAcceptsItem('pve', 'pvp-aegis-pendant'), false);
        assert.equal(petSlotAcceptsItem('pvp', 'pvp-aegis-pendant'), true);
        assert.equal(petSlotAcceptsItem('collar', 'collar-crimson'), true);
        assert.equal(petSlotAcceptsItem('collar', 'pvp-aegis-pendant'), false);
        assert.equal(petSlotAcceptsItem('nope', 'collar-crimson'), false);
        assert.equal(petSlotAcceptsItem('collar', undefined), false);
    });

    it('treats every collar and every PvP gear, and nothing else, as an unlock', () => {
        for (const id of [...petCollars.map((c) => c.id), ...petPvpGear.map((g) => g.id)]) assert.equal(isPetUnlockItem(id), true, id);
        for (const id of [...petPveGear.map((g) => g.id), ...petConsumables.map((c) => c.id), 'pet-treat', 'thrown-shuriken']) {
            assert.equal(isPetUnlockItem(id), false, id);
        }
    });
});

describe('pet supplies buy in bulk', () => {
    it('caps treats, PvE gear, consumables and evolution stones at the shared hold cap', () => {
        assert.equal(PET_SUPPLY_HOLD_CAP, 50);
        for (const id of [...petFeedItems.map((i) => i.id), ...petPveGear.map((g) => g.id), ...petConsumables.map((c) => c.id), ...PET_EVOLUTION_STONE_IDS]) {
            assert.equal(petSupplyHoldCap(id), PET_SUPPLY_HOLD_CAP, id);
        }
    });

    it('keeps collars and PvP gear single-purchase unlocks', () => {
        for (const id of [...petCollars.map((c) => c.id), ...petPvpGear.map((g) => g.id), 'shinobi-vest', undefined]) {
            assert.equal(petSupplyHoldCap(id), null, String(id));
        }
    });

    it('names exactly the stones the evolve route consumes', () => {
        const required = new Set(Object.values(EVOLUTION_LINES).flatMap((line) => Object.values(line.stages).map((stage) => stage.requiredItem)));
        assert.deepEqual([...PET_EVOLUTION_STONE_IDS].sort(), [...required].sort());
    });
});

describe('the last copy of a worn pet unlock stays in the backpack', () => {
    it('flags only an unlock with no copy left and a pet still wearing it', () => {
        assert.equal(petWearsUnlock(wearing('pvp-aegis-pendant'), 'pvp-aegis-pendant'), true);
        assert.equal(petUnlockLeftWithoutCopy({ ...wearing('pvp-aegis-pendant'), inventory: [] }, 'pvp-aegis-pendant'), true);
        assert.equal(petUnlockLeftWithoutCopy({ ...wearing('pvp-aegis-pendant'), inventory: ['pvp-aegis-pendant'] }, 'pvp-aegis-pendant'), false, 'a copy remains');
        assert.equal(petUnlockLeftWithoutCopy({ ...wearing('collar-crimson', 'collar'), itemStacks: [{ itemId: 'collar-crimson', count: 1 }] }, 'collar-crimson'), false);
        assert.equal(petUnlockLeftWithoutCopy({ pets: [], inventory: [] }, 'pvp-aegis-pendant'), false, 'no pet wears it');
        // PvE gear and consumables move onto the pet, so they never trip this.
        assert.equal(petUnlockLeftWithoutCopy({ pets: [{ id: 'p1', loadout: { pvp: 'consum-second-wind' } }], inventory: [] }, 'consum-second-wind'), false);
    });

    it('refuses a treasury donation of the last worn copy and allows a spare one', () => {
        const rules = { allowedCurrencies: ['ryo'], currencyCaps: { ryo: 1 }, itemCountCap: 10 };
        const donor = { ...wearing('pvp-aegis-pendant'), inventory: ['pvp-aegis-pendant'], itemStacks: [] };
        const refused = applyTreasuryDonation({}, donor, { kind: 'item', itemId: 'pvp-aegis-pendant', count: 1 }, rules);
        assert.deepEqual(refused, { ok: false, status: 400, error: PET_UNLOCK_WORN_ERROR });
        const spare = applyTreasuryDonation({}, { ...donor, inventory: ['pvp-aegis-pendant', 'pvp-aegis-pendant'] }, { kind: 'item', itemId: 'pvp-aegis-pendant', count: 1 }, rules);
        assert.equal(spare.ok, true);
    });

    it('refuses an Exchange listing of the last worn copy', () => {
        const sealed = { asset: { kind: 'item', id: 'pvp-aegis-pendant' }, definition: {}, stackable: false } as unknown as SealedExchangeAsset;
        const seller = { ...wearing('pvp-aegis-pendant'), inventory: ['pvp-aegis-pendant'], itemStacks: [], equipment: {} };
        assert.throws(() => removeAsset(seller, sealed, 1), (error: Error) => error.message === PET_UNLOCK_WORN_ERROR);
        const spare = removeAsset({ ...seller, inventory: ['pvp-aegis-pendant', 'pvp-aegis-pendant'] }, sealed, 1);
        assert.deepEqual(spare.inventory, ['pvp-aegis-pendant']);
        const unworn = removeAsset({ ...seller, pets: [] }, sealed, 1);
        assert.deepEqual(unworn.inventory, []);
    });

    it('a pet back from the Sanctuary drops only the unlocks the backpack no longer holds', () => {
        const pet = { id: 'p1', loadout: { collar: 'collar-crimson', pvp: 'pvp-aegis-pendant', pve: 'pve-frenzy-claw', pveDurability: 4 } };
        const back = withoutUnbackedPetUnlocks(pet, { inventory: ['collar-crimson'], itemStacks: [] });
        assert.deepEqual(back.loadout, { collar: 'collar-crimson', pve: 'pve-frenzy-claw', pveDurability: 4 });
        assert.equal(withoutUnbackedPetUnlocks(pet, { inventory: ['collar-crimson', 'pvp-aegis-pendant'] }), pet, 'unchanged when every unlock is held');
    });
});
