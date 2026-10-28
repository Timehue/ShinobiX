import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

test('sector discovery reads only local camp display fields and immediately reflects reconnects and KOs', async t => {
    const { kv } = await import('../_storage.js');
    const { setSleeperCamp, clearSleeperCamp, SLEEPER_CAMPS_KEY } = await import('../_realtime/sleeper-camps.js');
    const { onlineStore } = await import('../_realtime/online-store.js');
    const { sectorSleepers } = await import('./_sector-sleepers.js');
    const { projectKvValue } = await import('../_storage-projection.js');
    const camp = (name: string, sector = 22) => ({ name, displayName: name, sector, createdAt: 10 });
    const save = { character: { name: 'Shadow Fox', level: 20, village: 'Ashen Leaf Village',
        specialty: 'Ninjutsu', ryo: 12345, inventory: ['secret'], avatarImage: 'x'.repeat(100_000) },
        creatorEvents: ['y'.repeat(100_000)] };
    await kv.del(SLEEPER_CAMPS_KEY);
    await setSleeperCamp(camp('shadowfox'));
    await setSleeperCamp(camp('othersector', 23));
    let reads = 0;
    t.after(() => { delete kv.mgetProjected; });
    kv.mgetProjected = async (keys, projection) => {
        reads++;
        assert.deepEqual(keys, ['save:shadowfox']);
        return keys.map(() => projectKvValue(save, projection));
    };
    const concurrent = await Promise.all(Array.from({ length: 20 }, () => sectorSleepers(22)));
    const [row] = concurrent[0];
    assert.ok(concurrent.every(rows => rows === concurrent[0]), 'concurrent sector reads share one build');
    assert.equal(row.name, 'Shadow Fox');
    assert.equal(row.sleeping, true);
    assert.equal(row.currentSector, 22);
    assert.ok(JSON.stringify(row).length < 400, 'no inventory, art blobs or full character transfer');
    assert.equal(JSON.stringify(row).includes('secret'), false);
    assert.deepEqual(await sectorSleepers(22), concurrent[0], 'repeat polls reuse display fields, not membership');
    assert.deepEqual(await sectorSleepers(24), []);
    assert.equal(reads, 1, 'twenty concurrent callers share one save projection; empty sectors read none');

    onlineStore.upsert({ name: 'shadowfox', sector: 22, character: { name: 'Shadow Fox' } });
    assert.deepEqual(await sectorSleepers(22), [], 'live wins even before camp cleanup');
    onlineStore.remove('shadowfox');
    await clearSleeperCamp('shadowfox');
    assert.deepEqual(await sectorSleepers(22), [], 'KO immediately removes discovery');

    await setSleeperCamp({ ...camp('shadowfox'), createdAt: 11 });
    kv.mgetProjected = async (_keys, projection) => {
        await clearSleeperCamp('shadowfox');
        return [projectKvValue(save, projection)];
    };
    assert.deepEqual(await sectorSleepers(22), [], 'a KO racing the save read cannot resurrect the camp');
});

test('sector roster bypasses the all-player cache, validates sectors and disables HTTP caching', async () => {
    const handler = (await import('./roster.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    let code = 0, body: unknown, cache = '';
    const res = { setHeader(key: string, value: string) { if (key === 'Cache-Control') cache = value; },
        status(value: number) { code = value; return this; }, json(value: unknown) { body = value; }, end() {} };
    for (const sector of ['22', '66', '99']) {
        await handler({ method: 'GET', query: { sector }, headers: {} } as never, res as never);
        assert.equal(code, 200);
        assert.equal(cache, 'no-store');
        assert.deepEqual(body, { sector: Number(sector), sleepers: [] });
    }
    for (const sector of ['0', '-1', '22.5', 'NaN', '67', ['22']]) {
        await handler({ method: 'GET', query: { sector }, headers: {} } as never, res as never);
        assert.equal(code, 400);
    }
});
