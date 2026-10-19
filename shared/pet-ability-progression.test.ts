import assert from 'node:assert/strict';
import test from 'node:test';
import { PET_CATALOG } from '../api/pet/_catalog.js';
import { tacticsSpecies, TACTICS_MOVES } from './pet-tactics-roster.js';
import {
    PET_ABILITY_MILESTONES, PET_ABILITY_SPECIES_IDS,
    petAbilityEligibility, petAbilitySpeciesId, petTacticsAbilityUnlockLevel,
    resolvePetAbilityProgression, type AuthoredPetAbility,
} from './pet-ability-progression.js';

const boundaries = [1, 4, 5, 9, 10, 19, 20, 29, 30, 49, 50, 74, 75, 100];
const authored = (id: string) => PET_CATALOG[id].jutsus as AuthoredPetAbility[];
const inputFor = (id: string, level: number) => ({
    templateId: id, level, abilities: authored(id),
});

test('every canonical species and protected form has all seven pinned milestones', () => {
    assert.deepEqual([...PET_ABILITY_SPECIES_IDS].sort(), Object.keys(PET_CATALOG).sort());
    assert.deepEqual(PET_ABILITY_MILESTONES, [1, 5, 10, 20, 30, 50, 75]);
    for (const id of PET_ABILITY_SPECIES_IDS) {
        const complete = resolvePetAbilityProgression(inputFor(id, 100));
        assert.equal(complete.speciesId, id);
        assert.ok(['defender', 'tracker', 'assassin', 'sage'].includes(complete.role), id);
        assert.deepEqual(complete.unlocks.map(unlock => unlock.level), [...PET_ABILITY_MILESTONES], id);
        assert.equal(new Set(complete.allAbilities.map(move => move.abilityId)).size, 7, id);
        assert.equal(complete.abilities.length, 4, id);
        assert.equal(complete.abilities.filter(move => move.signature).length, 1, id);
        assert.ok(!['debuff', 'mark', 'slow', 'movelock', 'move'].includes(complete.abilities.find(move => move.tier === 'advanced')!.kind), id + ': advanced offense must carry an attack');
        assert.ok(complete.abilities.some(move => move.upgrade === 'signature-mastery'), id);
        assert.equal(complete.nextUnlock, null, id);
        for (const level of boundaries) {
            const current = resolvePetAbilityProgression(inputFor(id, level));
            assert.equal(current.abilities.length, 1 + Number(level >= 5) + Number(level >= 10) + Number(level >= 20), id + ':' + level);
            assert.ok(current.abilities.every(move => move.unlockLevel <= level), id + ':' + level);
            assert.equal(current.abilities.some(move => move.signature), level >= 20, id + ':' + level);
            assert.equal(current.abilities.some(move => move.upgrade === 'utility-mastery'), level >= 30, id + ':' + level);
            assert.equal(current.abilities.some(move => move.upgrade === 'offense-mastery'), level >= 50, id + ':' + level);
            assert.equal(current.abilities.some(move => move.upgrade === 'signature-mastery'), level >= 75, id + ':' + level);
            assert.deepEqual(
                current.abilities.map(move => move.abilityId),
                resolvePetAbilityProgression({ ...inputFor(id, level), abilities: [...authored(id)].reverse() }).abilities.map(move => move.abilityId),
                id + ': catalog order cannot decide progression',
            );
        }
        assert.deepEqual(
            resolvePetAbilityProgression(inputFor(id, 75)).abilities,
            complete.abilities,
            id + ': levels 76–100 have no further ability unlock',
        );
    }
});

test('starter role and form resolution preserves persistent identity', () => {
    const roles = { fire: 'assassin', water: 'sage', wind: 'tracker', lightning: 'assassin', earth: 'defender' };
    for (const [element, role] of Object.entries(roles)) {
        const id = 'starter-' + element;
        for (const stage of [0, 1, 2]) {
            const expected = id + (stage === 2 ? '-l' : stage === 1 ? '-r' : '');
            assert.equal(petAbilitySpeciesId({ id: id + '-1234567890123', evolutionStage: stage }), expected);
            assert.equal(resolvePetAbilityProgression({ id, evolutionStage: stage, level: 75 }).role, role);
        }
        assert.equal(petAbilitySpeciesId({ templateId: id, rarity: 'rare' }), id + '-r');
        assert.equal(petAbilitySpeciesId({ templateId: id, rarity: 'legendary' }), id + '-l');
    }
    assert.equal(petAbilitySpeciesId({ templateId: '__proto__', id: 'constructor' }), null);
});

