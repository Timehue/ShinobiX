/*
 * Server adapter for shared/pet-happiness.ts — applies the daily bond decay to
 * raw save records.
 *
 * The math and the tuning live in the shared module (imported unchanged by the
 * client); this file only knows how to reach into a `Record<string, unknown>`
 * save, walk `character.pets[]`, and write the three happiness fields back.
 *
 * Where this runs:
 *   - api/_elapsed-state.ts settleSaveRecordForRead(persist) — the owner's own
 *     save GET. This is what durably ticks the decay, once per day per player.
 *   - api/pet/progress.ts — before every pet action, under the save mutation
 *     lock, so feeding/petting/training can never bank a missed day.
 *   - api/combat-core/companion.ts — PROJECTED (not written) into the companion
 *     seal, so a fight always uses the pet's true happiness even if the owner
 *     has not re-read their save since the rollover.
 *
 * Cleared/updated fields are always written as explicit values, never `delete`d:
 * settled saves persist through `mergePreservingImages`, which seeds from the
 * STORED record and only overrides keys the incoming payload actually contains
 * (see the same note on settleFinishedTraining in _progress.ts).
 */

import {
    applyFreePetInteraction,
    applyPetHappinessGain,
    settlePetHappinessState,
    type PetHappinessSettlement,
    type PetHappinessState,
} from '../../shared/pet-happiness.js';

type RawPet = Record<string, unknown>;

function happinessStateOf(pet: RawPet): PetHappinessState {
    return {
        happiness: pet.happiness === undefined ? undefined : Number(pet.happiness),
        happinessDay: pet.happinessDay === undefined ? undefined : Number(pet.happinessDay),
        happinessPets: pet.happinessPets === undefined ? undefined : Number(pet.happinessPets),
    };
}

/** Write a settlement onto a pet, returning a NEW object (never mutating). */
export function withHappinessSettlement(pet: RawPet, settlement: PetHappinessSettlement): RawPet {
    return {
        ...pet,
        happiness: settlement.happiness,
        happinessDay: settlement.happinessDay,
        happinessPets: settlement.happinessPets,
    };
}

/** The pet's happiness right now, without writing anything. Use for reads that
 *  do not hold the save lock (combat seals, DTO projections). */
export function currentPetHappiness(pet: RawPet, now: number): number {
    return settlePetHappinessState(happinessStateOf(pet), now).happiness;
}

/** Settle one pet's pending decay. Returns the pet unchanged when nothing is owed. */
export function settlePetHappiness(pet: RawPet, now: number): { pet: RawPet; changed: boolean; decayed: number } {
    const settlement = settlePetHappinessState(happinessStateOf(pet), now);
    if (!settlement.changed) return { pet, changed: false, decayed: 0 };
    return { pet: withHappinessSettlement(pet, settlement), changed: true, decayed: settlement.decayed };
}

/**
 * Settle every owned pet on a character. Returns the character unchanged (same
 * reference) when no pet owed anything, so callers can skip a needless write.
 */
export function settleCharacterPetHappiness(
    character: Record<string, unknown>,
    now: number,
): { character: Record<string, unknown>; changed: boolean; decayed: number } {
    const pets = Array.isArray(character.pets) ? character.pets as RawPet[] : null;
    if (!pets || pets.length === 0) return { character, changed: false, decayed: 0 };
    let changed = false;
    let decayed = 0;
    const nextPets = pets.map((pet) => {
        if (!pet || typeof pet !== 'object') return pet;
        const settled = settlePetHappiness(pet, now);
        if (settled.changed) {
            changed = true;
            decayed += settled.decayed;
        }
        return settled.pet;
    });
    return changed ? { character: { ...character, pets: nextPets }, changed: true, decayed } : { character, changed: false, decayed: 0 };
}

/**
 * Spend one free "Pet" interaction. Returns null when today's budget is already
 * spent — api/pet/progress.ts turns that into a 409 so the player learns why.
 */
export function petFreeInteraction(pet: RawPet, now: number): RawPet | null {
    const settlement = applyFreePetInteraction(happinessStateOf(pet), now);
    return settlement ? withHappinessSettlement(pet, settlement) : null;
}

/** Apply an unbudgeted happiness gain (treat, bond training) after settling decay. */
export function grantPetHappiness(pet: RawPet, amount: number, now: number): RawPet {
    return withHappinessSettlement(pet, applyPetHappinessGain(happinessStateOf(pet), amount, now));
}

/**
 * SPEND happiness as the price of something (today: the bold expedition route,
 * shared/pet-expedition-contract.ts). Settles the pending daily decay first, so
 * the charge comes off what the pet actually holds and the stamp advances with
 * the same write — a long expedition's collect can otherwise settle its cost
 * against pre-decay happiness. Floors at 0; never goes negative.
 */
export function spendPetHappiness(pet: RawPet, amount: number, now: number): RawPet {
    const settled = settlePetHappinessState(happinessStateOf(pet), now);
    return withHappinessSettlement(pet, {
        ...settled,
        happiness: Math.max(0, settled.happiness - Math.max(0, Math.floor(Number(amount) || 0))),
        changed: true,
    });
}

/**
 * SUSPEND the bond clock for a pet leaving the carried roster (the Pet
 * Sanctuary). Settles whatever decay is owed up to this moment — so the banked
 * happiness is honest as of the deposit — then drops the stamp, which makes the
 * pet "never settled" again. The first settle after it is withdrawn therefore
 * re-stamps WITHOUT decaying, and time in storage costs nothing.
 *
 * This is not leniency, it is the absence of a trap. A sanctuary pet is not in
 * `character.pets`, so api/pet/progress.ts 404s every action against it: it
 * cannot be petted, fed or trained. Decay is the cost of ignoring a companion
 * you could have cared for — charging it while the game gives the player no way
 * to respond would just punish anyone who used the Sanctuary as intended.
 *
 * Cleared as explicit `undefined` rather than `delete`, matching how training
 * and expedition are cleared: a withdrawn pet is re-appended to `character.pets`
 * and written through `mergePreservingImages`, which pairs array items
 * positionally when no id matches — an own key that is undefined overrides and
 * then drops on JSON, while an absent key could inherit a neighbour's value.
 */
export function suspendPetHappiness(pet: RawPet, now: number): RawPet {
    const settled = settlePetHappinessState(happinessStateOf(pet), now);
    return { ...pet, happiness: settled.happiness, happinessDay: undefined, happinessPets: undefined };
}
