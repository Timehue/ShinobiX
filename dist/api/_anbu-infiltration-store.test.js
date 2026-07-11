"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _anbu_infiltration_store_js_1 = require("./_anbu-infiltration-store.js");
const _war_state_js_1 = require("./_war-state.js");
const _clan_points_js_1 = require("./_clan-points.js");
const _anbu_infiltration_js_1 = require("./_anbu-infiltration.js");
const NOW = Date.UTC(2026, 6, 10, 12, 0, 0);
const TODAY = '2026-07-10';
const now = () => NOW;
function fakeKv() {
    const store = new Map();
    return {
        store,
        async get(key) { return (store.has(key) ? store.get(key) : null); },
        async set(key, value, opts) {
            if (opts?.nx && store.has(key))
                return null;
            store.set(key, value);
            return 'OK';
        },
        async del(...keys) { let n = 0; for (const k of keys)
            if (store.delete(k))
                n++; return n; },
        async incr(key) { const v = (Number(store.get(key)) || 0) + 1; store.set(key, v); return v; },
    };
}
const passLock = async (_t, fn) => fn();
const SECTOR = 12;
const VILLAGE = 'Frostfang Village';
const TERRITORY_KEY = `world:territory:${SECTOR}`;
function deps(kv) { return { kv, lock: passLock, now }; }
function seedTerritory(kv, over = {}) {
    kv.store.set(TERRITORY_KEY, {
        sector: SECTOR, ownerVillage: VILLAGE, ownerClan: 'Storm Clan',
        warSupply: 4000, lastSupplyAt: NOW, updatedAt: NOW, ...over,
    });
}
function seedWarRecord(kv, warResources = 5000) {
    kv.store.set((0, _war_state_js_1.villageWarKey)(VILLAGE), { warResources });
}
function seedSave(kv, slug, char = {}) {
    kv.store.set(`save:${slug}`, {
        character: { name: slug, level: 100, ryo: 0, maxHp: 9000, maxChakra: 100, maxStamina: 100, stats: {}, ...char },
    });
}
const charOf = (kv, slug) => kv.store.get(`save:${slug}`).character;
const stacksOf = (kv, slug) => (charOf(kv, slug).itemStacks ?? []);
function makeRun(over = {}) {
    return {
        runId: 'r1', raiderSlug: 'raider', sector: SECTOR, targetVillage: VILLAGE,
        anbuSlug: 'anbu-one', anbuName: 'Anbu One', terrain: 'snow',
        session: { status: 'done', winner: 'squad' },
        createdAt: NOW,
        ...over
    };
}
(0, node_test_1.describe)('settleInfiltrationWin', () => {
    (0, node_test_1.it)('both-roll: drains both pools, mints both caches + ryo, writes ledgers', async () => {
        const kv = fakeKv();
        seedTerritory(kv);
        seedWarRecord(kv);
        seedSave(kv, 'raider');
        const out = await (0, _anbu_infiltration_store_js_1.settleInfiltrationWin)(makeRun(), 0.05, deps(kv)); // both band
        node_assert_1.strict.equal(out.ok, true);
        if (!out.ok || out.alreadySettled)
            throw new Error('unexpected');
        node_assert_1.strict.deepEqual(out.rolled, { supply: true, wr: true });
        node_assert_1.strict.equal(out.supplySkim, 40); // 1% of 4000
        node_assert_1.strict.equal(out.wrSkim, 50); // 1% of 5000
        node_assert_1.strict.equal(out.supplyCaches, 40);
        node_assert_1.strict.equal(out.wrCaches, 50);
        node_assert_1.strict.equal(out.ryo, _anbu_infiltration_js_1.RAID_RYO_REWARD);
        node_assert_1.strict.equal(out.overflowLost, 0);
        // pools drained
        node_assert_1.strict.equal(kv.store.get(TERRITORY_KEY).warSupply, 3960);
        node_assert_1.strict.equal(kv.store.get((0, _war_state_js_1.villageWarKey)(VILLAGE)).warResources, 4950);
        // caches + ryo credited
        const stacks = stacksOf(kv, 'raider');
        node_assert_1.strict.equal(stacks.find(s => s.itemId === _anbu_infiltration_js_1.CACHE_ITEM_IDS.warSupply)?.count, 40);
        node_assert_1.strict.equal(stacks.find(s => s.itemId === _anbu_infiltration_js_1.CACHE_ITEM_IDS.warResources)?.count, 50);
        node_assert_1.strict.equal(charOf(kv, 'raider').ryo, _anbu_infiltration_js_1.RAID_RYO_REWARD);
        // ledgers written for today
        node_assert_1.strict.deepEqual(kv.store.get((0, _anbu_infiltration_store_js_1.supplyLedgerKey)(SECTOR)), { date: TODAY, openingBalance: 4000, lostToday: 40 });
        node_assert_1.strict.deepEqual(kv.store.get((0, _anbu_infiltration_store_js_1.wrLedgerKey)((0, _anbu_infiltration_store_js_1.villageSlug)(VILLAGE))), { date: TODAY, openingBalance: 5000, lostToday: 50 });
        // paid receipt placed
        node_assert_1.strict.ok(kv.store.has((0, _anbu_infiltration_store_js_1.infilPaidKey)('r1')));
    });
    (0, node_test_1.it)('materializes lazy accrual before skimming (stored 0, 10 days accrued)', async () => {
        const kv = fakeKv();
        const tenDaysAgo = NOW - 10 * 24 * 60 * 60 * 1000;
        seedTerritory(kv, { warSupply: 0, lastSupplyAt: tenDaysAgo });
        seedWarRecord(kv);
        seedSave(kv, 'raider');
        const out = await (0, _anbu_infiltration_store_js_1.settleInfiltrationWin)(makeRun(), 0.30, deps(kv)); // supply-only band
        if (!out.ok || out.alreadySettled)
            throw new Error('unexpected');
        node_assert_1.strict.equal(out.supplySkim, 10); // 1% of 100/day × 10 days
        const terr = kv.store.get(TERRITORY_KEY);
        node_assert_1.strict.equal(terr.warSupply, 990); // materialized remainder
        node_assert_1.strict.equal(terr.lastSupplyAt, NOW); // accrual clock advanced (whole cycles consumed)
        node_assert_1.strict.equal(out.wrSkim, 0); // wr not rolled
        node_assert_1.strict.equal(kv.store.get((0, _war_state_js_1.villageWarKey)(VILLAGE)).warResources, 5000);
    });
    (0, node_test_1.it)('sector flipped mid-run → supply skim 0 (WR still drains)', async () => {
        const kv = fakeKv();
        seedTerritory(kv, { ownerVillage: 'Moonshadow Village' }); // no longer the target's
        seedWarRecord(kv);
        seedSave(kv, 'raider');
        const out = await (0, _anbu_infiltration_store_js_1.settleInfiltrationWin)(makeRun(), 0.05, deps(kv)); // both band
        if (!out.ok || out.alreadySettled)
            throw new Error('unexpected');
        node_assert_1.strict.equal(out.supplySkim, 0);
        node_assert_1.strict.equal(out.supplyCaches, 0);
        node_assert_1.strict.equal(out.wrSkim, 50);
        node_assert_1.strict.equal(kv.store.get(TERRITORY_KEY).warSupply, 4000); // untouched
    });
    (0, node_test_1.it)('daily-capped pool skims 0; ryo still granted', async () => {
        const kv = fakeKv();
        seedTerritory(kv);
        seedWarRecord(kv);
        seedSave(kv, 'raider');
        const tapped = { date: TODAY, openingBalance: 4000, lostToday: 2000 };
        kv.store.set((0, _anbu_infiltration_store_js_1.supplyLedgerKey)(SECTOR), tapped);
        const out = await (0, _anbu_infiltration_store_js_1.settleInfiltrationWin)(makeRun(), 0.30, deps(kv)); // supply-only
        if (!out.ok || out.alreadySettled)
            throw new Error('unexpected');
        node_assert_1.strict.equal(out.supplySkim, 0);
        node_assert_1.strict.equal(out.supplyCaches, 0);
        node_assert_1.strict.equal(out.ryo, _anbu_infiltration_js_1.RAID_RYO_REWARD);
        node_assert_1.strict.equal(charOf(kv, 'raider').ryo, _anbu_infiltration_js_1.RAID_RYO_REWARD);
        node_assert_1.strict.equal(kv.store.get(TERRITORY_KEY).warSupply, 4000);
    });
    (0, node_test_1.it)('idempotent: a second settle for the same run is a no-op', async () => {
        const kv = fakeKv();
        seedTerritory(kv);
        seedWarRecord(kv);
        seedSave(kv, 'raider');
        const first = await (0, _anbu_infiltration_store_js_1.settleInfiltrationWin)(makeRun(), 0.05, deps(kv));
        node_assert_1.strict.equal(first.ok && !first.alreadySettled, true);
        const second = await (0, _anbu_infiltration_store_js_1.settleInfiltrationWin)(makeRun(), 0.05, deps(kv));
        node_assert_1.strict.equal(second.ok && second.alreadySettled, true);
        // no double drain
        node_assert_1.strict.equal(kv.store.get(TERRITORY_KEY).warSupply, 3960);
        node_assert_1.strict.equal(charOf(kv, 'raider').ryo, _anbu_infiltration_js_1.RAID_RYO_REWARD);
    });
    (0, node_test_1.it)('stack cap 9999: overflow is lost, not minted past the cap', async () => {
        const kv = fakeKv();
        seedTerritory(kv);
        seedWarRecord(kv);
        seedSave(kv, 'raider', { itemStacks: [{ itemId: _anbu_infiltration_js_1.CACHE_ITEM_IDS.warSupply, count: 9990 }] });
        const out = await (0, _anbu_infiltration_store_js_1.settleInfiltrationWin)(makeRun(), 0.30, deps(kv)); // supply-only: 40 caches
        if (!out.ok || out.alreadySettled)
            throw new Error('unexpected');
        node_assert_1.strict.equal(out.supplyCaches, 40);
        node_assert_1.strict.equal(out.overflowLost, 31); // 9990 + 40 = 10030 → 9999
        node_assert_1.strict.equal(stacksOf(kv, 'raider').find(s => s.itemId === _anbu_infiltration_js_1.CACHE_ITEM_IDS.warSupply)?.count, 9999);
        // the enemy still lost the full skim
        node_assert_1.strict.equal(kv.store.get(TERRITORY_KEY).warSupply, 3960);
    });
    (0, node_test_1.it)('missing raider save → no-save error, tx marked failed, pools already debited stay debited', async () => {
        const kv = fakeKv();
        seedTerritory(kv);
        seedWarRecord(kv); // no raider save
        const out = await (0, _anbu_infiltration_store_js_1.settleInfiltrationWin)(makeRun(), 0.05, deps(kv));
        node_assert_1.strict.deepEqual(out, { ok: false, error: 'no-save' });
        node_assert_1.strict.equal(kv.store.get(TERRITORY_KEY).warSupply, 3960); // lose, never duplicate
    });
});
(0, node_test_1.describe)('turnInCachesForSave', () => {
    (0, node_test_1.it)('village: 1:1 into villageMerit, stack fully consumed and dropped', async () => {
        const kv = fakeKv();
        seedSave(kv, 'p1', { village: VILLAGE, itemStacks: [{ itemId: _anbu_infiltration_js_1.CACHE_ITEM_IDS.warResources, count: 5 }] });
        const out = await (0, _anbu_infiltration_store_js_1.turnInCachesForSave)({ playerName: 'p1', cache: 'warResources' }, deps(kv));
        node_assert_1.strict.equal(out.ok, true);
        if (!out.ok)
            throw new Error('unexpected');
        node_assert_1.strict.equal(out.dest, 'village');
        node_assert_1.strict.equal(out.points, 5);
        node_assert_1.strict.equal(out.consumed, 5);
        node_assert_1.strict.equal(out.remaining, 0);
        node_assert_1.strict.equal(charOf(kv, 'p1').villageMerit, 5);
        node_assert_1.strict.equal(stacksOf(kv, 'p1').length, 0); // empty stack dropped
    });
    (0, node_test_1.it)('clan: 2:1 into clan points, odd cache left held', async () => {
        const kv = fakeKv();
        seedSave(kv, 'p1', { clan: 'Storm Clan', itemStacks: [{ itemId: _anbu_infiltration_js_1.CACHE_ITEM_IDS.warSupply, count: 5 }] });
        const out = await (0, _anbu_infiltration_store_js_1.turnInCachesForSave)({ playerName: 'p1', cache: 'warSupply' }, deps(kv));
        if (!out.ok)
            throw new Error('unexpected');
        node_assert_1.strict.equal(out.dest, 'clan');
        node_assert_1.strict.equal(out.points, 2);
        node_assert_1.strict.equal(out.consumed, 4);
        node_assert_1.strict.equal(out.remaining, 1);
        node_assert_1.strict.equal(charOf(kv, 'p1').clanPoints, 2);
        node_assert_1.strict.equal(stacksOf(kv, 'p1').find(s => s.itemId === _anbu_infiltration_js_1.CACHE_ITEM_IDS.warSupply)?.count, 1);
    });
    (0, node_test_1.it)('clan: clamps to the 250 per-award cap and only consumes what credits', async () => {
        const kv = fakeKv();
        seedSave(kv, 'p1', { clan: 'Storm Clan', itemStacks: [{ itemId: _anbu_infiltration_js_1.CACHE_ITEM_IDS.warSupply, count: 600 }] });
        const out = await (0, _anbu_infiltration_store_js_1.turnInCachesForSave)({ playerName: 'p1', cache: 'warSupply' }, deps(kv));
        if (!out.ok)
            throw new Error('unexpected');
        node_assert_1.strict.equal(out.points, 250); // raw 300 clamped to per-award 250
        node_assert_1.strict.equal(out.consumed, 500); // only 250×2 consumed
        node_assert_1.strict.equal(out.remaining, 100);
        node_assert_1.strict.equal(charOf(kv, 'p1').clanPoints, 250);
    });
    (0, node_test_1.it)('clan: respects the weekly-cap headroom', async () => {
        const kv = fakeKv();
        seedSave(kv, 'p1', {
            clan: 'Storm Clan',
            weeklyClanPoints: 950,
            weeklyClanPointsWeek: (0, _clan_points_js_1.clanPointWeekKey)(new Date(NOW)),
            itemStacks: [{ itemId: _anbu_infiltration_js_1.CACHE_ITEM_IDS.warSupply, count: 600 }],
        });
        const out = await (0, _anbu_infiltration_store_js_1.turnInCachesForSave)({ playerName: 'p1', cache: 'warSupply' }, deps(kv));
        if (!out.ok)
            throw new Error('unexpected');
        node_assert_1.strict.equal(out.points, 50); // 1000 − 950 headroom
        node_assert_1.strict.equal(out.consumed, 100);
        node_assert_1.strict.equal(out.remaining, 500);
    });
    (0, node_test_1.it)('clan at full weekly cap → cap-reached, nothing consumed', async () => {
        const kv = fakeKv();
        seedSave(kv, 'p1', {
            clan: 'Storm Clan',
            weeklyClanPoints: 1000,
            weeklyClanPointsWeek: (0, _clan_points_js_1.clanPointWeekKey)(new Date(NOW)),
            itemStacks: [{ itemId: _anbu_infiltration_js_1.CACHE_ITEM_IDS.warSupply, count: 10 }],
        });
        const out = await (0, _anbu_infiltration_store_js_1.turnInCachesForSave)({ playerName: 'p1', cache: 'warSupply' }, deps(kv));
        node_assert_1.strict.deepEqual(out, { ok: false, error: 'cap-reached' });
        node_assert_1.strict.equal(stacksOf(kv, 'p1').find(s => s.itemId === _anbu_infiltration_js_1.CACHE_ITEM_IDS.warSupply)?.count, 10); // untouched
    });
    (0, node_test_1.it)('clan without a clan → not-in-clan; nothing held → nothing-to-turn-in', async () => {
        const kv = fakeKv();
        seedSave(kv, 'p1', { itemStacks: [{ itemId: _anbu_infiltration_js_1.CACHE_ITEM_IDS.warSupply, count: 4 }] });
        node_assert_1.strict.deepEqual(await (0, _anbu_infiltration_store_js_1.turnInCachesForSave)({ playerName: 'p1', cache: 'warSupply' }, deps(kv)), { ok: false, error: 'not-in-clan' });
        seedSave(kv, 'p2', {});
        node_assert_1.strict.deepEqual(await (0, _anbu_infiltration_store_js_1.turnInCachesForSave)({ playerName: 'p2', cache: 'warResources' }, deps(kv)), { ok: false, error: 'nothing-to-turn-in' });
    });
    (0, node_test_1.it)('village: partial count only consumes that many', async () => {
        const kv = fakeKv();
        seedSave(kv, 'p1', { village: VILLAGE, itemStacks: [{ itemId: _anbu_infiltration_js_1.CACHE_ITEM_IDS.warResources, count: 10 }] });
        const out = await (0, _anbu_infiltration_store_js_1.turnInCachesForSave)({ playerName: 'p1', cache: 'warResources', count: 3 }, deps(kv));
        if (!out.ok)
            throw new Error('unexpected');
        node_assert_1.strict.equal(out.points, 3);
        node_assert_1.strict.equal(out.remaining, 7);
        node_assert_1.strict.equal(charOf(kv, 'p1').villageMerit, 3);
    });
});
(0, node_test_1.describe)('Anbu roster + snapshot', () => {
    (0, node_test_1.it)('loadAnbuAppointees: safeNamed, deduped', async () => {
        const kv = fakeKv();
        // safeName lowercases (so 'Anbu-One' ≡ 'anbu-one') but a spaced display
        // name slugs differently ('Anbu Two' → 'anbutwo') — matching how
        // _war-role.ts compares appointees (lowercase-exact, not fuzzy).
        kv.store.set((0, _anbu_infiltration_store_js_1.villageStateKey)(VILLAGE), { anbuAppointees: ['Anbu-One', 'anbu-one', 'Anbu Two', '', null] });
        const list = await (0, _anbu_infiltration_store_js_1.loadAnbuAppointees)(VILLAGE, deps(kv));
        node_assert_1.strict.deepEqual(list, ['anbu-one', 'anbutwo']);
    });
    (0, node_test_1.it)('pickAnbuDefender: least-recently-defended rotation', async () => {
        const kv = fakeKv();
        const d = deps(kv);
        const first = await (0, _anbu_infiltration_store_js_1.pickAnbuDefender)(VILLAGE, ['anbu-b', 'anbu-a'], d);
        node_assert_1.strict.equal(first, 'anbu-a'); // tie at 0 → slug order
        const second = await (0, _anbu_infiltration_store_js_1.pickAnbuDefender)(VILLAGE, ['anbu-b', 'anbu-a'], d);
        node_assert_1.strict.equal(second, 'anbu-b'); // a now stamped, b is least-recent
        node_assert_1.strict.equal(await (0, _anbu_infiltration_store_js_1.pickAnbuDefender)(VILLAGE, [], d), null);
    });
    (0, node_test_1.it)('getOrSealAnbuSnapshot: seals once per day and caches (stale save changes ignored)', async () => {
        const kv = fakeKv();
        seedSave(kv, 'anbu-one', { name: 'Anbu One', specialty: 'Ninjutsu', maxHp: 12000 });
        const d = deps(kv);
        const snap1 = await (0, _anbu_infiltration_store_js_1.getOrSealAnbuSnapshot)(VILLAGE, 'anbu-one', d);
        node_assert_1.strict.ok(snap1);
        node_assert_1.strict.equal(snap1.name, 'Anbu One');
        node_assert_1.strict.equal(snap1.sealedAt, NOW);
        node_assert_1.strict.ok(snap1.character); // sealed combat character
        // mutate the save; same-day snapshot stays frozen
        seedSave(kv, 'anbu-one', { name: 'Renamed', maxHp: 1 });
        const snap2 = await (0, _anbu_infiltration_store_js_1.getOrSealAnbuSnapshot)(VILLAGE, 'anbu-one', d);
        node_assert_1.strict.equal(snap2.name, 'Anbu One');
        // no save at all → null
        node_assert_1.strict.equal(await (0, _anbu_infiltration_store_js_1.getOrSealAnbuSnapshot)(VILLAGE, 'ghost', d), null);
    });
    (0, node_test_1.it)('bumpInfilStartCount increments per call', async () => {
        const kv = fakeKv();
        const d = deps(kv);
        node_assert_1.strict.equal(await (0, _anbu_infiltration_store_js_1.bumpInfilStartCount)('raider', d), 1);
        node_assert_1.strict.equal(await (0, _anbu_infiltration_store_js_1.bumpInfilStartCount)('raider', d), 2);
    });
});
