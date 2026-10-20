import assert from 'node:assert/strict';
import test from 'node:test';
import { petBattleJutsus, petBattleTechniques } from './pet-battle-loadout.js';
import { tacticsPreset, tacticsSpecies } from './pet-tactics-roster.js';
import { PET_ABILITY_SPECIES_IDS, resolvePetAbilityProgression } from './pet-ability-progression.js';
import type { Pet } from '../shinobij.client/src/types/pet.js';
import { casualPvePetSnapshot } from '../api/pet/_casual-pve-seal.js';
import { snapshotPetForRanked } from '../api/pet/_ranked-engine.js';
import { companionMoveDamage, pickCompanionMove, sealCompanionFromSave } from '../api/combat-core/companion.js';
import { applyDuelCommand, createLiveCinematicDuel, readDuelControl, stepCinematicDuel } from '../shinobij.client/src/lib/pet-duel-cinematic.js';
import { createLiveCinematicDuel as serverDuel, readDuelControl as serverControl } from '../api/_pet-sim/pet-duel-cinematic.js';
import { petCombatDamage } from '../shinobij.client/src/lib/pet-combat-damage.js';
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
    const showdown = sealShowdownPet(owned, 'progression-v3');
    assert.deepEqual(showdown.moves.slice(1).map(move => move.name), expected.slice(0, 4));
    assert.equal(showdown.signatureMove.name, expected[4]);
    assert.deepEqual(showdown.moves.slice(1).map(move => move.element), petBattleTechniques(owned)!.slice(0, 4).map(move => move.element));
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

test('legacy battle snapshots keep their sealed kits; new pets resolve current-form progression', () => {
    const legacy = pet({ rankedBuild: undefined });
    assert.deepEqual(petBattleJutsus({ ...legacy, battleLoadoutVersion: 'legacy-v1' }), legacy.jutsus);
    assert.ok(petBattleJutsus(legacy).every(move => !!move.abilityId));
    assert.equal(petBattleTechniques(legacy), null);
    for (const evolved of [pet({ evolutionStage: 1, rarity: 'rare' }), pet({ rankedBuild: {} as Pet['rankedBuild'] })]) {
        const moves = petBattleTechniques(evolved)!;
        const speciesId = evolved.evolutionStage ? 'starter-wind-r' : 'starter-wind';
        assert.deepEqual(moves.filter(move => !move.signature).map(move => move.id), tacticsPreset(speciesId).moveIds);
        assert.equal(moves.find(move => move.signature)!.baseAbilityId,
            resolvePetAbilityProgression({ ...evolved }).abilities.find(move => move.signature)!.baseAbilityId);
    }
    const unknown = pet({ templateId: 'custom-species' });
    assert.deepEqual([...new Set(petBattleJutsus(unknown).map(move => move.name))], unknown.jutsus.map(move => move.name));
});

test('saved locked choices yield eligible defaults without changing preferences', () => {
    const owned = pet({ level: 1 });
    const saved = JSON.stringify(owned.rankedBuild);
    for (const level of [1, 4, 5, 9, 10, 19, 20, 29, 30, 49, 50, 74, 75, 100]) {
        const moves = petBattleTechniques({ ...owned, level })!;
        assert.ok(moves.length > 0);
        assert.ok(moves.every(move => (move.unlockLevel ?? 1) <= level));
        assert.equal(moves.some(move => move.signature), level >= 20);
        assert.ok(moves.every(move => !!move.abilityId && !!move.baseAbilityId));
    }
    assert.equal(JSON.stringify(owned.rankedBuild), saved);
    assert.equal(petBattleTechniques(owned)!.length, 1);
    assert.equal(petBattleTechniques(owned, { ruleset: 'competitive-tactics' })!.length, 5,
        'only the explicit normalized format bypasses earned levels');
    const learned = petBattleTechniques({ ...owned, level: 20 })!;
    assert.equal(learned[0].tier, 'basic');
    assert.deepEqual(learned.slice(1, 4).map(move => move.id), owned.rankedBuild!.moveIds.slice(0, 3));
    assert.equal(learned.at(-1)!.baseAbilityId,
        resolvePetAbilityProgression({ ...owned, level: 20 }).abilities.find(move => move.signature)!.baseAbilityId);
});

test('new seal admission ignores a forged legacy loadout marker', () => {
    const owned = pet({ level: 1, battleLoadoutVersion: 'legacy-v1' });
    assert.equal(petBattleJutsus(owned).length, 5);
    assert.equal(casualPvePetSnapshot(owned).jutsus.length, 1);
    assert.equal(snapshotPetForRanked(owned)!.jutsus.length, 1);
    const snapshot = casualPvePetSnapshot(pet());
    assert.deepEqual(petBattleJutsus(snapshot), snapshot.jutsus);
    assert.equal(snapshot.battleLoadoutVersion, 'progression-v3');
});

