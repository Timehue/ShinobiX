import test from 'node:test';
import assert from 'node:assert/strict';
import { toClientPet, toClientWarfrontSlot, type LadderPet } from './pet-ladder-client';

test('ladder replay preserves sealed progression metadata and its speed reference', () => {
    const pet: LadderPet = {
        id: 'owned', name: 'Companion', rarity: 'rare', level: 30, hp: 550, attack: 70,
        defense: 50, speed: 80, element: 'Wind', jutsus: [], speciesBalanceVersion: 1,
        growthVersion: 2, growthBaseStats: { hp: 300, attack: 40, defense: 30, speed: 50 },
        growthAllocation: { vitality: 10, power: 20, guard: 0, agility: 30 },
    };
    const original = structuredClone(pet);
    for (const projected of [toClientPet(pet), toClientWarfrontSlot({ pet, role: 'assassin' }).pet]) {
        for (const key of ['speciesBalanceVersion', 'growthVersion', 'growthBaseStats', 'growthAllocation'] as const) {
            assert.deepEqual(projected[key], pet[key], key);
        }
        assert.notEqual(projected.growthBaseStats, pet.growthBaseStats);
    }
    assert.deepEqual(pet, original);
    const legacy = { ...pet };
    delete legacy.speciesBalanceVersion;
    delete legacy.growthVersion;
    delete legacy.growthBaseStats;
    delete legacy.growthAllocation;
    const replay = toClientPet(legacy);
    for (const key of ['speciesBalanceVersion', 'growthVersion', 'growthBaseStats', 'growthAllocation']) {
        assert.equal(Object.hasOwn(replay, key), false, key);
    }
});