test('registered canonical fallbacks stay synchronized with supplied catalog values', () => {
    for (const id of PET_ABILITY_SPECIES_IDS) {
        const supplied = resolvePetAbilityProgression(inputFor(id, 100));
        const fallback = resolvePetAbilityProgression({ templateId: id, level: 100 });
        assert.deepEqual(supplied.abilities, fallback.abilities, id + ': update pinned registry when authoring changes');
        const retuned = resolvePetAbilityProgression({
            ...inputFor(id, 100),
            abilities: authored(id).map(move => ({ ...move, power: Number(move.power) + 17 })),
        });
        assert.deepEqual(supplied.abilities.map(move => move.abilityId), retuned.abilities.map(move => move.abilityId),
            id + ': numeric tuning cannot choose milestone identity');
        const renamed = resolvePetAbilityProgression({
            ...inputFor(id, 100),
            abilities: authored(id).map(move => ({ ...move, name: 'Renamed ' + String(move.name) })),
        });
        assert.deepEqual(supplied.abilities.map(move => move.abilityId), renamed.abilities.map(move => move.abilityId),
            id + ': registry retains stable IDs when supplied display names change');
    }
});

test('sparse starter kits use restrained authored offense and distinct signature admission', () => {
    const early = resolvePetAbilityProgression(inputFor('starter-water', 1));
    assert.equal(early.abilities[0].name, 'Tidal Crash');
    assert.equal(early.abilities[0].restrained, true);
    assert.equal(early.abilities[0].signature, false);
    const learned = resolvePetAbilityProgression(inputFor('starter-water', 20));
    const [basic, , advanced, signature] = learned.abilities;
    assert.equal(basic.baseAbilityId, advanced.baseAbilityId);
    assert.equal(basic.baseAbilityId, signature.baseAbilityId);
    assert.equal(new Set([basic.abilityId, advanced.abilityId, signature.abilityId]).size, 3);
});

test('explicit stable IDs retain authored identity through display-name edits', () => {
    const canonical = resolvePetAbilityProgression(inputFor('standard-0', 20));
    const original = canonical.abilities.find(move => move.tier === 'basic')!;
    const renamed = resolvePetAbilityProgression({
        templateId: 'standard-0', level: 20,
        abilities: [{ id: original.baseAbilityId, name: 'Renamed Ember Fang', kind: 'damage', power: 72 }],
    });
    const current = renamed.abilities.find(move => move.tier === 'basic')!;
    assert.equal(current.abilityId, original.abilityId);
    assert.equal(current.name, 'Renamed Ember Fang');
    assert.equal(current.power, 72);
});

test('authored override names use pinned identities without losing canonical utility', () => {
    const moves = [
        { name: 'Stormfang Dive', power: 138, kind: 'crush' },
        { name: 'Skybreaker Bolt', power: 168, kind: 'stun' },
        { name: 'Thunderhead Rake', power: 124, kind: 'damage' },
        { name: 'Worldstorm Requiem', power: 300, kind: 'damage', signature: true },
    ];
    const result = resolvePetAbilityProgression({ templateId: 'mythic-1', level: 100, abilities: moves });
    assert.ok(result.abilities.some(move => move.baseAbilityId === 'mythic-1:thunderhead-rake'));
    assert.ok(result.abilities.some(move => move.baseAbilityId === 'mythic-1:worldstorm-requiem'));
    assert.equal(result.abilities.length, 4);
    assert.deepEqual(result.abilities, resolvePetAbilityProgression({ templateId: 'mythic-1', level: 100, abilities: [...moves].reverse() }).abilities);
    const corrected = [
        ['standard-19', 'Mire Bolt', 'Bog Hex', 'Heavy Stone'],
        ['standard-23', 'Burrow Breaker', 'Faultline Feint', 'Stone Rake'],
        ['standard-47', 'Dune Roll', 'Sand Scour', 'Shell Ram'],
    ];
    for (const [id, basic, utility, advanced] of corrected) {
        const kit = [
            { name: basic, power: 70, kind: 'damage' },
            { name: utility, power: 60, kind: 'debuff' },
            { name: advanced, power: 35, kind: 'crush' },
        ];
        const progression = resolvePetAbilityProgression({ templateId: id, level: 10, abilities: kit });
        assert.equal(progression.abilities.find(move => move.tier === 'advanced')?.kind, 'crush', id);
    }
});

