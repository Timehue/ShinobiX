import assert from 'node:assert/strict';
import test from 'node:test';
import type { Character } from '../types/character';
import { resolveDungeonStage } from './dungeon-stage';

const token = 'dungeonrun0001';
const warden: NonNullable<Character['activeDungeonRun']> = {
    token,
    startedAt: 1,
    combatAuthorityVersion: 1,
    wardenDefeated: true,
    wardenProofId: 'wardenproof0001',
};
const card: NonNullable<Character['activeDungeonRun']> = {
    ...warden,
    cardAuthorityVersion: 1,
    cardDefeated: true,
    cardLastOutcome: 'player',
    cardLastProofId: 'cardproof000001',
    cardProofId: 'cardproof000001',
    cardSettledAt: 2,
    cardDefeatedAt: 2,
};

test('Dungeon stage recovery advances only through authoritative proof chains', () => {
    assert.equal(resolveDungeonStage(null), 'intro');
    assert.equal(resolveDungeonStage({ token, startedAt: 1, wardenDefeated: true }), 'intro');
    assert.equal(resolveDungeonStage(warden), 'tile');
    assert.equal(resolveDungeonStage({ ...warden, cardDefeated: true, cardProofId: 'cardproof000001' }), 'tile');
    assert.equal(resolveDungeonStage(card), 'pet');
    assert.equal(resolveDungeonStage({ ...card, petDefeated: true, petProofId: 'petproof000001' }), 'pet');
});

test('a proved Pet win remains a recoverable reward claim until settlement clears the run', () => {
    assert.equal(resolveDungeonStage({
        ...card,
        petAuthorityVersion: 1,
        petDefeated: true,
        petLastOutcome: 'win',
        petLastProofId: 'petproof000001',
        petProofId: 'petproof000001',
        petLastPetIds: ['pet-1'],
        petSettledAt: 3,
        petDefeatedAt: 3,
    }), 'complete');
    assert.equal(resolveDungeonStage(null), 'intro', 'a settled run has been cleared by /api/dungeon/run');
});
