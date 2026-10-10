import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    defaultVillageWarRecord,
    stepVillageWarDay,
    villageWarKey,
    STRUCTURE_KEYS,
    type VillageWarRecord,
} from './_war-state.js';
import { WR_POOL_CAP } from './_war-economy.js';
import { runVillageWarDailyPass } from './_war-daily.js';
import { WAR_VILLAGES } from './_war-map-sectors.js';

const NOW = Date.UTC(2026, 5, 29, 4, 0, 0); // a fixed timestamp (after 03:00 UTC)
const TODAY = '2026-06-29';

function withStructures(village: string, level: number): VillageWarRecord {
    const r = defaultVillageWarRecord(village);
    for (const k of STRUCTURE_KEYS) r.structures[k] = level;
    return r;
}

describe('stepVillageWarDay (pure)', () => {
    it('accrues WR for 8 held sectors and stamps the day', () => {
        const { record, summary } = stepVillageWarDay(defaultVillageWarRecord('Frostfang Village'), {
            sectorsControlled: 8, today: TODAY, now: NOW,
        });
        assert.equal(summary.ran, true);
        assert.equal(summary.wrAccrued, 200);
        assert.equal(record.warResources, 200);
        assert.equal(record.dormant, false);
        assert.equal(record.lastWarPassDate, TODAY);
    });

    it('is idempotent — a same-day re-run is a no-op', () => {
        const first = stepVillageWarDay(defaultVillageWarRecord('Frostfang Village'), { sectorsControlled: 8, today: TODAY, now: NOW });
        const second = stepVillageWarDay(first.record, { sectorsControlled: 8, today: TODAY, now: NOW });
        assert.equal(second.summary.ran, false);
        assert.equal(second.record.warResources, 200); // unchanged
        assert.equal(second.record, first.record);      // same reference, untouched
    });

    it('pays structure upkeep when affordable', () => {
        // 6× L5 = 90 upkeep; 8 sectors accrue 200 → pool 200 − 90 = 110, active.
        const { record, summary } = stepVillageWarDay(withStructures('Frostfang Village', 5), { sectorsControlled: 8, today: TODAY, now: NOW });
        assert.equal(summary.maintenanceOwed, 90);
        assert.equal(summary.maintenancePaid, 90);
        assert.equal(summary.dormant, false);
        assert.equal(record.warResources, 110);
        assert.equal(record.dormant, false);
    });

    it('mothballs (dormant) when upkeep is unaffordable, retaining WR', () => {
        // 6× L10 = 216 upkeep; 8 sectors accrue 200 → pool 200 < 216 → dormant, no pay.
        const { record, summary } = stepVillageWarDay(withStructures('Frostfang Village', 10), { sectorsControlled: 8, today: TODAY, now: NOW });
        assert.equal(summary.maintenanceOwed, 216);
        assert.equal(summary.maintenancePaid, 0);
        assert.equal(summary.dormant, true);
        assert.equal(record.warResources, 200);  // WR kept to recover
        assert.equal(record.dormant, true);
    });

    it('caps the WR pool at WR_POOL_CAP', () => {
        const seeded = { ...defaultVillageWarRecord('Frostfang Village'), warResources: WR_POOL_CAP - 50 };
        const { record } = stepVillageWarDay(seeded, { sectorsControlled: 8, today: TODAY, now: NOW });
        assert.equal(record.warResources, WR_POOL_CAP); // 4950 + 200 clamped to 5000
    });

    it('honors a Supply-Depot-boosted per-sector WR rate', () => {
        // wrPerSector 30 (depot L10) × 8 sectors = 240 accrued instead of 200.
        const { record, summary } = stepVillageWarDay(defaultVillageWarRecord('Frostfang Village'), {
            sectorsControlled: 8, today: TODAY, now: NOW, wrPerSector: 30,
        });
        assert.equal(summary.wrAccrued, 240);
        assert.equal(record.warResources, 240);
    });

    it('expires merc leases past their window', () => {
        const seeded: VillageWarRecord = {
            ...defaultVillageWarRecord('Frostfang Village'),
            mercLeases: [
                { tierId: 'merc-ronin', player: 'a', expiresAt: NOW - 1, count: 3 },   // expired
                { tierId: 'merc-oni', player: 'b', expiresAt: NOW + 100000, count: 4 }, // active
            ],
        };
        const { record, summary } = stepVillageWarDay(seeded, { sectorsControlled: 8, today: TODAY, now: NOW });
        assert.equal(summary.mercsExpired, 1);
        assert.equal(record.mercLeases.length, 1);
        assert.equal(record.mercLeases[0].tierId, 'merc-oni');
    });
});

