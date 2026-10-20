import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePetGrowth, specializationGrowth, applyGrowthAllocation, resetGrowthAllocation } from './_growth.js';
import { gainServerPetXp } from './_progress.js';
import { migrateCharacterOwnedPets } from './_owned-pet.js';
import { evolvePet, EVOLUTION_LINES } from './_evolution.js';
// Keep the independent client build outside the NodeNext server compile graph.
const clientModule = '../../shinobij.client/src/lib/pet-balance.ts';
let clientNormalize: (pet: unknown) => unknown;
let clientStats: (pet: unknown) => Record<string, number>;
let clientTemplate: (pet: unknown, pool: unknown[]) => Record<string, unknown>;
before(async () => { ({ normalizePetGrowth: clientNormalize, derivePetGrowthStats: clientStats, normalizePetTemplate: clientTemplate } = await import(clientModule)); });

const base = { hp: 320, attack: 40, defense: 28, speed: 30 };
const fresh = (level = 10) => ({ ...base, id: 'standard-0', templateId: 'standard-0', level, maxLevel: 100, xp: 123, rarity: 'standard', trait: 'Lucky', growthVersion: 2, growthBaseStats: base, jutsus: [] });

test('v1 migration triples invested and unspent points once while preserving earned state', () => {
    const old = { ...fresh(), growthVersion: 1, growthPoints: 3, growthAllocation: { vitality: 2, power: 4, guard: 0, agility: 0 }, happiness: 77, loadout: { pve: 'armor', pveDurability: 8 }, expedition: { token: 'sealed' }, foodXpDay: 12, foodXpUsed: 250 };
    const migrated = normalizePetGrowth(old);
    assert.deepEqual(migrated.growthAllocation, { vitality: 6, power: 12, guard: 0, agility: 0 });
    assert.equal(migrated.growthPoints, 9);
    for (const key of ['id', 'level', 'xp', 'jutsus', 'happiness', 'loadout', 'expedition', 'foodXpDay', 'foodXpUsed'] as const) assert.deepEqual(migrated[key], old[key]);
    assert.deepEqual(normalizePetGrowth(JSON.parse(JSON.stringify(migrated))), migrated);
    assert.deepEqual(clientNormalize(old), migrated);
    const owned = { pets: [old], inventory: ['ancient-pet-treat', 'unique-gear'], itemStacks: [{ itemId: 'pet-treat', count: 56 }] };
    const first = migrateCharacterOwnedPets('growth-owner', owned);
    assert.equal(first.changed, true);
    const again = migrateCharacterOwnedPets('growth-owner', first.character);
    assert.equal(again.changed, false);
    assert.deepEqual(first.character.inventory, owned.inventory);
    assert.deepEqual(first.character.itemStacks, owned.itemStacks);
});

test('level nine to ten grants three points, retains automatic growth and refunds survive reload', () => {
    const ninth = normalizePetGrowth({ ...fresh(9), xp: 899 });
    const tenth = gainServerPetXp(ninth, 1);
    assert.equal(tenth.level, 10);
    assert.equal(Number(tenth.growthPoints) - Number(ninth.growthPoints), 3);
    assert.equal(tenth.hp, Math.round(320 * 1.0675));
    const invested = applyGrowthAllocation(tenth, { vitality: 0, power: 27, guard: 0, agility: 0 });
    assert.ok(invested.ok);
    const reload = normalizePetGrowth(JSON.parse(JSON.stringify(invested.pet)));
    assert.equal(reload.growthPoints, 0);
    assert.equal((reload.growthAllocation as { power: number }).power, 27);
    assert.equal(resetGrowthAllocation(reload).growthPoints, 27);
});

test('soft caps apply separately at 20/21 and 50/51 with half-rate Agility', () => {
    for (const [n, expected] of [[19,.19],[20,.20],[21,.205],[49,.345],[50,.35],[51,.3525],[297,.9675]]) {
        assert.ok(Math.abs(specializationGrowth(n) - expected) < 1e-12);
        assert.equal(specializationGrowth(n, true), specializationGrowth(n) / 2);
    }
    const independent = normalizePetGrowth({ ...fresh(50), growthAllocation: { vitality: 21, power: 51, guard: 50, agility: 0 } });
    assert.equal(independent.hp, Math.round(320 * (1 + 49 * .0075 + .205)));
    assert.equal(independent.attack, Math.round(40 * (1 + 49 * .0075 + .3525)));
});

test('low/mid/high builds and extreme specialization match rounded client previews', () => {
    for (const level of [1, 10, 50, 100]) for (const attribute of ['vitality', 'power', 'guard', 'agility'] as const) {
        const allocation = { vitality: 0, power: 0, guard: 0, agility: 0, [attribute]: (level - 1) * 3 };
        const pet = normalizePetGrowth({ ...fresh(level), growthAllocation: allocation });
        const preview = clientStats(pet);
        for (const stat of ['hp', 'attack', 'defense', 'speed'] as const) assert.equal(preview[stat], pet[stat]);
        assert.ok(Number(pet.hp) <= 320 * 2.71 && Number(pet.attack) <= 40 * 2.71 + 1);
        assert.deepEqual(normalizePetGrowth(pet), pet);
    }
});

test('evolution preserves the daily food ledger, level, XP and already converted points', () => {
    const original = normalizePetGrowth({ ...fresh(50), id: 'starter-fire', name: 'Cinder Cub', element: 'Fire', foodXpDay: 20746, foodXpUsed: 1750, growthVersion: 1, growthAllocation: { vitality: 10, power: 20, guard: 10, agility: 9 } });
    const evolved = evolvePet(original, 1, EVOLUTION_LINES['starter-fire']);
    for (const field of ['id', 'level', 'xp', 'foodXpDay', 'foodXpUsed', 'growthAllocation', 'growthPoints']) assert.deepEqual(evolved[field], original[field]);
    assert.deepEqual(normalizePetGrowth(evolved), evolved);
});

test('client hydration cannot inflate authoritative growth stats to a published template floor', () => {
    const saved = normalizePetGrowth({ ...fresh(), growthAllocation: { vitality: 0, power: 27, guard: 0, agility: 0 } });
    const pool = [{ ...fresh(1), hp: 999, attack: 200, defense: 100, speed: 150 }];
    for (const pet of [saved, resetGrowthAllocation(saved)]) {
        const hydrated = clientTemplate(pet, pool);
        for (const stat of ['hp', 'attack', 'defense', 'speed']) assert.equal(hydrated[stat], pet[stat], stat);
    }
});
