import test from 'node:test';
import assert from 'node:assert/strict';
import { biomeForSettledSector, settleSaveRecord } from './_elapsed-state.js';
import { OLD_TO_NEW_SECTOR, sectorBiomeOf, WORLD_GEO_VERSION } from '../shared/sector-geo.js';

const NOW = 1_000_000;

function save(over: Record<string, unknown> = {}) {
    const { character: characterOverride, ...rest } = over;
    return {
        _saveAt: NOW - 10_000,
        // Post-reorg record: settle behavior below is tested WITHOUT the
        // one-time geography migration (that path has its own tests).
        worldGeoV: WORLD_GEO_VERSION,
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

test('a vitals-only settle remains a durable authoritative change', () => {
    const result = settleSaveRecord(save(), { now: NOW });
    assert.equal(result.changed, true);
    assert.equal(result.vitalsChanged, true);
    assert.equal(result.travelChanged, false);
    assert.equal(result.hollowGateRunCleared, false);
    assert.equal(result.geoChanged, false);
});

test('settleSaveRecord reports geoChanged when the one-time migration runs', () => {
    const legacy = save({ currentSector: 12 });
    delete (legacy as Record<string, unknown>).worldGeoV;
    const migrated = settleSaveRecord(legacy, { now: NOW });
    assert.equal(migrated.geoChanged, true, 'a migrated geo stamp must still be persisted');
    assert.equal(migrated.record.currentSector, OLD_TO_NEW_SECTOR[12]);
    assert.equal(settleSaveRecord(save(), { now: NOW }).geoChanged, false);
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

test('one-time world-geo migration remaps pre-reorg sector fields exactly once', () => {
    const legacy = save({
        pendingTravel: { destinationSector: 42, arrivalAt: NOW + 60_000 },
        character: { activeRiftQuest: { id: 'rift-hollow-stalker', targetSector: 16, stage: 'travel', baseline: 0 } },
    });
    delete (legacy as Record<string, unknown>).worldGeoV;
    const result = settleSaveRecord(legacy, { now: NOW });
    assert.equal(result.changed, true);
    assert.equal(result.record.worldGeoV, WORLD_GEO_VERSION);
    assert.equal(result.record.currentSector, OLD_TO_NEW_SECTOR[12]);
    assert.equal(result.record.currentBiome, sectorBiomeOf(OLD_TO_NEW_SECTOR[12]!));
    const travel = result.record.pendingTravel as { destinationSector: number };
    assert.equal(travel.destinationSector, OLD_TO_NEW_SECTOR[42]);
    const quest = (result.record.character as Record<string, unknown>).activeRiftQuest as { targetSector: number };
    assert.equal(quest.targetSector, OLD_TO_NEW_SECTOR[16]);
    // Idempotent: settling the migrated record again must not re-remap.
    const again = settleSaveRecord(result.record, { now: NOW });
    assert.equal((again.record as Record<string, unknown>).currentSector, OLD_TO_NEW_SECTOR[12]);
});

test('world-geo migration leaves records with nothing sector-shaped untouched', () => {
    const bare = { character: { name: 'Rill' }, _saveVersion: 1 } as Record<string, unknown>;
    const result = settleSaveRecord(bare, { now: NOW });
    assert.equal(result.changed, false);
    assert.equal('worldGeoV' in result.record, false);
});
