import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    PET_HAPPINESS_DAILY_DECAY,
    PET_HAPPINESS_DAILY_PET_BUDGET,
    PET_HAPPINESS_NEW_PET,
    PET_HAPPINESS_OBEDIENT,
    PET_HAPPINESS_PET_GAIN,
    applyFreePetInteraction,
    applyPetHappinessGain,
    clampHappiness,
    petHappinessBudgetRemaining,
    petHappinessCombatMult,
    petHappinessDisobeyChance,
    petHappinessPenaltyNote,
    petHappinessTier,
    petHappinessTrainingMult,
    petStartingHappiness,
    settlePetHappinessState,
    utcDayIndex,
} from './pet-happiness.js';

const DAY = 86_400_000;
/** 2026-08-31T00:00:00Z, exactly on a UTC day boundary. */
const DAY_0 = Date.UTC(2026, 7, 31);
const daysLater = (n: number) => DAY_0 + n * DAY;

describe('pet happiness — day index', () => {
    it('rolls over at UTC midnight, matching the lastDailyReset boundary', () => {
        const midnight = Date.UTC(2026, 7, 31);
        assert.equal(utcDayIndex(midnight - 1), utcDayIndex(midnight) - 1);
        assert.equal(utcDayIndex(midnight), utcDayIndex(midnight + DAY - 1));
        assert.equal(utcDayIndex(midnight + DAY), utcDayIndex(midnight) + 1);
    });

    it('agrees with the UTC date key the rest of the game stamps', () => {
        const key = (ms: number) => new Date(ms).toISOString().slice(0, 10);
        for (const ms of [DAY_0, DAY_0 + 1, DAY_0 + DAY - 1, DAY_0 + DAY]) {
            // Same day index <=> same date key.
            assert.equal(utcDayIndex(ms) === utcDayIndex(DAY_0), key(ms) === key(DAY_0));
        }
    });
});

describe('pet happiness — clamping', () => {
    it('clamps into [0, 100] and floors', () => {
        assert.equal(clampHappiness(undefined), 0);
        assert.equal(clampHappiness(-40), 0);
        assert.equal(clampHappiness(101), 100);
        assert.equal(clampHappiness(72.9), 72);
        assert.equal(clampHappiness('not a number'), 0);
    });
});

describe('pet happiness — decay settle', () => {
    it('stamps an unsettled pet WITHOUT decaying it (grandfathers pre-decay saves)', () => {
        const settled = settlePetHappinessState({ happiness: 100 }, DAY_0);
        assert.equal(settled.happiness, 100, 'no retro-decay on the first ever settle');
        assert.equal(settled.decayed, 0);
        assert.equal(settled.happinessDay, utcDayIndex(DAY_0));
        assert.equal(settled.happinessPets, 0);
        assert.equal(settled.changed, true, 'the stamp itself is a change worth persisting');
    });

    it('does nothing on the same UTC day', () => {
        const stamped = settlePetHappinessState({ happiness: 100 }, DAY_0);
        const again = settlePetHappinessState(stamped, DAY_0 + DAY - 1);
        assert.equal(again.happiness, 100);
        assert.equal(again.decayed, 0);
        assert.equal(again.changed, false, 'an unchanged settle must not force a save write');
    });

    it('drops one tick per elapsed daily reset', () => {
        const stamped = settlePetHappinessState({ happiness: 100 }, DAY_0);
        const oneDay = settlePetHappinessState(stamped, daysLater(1));
        assert.equal(oneDay.happiness, 100 - PET_HAPPINESS_DAILY_DECAY);
        assert.equal(oneDay.decayed, PET_HAPPINESS_DAILY_DECAY);

        const fiveDays = settlePetHappinessState(stamped, daysLater(5));
        assert.equal(fiveDays.happiness, 100 - 5 * PET_HAPPINESS_DAILY_DECAY);
        assert.equal(fiveDays.decayed, 5 * PET_HAPPINESS_DAILY_DECAY);
    });

    it('floors at 0 and never goes negative', () => {
        const stamped = settlePetHappinessState({ happiness: 30 }, DAY_0);
        const settled = settlePetHappinessState(stamped, daysLater(365));
        assert.equal(settled.happiness, 0);
        assert.equal(settled.decayed, 30, 'decayed reports what was actually lost, not the owed total');
    });

    it('is path-independent: five one-day settles equal one five-day settle', () => {
        let stepwise = settlePetHappinessState({ happiness: 100 }, DAY_0);
        for (let day = 1; day <= 5; day += 1) stepwise = settlePetHappinessState(stepwise, daysLater(day));
        const oneShot = settlePetHappinessState(settlePetHappinessState({ happiness: 100 }, DAY_0), daysLater(5));
        assert.equal(stepwise.happiness, oneShot.happiness);
    });

    it('refills the free-petting budget when the day rolls over', () => {
        const spent = { happiness: 80, happinessDay: utcDayIndex(DAY_0), happinessPets: PET_HAPPINESS_DAILY_PET_BUDGET };
        assert.equal(petHappinessBudgetRemaining(spent, DAY_0), 0);
        assert.equal(petHappinessBudgetRemaining(spent, daysLater(1)), PET_HAPPINESS_DAILY_PET_BUDGET);
    });

    it('pulls a FUTURE stamp back to today so clock skew cannot freeze decay', () => {
        const skewed = { happiness: 90, happinessDay: utcDayIndex(daysLater(30)), happinessPets: 0 };
        const settled = settlePetHappinessState(skewed, DAY_0);
        assert.equal(settled.happinessDay, utcDayIndex(DAY_0));
        assert.equal(settled.happiness, 90, 'pulling the stamp back must not itself cost happiness');
        assert.equal(settled.decayed, 0);
    });

    it('clamps a corrupt over-budget counter down to the budget', () => {
        const settled = settlePetHappinessState(
            { happiness: 50, happinessDay: utcDayIndex(DAY_0), happinessPets: 9999 },
            DAY_0,
        );
        assert.equal(settled.happinessPets, PET_HAPPINESS_DAILY_PET_BUDGET);
        assert.equal(petHappinessBudgetRemaining(settled, DAY_0), 0);
    });
});