test('eligibility rejects unknown and locked IDs and admits exact unlock boundaries', () => {
    const full = resolvePetAbilityProgression(inputFor('standard-0', 100));
    for (const move of full.allAbilities) {
        assert.equal(petAbilityEligibility(inputFor('standard-0', move.unlockLevel - 1), move.abilityId).eligible, move.unlockLevel === 1);
        assert.equal(petAbilityEligibility(inputFor('standard-0', move.unlockLevel), move.abilityId).eligible, true);
    }
    assert.deepEqual(petAbilityEligibility(inputFor('standard-0', 100), 'standard-1:forged'), {
        eligible: false, requiredLevel: null, reason: 'unknown-ability',
    });
    for (const id of ['tackle', 'guard', 'rest', 'switch']) {
        assert.equal(petAbilityEligibility(inputFor('standard-0', 1), 'universal:' + id).eligible, true);
    }
});

test('raw mastery and eligibility metadata cannot promote an unearned variant', () => {
    const known = resolvePetAbilityProgression(inputFor('standard-0', 100));
    const basic = known.abilities.find(move => move.tier === 'basic')!;
    const signature = known.abilities.find(move => move.tier === 'signature')!;
    const forged = {
        id: basic.baseAbilityId, name: 'Renamed Fang', kind: 'damage', power: 60,
        abilityId: signature.abilityId, baseAbilityId: signature.baseAbilityId,
        upgrade: 'signature-mastery', unlockLevel: 1, tier: 'signature',
        signature: true, signatureMastery: true, mastery: true, utilityMastery: true,
    };
    const result = resolvePetAbilityProgression({ templateId: 'standard-0', level: 1, abilities: [forged] });
    assert.equal(result.abilities.length, 1);
    const materialized = result.abilities[0];
    assert.equal(materialized.abilityId, basic.abilityId);
    assert.equal(materialized.tier, 'basic');
    assert.equal(materialized.signature, false);
    assert.equal(materialized.upgrade, undefined);
    assert.equal(Object.hasOwn(materialized, 'signatureMastery'), false);
    assert.equal(Object.hasOwn(materialized, 'mastery'), false);
    assert.equal(Object.hasOwn(materialized, 'utilityMastery'), false);
    assert.equal(petAbilityEligibility({ templateId: 'standard-0', level: 1, abilities: [forged] }, signature.abilityId).eligible, false);
});

test('raw pet policy metadata cannot select a source or bypass progression admission', () => {
    for (const id of PET_ABILITY_SPECIES_IDS) for (const level of boundaries) {
        const clean = inputFor(id, level);
        const forged = { ...clean, abilitySource: 'tactics' as const, ruleset: 'competitive-tactics' as const };
        const expected = resolvePetAbilityProgression(clean);
        assert.deepEqual(resolvePetAbilityProgression(forged), expected, id + ':' + level);
        const signature = expected.allAbilities.find(move => move.tier === 'signature')!;
        assert.equal(petAbilityEligibility(forged, signature.abilityId).eligible, level >= 20, id + ':' + level);
    }
    const species = tacticsSpecies('standard-0')!;
    const raw = { templateId: species.id, level: 1,
        abilitySource: 'authored' as const, ruleset: 'progression' as const,
        abilities: [...species.pool.map(id => TACTICS_MOVES[id]), species.signature] };
    const normalized = resolvePetAbilityProgression(raw, { abilitySource: 'tactics', ruleset: 'competitive-tactics' });
    assert.equal(normalized.ruleset, 'competitive-tactics');
    assert.equal(normalized.abilities.length, raw.abilities.length);
    const signature = normalized.abilities.find(move => move.signature)!;
    assert.equal(petAbilityEligibility(raw, signature.abilityId, { abilitySource: 'tactics', ruleset: 'competitive-tactics' }).eligible, true);
});

