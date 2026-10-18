import assert from 'node:assert/strict';
import test from 'node:test';
import { petBattleJutsus, petBattleTechniques } from './pet-battle-loadout.js';
import { tacticsPreset, tacticsSpecies } from './pet-tactics-roster.js';
import type { Pet } from '../shinobij.client/src/types/pet.js';
import { casualPvePetSnapshot } from '../api/pet/_casual-pve-seal.js';
import { snapshotPetForRanked } from '../api/pet/_ranked-engine.js';
import { pickCompanionMove, sealCompanionFromSave } from '../api/combat-core/companion.js';
import { applyDuelCommand, createLiveCinematicDuel, readDuelControl, stepCinematicDuel } from '../shinobij.client/src/lib/pet-duel-cinematic.js';
import { createLiveCinematicDuel as serverDuel, readDuelControl as serverControl } from '../api/_pet-sim/pet-duel-cinematic.js';
import { petCombatDamage } from '../shinobij.client/src/lib/pet.js';
import { addStatus, createShowdownSession, resolveShowdownRound, sealShowdownPet } from '../api/_pet-showdown/engine.js';

const pet = (over: Partial<Pet> = {}): Pet => ({
    id: 'owned-wind', templateId: 'starter-wind', name: 'Gale Chick', rarity: 'standard',
    level: 50, xp: 0, maxLevel: 100, hp: 500, attack: 80, defense: 40, speed: 70,
    happiness: 100, unlockedForPve: false,
    jutsus: [{ name: 'Old adventure attack', kind: 'damage', power: 900, cooldown: 0, currentCooldown: 0 }],
    rankedBuild: { ...tacticsPreset('starter-wind', 1), ownedPetId: 'owned-wind' }, ...over,
});

test('saved four abilities and signature reach client combat, server snapshots and level-50 summons', () => {
    const owned = pet();
    const expected = petBattleTechniques(owned)!.map(move => move.name);
    assert.equal(expected.length, 5);
    const showdown = sealShowdownPet(owned);
    assert.deepEqual(showdown.moves.map(move => move.name), expected.slice(0, 4));
    assert.equal(showdown.signatureMove.name, expected[4]);
    assert.deepEqual(showdown.moves.map(move => move.element), petBattleTechniques(owned)!.slice(0, 4).map(move => move.element));
    const snapshots = [owned, casualPvePetSnapshot(owned), snapshotPetForRanked(owned)!];
    for (const snapshot of snapshots) {
        const live = createLiveCinematicDuel(snapshot, pet({ id: 'enemy', rankedBuild: undefined }), 7);
        const server = serverDuel(snapshot, pet({ id: 'enemy', rankedBuild: undefined }), 7);
        assert.deepEqual(readDuelControl(live, 'player-0')!.abilities.map(move => move.name), expected);
        assert.deepEqual(serverControl(server, 'player-0')!.abilities.map(move => move.name), expected);
    }
    const seal = sealCompanionFromSave({ pets: [owned], activePetId: owned.id })!;
    assert.deepEqual(seal.moves.map(move => move.name), expected);
    assert.equal(seal.moves.filter(move => move.signature).length, 1);
    assert.equal(seal.damage, petCombatDamage(owned), 'client and server damage use the chosen abilities');
    assert.equal(sealCompanionFromSave({ pets: [pet({ level: 49, unlockedForPve: true })], activePetId: owned.id }), null);
    const frozen = JSON.stringify(seal);
    owned.rankedBuild!.moveIds = tacticsPreset('starter-wind').moveIds;
    assert.equal(JSON.stringify(seal), frozen, 'saving another kit cannot change a sealed summon');
    for (const snapshot of snapshots.slice(1)) {
        assert.deepEqual(petBattleTechniques(snapshot)!.map(move => move.name), expected, 'battle snapshots retain a separate, bounded copy of the saved choices');
    }
    assert.notDeepEqual(sealCompanionFromSave({ pets: [owned], activePetId: owned.id })!.moves.map(move => move.name), expected);
});

