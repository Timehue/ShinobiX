import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSealedPetSnapshots } from './_casual-pve-seal.js';
import { buildWarfrontAiTeam } from './_warfront-ai.js';
import { casualPvePetSnapshot } from './_casual-pve-seal.js';
import { createCasualPveBattleSeal, parseCasualPveBattleSeal } from './_casual-pve-seal.js';
import { petBattleJutsus } from '../../shared/pet-battle-loadout.js';

test('repeated sealed AI templates remain ordered while player rosters must stay distinct', () => {
    const rivals = buildWarfrontAiTeam(4).map(casualPvePetSnapshot);
    const ids = rivals.map(pet => pet.id);
    assert.equal(new Set(ids).size, 3, 'the real four-slot AI band repeats one template');
    assert.equal(parseSealedPetSnapshots(rivals, ids), null, 'player roster uniqueness stays strict');
    assert.deepEqual(parseSealedPetSnapshots(rivals, ids, { allowRepeatedOpponentIds: true }), rivals);
    const old = rivals.map(pet => ({ ...pet, battleLoadoutVersion: undefined }));
    assert.ok(parseSealedPetSnapshots(old, ids, { allowRepeatedOpponentIds: true })!.every(pet => pet.battleLoadoutVersion === 'legacy-v1'));
    assert.equal(parseSealedPetSnapshots(rivals, [...ids].reverse(), { allowRepeatedOpponentIds: true }), null);
    assert.equal(parseSealedPetSnapshots([...rivals, rivals[0]], [...ids, ids[0]], { allowRepeatedOpponentIds: true }), null);
    assert.equal(parseSealedPetSnapshots(rivals.map(pet => ({ ...pet, attack: NaN })), ids, { allowRepeatedOpponentIds: true }), null);
});

test('new seals freeze earned kits while version-one receipts replay their original kit', () => {
    const pets = buildWarfrontAiTeam(1).slice(0, 1);
    const seal = createCasualPveBattleSeal(pets, pets, { mode: '1v1', seed: 4, damageMult: 1,
        hpMult: 1, revive: false, applyItems: false, accuracy: false, terrain: null });
    assert.equal(seal.version, 2);
    const parsed = parseCasualPveBattleSeal(JSON.parse(JSON.stringify(seal)))!;
    assert.equal(parsed.playerPets[0].battleLoadoutVersion, 'progression-v3');
    assert.deepEqual(petBattleJutsus(parsed.playerPets[0]), parsed.playerPets[0].jutsus);
    const old = parseCasualPveBattleSeal({ ...seal, version: 1 })!;
    assert.equal(old.playerPets[0].battleLoadoutVersion, 'legacy-v1');
    assert.deepEqual(petBattleJutsus(old.playerPets[0]), old.playerPets[0].jutsus);
});