function memStore() {
    const m = new Map<string, unknown>();
    return {
        m,
        get: async <T = unknown>(k: string): Promise<T | null> => (m.has(k) ? (m.get(k) as T) : null),
        set: async (k: string, v: unknown) => { m.set(k, v); return 'OK'; },
        // Territory-scan surface (HeldSectorStore) so the daily pass reads held
        // sectors from THIS store and never touches live storage in unit tests.
        keys: async (pattern: string): Promise<string[]> => {
            const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
            return [...m.keys()].filter((k) => k.startsWith(prefix));
        },
        mget: async (...keys: string[]): Promise<unknown[]> => keys.map((k) => (m.has(k) ? m.get(k) : null)),
    };
}

/** Seed `world:territory:<sector>` ownership rows into a memStore. */
function seedTerritory(store: ReturnType<typeof memStore>, owners: Record<number, string>) {
    for (const [sector, ownerVillage] of Object.entries(owners)) {
        store.m.set(`world:territory:${sector}`, { sector: Number(sector), ownerVillage });
    }
}
const passthroughLock = <T>(_k: string, fn: () => Promise<T>) => fn();
/** The live sweep scans real storage; unit tests stub it out. */
const noSweep = async (): Promise<unknown[]> => [];

describe('runVillageWarDailyPass (orchestration)', () => {
    it('no-ops when explicitly disabled', async () => {
        const store = memStore();
        const r = await runVillageWarDailyPass({ store, lock: passthroughLock, sweepSectorWars: noSweep, now: NOW, enabled: false });
        assert.deepEqual(r, { enabled: false, processed: 0, ran: 0, sealsAccrued: 0, sectorWarsSettled: 0, failed: [], complete: true });
        assert.equal(store.m.size, 0, 'not even the done-marker: switching the pass back on the same day still runs it');
    });

    it('scales the WR + seal faucet to sectors ACTUALLY held, not the home table', async () => {
        // Frostfang has been pushed down to 2 sectors; Moonshadow occupies 11
        // (its own 8 + 3 conquered). Income must follow the live territory rows.
        const store = memStore();
        const owners: Record<number, string> = {};
        for (const s of [26, 27]) owners[s] = 'Frostfang Village';
        for (const s of [17, 18, 19, 20, 21, 22, 23, 24, 28, 29, 30]) owners[s] = 'Moonshadow Village';
        seedTerritory(store, owners);

        const r = await runVillageWarDailyPass({ store, lock: passthroughLock, sweepSectorWars: noSweep, now: NOW, enabled: true });
        assert.equal(r.enabled, true);

        const frost = store.m.get(villageWarKey('Frostfang Village')) as VillageWarRecord;
        const moon = store.m.get(villageWarKey('Moonshadow Village')) as VillageWarRecord;
        assert.equal(frost.warResources, 50, '2 sectors × 25 WR');
        assert.equal(moon.warResources, 275, '11 sectors × 25 WR — conquest pays, uncapped');

        // A village holding nothing earns nothing (it also stops paying upkeep it can't afford).
        const ashen = store.m.get(villageWarKey('Ashen Leaf Village')) as VillageWarRecord;
        assert.equal(ashen.warResources, 0, 'holds no sectors → no faucet');

        // Seals mirror the same count: 2 + 11 + 0 + 0.
        assert.equal(r.sealsAccrued, 13);
        const frostTreasury = store.m.get('game:village-state:frostfangvillage') as { treasury?: { honorSeals?: number } };
        assert.equal(frostTreasury.treasury?.honorSeals, 2);
    });

    it('settles due sector wars BEFORE paying income, so a captured sector pays its new owner', async () => {
        const store = memStore();
        const owners: Record<number, string> = {};
        for (const s of [26, 27]) owners[s] = 'Frostfang Village';
        for (const s of [17, 18, 19, 20, 21, 22, 23, 24]) owners[s] = 'Moonshadow Village';
        seedTerritory(store, owners);
        // The due war's verdict: Moonshadow takes sector 26 from Frostfang.
        const sweep = async (): Promise<unknown[]> => {
            store.m.set('world:territory:26', { sector: 26, ownerVillage: 'Moonshadow Village' });
            return [{ sector: 26 }];
        };

        const r = await runVillageWarDailyPass({ store, lock: passthroughLock, sweepSectorWars: sweep, now: NOW, enabled: true });
        assert.equal(r.sectorWarsSettled, 1);
        assert.equal((store.m.get(villageWarKey('Frostfang Village')) as VillageWarRecord).warResources, 25, 'the loser keeps 1 sector');
        assert.equal((store.m.get(villageWarKey('Moonshadow Village')) as VillageWarRecord).warResources, 225, 'the winner is paid for 9');
    });

    it('still pays income when the sector-war settlement sweep fails', async () => {
        const store = memStore();
        const failingSweep = async (): Promise<unknown[]> => { throw new Error('settle down'); };
        const r = await runVillageWarDailyPass({ store, lock: passthroughLock, sweepSectorWars: failingSweep, now: NOW, enabled: true });
        assert.equal(r.sectorWarsSettled, 0);
        assert.equal(r.ran, 4);
    });

    it('falls back to the home-sector baseline when territory is unseeded', async () => {
        // No world:territory:* rows at all = the pre-launch/unseeded world. The
        // faucet must NOT silently switch off world-wide.
        const store = memStore();
        const r = await runVillageWarDailyPass({ store, lock: passthroughLock, sweepSectorWars: noSweep, now: NOW, enabled: true });
        assert.equal(r.sealsAccrued, 32, '4 villages × 8 home sectors');
        for (const v of WAR_VILLAGES) {
            assert.equal((store.m.get(villageWarKey(v)) as VillageWarRecord).warResources, 200);
        }
    });

    it('processes all 4 villages and is idempotent across same-day runs', async () => {
        const store = memStore();
        const first = await runVillageWarDailyPass({ store, lock: passthroughLock, sweepSectorWars: noSweep, now: NOW, enabled: true });
        assert.equal(first.enabled, true);
        assert.equal(first.processed, WAR_VILLAGES.length);
        assert.equal(first.ran, 4);
        // Each village got a record with 200 WR accrued (8 home sectors, no structures).
        for (const v of WAR_VILLAGES) {
            const rec = store.m.get(villageWarKey(v)) as VillageWarRecord;
            assert.ok(rec, `${v} record written`);
            assert.equal(rec.warResources, 200);
            assert.equal(rec.lastWarPassDate, TODAY);
        }
        // Seals accrue to each village treasury (8 sectors × 1 seal = 8 each; 32 total).
        assert.equal(first.sealsAccrued, 32);
        const frostTreasury = store.m.get('game:village-state:frostfangvillage') as { treasury?: { honorSeals?: number } };
        assert.equal(frostTreasury.treasury?.honorSeals, 8);

        // Same-day re-run: nothing changes (WR or seals).
        const second = await runVillageWarDailyPass({ store, lock: passthroughLock, sweepSectorWars: noSweep, now: NOW, enabled: true });
        assert.equal(second.ran, 0);
        assert.equal(second.sealsAccrued, 0);
        for (const v of WAR_VILLAGES) {
            assert.equal((store.m.get(villageWarKey(v)) as VillageWarRecord).warResources, 200);
        }
        assert.equal((store.m.get('game:village-state:frostfangvillage') as { treasury?: { honorSeals?: number } }).treasury?.honorSeals, 8);
    });

    it('accrues again on the next day', async () => {
        const store = memStore();
        await runVillageWarDailyPass({ store, lock: passthroughLock, sweepSectorWars: noSweep, now: NOW, enabled: true });
        const nextDay = await runVillageWarDailyPass({ store, lock: passthroughLock, sweepSectorWars: noSweep, now: NOW + 24 * 3600 * 1000, enabled: true });
        assert.equal(nextDay.ran, 4);
        const rec = store.m.get(villageWarKey('Frostfang Village')) as VillageWarRecord;
        assert.equal(rec.warResources, 400); // 200 + 200
    });

    it('resets per-war structures (Ramparts/Watchtower) at peace, keeps them at war', async () => {
        const base = defaultVillageWarRecord('Frostfang Village');
        // Seed Frostfang with per-war + a permanent structure and a WR pool that
        // covers any upkeep — this isolates the reset behaviour.
        const seed = (): VillageWarRecord => ({ ...base, warResources: 1_000, structures: { ...base.structures, ramparts: 8, watchtower: 6, barracks: 5 } });

        const peaceStore = memStore();
        peaceStore.m.set(villageWarKey('Frostfang Village'), seed());
        await runVillageWarDailyPass({ store: peaceStore, lock: passthroughLock, sweepSectorWars: noSweep, now: NOW, enabled: true, isAtWar: async () => false });
        const atPeace = peaceStore.m.get(villageWarKey('Frostfang Village')) as VillageWarRecord;
        assert.equal(atPeace.structures.ramparts, 0);   // per-war wiped
        assert.equal(atPeace.structures.watchtower, 0);  // per-war wiped
        assert.equal(atPeace.structures.barracks, 5);    // permanent kept

        const warStore = memStore();
        warStore.m.set(villageWarKey('Frostfang Village'), seed());
        await runVillageWarDailyPass({ store: warStore, lock: passthroughLock, sweepSectorWars: noSweep, now: NOW, enabled: true, isAtWar: async () => true });
        const atWar = warStore.m.get(villageWarKey('Frostfang Village')) as VillageWarRecord;
        assert.equal(atWar.structures.ramparts, 8);   // held while at war
        assert.equal(atWar.structures.watchtower, 6);
    });

    it('a same-day re-run never wipes fortifications bought after the day was stepped', async () => {
        // The pass now re-runs to finish unfinished days; only the run that steps
        // the day may reset, or a retry would erase a purchase made since 03:00.
        const base = defaultVillageWarRecord('Frostfang Village');
        const store = memStore();
        store.m.set(villageWarKey('Frostfang Village'), { ...base, lastWarPassDate: TODAY, structures: { ...base.structures, ramparts: 3 } });
        await runVillageWarDailyPass({ store, lock: passthroughLock, sweepSectorWars: noSweep, now: NOW, enabled: true, isAtWar: async () => false });
        assert.equal((store.m.get(villageWarKey('Frostfang Village')) as VillageWarRecord).structures.ramparts, 3);
    });
});

