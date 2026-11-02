import test from 'node:test';
import assert from 'node:assert/strict';
import { PET_CATALOG } from './_catalog.js';
import { createOwnedPet, migrateCharacterOwnedPets, migrateOwnedPet, projectCurrentPetSpecies } from './_owned-pet.js';
import { derivePetGrowthStats, normalizePetGrowth } from './_growth.js';
import { PREVIOUS_PET_SPECIES_BASES } from './_species-balance-v1.js';
import { grantWildPet } from './_encounter.js';
import { sanitizePetRoster } from '../save/_sanitize-pets.js';
import { buildWarTeam } from '../_pet-showdown/war-team.js';
import { sealChallengedPets } from './_pvp-duel.js';
import { chooseOwnedLadderPets, toPet, snapshotLadderPet, projectLadderSpeciesBalance, type DefenseDoc } from '../pet-ladder/_core.js';
import { chooseOwnedPets } from '../arena/_lobby-core.js';
import { sealCompanionFromSave } from '../combat-core/companion.js';
import { sealShowdownPet } from '../_pet-showdown/engine.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { chooseArenaPets } from '../_pet-tactics/arena-showdown.js';

const stats = ['hp', 'attack', 'defense', 'speed'] as const;
function previousPet(id: string, level = 3) {
    const template = PET_CATALOG[id];
    const old = PREVIOUS_PET_SPECIES_BASES[id];
    const jutsus = (template.jutsus as Record<string, unknown>[]).map((move, index) => ({ ...move, power: old[index + 4] }));
    return normalizePetGrowth({
        ...template, id: id + ':owned', templateId: id, speciesBalanceVersion: undefined,
        origin: 'wild', trait: 'Battleborn', level, xp: 100, jutsus,
        growthVersion: 2, growthBaseStats: Object.fromEntries(stats.map((stat, index) => [stat, old[index]])),
        growthAllocation: { vitality: 1, power: 2, guard: 0, agility: 0 },
    });
}

test('all previous species migrate once to current bases while retaining point investment', () => {
    for (const id of Object.keys(PREVIOUS_PET_SPECIES_BASES)) {
        const original = previousPet(id);
        const frozen = structuredClone(original);
        const first = migrateOwnedPet('balance-owner', original);
        assert.equal(first.changed, true, id);
        const template = PET_CATALOG[id];
        assert.deepEqual(first.pet.growthBaseStats, Object.fromEntries(stats.map(stat => [stat, template[stat]])), id);
        assert.deepEqual(first.pet.growthAllocation, original.growthAllocation, id);
        assert.equal(first.pet.growthPoints, original.growthPoints, id);
        assert.deepEqual(first.pet.jutsus, template.jutsus, id);
        const derived = derivePetGrowthStats(first.pet);
        for (const stat of stats) assert.equal(first.pet[stat], derived[stat], id + ' ' + stat);
        const second = migrateOwnedPet('balance-owner', JSON.parse(JSON.stringify(first.pet)));
        assert.equal(second.changed, false, id);
        assert.deepEqual(second.pet, JSON.parse(JSON.stringify(first.pet)), id);
        assert.deepEqual(original, frozen, 'input is immutable');
    }
});

test('new battle projections match persisted migration without mutating the stored roster', () => {
    for (const version of [undefined, 1, 2]) {
        const stored = { ...previousPet('rare-23', 50), growthVersion: version };
        const original = structuredClone(stored);
        const migrated = migrateOwnedPet('balance-owner', stored).pet;
        const projected = projectCurrentPetSpecies(stored);
        for (const key of [...stats, 'growthVersion', 'growthBaseStats', 'growthAllocation', 'speciesBalanceVersion', 'jutsus']) {
            assert.deepEqual(projected[key], migrated[key], key);
        }
        assert.deepEqual(stored, original);
        assert.equal(projectCurrentPetSpecies(projected), projected, 'current inputs are not migrated twice');
    }
});

