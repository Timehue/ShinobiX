import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { _makeMemoryKv, type KvLike } from '../_storage.js';
import {
    getPetFromSanctuaryCore,
    listPetSanctuaryCore,
    PET_SANCTUARY_PAGE_SIZE,
    petSanctuaryMetaKey,
    removePetFromSanctuaryCore,
    storePetInSanctuaryCore,
} from './_sanctuary.js';

const pet = (index: number, patch: Record<string, unknown> = {}) => ({
    id: `ember-fox:${index}`,
    templateId: 'starter-fire',
    name: `Ember Fox ${index}`,
    level: index + 1,
    element: index % 2 ? 'fire' : 'wind',
    rarity: index % 3 ? 'standard' : 'rare',
    origin: 'wild',
    trait: index % 2 ? 'Swift' : 'Loyal',
    ...patch,
});

function failOnceAfterCommittedSet(store: KvLike, writeBoundary: number): KvLike {
    let writes = 0;
    return {
        ...store,
        async set(key, value, options) {
            const result = await store.set(key, value, options);
            writes += 1;
            if (writes === writeBoundary) throw new Error(`injected failure after write ${writeBoundary}`);
            return result;
        },
    };
}

function failOnceAfterCommittedWrite(store: KvLike, writeBoundary: number): KvLike {
    let writes = 0;
    const loseAck = () => {
        writes += 1;
        if (writes === writeBoundary) throw new Error(`injected removal failure after write ${writeBoundary}`);
    };
    return {
        ...store,
        async set(key, value, options) {
            const result = await store.set(key, value, options);
            loseAck();
            return result;
        },
        async del(...keys) {
            const result = await store.del(...keys);
            loseAck();
            return result;
        },
    };
}