const FROST = 'Frostfang Village';
const FROST_STATE = 'game:village-state:frostfangvillage';
const frostRecord = (store: ReturnType<typeof memStore>) => store.m.get(villageWarKey(FROST)) as VillageWarRecord | undefined;
const treasuryOf = (store: ReturnType<typeof memStore>, village: string) =>
    ((store.m.get(`game:village-state:${village.toLowerCase().replace(/[^a-z0-9]/g, '')}`) as { treasury?: Record<string, unknown> } | undefined)?.treasury ?? {});

/** A memStore whose `set` throws for the keys `failOn` picks, while `armed()`. */
function failingStore(failOn: (key: string) => boolean) {
    const store = memStore();
    const set = store.set;
    let armed = true;
    return Object.assign(store, {
        disarm: () => { armed = false; },
        set: async (k: string, v: unknown) => {
            if (armed && failOn(k)) throw new Error(`KV blip on ${k}`);
            return set(k, v);
        },
    });
}

/** The full set of non-live deps (stores ON, nothing scanned from live storage). */
function passDeps(store: ReturnType<typeof memStore>, over: Record<string, unknown> = {}) {
    return {
        store, lock: passthroughLock, sweepSectorWars: noSweep, now: NOW, enabled: true,
        isAtWar: async () => false,
        storesEnabled: true, listSectorWars: async () => [], listClanWars: async () => [], notifyUnfed: async () => {},
        ...over,
    };
}