describe('pet happiness — free petting budget', () => {
    it('grants exactly the daily budget, then refuses', () => {
        let state = settlePetHappinessState({ happiness: 0 }, DAY_0);
        const clicks = PET_HAPPINESS_DAILY_PET_BUDGET / PET_HAPPINESS_PET_GAIN;
        for (let i = 0; i < clicks; i += 1) {
            const next = applyFreePetInteraction(state, DAY_0);
            assert.ok(next, `interaction ${i + 1} of ${clicks} should be allowed`);
            state = next;
        }
        assert.equal(state.happiness, PET_HAPPINESS_DAILY_PET_BUDGET);
        assert.equal(applyFreePetInteraction(state, DAY_0), null, 'budget spent → caller must 409');
    });

    it('outpaces the daily decay, so a player who shows up never loses ground', () => {
        assert.ok(
            PET_HAPPINESS_DAILY_PET_BUDGET > PET_HAPPINESS_DAILY_DECAY,
            'free petting must be able to beat one decay tick or the loop is unwinnable',
        );
    });

    it('still allows the five interactions a breeding elemental bond asks for', () => {
        // elemental-bond:interaction:5 (api/pet/_breeding-requirements.ts) needs
        // five pet interactions with a matching-element companion. A player who
        // owns exactly ONE such pet must still clear it in a day — rationing
        // petting below this would silently slow breeding down.
        assert.ok(PET_HAPPINESS_DAILY_PET_BUDGET >= 5 * PET_HAPPINESS_PET_GAIN);
        let state = settlePetHappinessState({ happiness: 0 }, DAY_0);
        for (let i = 0; i < 5; i += 1) {
            const next = applyFreePetInteraction(state, DAY_0);
            assert.ok(next, `breeding interaction ${i + 1} of 5 must be allowed`);
            state = next;
        }
    });

    it('settles the missed decay BEFORE the gain — petting cannot skip a day', () => {
        const stale = { happiness: 100, happinessDay: utcDayIndex(DAY_0), happinessPets: 0 };
        const petted = applyFreePetInteraction(stale, daysLater(3));
        assert.ok(petted);
        assert.equal(petted.happiness, 100 - 3 * PET_HAPPINESS_DAILY_DECAY + PET_HAPPINESS_PET_GAIN);
    });

    it('spends budget even at 100, so free pets cannot be banked on a maxed pet', () => {
        const maxed = settlePetHappinessState({ happiness: 100 }, DAY_0);
        const petted = applyFreePetInteraction(maxed, DAY_0);
        assert.ok(petted);
        assert.equal(petted.happiness, 100);
        assert.equal(petted.happinessPets, PET_HAPPINESS_PET_GAIN);
    });

    it('treats and bond training are NOT budgeted, but still settle decay first', () => {
        const spentOut = { happiness: 100, happinessDay: utcDayIndex(DAY_0), happinessPets: PET_HAPPINESS_DAILY_PET_BUDGET };
        assert.equal(applyFreePetInteraction(spentOut, DAY_0), null);
        const fed = applyPetHappinessGain(spentOut, 10, DAY_0);
        assert.equal(fed.happiness, 100, 'already maxed — but the treat was still allowed');
        assert.equal(
            applyPetHappinessGain({ happiness: 100, happinessDay: utcDayIndex(DAY_0), happinessPets: 0 }, 10, daysLater(2)).happiness,
            100 - 2 * PET_HAPPINESS_DAILY_DECAY + 10,
        );
    });
});