test('fresh war, PvP, ladder, co-op and companion selections use the same migrated pet', () => {
    const old = previousPet('rare-23', 50);
    const original = structuredClone(old);
    const migrated = migrateOwnedPet('balance-owner', old).pet;
    const character = { pets: [old], activePetId: String(old.id) };
    const war = buildWarTeam(character, [String(old.id)])![0];
    const pvp = sealChallengedPets(character, [String(old.id)])![0];
    const ladder = toPet(chooseOwnedLadderPets([old], [old.id], 1)![0]);
    const coop = chooseOwnedPets([old, { ...old, id: 'second' }], [old.id, 'second'])![0];
    const arenaRoster = [old, ...['second', 'third', 'fourth'].map(id => ({ ...old, id }))];
    const arena = chooseArenaPets({ pets: arenaRoster }, arenaRoster.map(pet => pet.id))[0];
    for (const selected of [war, pvp, ladder, coop, arena]) {
        for (const key of [...stats, 'growthVersion', 'growthBaseStats', 'growthAllocation', 'speciesBalanceVersion'] as const) {
            assert.deepEqual(selected[key], migrated[key], key);
        }
    }
    assert.deepEqual(sealShowdownPet(ladder as Pet, 'progression-v3'),
        sealShowdownPet(migrated as unknown as Pet, 'progression-v3'));
    assert.deepEqual(sealCompanionFromSave(character), sealCompanionFromSave({ ...character, pets: [migrated] }));
    assert.deepEqual(old, original);
});

test('new ladder challenges rebalance old offline defenses without refreshing their sealed build', () => {
    const old = previousPet('rare-23', 50);
    const snapshot = snapshotLadderPet(old);
    delete snapshot.growthBaseStats;
    delete snapshot.growthAllocation;
    delete snapshot.growthVersion;
    const defense: DefenseDoc = { slug: 'owner', name: 'Owner', mode: 'coliseum',
        pets: [snapshot], roles: ['sage'], updatedAt: 123 };
    const original = structuredClone(defense);
    const later = { ...old, level: 100, attack: 999, loadout: { pvp: 'later-gear' } };
    const current = projectLadderSpeciesBalance(defense, [later]);
    const expected = migrateOwnedPet('owner', old).pet;
    for (const stat of stats) assert.ok(Math.abs(Number(current.pets[0][stat]) - Number(expected[stat])) <= 1, stat);
    assert.equal(current.pets[0].level, 50);
    assert.deepEqual(current.pets[0].loadout, snapshot.loadout);
    assert.equal(current.pets[0].speciesBalanceVersion, 1);
    assert.deepEqual(projectLadderSpeciesBalance(current, [later]), current, 'projection is idempotent');
    assert.deepEqual(projectLadderSpeciesBalance(defense, [{ ...later, origin: 'admin' }]), defense);
    assert.deepEqual(defense, original, 'stored defense and retained replays stay immutable');
});

test('species migration preserves earned jutsu power, custom slots, and all other owned state', () => {
    const pet = previousPet('rare-23', 50);
    const moves = pet.jutsus as Record<string, unknown>[];
    moves[0].power = Number(moves[0].power) + 17;
    moves.push({ name: 'Personal Art', power: 42, kind: 'damage', cooldown: 3 });
    Object.assign(pet, {
        nickname: 'Stone', happiness: 88, foodXpDay: 123, foodXpUsed: 500,
        loadout: { pve: 'armor', pveDurability: 8 }, training: { endsAt: 2000 },
        expedition: { token: 'sealed', endsAt: 3000 }, generation: 2,
        parentInstanceIds: ['parent-a', 'parent-b'], breedingUsesMax: 8, breedingUsesRemaining: 3,
    });
    const original = structuredClone(pet);
    const oldBattle = { pets: [structuredClone(pet)] };
    const character = { pets: [pet], oldBattle, ryo: 1234, inventory: ['food'], itemStacks: [{ itemId: 'food', count: 2 }] };
    const migrated = migrateCharacterOwnedPets('balance-owner', character);
    const result = (migrated.character.pets as Record<string, unknown>[])[0];
    assert.equal((result.jutsus as Record<string, unknown>[])[0].power,
        Number((PET_CATALOG['rare-23'].jutsus as Record<string, unknown>[])[0].power) + 17);
    assert.deepEqual((result.jutsus as unknown[]).at(-1), moves.at(-1));
    for (const key of ['id', 'level', 'xp', 'trait', 'growthVersion', 'growthAllocation', 'growthPoints',
        'nickname', 'happiness', 'foodXpDay', 'foodXpUsed', 'loadout', 'training', 'expedition',
        'generation', 'parentInstanceIds', 'breedingUsesMax', 'breedingUsesRemaining']) {
        assert.deepEqual(result[key], original[key], key);
    }
    for (const key of ['oldBattle', 'ryo', 'inventory', 'itemStacks'] as const) assert.deepEqual(migrated.character[key], character[key], key);
    assert.deepEqual(pet, original);
    assert.equal(migrateCharacterOwnedPets('balance-owner', migrated.character).changed, false);
});