describe('runVillageWarDailyPass — only the 32 war sectors pay (bug: non-war sectors inflated the economy)', () => {
    it('a central, special or wilderness row stamped with a village pays it nothing', async () => {
        const store = memStore();
        const owners: Record<number, string> = {};
        for (const s of [26, 27, 28, 29, 30, 31, 32, 33]) owners[s] = FROST;
        // Clan captures (or the territory endpoint) stamped Frostfang on these.
        for (const s of [25, 34, 40, 47, 51, 54, 60, 99]) owners[s] = FROST;
        seedTerritory(store, owners);
        const r = await runVillageWarDailyPass(passDeps(store, { storesEnabled: false }));
        assert.equal(frostRecord(store)?.warResources, 200, '8 war sectors × 25 WR, not 16');
        assert.equal(treasuryOf(store, FROST).honorSeals, 8, '8 seals, not 16');
        assert.equal(r.complete, true);
    });

    it('pays exactly the count the War Map displays — a suspended war sector is excluded from both', async () => {
        const { loadHeldSectorCounts } = await import('./_war-held-sectors.js');
        const store = memStore();
        const owners: Record<number, string> = {};
        for (const s of [26, 27, 28, 29, 30, 31, 32, 33]) owners[s] = FROST;
        seedTerritory(store, owners);
        store.m.set('world:territory:27', { sector: 27, ownerVillage: FROST, ownerClan: 'Frost', rewardSuspendedAt: NOW - 1 });
        const displayed = await loadHeldSectorCounts(store, { now: NOW });
        await runVillageWarDailyPass(passDeps(store, { storesEnabled: false }));
        assert.equal(displayed[FROST], 7);
        assert.equal(frostRecord(store)?.warResources, displayed[FROST] * 25);
        assert.equal(treasuryOf(store, FROST).honorSeals, displayed[FROST]);
    });
});