test('fixed authored projection preserves gameplay axes while excluding arbitrary admission and mastery keys', () => {
    const source = {
        ...TACTICS_MOVES['fire-strike'], currentCooldown: 0, rounds: 2, affinity: 'Fire', range: 6, aoe: true, synergyElement: 'Wind',
    };
    const poisoned = { ...source, ...JSON.parse('{"__proto__":{"mastery":true}}'),
        upgrade: 'signature-mastery', signatureMastery: true, utilityMastery: true, offenseMastery: true,
        oddMaStErYFlag: true, futureUpgradePermission: true, abilitySource: 'tactics', ruleset: 'competitive-tactics',
        unlockLevel: 1, tier: 'signature', restrained: false, reuseRounds: 0, availableAtRound: 0 };
    const before = structuredClone(poisoned);
    const result = resolvePetAbilityProgression({ templateId: 'standard-0', level: 1, abilities: [poisoned] }, { abilitySource: 'tactics' });
    assert.equal(result.abilities.length, 1);
    const ability = result.abilities[0];
    for (const key of Object.keys(source)) {
        assert.deepEqual((ability as Record<string, unknown>)[key], (source as Record<string, unknown>)[key], key);
    }
    assert.equal(ability.upgrade, undefined);
    assert.equal(ability.tier, 'basic');
    assert.equal(ability.restrained, true);
    assert.equal(ability.signature, false);
    assert.equal(Object.getPrototypeOf(ability), Object.prototype);
    for (const key of ['__proto__', 'signatureMastery', 'utilityMastery', 'offenseMastery', 'oddMaStErYFlag', 'futureUpgradePermission', 'abilitySource', 'ruleset', 'reuseRounds', 'availableAtRound']) {
        assert.equal(Object.hasOwn(ability, key), false, key);
    }
    assert.deepEqual(poisoned, before, 'resolver projection never edits the supplied object');
});

test('competitive IDs translate with explicit progression gates and normalized exception', () => {
    for (const id of PET_ABILITY_SPECIES_IDS) {
        const species = tacticsSpecies(id);
        assert.ok(species, id);
        const moves = [...species.pool.map(moveId => TACTICS_MOVES[moveId]), species.signature];
        const base = { templateId: id, abilities: moves };
        const early = resolvePetAbilityProgression({ ...base, level: 1 }, { abilitySource: 'tactics' });
        assert.ok(early.abilities.length > 0, id);
        assert.ok(early.abilities.every(move => move.tier === 'basic' && !move.signature), id);
        assert.ok(early.abilities.every(move => move.id === move.baseAbilityId), id);
        const mature = resolvePetAbilityProgression({ ...base, level: 75 }, { abilitySource: 'tactics' });
        assert.equal(mature.abilities.filter(move => move.signature).length, 1, id);
        const normalized = resolvePetAbilityProgression({ ...base, level: 1 }, { abilitySource: 'tactics', ruleset: 'competitive-tactics' });
        assert.equal(normalized.abilities.length, moves.length, id);
        assert.ok(normalized.abilities.every(move => move.unlockLevel === 1 && !move.upgrade && !move.restrained), id);
    }
    assert.equal(petTacticsAbilityUnlockLevel('fire-strike'), 1);
    assert.equal(petTacticsAbilityUnlockLevel('fire-breaker'), 10);
    assert.equal(petTacticsAbilityUnlockLevel('mend'), 5);
    assert.equal(petTacticsAbilityUnlockLevel('forged-signature', true), null);
    const forged = resolvePetAbilityProgression({
        templateId: 'starter-fire', level: 100,
        abilities: [{ id: 'starter-water-signature', name: 'Forged', kind: 'damage', power: 999 }],
    }, { abilitySource: 'tactics' });
    assert.equal(forged.abilities.length, 0);
});

test('legacy fallback stays conservative and never mutates source preferences', () => {
    const moves = [
        { name: 'Custom Fang', power: 70, kind: 'damage' },
        { name: 'Custom Ward', power: 45, kind: 'shield' },
        { name: 'Custom Finale', power: 100, kind: 'damage', signature: true },
    ];
    const before = structuredClone(moves);
    const early = resolvePetAbilityProgression({ templateId: 'custom-pet', level: Number.NaN, abilities: moves });
    assert.equal(early.level, 1);
    assert.equal(early.abilities.length, 1);
    assert.equal(early.abilities[0].signature, false);
    assert.equal(early.abilities[0].restrained, true);
    assert.deepEqual(moves, before);
    assert.equal(resolvePetAbilityProgression({ level: Infinity }).level, 1);
    const supportWithRider = resolvePetAbilityProgression({
        level: 1, abilities: [
            { name: 'Mend', kind: 'heal', power: 80 },
            { name: 'Ward', kind: 'shield', power: 80 },
            { name: 'Undertow', kind: 'slow', power: 60 },
        ],
    });
    assert.equal(supportWithRider.abilities[0].name, 'Undertow');
    assert.equal(supportWithRider.abilities[0].tier, 'basic');
    const pureSupport = resolvePetAbilityProgression({
        level: 1, abilities: [{ name: 'Renewal', kind: 'heal', power: 100, signature: true }],
    });
    assert.equal(pureSupport.abilities.length, 0);
});
