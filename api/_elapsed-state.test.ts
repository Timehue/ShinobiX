import test from 'node:test';
import assert from 'node:assert/strict';
import { biomeForSettledSector, settleSaveRecord } from './_elapsed-state.js';

const NOW = 1_000_000;

function save(over: Record<string, unknown> = {}) {
    const { character: characterOverride, ...rest } = over;
    return {
        _saveAt: NOW - 10_000,
        currentSector: 12,
        currentBiome: 'shadow',
        character: {
            name: 'Tester',
            hp: 10,
            maxHp: 100,
            chakra: 20,
            maxChakra: 100,
            stamina: 30,
            maxStamina: 100,
            ...((characterOverride as Record<string, unknown> | undefined) ?? {}),
        },
        ...rest,
    } as Record<string, unknown>;
}

test('settleSaveRecord regenerates vitals from _saveAt and clamps to max', () => {
    const result = settleSaveRecord(save(), { now: NOW });
    assert.equal(result.changed, true);
    assert.equal(result.vitalsChanged, true);
    assert.deepEqual(result.record.character, {
        name: 'Tester',
        hp: 20,
        maxHp: 100,
        chakra: 30,
        maxChakra: 100,
        stamina: 40,
        maxStamina: 100,
    });
    assert.equal(result.record._saveAt, NOW);
});

test('settleSaveRecord applies equipped Aura Sphere regen bonus', () => {
    const result = settleSaveRecord(save({
        character: {
            hp: 10,
            chakra: 10,
            stamina: 10,
            auraSphereLevel: 150,
            equipment: { aura: 'aura-sphere' },
        },
    }), { now: NOW });
    assert.equal((result.record.character as Record<string, unknown>).hp, 40);
    assert.equal((result.record.character as Record<string, unknown>).chakra, 40);
    assert.equal((result.record.character as Record<string, unknown>).stamina, 40);
});

test('settleSaveRecord does not regenerate during battle locks or Hollow Gate runs', () => {
    const locked = settleSaveRecord(save(), { now: NOW, battleLocked: true });
    assert.equal(locked.vitalsChanged, false);
    assert.equal((locked.record.character as Record<string, unknown>).hp, 10);

    const hollow = settleSaveRecord(save({ character: { hollowGateRun: { completed: false } } }), { now: NOW });
    assert.equal(hollow.vitalsChanged, false);
    assert.equal((hollow.record.character as Record<string, unknown>).hp, 10);
});

test('settleSaveRecord completes expired pending travel', () => {
    const result = settleSaveRecord(save({
        pendingTravel: { destinationSector: 42, arrivalAt: NOW - 1 },
    }), { now: NOW });
    assert.equal(result.travelChanged, true);
    assert.equal(result.record.currentSector, 42);
    assert.equal(result.record.currentBiome, biomeForSettledSector(42));
    assert.equal(result.record.pendingTravel, null);
});

test('settleSaveRecord keeps future pending travel without changing sector', () => {
    const result = settleSaveRecord(save({
        pendingTravel: { destinationSector: 42, arrivalAt: NOW + 1 },
    }), { now: NOW });
    assert.equal(result.travelChanged, false);
    assert.equal(result.record.currentSector, 12);
    assert.deepEqual(result.record.pendingTravel, { destinationSector: 42, arrivalAt: NOW + 1 });
});