describe('runVillageWarDailyPass — partial failures are finished by a re-run, exactly once', () => {
    it('seals whose credit failed land on a same-day re-run, and only once', async () => {
        const store = failingStore((k) => k === FROST_STATE);
        const first = await runVillageWarDailyPass(passDeps(store, { storesEnabled: false }));
        assert.equal(frostRecord(store)?.lastWarPassDate, TODAY, 'the war record was stamped');
        assert.equal(treasuryOf(store, FROST).honorSeals, undefined, 'the seal credit did not land');

        store.disarm();
        const second = await runVillageWarDailyPass(passDeps(store, { storesEnabled: false }));
        // Before the fix the stamped record gated the seals off for the day.
        assert.equal(treasuryOf(store, FROST).honorSeals, 8, 'the day\'s seals land on the re-run');
        assert.equal(frostRecord(store)?.warResources, 200, 'WR is not paid twice');
        const third = await runVillageWarDailyPass(passDeps(store, { storesEnabled: false }));
        assert.equal(treasuryOf(store, FROST).honorSeals, 8, 'and the seals only once');

        assert.equal(first.complete, false);
        assert.deepEqual(first.failed, [FROST]);
        assert.equal(second.ran, 0);
        assert.equal(second.sealsAccrued, 8);
        assert.equal(second.complete, true);
        assert.equal(third.sealsAccrued, 0);
        assert.equal(treasuryOf(store, FROST).sealsAccrualDate, TODAY);
    });

    it('a seal credit that committed but reported an error is not paid twice', async () => {
        const store = memStore();
        const set = store.set;
        let blip = true;
        store.set = async (k: string, v: unknown) => {
            const out = await set(k, v);
            if (blip && k === FROST_STATE) { blip = false; throw new Error('committed, then timed out'); }
            return out;
        };
        await runVillageWarDailyPass(passDeps(store, { storesEnabled: false }));
        await runVillageWarDailyPass(passDeps(store, { storesEnabled: false }));
        assert.equal(treasuryOf(store, FROST).honorSeals, 8);
    });

    it('a stores day that failed is finished by a same-day re-run, and only once', async () => {
        const store = failingStore((k) => k === 'war:stores-day:frostfangvillage');
        store.m.set(FROST_STATE, { treasury: { provisions: 100 } });
        const first = await runVillageWarDailyPass(passDeps(store));
        assert.equal(treasuryOf(store, FROST).provisions, 100, 'the stores day did not run');

        store.disarm();
        await runVillageWarDailyPass(passDeps(store));
        // Before the fix the stores day only ran in the run that stamped the record.
        assert.equal(treasuryOf(store, FROST).provisions, 95, 'the day\'s 5% spoilage lands on the re-run');
        await runVillageWarDailyPass(passDeps(store));
        assert.equal(treasuryOf(store, FROST).provisions, 95, 'and only once');
        assert.equal(first.complete, false);
        assert.deepEqual(first.failed, [FROST]);
    });

    it('a village whose war-record lock is contended is finished by the next run; nobody is paid twice', async () => {
        const store = memStore();
        let contended = true;
        const lock = async <T>(k: string, fn: () => Promise<T>): Promise<T> => {
            if (contended && k === villageWarKey(FROST)) throw new Error('lock contended');
            return fn();
        };
        const first = await runVillageWarDailyPass(passDeps(store, { lock }));
        assert.equal(frostRecord(store), undefined);
        assert.equal(first.complete, false);
        assert.deepEqual(first.failed, [FROST]);

        contended = false;
        const second = await runVillageWarDailyPass(passDeps(store, { lock }));
        assert.equal(second.ran, 1, 'only the village that failed is stepped');
        assert.equal(second.complete, true);
        for (const v of WAR_VILLAGES) {
            assert.equal((store.m.get(villageWarKey(v)) as VillageWarRecord).warResources, 200, `${v} paid once`);
            assert.equal(treasuryOf(store, v).honorSeals, 8, `${v} seals once`);
        }
    });

    it('an earlier day\'s seals that never landed are credited before today\'s step', async () => {
        const store = failingStore((k) => k === FROST_STATE);
        await runVillageWarDailyPass(passDeps(store, { storesEnabled: false }));
        assert.equal(treasuryOf(store, FROST).honorSeals, undefined, 'yesterday\'s seals are still owed');

        store.disarm();
        const tomorrow = NOW + 24 * 3600 * 1000;
        const r = await runVillageWarDailyPass(passDeps(store, { storesEnabled: false, now: tomorrow }));
        assert.equal(treasuryOf(store, FROST).honorSeals, 16, 'yesterday\'s 8 and today\'s 8 — neither overwritten');
        assert.equal(r.sealsAccrued, 32 + 8);
    });

    it('a seals journal whose day was never stamped is not paid (its WR was not paid either)', async () => {
        const store = memStore();
        const { dailySealsJournalKey } = await import('./_war-daily.js');
        store.m.set(dailySealsJournalKey(FROST), { date: '2026-06-28', seals: 8, at: NOW - 86_400_000 });
        store.m.set(villageWarKey(FROST), { ...defaultVillageWarRecord(FROST), lastWarPassDate: '2026-06-27' });
        await runVillageWarDailyPass(passDeps(store, { storesEnabled: false }));
        assert.equal(treasuryOf(store, FROST).honorSeals, 8, 'only today\'s seals');
    });

    it('a failed sector-war scan defers the stores day instead of running it as if no war were active', async () => {
        const store = memStore();
        store.m.set(FROST_STATE, { treasury: { provisions: 100 } });
        const first = await runVillageWarDailyPass(passDeps(store, { listSectorWars: async () => { throw new Error('scan down'); } }));
        assert.equal(treasuryOf(store, FROST).provisions, 100, 'no stores day on unknown wars');
        assert.equal(first.complete, false);
        await runVillageWarDailyPass(passDeps(store));
        assert.equal(treasuryOf(store, FROST).provisions, 95);
    });

    it('records the finished day only when every village landed', async () => {
        const { VILLAGE_WAR_DAILY_MARKER_KEY } = await import('./_war-daily.js');
        const store = failingStore((k) => k === FROST_STATE);
        await runVillageWarDailyPass(passDeps(store, { storesEnabled: false }));
        assert.equal(store.m.get(VILLAGE_WAR_DAILY_MARKER_KEY), undefined);
        store.disarm();
        await runVillageWarDailyPass(passDeps(store, { storesEnabled: false }));
        assert.deepEqual(store.m.get(VILLAGE_WAR_DAILY_MARKER_KEY), { date: TODAY, at: NOW });
    });
});

