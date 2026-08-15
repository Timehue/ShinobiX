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
        assert.deepEqual(r, { enabled: false, processed: 0, ran: 0, sealsAccrued: 0, sectorWarsSettled: 0 });
        assert.equal(store.m.size, 0);
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
        // Seed Frostfang with per-war + a permanent structure, already passed today so
        // the accrual is idempotent — this isolates the reset behaviour.
        const seed = (): VillageWarRecord => ({ ...base, lastWarPassDate: TODAY, structures: { ...base.structures, ramparts: 8, watchtower: 6, barracks: 5 } });

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
});
