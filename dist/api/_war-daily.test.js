"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _war_state_js_1 = require("./_war-state.js");
const _war_economy_js_1 = require("./_war-economy.js");
const _war_daily_js_1 = require("./_war-daily.js");
const _war_map_sectors_js_1 = require("./_war-map-sectors.js");
const NOW = Date.UTC(2026, 5, 29, 4, 0, 0); // a fixed timestamp (after 03:00 UTC)
const TODAY = '2026-06-29';
function withStructures(village, level) {
    const r = (0, _war_state_js_1.defaultVillageWarRecord)(village);
    for (const k of _war_state_js_1.STRUCTURE_KEYS)
        r.structures[k] = level;
    return r;
}
(0, node_test_1.describe)('stepVillageWarDay (pure)', () => {
    (0, node_test_1.it)('accrues WR for 8 held sectors and stamps the day', () => {
        const { record, summary } = (0, _war_state_js_1.stepVillageWarDay)((0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village'), {
            sectorsControlled: 8, today: TODAY, now: NOW,
        });
        node_assert_1.strict.equal(summary.ran, true);
        node_assert_1.strict.equal(summary.wrAccrued, 200);
        node_assert_1.strict.equal(record.warResources, 200);
        node_assert_1.strict.equal(record.dormant, false);
        node_assert_1.strict.equal(record.lastWarPassDate, TODAY);
    });
    (0, node_test_1.it)('is idempotent — a same-day re-run is a no-op', () => {
        const first = (0, _war_state_js_1.stepVillageWarDay)((0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village'), { sectorsControlled: 8, today: TODAY, now: NOW });
        const second = (0, _war_state_js_1.stepVillageWarDay)(first.record, { sectorsControlled: 8, today: TODAY, now: NOW });
        node_assert_1.strict.equal(second.summary.ran, false);
        node_assert_1.strict.equal(second.record.warResources, 200); // unchanged
        node_assert_1.strict.equal(second.record, first.record); // same reference, untouched
    });
    (0, node_test_1.it)('pays structure upkeep when affordable', () => {
        // 6× L5 = 90 upkeep; 8 sectors accrue 200 → pool 200 − 90 = 110, active.
        const { record, summary } = (0, _war_state_js_1.stepVillageWarDay)(withStructures('Frostfang Village', 5), { sectorsControlled: 8, today: TODAY, now: NOW });
        node_assert_1.strict.equal(summary.maintenanceOwed, 90);
        node_assert_1.strict.equal(summary.maintenancePaid, 90);
        node_assert_1.strict.equal(summary.dormant, false);
        node_assert_1.strict.equal(record.warResources, 110);
        node_assert_1.strict.equal(record.dormant, false);
    });
    (0, node_test_1.it)('mothballs (dormant) when upkeep is unaffordable, retaining WR', () => {
        // 6× L10 = 216 upkeep; 8 sectors accrue 200 → pool 200 < 216 → dormant, no pay.
        const { record, summary } = (0, _war_state_js_1.stepVillageWarDay)(withStructures('Frostfang Village', 10), { sectorsControlled: 8, today: TODAY, now: NOW });
        node_assert_1.strict.equal(summary.maintenanceOwed, 216);
        node_assert_1.strict.equal(summary.maintenancePaid, 0);
        node_assert_1.strict.equal(summary.dormant, true);
        node_assert_1.strict.equal(record.warResources, 200); // WR kept to recover
        node_assert_1.strict.equal(record.dormant, true);
    });
    (0, node_test_1.it)('caps the WR pool at WR_POOL_CAP', () => {
        const seeded = { ...(0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village'), warResources: _war_economy_js_1.WR_POOL_CAP - 50 };
        const { record } = (0, _war_state_js_1.stepVillageWarDay)(seeded, { sectorsControlled: 8, today: TODAY, now: NOW });
        node_assert_1.strict.equal(record.warResources, _war_economy_js_1.WR_POOL_CAP); // 4950 + 200 clamped to 5000
    });
    (0, node_test_1.it)('honors a Supply-Depot-boosted per-sector WR rate', () => {
        // wrPerSector 30 (depot L10) × 8 sectors = 240 accrued instead of 200.
        const { record, summary } = (0, _war_state_js_1.stepVillageWarDay)((0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village'), {
            sectorsControlled: 8, today: TODAY, now: NOW, wrPerSector: 30,
        });
        node_assert_1.strict.equal(summary.wrAccrued, 240);
        node_assert_1.strict.equal(record.warResources, 240);
    });
    (0, node_test_1.it)('expires merc leases past their window', () => {
        const seeded = {
            ...(0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village'),
            mercLeases: [
                { tierId: 'merc-ronin', player: 'a', expiresAt: NOW - 1, count: 3 }, // expired
                { tierId: 'merc-oni', player: 'b', expiresAt: NOW + 100000, count: 4 }, // active
            ],
        };
        const { record, summary } = (0, _war_state_js_1.stepVillageWarDay)(seeded, { sectorsControlled: 8, today: TODAY, now: NOW });
        node_assert_1.strict.equal(summary.mercsExpired, 1);
        node_assert_1.strict.equal(record.mercLeases.length, 1);
        node_assert_1.strict.equal(record.mercLeases[0].tierId, 'merc-oni');
    });
});
function memStore() {
    const m = new Map();
    return {
        m,
        get: async (k) => (m.has(k) ? m.get(k) : null),
        set: async (k, v) => { m.set(k, v); return 'OK'; },
    };
}
const passthroughLock = (_k, fn) => fn();
(0, node_test_1.describe)('runVillageWarDailyPass (orchestration)', () => {
    (0, node_test_1.it)('no-ops when disabled (default OFF)', async () => {
        const store = memStore();
        const r = await (0, _war_daily_js_1.runVillageWarDailyPass)({ store, lock: passthroughLock, now: NOW, enabled: false });
        node_assert_1.strict.deepEqual(r, { enabled: false, processed: 0, ran: 0, sealsAccrued: 0 });
        node_assert_1.strict.equal(store.m.size, 0);
    });
    (0, node_test_1.it)('processes all 4 villages and is idempotent across same-day runs', async () => {
        const store = memStore();
        const first = await (0, _war_daily_js_1.runVillageWarDailyPass)({ store, lock: passthroughLock, now: NOW, enabled: true });
        node_assert_1.strict.equal(first.enabled, true);
        node_assert_1.strict.equal(first.processed, _war_map_sectors_js_1.WAR_VILLAGES.length);
        node_assert_1.strict.equal(first.ran, 4);
        // Each village got a record with 200 WR accrued (8 home sectors, no structures).
        for (const v of _war_map_sectors_js_1.WAR_VILLAGES) {
            const rec = store.m.get((0, _war_state_js_1.villageWarKey)(v));
            node_assert_1.strict.ok(rec, `${v} record written`);
            node_assert_1.strict.equal(rec.warResources, 200);
            node_assert_1.strict.equal(rec.lastWarPassDate, TODAY);
        }
        // Seals accrue to each village treasury (8 sectors × 1 seal = 8 each; 32 total).
        node_assert_1.strict.equal(first.sealsAccrued, 32);
        const frostTreasury = store.m.get('game:village-state:frostfangvillage');
        node_assert_1.strict.equal(frostTreasury.treasury?.honorSeals, 8);
        // Same-day re-run: nothing changes (WR or seals).
        const second = await (0, _war_daily_js_1.runVillageWarDailyPass)({ store, lock: passthroughLock, now: NOW, enabled: true });
        node_assert_1.strict.equal(second.ran, 0);
        node_assert_1.strict.equal(second.sealsAccrued, 0);
        for (const v of _war_map_sectors_js_1.WAR_VILLAGES) {
            node_assert_1.strict.equal(store.m.get((0, _war_state_js_1.villageWarKey)(v)).warResources, 200);
        }
        node_assert_1.strict.equal(store.m.get('game:village-state:frostfangvillage').treasury?.honorSeals, 8);
    });
    (0, node_test_1.it)('accrues again on the next day', async () => {
        const store = memStore();
        await (0, _war_daily_js_1.runVillageWarDailyPass)({ store, lock: passthroughLock, now: NOW, enabled: true });
        const nextDay = await (0, _war_daily_js_1.runVillageWarDailyPass)({ store, lock: passthroughLock, now: NOW + 24 * 3600 * 1000, enabled: true });
        node_assert_1.strict.equal(nextDay.ran, 4);
        const rec = store.m.get((0, _war_state_js_1.villageWarKey)('Frostfang Village'));
        node_assert_1.strict.equal(rec.warResources, 400); // 200 + 200
    });
    (0, node_test_1.it)('resets per-war structures (Ramparts/Watchtower) at peace, keeps them at war', async () => {
        const base = (0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village');
        // Seed Frostfang with per-war + a permanent structure, already passed today so
        // the accrual is idempotent — this isolates the reset behaviour.
        const seed = () => ({ ...base, lastWarPassDate: TODAY, structures: { ...base.structures, ramparts: 8, watchtower: 6, barracks: 5 } });
        const peaceStore = memStore();
        peaceStore.m.set((0, _war_state_js_1.villageWarKey)('Frostfang Village'), seed());
        await (0, _war_daily_js_1.runVillageWarDailyPass)({ store: peaceStore, lock: passthroughLock, now: NOW, enabled: true, isAtWar: async () => false });
        const atPeace = peaceStore.m.get((0, _war_state_js_1.villageWarKey)('Frostfang Village'));
        node_assert_1.strict.equal(atPeace.structures.ramparts, 0); // per-war wiped
        node_assert_1.strict.equal(atPeace.structures.watchtower, 0); // per-war wiped
        node_assert_1.strict.equal(atPeace.structures.barracks, 5); // permanent kept
        const warStore = memStore();
        warStore.m.set((0, _war_state_js_1.villageWarKey)('Frostfang Village'), seed());
        await (0, _war_daily_js_1.runVillageWarDailyPass)({ store: warStore, lock: passthroughLock, now: NOW, enabled: true, isAtWar: async () => true });
        const atWar = warStore.m.get((0, _war_state_js_1.villageWarKey)('Frostfang Village'));
        node_assert_1.strict.equal(atWar.structures.ramparts, 8); // held while at war
        node_assert_1.strict.equal(atWar.structures.watchtower, 6);
    });
});
