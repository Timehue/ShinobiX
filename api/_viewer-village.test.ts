import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

/*
 * Village resolution for members-only views (api/_viewer-village.ts).
 *
 * Two contracts. AUTHORITY: the answer is the village the SAVE records, never
 * the client-supplied presence row, because /api/village/intel,
 * /api/village/war-map and /api/village/state serve a village's internals only
 * to its members. COST: the save is read as a database-side projection, never
 * as the whole ~200 KB row, because intel and war-map resolve the caller on
 * every request (it once measured ~21 full-save reads/second). So the tests
 * assert what was read, not just the value.
 */

const VILLAGE = 'Frostfang Village';
const OTHER = 'Emberfall Village';

let viewer: typeof import('./_viewer-village.js');
let kv: typeof import('./_storage.js').kv;
let onlineStore: typeof import('./_realtime/online-store.js').onlineStore;

type Reads = { fullSaveReads: number; projectedKeys: string[][]; projections: unknown[] };

/**
 * Runs `run` with a Postgres-style `mgetProjected` installed (the memory store
 * has none), counting every full `save:` read through get/mget meanwhile.
 */
async function withProjectedStore<T>(run: () => Promise<T>): Promise<{ value: T } & Reads> {
    const store = kv as unknown as Record<string, unknown>;
    const originalGet = kv.get.bind(kv);
    const originalMget = kv.mget.bind(kv);
    const reads: Reads = { fullSaveReads: 0, projectedKeys: [], projections: [] };
    store.get = ((key: string, ...rest: unknown[]) => {
        if (String(key).startsWith('save:')) reads.fullSaveReads++;
        return (originalGet as (...a: unknown[]) => unknown)(key, ...rest);
    }) as typeof kv.get;
    store.mget = ((...keys: string[]) => {
        reads.fullSaveReads += keys.filter((key) => String(key).startsWith('save:')).length;
        return (originalMget as (...a: unknown[]) => unknown)(...keys);
    }) as typeof kv.mget;
    store.mgetProjected = async (keys: string[], projection: Record<string, readonly string[]>) => {
        reads.projectedKeys.push(keys);
        reads.projections.push(projection);
        const { projectKvValue } = await import('./_storage-projection.js');
        const values = await originalMget(...keys);
        return values.map((value) => projectKvValue(value, projection));
    };
    try {
        return { value: await run(), ...reads };
    } finally {
        store.get = originalGet;
        store.mget = originalMget;
        delete store.mgetProjected;
    }
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ onlineStore } = await import('./_realtime/online-store.js'));
    viewer = await import('./_viewer-village.js');
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const p of onlineStore.list()) onlineStore.remove(p.name);
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const p of onlineStore.list()) onlineStore.remove(p.name);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function seedSave(name: string, village: unknown) {
    await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, village, level: 12 } });
}

describe('viewerVillageOf: the SAVE decides, read as a projection', { concurrency: false }, () => {
    it('a village claimed in the presence row never wins over the save', async () => {
        await seedSave('frostwalker', VILLAGE);
        onlineStore.upsert({ name: 'frostwalker', sector: 26, character: { name: 'frostwalker', village: OTHER, level: 12 } });

        const { value } = await withProjectedStore(() => viewer.viewerVillageOf('frostwalker'));
        assert.equal(value, VILLAGE, 'presence is client-supplied; members-only views must read the save');
    });

    it('reads only character.village, never the whole save', async () => {
        await seedSave('frostwalker', VILLAGE);
        onlineStore.upsert({ name: 'frostwalker', sector: 26, character: { name: 'frostwalker', village: VILLAGE, level: 12 } });

        const { value, fullSaveReads, projectedKeys, projections } = await withProjectedStore(() => viewer.viewerVillageOf('frostwalker'));
        assert.equal(value, VILLAGE);
        assert.equal(fullSaveReads, 0, 'the ~200 KB save row must not be transferred');
        assert.deepEqual(projectedKeys, [['save:frostwalker']]);
        assert.deepEqual(projections, [{ village: ['character', 'village'] }]);
    });

    it('answers a player with no presence row at all from the save', async () => {
        await seedSave('ghostwalker', VILLAGE);
        const { value } = await withProjectedStore(() => viewer.viewerVillageOf('ghostwalker'));
        assert.equal(value, VILLAGE);
    });

    it('also works on a store without projection support (whole-row fallback)', async () => {
        await seedSave('ghostwalker', VILLAGE);
        assert.equal(await viewer.viewerVillageOf('ghostwalker'), VILLAGE);
    });

    it('a villageless, unknown or malformed save resolves to \'\'', async () => {
        await seedSave('drifter', '');
        await seedSave('oddwalker', { name: VILLAGE });
        await seedSave('padwalker', `  ${VILLAGE}  `);
        await withProjectedStore(async () => {
            assert.equal(await viewer.viewerVillageOf('drifter'), '');
            assert.equal(await viewer.viewerVillageOf('nobodyhere'), '');
            assert.equal(await viewer.viewerVillageOf('oddwalker'), '', 'a non-string village is no village');
            assert.equal(await viewer.viewerVillageOf('padwalker'), VILLAGE);
        });
    });

    it('an unusable name never touches storage', async () => {
        const { value, fullSaveReads, projectedKeys } = await withProjectedStore(() => viewer.viewerVillageOf('   '));
        assert.equal(value, '');
        assert.equal(fullSaveReads, 0);
        assert.deepEqual(projectedKeys, []);
    });

    it('resolves a display-cased name through the save slug', async () => {
        await seedSave('frost-walker', VILLAGE);
        const { value, projectedKeys } = await withProjectedStore(() => viewer.viewerVillageOf('Frost-Walker'));
        assert.equal(value, VILLAGE);
        assert.deepEqual(projectedKeys, [['save:frost-walker']]);
    });
});
