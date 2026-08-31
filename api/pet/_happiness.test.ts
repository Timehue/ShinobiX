import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    PET_HAPPINESS_DAILY_DECAY,
    PET_HAPPINESS_DAILY_PET_BUDGET,
    PET_HAPPINESS_PET_GAIN,
    utcDayIndex,
} from '../../shared/pet-happiness.js';
import {
    currentPetHappiness,
    grantPetHappiness,
    petFreeInteraction,
    settleCharacterPetHappiness,
    settlePetHappiness,
    spendPetHappiness,
} from './_happiness.js';

const DAY = 86_400_000;
const DAY_0 = Date.UTC(2026, 7, 31);
const daysLater = (n: number) => DAY_0 + n * DAY;

const stampedPet = (id: string, happiness: number, at = DAY_0) => ({
    id,
    name: 'Wolf',
    happiness,
    happinessDay: utcDayIndex(at),
    happinessPets: 0,
});

describe('server pet-happiness settle', () => {
    it('leaves an already-settled pet untouched by reference', () => {
        const pet = stampedPet('p1', 80);
        const settled = settlePetHappiness(pet, DAY_0);
        assert.equal(settled.changed, false);
        assert.equal(settled.pet, pet, 'no write means the exact same object, so callers can skip persisting');
    });

    it('decays across a daily reset without mutating the input', () => {
        const pet = stampedPet('p1', 80);
        const settled = settlePetHappiness(pet, daysLater(2));
        assert.equal(settled.changed, true);
        assert.equal(settled.decayed, 2 * PET_HAPPINESS_DAILY_DECAY);
        assert.equal(settled.pet.happiness, 80 - 2 * PET_HAPPINESS_DAILY_DECAY);
        assert.equal(pet.happiness, 80, 'input pet must not be mutated');
    });

    it('preserves every other field on the pet', () => {
        const pet = { ...stampedPet('p1', 80), level: 42, nickname: 'Ash', loadout: { pve: 'gear' } };
        const settled = settlePetHappiness(pet, daysLater(1));
        assert.equal(settled.pet.level, 42);
        assert.equal(settled.pet.nickname, 'Ash');
        assert.deepEqual(settled.pet.loadout, { pve: 'gear' });
    });

    it('writes the cleared counters as explicit values, never as absent keys', () => {
        // Settled saves persist through mergePreservingImages, which seeds from
        // the STORED record — an absent key would let the stale value survive.
        const settled = settlePetHappiness(stampedPet('p1', 80, DAY_0), daysLater(1));
        assert.ok(Object.hasOwn(settled.pet, 'happiness'));
        assert.ok(Object.hasOwn(settled.pet, 'happinessDay'));
        assert.ok(Object.hasOwn(settled.pet, 'happinessPets'));
    });

    it('stamps a legacy pet that has never been settled instead of retro-decaying it', () => {
        const legacy = { id: 'legacy', happiness: 100 };
        const settled = settlePetHappiness(legacy, daysLater(400));
        assert.equal(settled.pet.happiness, 100, 'a pre-decay save must not lose happiness on the first read');
        assert.equal(settled.decayed, 0);
        assert.equal(settled.pet.happinessDay, utcDayIndex(daysLater(400)));
    });

    it('projects the current value without writing (currentPetHappiness)', () => {
        const pet = stampedPet('p1', 100);
        assert.equal(currentPetHappiness(pet, daysLater(4)), 100 - 4 * PET_HAPPINESS_DAILY_DECAY);
        assert.equal(pet.happiness, 100, 'projection must not mutate');
    });
});