describe('runVillageWarDailyPass — a failed territory scan is never paid as the baseline', () => {
    it('pays nothing and stamps nothing, so the retried day pays the real count once', async () => {
        const store = memStore();
        const owners: Record<number, string> = {};
        for (const s of [26, 27]) owners[s] = FROST;
        for (const s of [17, 18, 19, 20, 21, 22, 23, 24]) owners[s] = 'Moonshadow Village';
        seedTerritory(store, owners);
        const keys = store.keys;
        store.keys = async () => { throw new Error('scan down'); };
        const first = await runVillageWarDailyPass(passDeps(store, { storesEnabled: false }));
        // Before the fix every village was paid the 8-sector baseline and stamped.
        assert.equal(frostRecord(store), undefined, 'nothing stamped, nothing paid');
        assert.equal(treasuryOf(store, FROST).honorSeals, undefined);
        assert.equal(first.complete, false);
        assert.equal(first.ran, 0);

        store.keys = keys;
        await runVillageWarDailyPass(passDeps(store, { storesEnabled: false }));
        assert.equal(frostRecord(store)?.warResources, 50, 'the real 2 sectors, not the baseline 8');
        assert.equal(treasuryOf(store, FROST).honorSeals, 2);
    });
});

describe('runVillageWarDailyPass — per-war structures (bugs: at-war fail-open, dormancy over reset structures)', () => {
    it('an at-war check that FAILS keeps the per-war structures (fails closed)', async () => {
        const base = defaultVillageWarRecord(FROST);
        const store = memStore();
        store.m.set(villageWarKey(FROST), { ...base, warResources: 1_000, structures: { ...base.structures, ramparts: 7, watchtower: 4 } });
        await runVillageWarDailyPass(passDeps(store, { storesEnabled: false, isAtWar: async () => { throw new Error('war scan down'); } }));
        const rec = frostRecord(store)!;
        assert.equal(rec.structures.ramparts, 7, 'a transient read error must not wipe a defender\'s paid fortifications');
        assert.equal(rec.structures.watchtower, 4);
        assert.equal(rec.lastWarPassDate, TODAY, 'the day is still paid');
    });

    it('the day a village reaches peace, its reset fortifications are not billed — no dormancy over them', async () => {
        // Every structure at L10 costs 36 WR/day. An empty pool earns 3 × 25 = 75 WR:
        // enough for the two PERMANENT structures (72), not for those plus the
        // Ramparts and Watchtower being reset that same day (144).
        const base = defaultVillageWarRecord(FROST);
        const store = memStore();
        store.m.set(villageWarKey(FROST), {
            ...base,
            warResources: 0,
            structures: { ...base.structures, ramparts: 10, watchtower: 10, barracks: 10, warAcademy: 10, supplyDepot: 0, treasuryVault: 0 },
        });
        const owners: Record<number, string> = {};
        for (const s of [26, 27, 28]) owners[s] = FROST;
        for (const s of [17, 18, 19, 20, 21, 22, 23, 24]) owners[s] = 'Moonshadow Village';
        seedTerritory(store, owners);
        await runVillageWarDailyPass(passDeps(store, { storesEnabled: false, isAtWar: async () => false }));
        const rec = frostRecord(store)!;
        // Billing the reset Ramparts + Watchtower too (144 total) mothballed it,
        // suspending the Barracks and War Academy bonuses as well.
        assert.equal(rec.dormant, false, 'not dormant over structures that no longer exist');
        assert.equal(rec.warResources, 3);
        assert.equal(rec.structures.ramparts, 0);
        assert.equal(rec.structures.watchtower, 0);
        assert.equal(rec.structures.barracks, 10);
    });
});

