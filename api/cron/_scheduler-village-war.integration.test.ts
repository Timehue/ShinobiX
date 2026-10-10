import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
delete process.env.DISABLE_VILLAGE_WAR;

/*
 * The village-war daily pass, driven through the scheduler's real catch-up tick
 * on the real storage adapter (memory KV) and the real job lease.
 *
 * Two failures this pins:
 *   - The 03:00 UTC timer was the ONLY way the pass ran, so a restart spanning
 *     03:00 skipped the village-war day outright.
 *   - The day's lease was held for 20 hours after ANY run, so a village that
 *     failed (here: its war-record lock is held by another writer) stayed unpaid
 *     until the next day.
 * The clock is mocked (Date only) so the 03:00 boundary is deterministic.
 */

type Store = typeof import('../_storage.js').kv;
type Rec = { warResources: number; lastWarPassDate: string };

const FROST = 'Frostfang Village';
const DAY_ONE = Date.UTC(2026, 9, 8, 4, 0, 0);

let kv: Store;
let scheduler: typeof import('./_scheduler.js');
let daily: typeof import('../_war-daily.js');
let warState: typeof import('../_war-state.js');
let sectors: typeof import('../_war-map-sectors.js');
let background: typeof import('../_background-work.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    scheduler = await import('./_scheduler.js');
    daily = await import('../_war-daily.js');
    warState = await import('../_war-state.js');
    sectors = await import('../_war-map-sectors.js');
    background = await import('../_background-work.js');
});

after(async () => {
    mock.timers.reset();
    await background.drainBackgroundWork();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function wr(village: string): Promise<number | undefined> {
    return (await kv.get<Rec>(warState.villageWarKey(village)))?.warResources;
}
async function seals(village: string): Promise<number | undefined> {
    const state = await kv.get<{ treasury?: { honorSeals?: number } }>(`game:village-state:${warState.villageWarSlug(village)}`);
    return state?.treasury?.honorSeals;
}

test('a restart across 03:00 catches the day up, a failed village is retried, and nothing is paid twice', async () => {
    mock.timers.enable({ apis: ['Date'], now: DAY_ONE });
    // Another writer holds Frostfang's war record for the whole first run.
    const frostLock = `lock:${warState.villageWarKey(FROST)}`;
    try {
        for (const village of sectors.WAR_VILLAGES) {
            for (const sector of sectors.homeSectorsForVillage(village)) {
                await kv.set(`world:territory:${sector}`, { sector, ownerVillage: village });
            }
        }
        await kv.set(frostLock, 'another-writer', { nx: true, ex: 600 });

        // Boot after 03:00 with no pass recorded today: the catch-up runs it.
        await scheduler.fireVillageWarDailyCatchUp();
        for (const village of sectors.WAR_VILLAGES) {
            if (village === FROST) continue;
            assert.equal(await wr(village), 200, `${village} is paid by the catch-up`);
            assert.equal(await seals(village), 8);
        }
        assert.equal(await wr(FROST), undefined, 'the contended village is not paid yet');
        assert.equal(await kv.get(`cron:lease:village-war-daily`), null, 'an unfinished day releases its lease');
        assert.equal(await kv.get(daily.VILLAGE_WAR_DAILY_MARKER_KEY), null);

        // The writer lets go; the next tick finishes Frostfang and only Frostfang.
        await kv.del(frostLock);
        await scheduler.fireVillageWarDailyCatchUp();
        for (const village of sectors.WAR_VILLAGES) {
            assert.equal(await wr(village), 200, `${village} is paid exactly once`);
            assert.equal(await seals(village), 8, `${village} seals exactly once`);
        }
        assert.deepEqual(await kv.get(daily.VILLAGE_WAR_DAILY_MARKER_KEY), { date: '2026-10-08', at: DAY_ONE });
        assert.ok(await kv.get(`cron:lease:village-war-daily`), 'a complete day holds its lease');

        // A finished day is a no-op for every later tick.
        await scheduler.fireVillageWarDailyCatchUp();
        assert.equal(await wr(FROST), 200);

        // Before 03:00 the next day nothing runs; after it, the next day is paid.
        mock.timers.setTime(Date.UTC(2026, 9, 9, 2, 0, 0));
        await scheduler.fireVillageWarDailyCatchUp();
        assert.equal(await wr(FROST), 200, 'never a day early');
        mock.timers.setTime(Date.UTC(2026, 9, 9, 3, 30, 0));
        await scheduler.fireVillageWarDailyCatchUp();
        for (const village of sectors.WAR_VILLAGES) {
            assert.equal(await wr(village), 400, `${village} is paid for the second day`);
            assert.equal(await seals(village), 16);
        }
    } finally {
        // Settle the telemetry the passes queued while the clock is still the
        // mocked one, then hand the real clock back.
        await background.drainBackgroundWork();
        await kv.del(frostLock).catch(() => undefined);
        mock.timers.reset();
    }
});