test('species migration composes with old point conversion without tripling it again', () => {
    const pet = { ...previousPet('legendary-3', 10), growthVersion: 1, growthAllocation: { vitality: 1, power: 2, guard: 0, agility: 0 } };
    const first = migrateOwnedPet('balance-owner', pet).pet;
    assert.deepEqual(first.growthAllocation, { vitality: 3, power: 6, guard: 0, agility: 0 });
    assert.equal(first.growthPoints, 18);
    assert.equal(first.growthVersion, 2);
    assert.equal(first.speciesBalanceVersion, 1);
    assert.equal(migrateOwnedPet('balance-owner', first).changed, false);
});

test('fresh acquisition and a retained old encounter grant the same current species budget', () => {
    for (const id of ['rare-23', 'legendary-3']) {
        const fresh = createOwnedPet(id, { origin: 'wild', trait: 'Battleborn', secureInt: min => min });
        const old = previousPet(id);
        const encounter: Record<string, unknown> = { ...old, ...old.growthBaseStats as object, level: 80 };
        delete encounter.growthBaseStats;
        const capture = grantWildPet({ pets: [] }, encounter, () => 0);
        assert.equal(capture.ok, true);
        if (!capture.ok) continue;
        for (const stat of stats) assert.equal(capture.pet[stat], fresh[stat], id + ' ' + stat);
        assert.deepEqual(capture.pet.growthBaseStats, fresh.growthBaseStats);
        assert.equal(capture.pet.speciesBalanceVersion, 1);
        assert.equal(capture.pet.level, 1);
        assert.equal(capture.pet.growthPoints, 0);
    }
});

test('custom base adjustments survive proportionally and admin pets remain authored', () => {
    const pet = previousPet('rare-23');
    const base = pet.growthBaseStats as Record<string, number>;
    base.hp *= 2;
    const changed = migrateOwnedPet('balance-owner', pet).pet;
    assert.equal((changed.growthBaseStats as Record<string, number>).hp, Number(PET_CATALOG['rare-23'].hp) * 2);
    const admin: Record<string, unknown> = { ...previousPet('rare-23'), origin: 'admin' };
    const migratedAdmin = migrateOwnedPet('balance-owner', admin).pet;
    assert.deepEqual(migratedAdmin.growthBaseStats, admin.growthBaseStats);
    assert.deepEqual(migratedAdmin.jutsus, admin.jutsus);
    const starter = createOwnedPet('starter-fire', { origin: 'starter', trait: 'Loyal', secureInt: min => min });
    assert.equal(migrateOwnedPet('balance-owner', starter).changed, false);
});

test('a generic save cannot forge, erase, or advance the authoritative species stamp', () => {
    const stored = migrateOwnedPet('balance-owner', previousPet('rare-23')).pet;
    for (const submittedVersion of [undefined, 0, 999]) {
        const incoming = { pets: [{ ...stored, speciesBalanceVersion: submittedVersion }] };
        sanitizePetRoster(incoming, { pets: [stored] }, false);
        assert.equal(incoming.pets[0].speciesBalanceVersion, 1);
    }
});