describe('runVillageWarDailyPass — telemetry logs what was actually credited', () => {
    it('wr.earn is the amount the capped pool took, not the gross accrual', async () => {
        const { drainBackgroundWork } = await import('./_background-work.js');
        const { WAR_ECO_TXN_LIST_KEY } = await import('./_war-telemetry.js');
        const store = memStore();
        store.m.set(villageWarKey(FROST), { ...defaultVillageWarRecord(FROST), warResources: WR_POOL_CAP - 30 });
        await runVillageWarDailyPass(passDeps(store, { storesEnabled: false }));
        await drainBackgroundWork();
        const events = (store.m.get(WAR_ECO_TXN_LIST_KEY) ?? []) as Array<{ eventId: string; amount: number }>;
        const earn = events.find((e) => e.eventId === `wr-earn:frostfangvillage:${TODAY}`);
        assert.equal(frostRecord(store)?.warResources, WR_POOL_CAP);
        assert.equal(earn?.amount, 30, 'only 30 WR fit under the cap, not the 200 accrued');
    });
});

describe('runVillageWarDailyCatchUp — the scheduler\'s retry / restart tick', () => {
    const result = (over: Record<string, unknown> = {}) => ({ enabled: true, processed: 4, ran: 4, sealsAccrued: 32, sectorWarsSettled: 0, failed: [], complete: true, ...over });

    it('never runs a day before 03:00 UTC', async () => {
        const { runVillageWarDailyCatchUp } = await import('./_war-daily.js');
        let runs = 0;
        const out = await runVillageWarDailyCatchUp({ now: Date.UTC(2026, 5, 29, 2, 59), store: memStore(), runPass: async () => { runs++; return result(); } });
        assert.deepEqual(out, { status: 'not-due' });
        assert.equal(runs, 0);
    });

    it('runs the pass after 03:00 when today is not recorded complete (a restart across 03:00)', async () => {
        const { runVillageWarDailyCatchUp, VILLAGE_WAR_DAILY_MARKER_KEY } = await import('./_war-daily.js');
        const store = memStore();
        store.m.set(VILLAGE_WAR_DAILY_MARKER_KEY, { date: '2026-06-28', at: NOW - 86_400_000 });
        const seen: number[] = [];
        const at = Date.UTC(2026, 5, 29, 3, 7);
        const out = await runVillageWarDailyCatchUp({ now: at, store, runPass: async (t) => { seen.push(t); return result(); } });
        assert.equal(out.status, 'ran');
        assert.deepEqual(seen, [at], 'the pass runs on the tick\'s own clock');
    });

    it('does nothing once today is recorded complete, and reports a held lease as busy', async () => {
        const { runVillageWarDailyCatchUp, VILLAGE_WAR_DAILY_MARKER_KEY } = await import('./_war-daily.js');
        const store = memStore();
        store.m.set(VILLAGE_WAR_DAILY_MARKER_KEY, { date: TODAY, at: NOW });
        let runs = 0;
        assert.deepEqual(await runVillageWarDailyCatchUp({ now: NOW, store, runPass: async () => { runs++; return result(); } }), { status: 'done' });
        assert.equal(runs, 0);
        assert.deepEqual(await runVillageWarDailyCatchUp({ now: NOW, store: memStore(), runPass: async () => null }), { status: 'busy' });
    });

    it('an unreadable marker re-runs the pass rather than skipping the day', async () => {
        const { runVillageWarDailyCatchUp } = await import('./_war-daily.js');
        let runs = 0;
        const broken = { get: async () => { throw new Error('kv down'); } };
        await runVillageWarDailyCatchUp({ now: NOW, store: broken, runPass: async () => { runs++; return result(); } });
        assert.equal(runs, 1);
    });

    it('end to end: an incomplete pass releases its lease, the retry finishes the day, a complete one holds it', async () => {
        const { withScheduledJobLeaseCore } = await import('./cron/_job-lease.js');
        const { _makeMemoryKv } = await import('./_storage.js');
        const leaseStore = _makeMemoryKv();
        const store = failingStore((k) => k === FROST_STATE);
        // The scheduler's exact lease policy for this job (api/cron/_scheduler.ts).
        const leased = () => withScheduledJobLeaseCore(leaseStore, 'village-war-daily',
            () => runVillageWarDailyPass(passDeps(store, { storesEnabled: false })),
            { ttlSec: 30 * 60, holdUntilExpiryOnSuccess: true, holdUntilExpiryWhen: (r) => r.complete });
        const first = await leased();
        store.disarm();
        const retry = await leased();
        assert.equal(retry.acquired, true, 'the unfinished day released the lease, so the retry runs');
        assert.equal(treasuryOf(store, FROST).honorSeals, 8);
        assert.deepEqual(await leased(), { acquired: false }, 'a complete day holds the lease');
        assert.equal(first.acquired && first.value.complete, false);
        assert.equal(retry.acquired && retry.value.complete, true);
    });
});