test('earned mastery changes spatial and summon power or recovery exactly once', () => {
    const at = (level: number) => petBattleJutsus(pet({ level }));
    const utility29 = at(29).find(move => move.kind === 'buff')!;
    const utility30 = at(30).find(move => move.kind === 'buff')!;
    assert.equal(utility30.cooldown, Math.max(1, utility29.cooldown - 1));
    const offense49 = at(49).find(move => move.tier === 'advanced')!;
    const offense50 = at(50).find(move => move.tier === 'advanced')!;
    assert.equal(offense50.power, Math.round(offense49.power * 1.08));
    const signature74 = at(74).find(move => move.signature)!;
    const signature75 = at(75).find(move => move.signature)!;
    assert.equal(signature75.power, Math.round(signature74.power * 1.1));
    assert.deepEqual(at(100), at(75), 'levels76–100 add stats without another ability milestone');
    const snapshot = casualPvePetSnapshot(pet({ level: 75 }));
    assert.deepEqual(petBattleJutsus(snapshot), snapshot.jutsus, 'frozen mastery is never applied twice');
});

test('competitive allocations and items never change adventure stats or summon strength', () => {
    const first = pet();
    const second = pet({ rankedBuild: { ...first.rankedBuild!, allocation: { vitality: 25, power: 0, guard: 24, agility: 0 }, item: 'focus-lens' } });
    assert.deepEqual(petBattleJutsus(first), petBattleJutsus(second));
    assert.deepEqual(sealCompanionFromSave({ pets: [first], activePetId: first.id }), sealCompanionFromSave({ pets: [second], activePetId: second.id }));
});

test('saved protection and redirection retain their support semantics in adventure formats', () => {
    const earth = pet({ templateId: 'starter-earth', rankedBuild: { ...tacticsPreset('starter-earth', 1), ownedPetId: 'owned-wind' } });
    const redirect = petBattleJutsus(earth).find(move => move.name === 'Intercept')!;
    assert.equal(redirect.kind, 'taunt');
    const windBuild = tacticsPreset('starter-wind', 1);
    windBuild.moveIds = ['protect', ...windBuild.moveIds.filter(id => id !== 'protect')];
    const wind = petBattleJutsus(pet({ rankedBuild: { ...windBuild, ownedPetId: 'owned-wind' } })).find(move => move.name === 'Perfect Guard')!;
    assert.equal(wind.kind, 'barrier');
    const support = sealCompanionFromSave({ pets: [earth], activePetId: earth.id })!.moves.find(move => move.name === 'Intercept')!;
    assert.equal(companionMoveDamage(100, support), 0);
});

test('equipped support can be used by summons and Purify clears harmful conditions in duels', () => {
    const waterBuild = tacticsPreset('starter-water', 1);
    waterBuild.moveIds = ['purify', ...waterBuild.moveIds.filter(id => id !== 'purify')];
    const owned = pet({ templateId: 'starter-water', rankedBuild: { ...waterBuild, ownedPetId: 'owned-wind' } });
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

test('saved preferences retain native Final Arts and an affordable strike across every form and boundary', () => {
    for (const speciesId of PET_ABILITY_SPECIES_IDS) {
        if (!tacticsSpecies(speciesId)) continue;
        for (const preset of [0, 1]) for (const level of [1, 4, 5, 9, 10, 19, 20, 29, 30, 49, 50, 74, 75, 100]) {
            const owned = pet({ templateId: speciesId, level, jutsus: [],
                rankedBuild: { ...tacticsPreset(speciesId, preset), ownedPetId: 'owned-wind' } });
            const before = JSON.stringify(owned);
            const native = resolvePetAbilityProgression(owned);
            const moves = petBattleTechniques(owned, { forceProgression: true })!;
            assert.ok(moves.filter(move => !move.signature).length <= 4);
            assert.ok(moves.some(move => move.tier === 'basic'));
            assert.ok(moves.every(move => (move.unlockLevel ?? 1) <= level));
            const signature = moves.find(move => move.signature);
            assert.equal(signature?.baseAbilityId, native.abilities.find(move => move.signature)?.baseAbilityId);
            assert.equal(signature?.kind, native.abilities.find(move => move.signature)?.kind);
            const projected = petBattleJutsus(owned, { forceProgression: true }).find(move => move.signature);
            assert.equal(projected?.baseAbilityId, signature?.baseAbilityId);
            assert.equal(JSON.stringify(owned), before);
            const normalized = petBattleTechniques(owned, { ruleset: 'competitive-tactics' })!;
            assert.equal(normalized.at(-1)!.id, tacticsSpecies(speciesId)!.signature.id);
        }
    }
});
