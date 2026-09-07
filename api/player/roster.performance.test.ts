import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

test('roster projection preserves settled vitals, travel, public profile and pet eligibility without full save transfer', async t => {
    const { kv } = await import('../_storage.js');
    const { projectKvValue } = await import('../_storage-projection.js');
    const { __clearProcCache } = await import('../_proc-cache.js');
    const { WORLD_GEO_VERSION } = await import('../../shared/sector-geo.js');
    const handler = (await import('./roster.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    __clearProcCache();
    t.after(__clearProcCache);
    const now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const character = {
        name: 'ProjectionNinja', level: 20, village: 'Stormveil Village', specialty: 'Ninjutsu',
        hp: 5, maxHp: 100, chakra: 4, maxChakra: 100, stamina: 3, maxStamina: 100,
        ryo: 999, stats: {}, inventory: ['private-item'], pets: [],
        nindo: 'Stay true.', nindoBg: 'moon',
    };
    const save = {
        character, worldGeoV: WORLD_GEO_VERSION, currentSector: 39,
        pendingTravel: { destinationSector: 40, arrivalAt: Date.now() - 10_000 },
        // Live main settles regeneration from its independent cursor, even
        // when an unrelated write refreshed the general save timestamp.
        _saveAt: now, _regenAt: now - 10_000, _saveVersion: 9,
        creatorEvents: [{ script: 'x'.repeat(100_000) }], savedImages: { private: 'large' },
    };
    await kv.set('save:projectionninja', save);
    await kv.hset('player:registry', { projectionninja: { name: 'ProjectionNinja', level: 20 } });
    let projections = 0;
    kv.mgetProjected = async (keys, projection) => {
        projections++;
        assert.deepEqual(keys, ['save:projectionninja']);
        const projected = projectKvValue(save, projection)!;
        assert.equal(projected._regenAt, save._regenAt);
        assert.ok(!('creatorEvents' in projected) && !('savedImages' in projected));
        return [projected];
    };
    t.after(() => { delete kv.mgetProjected; });
    let body: { players: Array<Record<string, unknown>> } | undefined;
    const res = { setHeader() {}, status() { return this; }, json(value: typeof body) { body = value; }, end() {} };
    await handler({ method: 'GET', query: {}, headers: {} } as never, res as never);
    assert.equal(projections, 1);
    const player = body!.players[0];
    const publicChar = player.character as Record<string, unknown>;
    assert.equal(publicChar.nindo, 'Stay true.');
    assert.ok(Number(publicChar.hp) >= 15);
    assert.ok(!('ryo' in publicChar) && !('inventory' in publicChar));
    assert.equal(player.currentSector, 40);
    assert.equal(player.sleeping, true);
    assert.deepEqual(player.eligiblePets, []);
    assert.deepEqual(await kv.get('save:projectionninja'), save, 'read projection must not replace the save');
});
