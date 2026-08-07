import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { _makeMemoryKv } from '../_storage.js';
import {
    getPetFromSanctuaryCore,
    listPetSanctuaryCore,
    PET_SANCTUARY_PAGE_SIZE,
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

describe('pet sanctuary storage', () => {
    it('stores a deterministic pet only once and preserves the complete owned-pet record', async () => {
        const store = _makeMemoryKv();
        const first = await storePetInSanctuaryCore(store, 'Kakashi', pet(1, { paletteVariantId: 'chromatic' }), 'wild', 100);
        const replay = await storePetInSanctuaryCore(store, 'Kakashi', pet(1, { paletteVariantId: 'chromatic' }), 'wild', 200);
        assert.equal(first.replayed, false);
        assert.equal(replay.replayed, true);
        assert.equal(replay.item.storedAt, 100);
        assert.equal(replay.item.pet.paletteVariantId, 'chromatic');
        assert.equal((await listPetSanctuaryCore(store, 'Kakashi')).total, 1);
    });

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
        assert.equal(await removePetFromSanctuaryCore(store, 'Raiko', 'ember-fox:1'), null);
        assert.equal(await getPetFromSanctuaryCore(store, 'Raiko', 'ember-fox:1'), null);
        const listed = await listPetSanctuaryCore(store, 'Raiko');
        assert.equal(listed.total, 1);
        assert.deepEqual(listed.items.map((item) => item.pet.id), ['ember-fox:2']);
    });

    it('compacts empty tail pages so large released collections stay cheap to browse', async () => {
        const store = _makeMemoryKv();
        for (let index = 0; index <= PET_SANCTUARY_PAGE_SIZE; index += 1) await storePetInSanctuaryCore(store, 'Tsunade', pet(index), 'wild', index);
        await removePetFromSanctuaryCore(store, 'Tsunade', `ember-fox:${PET_SANCTUARY_PAGE_SIZE}`);
        const listed = await listPetSanctuaryCore(store, 'Tsunade', { limit: PET_SANCTUARY_PAGE_SIZE });
        assert.equal(listed.items.length, PET_SANCTUARY_PAGE_SIZE);
        assert.equal(listed.nextCursor, null);
    });
});