describe('server pet-happiness — character roster', () => {
    it('settles every owned pet and reports the total decayed', () => {
        const character = { name: 'Ren', pets: [stampedPet('a', 100), stampedPet('b', 40)] };
        const settled = settleCharacterPetHappiness(character, daysLater(1));
        assert.equal(settled.changed, true);
        assert.equal(settled.decayed, 2 * PET_HAPPINESS_DAILY_DECAY);
        const pets = settled.character.pets as Array<Record<string, unknown>>;
        assert.equal(pets[0].happiness, 100 - PET_HAPPINESS_DAILY_DECAY);
        assert.equal(pets[1].happiness, 40 - PET_HAPPINESS_DAILY_DECAY);
    });

    it('returns the SAME character reference when nothing is owed', () => {
        const character = { name: 'Ren', pets: [stampedPet('a', 100)] };
        const settled = settleCharacterPetHappiness(character, DAY_0);
        assert.equal(settled.changed, false);
        assert.equal(settled.character, character, 'an unchanged settle must not force a save write');
    });

    it('is a no-op for a character with no pets', () => {
        for (const character of [{ name: 'Ren' }, { name: 'Ren', pets: [] }]) {
            const settled = settleCharacterPetHappiness(character, daysLater(9));
            assert.equal(settled.changed, false);
            assert.equal(settled.character, character);
        }
    });

    it('survives a malformed roster entry', () => {
        const character = { name: 'Ren', pets: [null, stampedPet('a', 100)] };
        const settled = settleCharacterPetHappiness(character, daysLater(1));
        const pets = settled.character.pets as Array<Record<string, unknown> | null>;
        assert.equal(pets[0], null);
        assert.equal(pets[1]?.happiness, 100 - PET_HAPPINESS_DAILY_DECAY);
    });
});

describe('server pet-happiness — interactions', () => {
    it('rations free petting to the daily budget', () => {
        let pet: Record<string, unknown> | null = stampedPet('p1', 0);
        for (let i = 0; i < PET_HAPPINESS_DAILY_PET_BUDGET / PET_HAPPINESS_PET_GAIN; i += 1) {
            pet = petFreeInteraction(pet as Record<string, unknown>, DAY_0);
            assert.ok(pet, `interaction ${i + 1} should be allowed`);
        }
        assert.equal((pet as Record<string, unknown>).happiness, PET_HAPPINESS_DAILY_PET_BUDGET);
        assert.equal(petFreeInteraction(pet as Record<string, unknown>, DAY_0), null, 'endpoint turns null into a 409');
    });

    it('refills the free budget after the daily reset', () => {
        const spentOut = { ...stampedPet('p1', 50), happinessPets: PET_HAPPINESS_DAILY_PET_BUDGET };
        assert.equal(petFreeInteraction(spentOut, DAY_0), null);
        const nextDay = petFreeInteraction(spentOut, daysLater(1));
        assert.ok(nextDay, 'a new day refills the budget');
        assert.equal(nextDay.happiness, 50 - PET_HAPPINESS_DAILY_DECAY + PET_HAPPINESS_PET_GAIN);
    });

    it('lets treats and bond training through even when free petting is spent', () => {
        const spentOut = { ...stampedPet('p1', 50), happinessPets: PET_HAPPINESS_DAILY_PET_BUDGET };
        assert.equal(grantPetHappiness(spentOut, 10, DAY_0).happiness, 60);
    });

    // The bold expedition route (shared/pet-expedition-contract.ts) charges 5
    // happiness on return. It must come off what the pet ACTUALLY holds.
    it('spends against the settled value, not the stale stored one', () => {
        const stale = stampedPet('p1', 20, DAY_0);
        const spent = spendPetHappiness(stale, 5, daysLater(1));
        assert.equal(spent.happiness, 20 - PET_HAPPINESS_DAILY_DECAY - 5, 'decay settles first, then the charge');
        assert.equal(spent.happinessDay, utcDayIndex(daysLater(1)), 'and the stamp advances with the same write');
    });

    it('floors a spend at 0 rather than going negative', () => {
        assert.equal(spendPetHappiness(stampedPet('p1', 3), 5, DAY_0).happiness, 0);
        assert.equal(spendPetHappiness(stampedPet('p1', 0), 5, DAY_0).happiness, 0);
    });
});
