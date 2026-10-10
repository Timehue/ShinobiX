import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

/*
 * The daily pass's LIVE at-war check (no injected isAtWar), on the real storage
 * adapter. It used to end in `catch { return false; }`: any error reading the
 * village-war or sector-war rows read as "at peace", and the pass then zeroed the
 * village's Ramparts and Watchtower — a defender's paid fortifications wiped in
 * the middle of its war by a transient scan error. It now fails CLOSED.
 */

type Store = typeof import('./_storage.js').kv;
type Rec = { structures: Record<string, number>; lastWarPassDate: string };

const FROST = 'Frostfang Village';
const NOW = Date.UTC(2026, 9, 8, 4, 0, 0);

let kv: Store;
let daily: typeof import('./_war-daily.js');
let warState: typeof import('./_war-state.js');
let background: typeof import('./_background-work.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    daily = await import('./_war-daily.js');
    warState = await import('./_war-state.js');
    background = await import('./_background-work.js');
});

after(async () => {
    await background.drainBackgroundWork();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

test('a failed war scan keeps the per-war structures instead of resetting them', async () => {
    const key = warState.villageWarKey(FROST);
    const base = warState.defaultVillageWarRecord(FROST);
    await kv.set(key, { ...base, warResources: 1_000, structures: { ...base.structures, ramparts: 7, watchtower: 4 } });

    const realKeys = kv.keys.bind(kv);
    kv.keys = (async (pattern: string) => {
        // The village-war rows (world-state) and the sector-war rows both fail to scan.
        if (pattern.startsWith('world:war:') || pattern.startsWith('shared:sector-war:')) throw new Error('war scan down');
        return realKeys(pattern);
    }) as typeof kv.keys;
    try {
        await daily.runVillageWarDailyPass({ now: NOW, enabled: true, sweepSectorWars: async () => [], storesEnabled: false });
    } finally {
        kv.keys = realKeys;
    }

    const rec = await kv.get<Rec>(key);
    assert.equal(rec?.structures.ramparts, 7, 'a transient scan error must not wipe paid Ramparts');
    assert.equal(rec?.structures.watchtower, 4, 'nor the Watchtower');
    assert.equal(rec?.lastWarPassDate, '2026-10-08', 'the day itself is still paid');
});
