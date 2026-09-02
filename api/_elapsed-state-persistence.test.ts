import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

let kv: typeof import('./_storage.js').kv;
let settleSaveRecordForRead: typeof import('./_elapsed-state.js').settleSaveRecordForRead;
// Both fixtures below stamp this. A character missing it makes
// migrateCharacterOwnedPets report a change, which is a genuine one-time durable
// migration and DOES publish a version — correct, but it would mask whether the
// projection-only path bumps, which is the whole point of the first test.
let PET_BREEDING_MIGRATION_VERSION: number;
const WORLD_GEO_VERSION = 2;

before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    ({ kv } = await import('./_storage.js'));
    ({ settleSaveRecordForRead } = await import('./_elapsed-state.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('./pet/_owned-pet.js'));
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

test('owner read durably settles regenerated vitals for later authoritative mutations', async () => {
    const playerName = 'ElapsedVitalPersistence';
    const key = 'save:elapsedvitalpersistence';
    const now = 1_000_000;
    await kv.set(key, {
        _saveVersion: 7,
        _saveAt: now - 60_000,
        worldGeoV: WORLD_GEO_VERSION,
        currentSector: 40,
        currentBiome: 'central',
        character: {
            name: playerName,
            petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            hp: 0,
            maxHp: 100,
            chakra: 0,
            maxChakra: 100,
            stamina: 0,
            maxStamina: 100,
        },
    });

    try {
        const settled = await settleSaveRecordForRead(playerName, await kv.get<Record<string, unknown>>(key) as Record<string, unknown>, {
            persist: true,
            now,
        });
        const durable = await kv.get<Record<string, unknown>>(key);
        const projectedCharacter = settled.record.character as Record<string, unknown>;
        const durableCharacter = durable?.character as Record<string, unknown>;

        assert.ok(Number(projectedCharacter.stamina) > 0, 'owner read projects elapsed stamina');
        assert.equal(durableCharacter.stamina, projectedCharacter.stamina,
            'later lock-protected mutations must observe the same authoritative stamina');
        assert.equal(durableCharacter.hp, projectedCharacter.hp);
        assert.equal(durableCharacter.chakra, projectedCharacter.chakra);
        assert.equal(durable?._saveAt, settled.record._saveAt,
            'the durable record and owner response must share one save timestamp');
        // ⛔ The write happens; the VERSION MUST NOT MOVE. Regen is re-derived
        // from `_saveAt` on every read, so it tells the owner's open client
        // nothing it cannot compute itself — but publishing a version declared
        // that client's `_baseSaveVersion` stale, and with VITAL_REGEN_MS = 1s
        // that fired on essentially every owner read below full vitals. The next
        // autosave then took a 409 and captured a recovery draft for a divergence
        // that never existed. This assertion previously read `8` and was the
        // codification of that bug (the guard from d453f9257 having been lost in
        // merge d9ef64aa9). A settle carrying something durable — travel arrival,
        // an expired Hollow Gate run, the geo migration, pet breeding/bond — DOES
        // still bump; see the pet-happiness wiring suite for that side.
        assert.equal(durable?._saveVersion, 7, 'a projection-only settle must not publish a new version');
        assert.equal(settled.record._saveVersion, 7);
    } finally {
        await kv.del(key);
    }
});

test('a DURABLE settle still publishes a version the client must adopt', async () => {
    // The other half of the discriminator. A travel arrival moves currentSector,
    // which no later read can re-derive from `_saveAt` — so unlike regen it has to
    // force the owner's client to refetch rather than keep saving over it. If this
    // ever goes green while the projection-only test above also passes trivially,
    // the guard has been replaced by an unconditional `return next` and admissions
    // are back to reading pre-regeneration vitals.
    const playerName = 'ElapsedDurablePersistence';
    const key = 'save:elapseddurablepersistence';
    const now = 1_000_000;
    await kv.set(key, {
        _saveVersion: 7,
        _saveAt: now - 60_000,
        worldGeoV: WORLD_GEO_VERSION,
        currentSector: 12,
        currentBiome: 'central',
        pendingTravel: { destinationSector: 42, arrivalAt: now - 1 },
        // Full vitals + every migration stamped, so the ONLY thing this settle
        // produces is the arrival — the bump below can come from nothing else.
        character: {
            name: playerName,
            petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            hp: 100, maxHp: 100,
            chakra: 100, maxChakra: 100,
            stamina: 100, maxStamina: 100,
        },
    });

    try {
        const settled = await settleSaveRecordForRead(playerName, await kv.get<Record<string, unknown>>(key) as Record<string, unknown>, {
            persist: true,
            now,
        });
        const durable = await kv.get<Record<string, unknown>>(key);

        assert.equal(settled.travelChanged, true, 'the arrival settled');
        assert.equal(durable?.currentSector, 42, 'and is durable');
        assert.equal(durable?._saveVersion, 8, 'novel state MUST publish a version');
        assert.equal(settled.record._saveVersion, 8, 'and the owner response carries it for adoption');
    } finally {
        await kv.del(key);
    }
});
