import test from 'node:test';
import assert from 'node:assert/strict';
import { petWitnessReceiptForSettlement, recordPetArenaVictory, PET_WITNESS_WIN_THRESHOLD } from './_pet-witness.js';
import { backfillChronicleProgressionCards } from './_progression-cards.js';

const pet = (overrides: Record<string, unknown> = {}) => ({
    id: 'pet-1', name: 'Ripple Seal', nickname: 'Mizu', element: 'Water', chronicleArenaWins: 0, ...overrides,
});

test('the tenth authoritative pet win records provenance and grants one stable witness card', () => {
    const out = recordPetArenaVictory({
        starterCardsClaimed: true,
        tileCards: [],
        pets: [pet({ chronicleArenaWins: PET_WITNESS_WIN_THRESHOLD - 1 })],
    }, ['pet-1'], 1234);
    assert.deepEqual(out.granted, ['pet-witness-water']);
    assert.deepEqual(out.witnessed, [{
        cardId: 'pet-witness-water', petId: 'pet-1', petName: 'Mizu', element: 'Water',
        deed: 'arena-renown', wins: PET_WITNESS_WIN_THRESHOLD, witnessedAt: 1234,
    }]);
    assert.equal((out.character.pets as Array<Record<string, unknown>>)[0].chronicleArenaWins, PET_WITNESS_WIN_THRESHOLD);
});

test('replays and later same-element champions never mint duplicate witness cards', () => {
    const first = recordPetArenaVictory({
        starterCardsClaimed: true,
        tileCards: ['pet-witness-water'],
        chroniclePetWitnesses: [{
            cardId: 'pet-witness-water', petId: 'old', petName: 'Old Friend', element: 'Water',
            deed: 'arena-renown', wins: 10, witnessedAt: 1,
        }],
        pets: [pet({ chronicleArenaWins: 99 })],
    }, ['pet-1'], 2);
    assert.deepEqual(first.granted, []);
    assert.deepEqual(first.witnessed, []);
    assert.equal((first.character.tileCards as string[]).filter((id) => id === 'pet-witness-water').length, 1);
});

test('pre-Scribe renown is preserved and backfilled only after Chronicle unlock', () => {
    const earned = recordPetArenaVictory({
        tileCards: [],
        pets: [pet({ chronicleArenaWins: 9 })],
    }, ['pet-1'], 77);
    assert.deepEqual(earned.granted, []);
    const backfill = backfillChronicleProgressionCards({ ...earned.character, starterCardsClaimed: true });
    assert.deepEqual(backfill.granted, ['pet-witness-water']);
});

test('a lost settlement response can replay the same witness ceremony without another win', () => {
    const receiptId = 'pet-ranked:5e8f95ec-26b7-49bb-bc9f-36ec90168cbd';
    const settled = recordPetArenaVictory({
        starterCardsClaimed: true,
        tileCards: [],
        pets: [pet({ chronicleArenaWins: 9 })],
    }, ['pet-1'], 123, receiptId);
    const replay = petWitnessReceiptForSettlement(settled.character, receiptId);
    assert.deepEqual(replay.granted, ['pet-witness-water']);
    assert.deepEqual(replay.witnessed, settled.witnessed);
    assert.deepEqual(replay.livingWitnessProgress, [{
        sourceReceipt: receiptId,
        petId: 'pet-1',
        petName: 'Mizu',
        cardId: 'pet-witness-water',
        wins: 10,
        threshold: PET_WITNESS_WIN_THRESHOLD,
        deedRecorded: true,
        cardPressed: true,
    }]);
    assert.equal((settled.character.pets as Array<Record<string, unknown>>)[0].chronicleArenaWins, 10);
});

test('each eligible victory returns exact Living Witness progress and replays without incrementing', () => {
    const receiptId = 'pet-casual:first-win';
    const settled = recordPetArenaVictory({
        starterCardsClaimed: false,
        tileCards: [],
        pets: [pet()],
    }, ['pet-1'], 456, receiptId);
    assert.deepEqual(settled.livingWitnessProgress, [{
        sourceReceipt: receiptId,
        petId: 'pet-1',
        petName: 'Mizu',
        cardId: 'pet-witness-water',
        wins: 1,
        threshold: PET_WITNESS_WIN_THRESHOLD,
        deedRecorded: false,
        cardPressed: false,
    }]);

    const replay = recordPetArenaVictory(settled.character, ['pet-1'], 999, receiptId);
    assert.deepEqual(replay.livingWitnessProgress, settled.livingWitnessProgress);
    assert.equal((replay.character.pets as Array<Record<string, unknown>>)[0].chronicleArenaWins, 1);
});

test('the tenth pre-Scribe win records the deed without claiming that its card was pressed', () => {
    const receiptId = 'pet-casual:tenth-win-before-card-hall';
    const settled = recordPetArenaVictory({
        tileCards: [],
        pets: [pet({ chronicleArenaWins: 9 })],
    }, ['pet-1'], 789, receiptId);
    assert.equal(settled.livingWitnessProgress[0]?.deedRecorded, true);
    assert.equal(settled.livingWitnessProgress[0]?.cardPressed, false);
});

test('wins after the threshold never restage the card-pressed event', () => {
    const settled = recordPetArenaVictory({
        starterCardsClaimed: true,
        tileCards: ['pet-witness-water'],
        chroniclePetWitnesses: [{
            cardId: 'pet-witness-water', petId: 'pet-1', petName: 'Mizu', element: 'Water',
            deed: 'arena-renown', wins: 10, witnessedAt: 1,
        }],
        pets: [pet({ chronicleArenaWins: 10 })],
    }, ['pet-1'], 999, 'pet-casual:eleventh-win');
    assert.deepEqual(settled.livingWitnessProgress, []);
    assert.equal((settled.character.pets as Array<Record<string, unknown>>)[0].chronicleArenaWins, 11);
});
