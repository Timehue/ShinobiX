import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

/*
 * Presence-first village resolution (api/_viewer-village.ts).
 *
 * The perf contract these tests lock in is NOT "returns the right string" — it
 * is "does not touch the save store when presence can answer". /api/village/intel
 * and /api/village/war-map both resolve the caller's village BEFORE their
 * proc-cache memo, so a save read there is paid on EVERY request; at the intel
 * endpoint's cadence that measured ~21 full-save reads/second (~4 MB/s, avatars
 * included) on the single Railway process. So each test asserts the KV read
 * COUNT, not just the value.
 */

const VILLAGE = 'Frostfang Village';

let viewer: typeof import('./_viewer-village.js');
let kv: typeof import('./_storage.js').kv;
let onlineStore: typeof import('./_realtime/online-store.js').onlineStore;

/** Counts `save:` reads by wrapping kv.get for the duration of one call. */
async function countingSaveReads<T>(run: () => Promise<T>): Promise<{ value: T; saveReads: number }> {
    const original = kv.get.bind(kv);
    let saveReads = 0;
    (kv as unknown as { get: typeof kv.get }).get = ((key: string, ...rest: unknown[]) => {
        if (String(key).startsWith('save:')) saveReads++;
        return (original as (...a: unknown[]) => unknown)(key, ...rest);
    }) as typeof kv.get;
    try {
        return { value: await run(), saveReads };
    } finally {
        (kv as unknown as { get: typeof kv.get }).get = original;
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

async function seedSave(name: string, village: string) {
    await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, village, level: 12 } });
}

describe('viewerVillageOf: presence first, save only on a miss', { concurrency: false }, () => {
    it('an ONLINE player resolves from presence with ZERO save reads', async () => {
        await seedSave('frostwalker', VILLAGE);
        onlineStore.upsert({ name: 'frostwalker', sector: 26, character: { name: 'frostwalker', village: VILLAGE, level: 12 } });

        const { value, saveReads } = await countingSaveReads(() => viewer.viewerVillageOf('frostwalker'));
        assert.equal(value, VILLAGE);
        assert.equal(saveReads, 0, 'presence hit must not read the save blob');
    });

    it('falls back to the SAVE when the player has no presence row at all', async () => {
        await seedSave('ghostwalker', VILLAGE);

        const { value, saveReads } = await countingSaveReads(() => viewer.viewerVillageOf('ghostwalker'));
        assert.equal(value, VILLAGE);
        assert.equal(saveReads, 1, 'presence miss must fall back to exactly one save read');
    });

    it('falls back when presence exists but carries no character (restored snapshot row)', async () => {
        await seedSave('snapwalker', VILLAGE);
        onlineStore.upsert({ name: 'snapwalker', sector: 26, character: null });

        const { value, saveReads } = await countingSaveReads(() => viewer.viewerVillageOf('snapwalker'));
        assert.equal(value, VILLAGE);
        assert.equal(saveReads, 1);
    });

    it('falls back when the presence character has an empty / missing village', async () => {
        await seedSave('halfwalker', VILLAGE);
        onlineStore.upsert({ name: 'halfwalker', sector: 26, character: { name: 'halfwalker', village: '   ', level: 3 } });

        const { value, saveReads } = await countingSaveReads(() => viewer.viewerVillageOf('halfwalker'));
        assert.equal(value, VILLAGE);
        assert.equal(saveReads, 1);
    });

    it('a genuinely villageless player resolves to \'\' (and pays the read, by design)', async () => {
        await seedSave('drifter', '');
        onlineStore.upsert({ name: 'drifter', sector: 26, character: { name: 'drifter', village: '', level: 3 } });

        const { value, saveReads } = await countingSaveReads(() => viewer.viewerVillageOf('drifter'));
        assert.equal(value, '');
        assert.equal(saveReads, 1);
    });

    it('an unknown player is \'\' and an empty name never touches storage', async () => {
        const unknown = await countingSaveReads(() => viewer.viewerVillageOf('nobodyhere'));
        assert.equal(unknown.value, '');
        assert.equal(unknown.saveReads, 1);

        const blank = await countingSaveReads(() => viewer.viewerVillageOf('   '));
        assert.equal(blank.value, '');
        assert.equal(blank.saveReads, 0, 'an unusable name must short-circuit before any read');
    });

    it('resolves a display-cased name through the same slug the presence store keys on', async () => {
        onlineStore.upsert({ name: 'Frost-Walker', sector: 26, character: { name: 'Frost-Walker', village: VILLAGE } });
        const { value, saveReads } = await countingSaveReads(() => viewer.viewerVillageOf('Frost-Walker'));
        assert.equal(value, VILLAGE);
        assert.equal(saveReads, 0);
    });

    it('presenceVillageOf alone never reads storage, hit or miss', async () => {
        await seedSave('frostwalker', VILLAGE);
        onlineStore.upsert({ name: 'frostwalker', sector: 26, character: { name: 'frostwalker', village: VILLAGE } });
        assert.equal(viewer.presenceVillageOf('frostwalker'), VILLAGE);
        assert.equal(viewer.presenceVillageOf('ghostwalker'), '');
    });
});