test('old pets keep authored kits; evolved or malformed saved builds get a legal current-form kit', () => {
    const legacy = pet({ rankedBuild: undefined });
    assert.deepEqual(petBattleJutsus(legacy), legacy.jutsus);
    assert.equal(petBattleTechniques(legacy), null);
    for (const evolved of [pet({ evolutionStage: 1, rarity: 'rare' }), pet({ rankedBuild: {} as Pet['rankedBuild'] })]) {
        const moves = petBattleTechniques(evolved)!;
        const speciesId = evolved.evolutionStage ? 'starter-wind-r' : 'starter-wind';
        assert.deepEqual(moves.map(move => move.id), [...tacticsPreset(speciesId).moveIds, tacticsSpecies(speciesId)!.signature.id]);
    }
    const unknown = pet({ templateId: 'custom-species' });
    assert.deepEqual(petBattleJutsus(unknown), unknown.jutsus);
});

test('competitive allocations and items never change adventure stats or summon strength', () => {
    const first = pet();
    const second = pet({ rankedBuild: { ...first.rankedBuild!, allocation: { vitality: 25, power: 0, guard: 24, agility: 0 }, item: 'focus-lens' } });
    assert.deepEqual(petBattleJutsus(first), petBattleJutsus(second));
    assert.deepEqual(sealCompanionFromSave({ pets: [first], activePetId: first.id }), sealCompanionFromSave({ pets: [second], activePetId: second.id }));
});

test('equipped support can be used by summons and Purify clears harmful conditions in duels', () => {
    const owned = pet({ templateId: 'starter-water', rankedBuild: { ...tacticsPreset('starter-water', 1), ownedPetId: 'owned-wind' } });
    const moves = sealCompanionFromSave({ pets: [owned], activePetId: owned.id })!.moves;
    assert.equal(pickCompanionMove(moves, {}, 1, true)?.kind, 'cleanse');
    assert.notEqual(pickCompanionMove(moves, {}, 1)?.kind, 'cleanse', 'Purify waits for a harmful condition');
    const rally = { name: 'Rally', kind: 'buff', power: 100, cooldown: 0, rounds: 2, signature: false };
    assert.equal(pickCompanionMove([rally], {}, 1), rally, 'equipped setup abilities are usable at full HP');
    const sim = createLiveCinematicDuel(owned, pet({ id: 'enemy', rankedBuild: undefined }), 12);
    const fighter = sim.fighters[0];
    const index = fighter.abilities.findIndex(move => move.kind === 'cleanse');
    fighter.abilities[index].cdLeft = 0;
    Object.assign(fighter.statuses, { burnLeft: 1000, burnDmg: 1, halfHeal: true, slowLeft: 1000, marked: true,
        shieldHp: 200, buffLeft: 1000, buffMag: 0.25 });
    assert.equal(applyDuelCommand(sim, { kind: 'ability', actorId: fighter.id, idx: index }), true);
    for (let i = 0; i < 40; i++) stepCinematicDuel(sim);
    assert.equal(fighter.statuses.burnLeft, 0);
    assert.equal(fighter.statuses.slowLeft, 0);
    assert.equal(fighter.statuses.halfHeal, false);
    assert.equal(fighter.statuses.marked, false);
    assert.ok(fighter.statuses.buffLeft > 0, 'Purify preserves beneficial conditions');
    const showdown = createShowdownSession({ sessionId: 'loadout-cleanse', playerName: 'A', enemyTeamName: 'B',
        format: '1v1', tier: 'warrior', seed: 8, playerPets: [owned], enemyPets: [pet({ id: 'enemy', rankedBuild: undefined })], rewardEligible: false });
    const actor = showdown.player[0];
    const cleanseIndex = actor.moves.findIndex(move => move.kind === 'cleanse');
    assert.ok(cleanseIndex >= 0, 'Purify stays a cleanse in turn-based battles');
    actor.readiness = 10;
    addStatus(showdown, actor, 'burn', 5, 12);
    addStatus(showdown, actor, 'buff', 5, 1.25);
    resolveShowdownRound(showdown, [{ kind: 'move', petId: actor.id, moveIndex: cleanseIndex, targetId: actor.id }],
        [{ kind: 'rest', petId: showdown.enemy[0].id }]);
    assert.equal(actor.statuses.some(status => status.kind === 'burn'), false);
    assert.equal(actor.statuses.some(status => status.kind === 'buff'), true);
});