describe('pet sanctuary storage', () => {
    it('stores a deterministic pet only once and preserves the complete owned-pet record', async () => {
        const store = _makeMemoryKv();
        const first = await storePetInSanctuaryCore(store, 'Raiko', pet(1, { paletteVariantId: 'chromatic' }), 'wild', 100);
        const replay = await storePetInSanctuaryCore(store, 'Raiko', pet(1, { paletteVariantId: 'chromatic' }), 'wild', 200);
        assert.equal(first.replayed, false);
        assert.equal(replay.replayed, true);
        assert.equal(replay.item.storedAt, 100);
        assert.equal(replay.item.pet.paletteVariantId, 'chromatic');
        assert.equal((await listPetSanctuaryCore(store, 'Raiko')).total, 1);
    });

    for (const [boundary, label] of [[1, 'item'], [2, 'page'], [3, 'meta']] as const) {
        it(`repairs a retry after the ${label} write committed but its acknowledgement was lost`, async () => {
            const memory = _makeMemoryKv();
            const store = failOnceAfterCommittedSet(memory, boundary);
            const firstVersion = pet(7, { nickname: 'Before', level: 8, trait: 'Swift' });
            await assert.rejects(
                storePetInSanctuaryCore(store, 'Kakashi', firstVersion, 'roster', 100),
                new RegExp(`injected failure after write ${boundary}`),
            );

            const currentVersion = pet(7, { nickname: 'Current', level: 42, trait: 'Veteran' });
            const retry = await storePetInSanctuaryCore(store, 'Kakashi', currentVersion, 'roster', 200);
            assert.equal(retry.replayed, true);
            assert.equal(retry.item.storedAt, 100, 'a replay preserves the original deposit time');
            assert.equal(retry.item.pet.nickname, 'Current');
            assert.equal(retry.item.pet.level, 42);

            const listed = await listPetSanctuaryCore(memory, 'Kakashi');
            assert.equal(listed.total, 1);
            assert.equal(listed.items.length, 1);
            assert.equal(listed.items[0].pet.id, 'ember-fox:7');
            assert.equal(listed.items[0].pet.nickname, 'Current');
            assert.equal(listed.items[0].pet.level, 42);
            assert.equal((await listPetSanctuaryCore(memory, 'Kakashi', { search: 'current' })).items.length, 1);
            assert.equal((await listPetSanctuaryCore(memory, 'Kakashi', { search: 'before' })).items.length, 0);

            const meta = await memory.get<{ total: number; lastPage: number }>(petSanctuaryMetaKey('Kakashi'));
            assert.deepEqual({ total: meta?.total, lastPage: meta?.lastPage }, { total: 1, lastPage: 1 });

            // A completed replay is a semantic no-op: no duplicate index entry,
            // no total drift, and the current authoritative snapshot remains.
            await storePetInSanctuaryCore(store, 'Kakashi', currentVersion, 'roster', 300);
            const replayedAgain = await listPetSanctuaryCore(memory, 'Kakashi');
            assert.equal(replayedAgain.total, 1);
            assert.deepEqual(replayedAgain.items.map((item) => item.pet.nickname), ['Current']);
        });
    }

    it('pages an uncapped collection newest-first without loading the entire sanctuary', async () => {
        const store = _makeMemoryKv();
        const count = PET_SANCTUARY_PAGE_SIZE * 3 + 5;
        for (let index = 0; index < count; index += 1) await storePetInSanctuaryCore(store, 'Hinata', pet(index), 'roster', index);
        const first = await listPetSanctuaryCore(store, 'Hinata', { limit: 17 });
        assert.equal(first.total, count);
        assert.equal(first.items.length, 17);
        assert.equal(first.items[0].pet.id, `ember-fox:${count - 1}`);
        assert.ok(first.nextCursor);
        const second = await listPetSanctuaryCore(store, 'Hinata', { limit: 17, cursor: first.nextCursor ?? undefined });
        assert.equal(second.items.length, 17);
        assert.equal(second.items[0].pet.id, `ember-fox:${count - 18}`);
    });

    it('filters index metadata and can hide carried duplicates during retry recovery', async () => {
        const store = _makeMemoryKv();
        await storePetInSanctuaryCore(store, 'Sakura', pet(1, { nickname: 'Cinder' }), 'wild', 1);
        await storePetInSanctuaryCore(store, 'Sakura', pet(2), 'bred', 2);
        await storePetInSanctuaryCore(store, 'Sakura', pet(3), 'bred', 3);
        const fire = await listPetSanctuaryCore(store, 'Sakura', { element: 'fire', search: 'cinder' });
        assert.deepEqual(fire.items.map((item) => item.pet.id), ['ember-fox:1']);
        const excluded = await listPetSanctuaryCore(store, 'Sakura', { excludePetIds: ['ember-fox:3'] });
        assert.equal(excluded.total, 3);
        assert.deepEqual(excluded.items.map((item) => item.pet.id), ['ember-fox:2', 'ember-fox:1']);
    });

    it('removes a stored pet idempotently without disturbing its neighbors', async () => {
        const store = _makeMemoryKv();
        await storePetInSanctuaryCore(store, 'Raiko', pet(1), 'wild', 1);
        await storePetInSanctuaryCore(store, 'Raiko', pet(2), 'bred', 2);
        assert.equal((await removePetFromSanctuaryCore(store, 'Raiko', 'ember-fox:1'))?.pet.id, 'ember-fox:1');
        assert.equal((await removePetFromSanctuaryCore(store, 'Raiko', 'ember-fox:1'))?.pet.id, 'ember-fox:1');
        assert.equal(await getPetFromSanctuaryCore(store, 'Raiko', 'ember-fox:1'), null);
        const listed = await listPetSanctuaryCore(store, 'Raiko');
        assert.equal(listed.total, 1);
        assert.deepEqual(listed.items.map((item) => item.pet.id), ['ember-fox:2']);
    });

    for (const [boundary, label] of [[1, 'removal receipt'], [2, 'page'], [3, 'meta'], [4, 'item deletion']] as const) {
        it(`finishes a removal retry after the ${label} committed but its acknowledgement was lost`, async () => {
            const memory = _makeMemoryKv();
            await storePetInSanctuaryCore(memory, 'Shizune', pet(1), 'wild', 1);
            await storePetInSanctuaryCore(memory, 'Shizune', pet(2), 'bred', 2);
            const store = failOnceAfterCommittedWrite(memory, boundary);

            await assert.rejects(
                removePetFromSanctuaryCore(store, 'Shizune', 'ember-fox:1'),
                new RegExp(`injected removal failure after write ${boundary}`),
            );
            const retry = await removePetFromSanctuaryCore(store, 'Shizune', 'ember-fox:1');
            assert.equal(retry?.pet.id, 'ember-fox:1');
            assert.equal(await getPetFromSanctuaryCore(memory, 'Shizune', 'ember-fox:1'), null);

            const listed = await listPetSanctuaryCore(memory, 'Shizune');
            assert.equal(listed.total, 1);
            assert.deepEqual(listed.items.map((item) => item.pet.id), ['ember-fox:2']);
            const meta = await memory.get<{ total: number; lastPage: number }>(petSanctuaryMetaKey('Shizune'));
            assert.deepEqual({ total: meta?.total, lastPage: meta?.lastPage }, { total: 1, lastPage: 1 });

            const replay = await removePetFromSanctuaryCore(store, 'Shizune', 'ember-fox:1');
            assert.equal(replay?.pet.id, 'ember-fox:1', 'a completed response can also be safely replayed');
        });
    }

    it('compacts empty tail pages so large released collections stay cheap to browse', async () => {
        const store = _makeMemoryKv();
        for (let index = 0; index <= PET_SANCTUARY_PAGE_SIZE; index += 1) await storePetInSanctuaryCore(store, 'Tsunade', pet(index), 'wild', index);
        await removePetFromSanctuaryCore(store, 'Tsunade', `ember-fox:${PET_SANCTUARY_PAGE_SIZE}`);
        const listed = await listPetSanctuaryCore(store, 'Tsunade', { limit: PET_SANCTUARY_PAGE_SIZE });
        assert.equal(listed.items.length, PET_SANCTUARY_PAGE_SIZE);
        assert.equal(listed.nextCursor, null);
    });
});
