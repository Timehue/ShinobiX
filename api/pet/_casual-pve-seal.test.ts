import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSealedPetSnapshots } from './_casual-pve-seal.js';
import { buildWarfrontAiTeam } from './_warfront-ai.js';
import { casualPvePetSnapshot } from './_casual-pve-seal.js';

test('repeated sealed AI templates remain ordered while player rosters must stay distinct', () => {
    const rivals = buildWarfrontAiTeam(4).map(casualPvePetSnapshot);
    const ids = rivals.map(pet => pet.id);
    assert.equal(new Set(ids).size, 3, 'the real four-slot AI band repeats one template');
    assert.equal(parseSealedPetSnapshots(rivals, ids), null, 'player roster uniqueness stays strict');
    assert.deepEqual(parseSealedPetSnapshots(rivals, ids, { allowRepeatedOpponentIds: true }), rivals);
    assert.equal(parseSealedPetSnapshots(rivals, [...ids].reverse(), { allowRepeatedOpponentIds: true }), null);
    assert.equal(parseSealedPetSnapshots([...rivals, rivals[0]], [...ids, ids[0]], { allowRepeatedOpponentIds: true }), null);
    assert.equal(parseSealedPetSnapshots(rivals.map(pet => ({ ...pet, attack: NaN })), ids, { allowRepeatedOpponentIds: true }), null);
});