describe('pet happiness — tiers and penalties', () => {
    it('maps the bands', () => {
        assert.equal(petHappinessTier(100), 'content');
        assert.equal(petHappinessTier(80), 'content');
        assert.equal(petHappinessTier(79), 'steady');
        assert.equal(petHappinessTier(PET_HAPPINESS_OBEDIENT), 'steady');
        assert.equal(petHappinessTier(70), 'restless');
        assert.equal(petHappinessTier(50), 'restless');
        assert.equal(petHappinessTier(49), 'unhappy');
        assert.equal(petHappinessTier(25), 'unhappy');
        assert.equal(petHappinessTier(24), 'neglected');
        assert.equal(petHappinessTier(0), 'neglected');
    });

    it('leaves EVERY pre-existing behaviour at 50+ exactly as it was', () => {
        // Training: >= 80 → 1.15, >= 50 → 1.05. Combat: no multiplier ever.
        // Obedience: 0% below the 71 cliff... 35% below it, 0% at or above.
        for (const happiness of [50, 60, 70, 71, 79, 80, 90, 100]) {
            assert.equal(
                petHappinessTrainingMult(happiness),
                happiness >= 80 ? 1.15 : 1.05,
                `training multiplier changed at ${happiness}`,
            );
            assert.equal(petHappinessCombatMult(happiness), 1, `combat multiplier changed at ${happiness}`);
            assert.equal(
                petHappinessDisobeyChance(happiness),
                happiness >= PET_HAPPINESS_OBEDIENT ? 0 : 0.35,
                `disobey chance changed at ${happiness}`,
            );
        }
    });

    it('applies the NEW maluses only below 50', () => {
        assert.equal(petHappinessCombatMult(49), 0.9);
        assert.equal(petHappinessCombatMult(24), 0.8);
        assert.equal(petHappinessDisobeyChance(49), 0.5);
        assert.equal(petHappinessDisobeyChance(24), 0.65);
        assert.equal(petHappinessTrainingMult(49), 1);
        assert.equal(petHappinessTrainingMult(24), 0.85);
    });

    it('takes SIX ignored days for a maxed pet to earn its first penalty', () => {
        // The module header states this; pin it so the prose cannot drift from
        // the constants when someone retunes the decay or the tier floors.
        let state = settlePetHappinessState({ happiness: 100 }, DAY_0);
        const tierEachDay: string[] = [];
        for (let day = 1; day <= 6; day += 1) {
            state = settlePetHappinessState(state, daysLater(day));
            tierEachDay.push(petHappinessTier(state.happiness));
        }
        assert.deepEqual(tierEachDay, ['content', 'content', 'restless', 'restless', 'restless', 'unhappy']);
        assert.equal(state.happiness, 40);
        assert.notEqual(petHappinessPenaltyNote(state.happiness), '', 'day six is the first day that costs the player something');
    });

    it('gets strictly worse as happiness falls', () => {
        const samples = [100, 80, 71, 50, 25, 0];
        for (let i = 1; i < samples.length; i += 1) {
            assert.ok(petHappinessCombatMult(samples[i]) <= petHappinessCombatMult(samples[i - 1]));
            assert.ok(petHappinessDisobeyChance(samples[i]) >= petHappinessDisobeyChance(samples[i - 1]));
            assert.ok(petHappinessTrainingMult(samples[i]) <= petHappinessTrainingMult(samples[i - 1]));
        }
    });

    it('explains the penalty only when there is one', () => {
        assert.equal(petHappinessPenaltyNote(80), '');
        assert.equal(petHappinessPenaltyNote(50), '');
        assert.match(petHappinessPenaltyNote(30), /ignores half your commands/);
        assert.match(petHappinessPenaltyNote(10), /trains 15% slower/);
        // The UI prints the tier label right next to this line — do not repeat it.
        assert.doesNotMatch(petHappinessPenaltyNote(30), /Unhappy/);
        assert.doesNotMatch(petHappinessPenaltyNote(10), /Neglected/);
    });
});

describe('pet happiness — new companions', () => {
    it('start restless, not neglected', () => {
        assert.equal(petStartingHappiness(), PET_HAPPINESS_NEW_PET);
        assert.equal(petHappinessTier(petStartingHappiness()), 'restless');
        assert.equal(petHappinessCombatMult(petStartingHappiness()), 1, 'a brand-new pet must not arrive with a malus');
    });

    it('reach the obedience line within one day of free petting', () => {
        let state = settlePetHappinessState({ happiness: petStartingHappiness() }, DAY_0);
        for (let i = 0; i < PET_HAPPINESS_DAILY_PET_BUDGET / PET_HAPPINESS_PET_GAIN; i += 1) {
            state = applyFreePetInteraction(state, DAY_0) ?? state;
        }
        assert.ok(state.happiness >= PET_HAPPINESS_OBEDIENT);
    });
});
