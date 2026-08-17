import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { isDeepStrictEqual } from 'node:util';
import {
    settleInfiltrationWin,
    settleInfiltrationLoss,
    turnInCachesForSave,
    pickAnbuDefender,
    getOrSealAnbuSnapshot,
    reserveInfilStartAttempt,
    loadAnbuAppointees,
    infilStartCountKey,
    supplyLedgerKey,
    wrLedgerKey,
    villageStateKey,
    villageSlug,
    type InfilRun,
    type InfilKv,
    type InfilLock,
} from './_anbu-infiltration-store.js';
import { buildInfiltrationEncounter } from './_anbu-infiltration-encounter.js';
import { villageWarKey } from './_war-state.js';
import { clanPointWeekKey } from './_clan-points.js';
import { CACHE_ITEM_IDS, RAID_RYO_REWARD, type DailyLossLedger } from './_anbu-infiltration.js';

const NOW = Date.UTC(2026, 6, 10, 12, 0, 0);
const TODAY = '2026-07-10';
const now = () => NOW;

function fakeKv(): InfilKv & { store: Map<string, unknown> } {
    const store = new Map<string, unknown>();
    return {
        store,
        async get<T>(key: string) { return (store.has(key) ? store.get(key) : null) as T | null; },
        async set(key, value, opts) {
            if (opts?.nx && store.has(key)) return null;
            store.set(key, value);
            return 'OK';
        },
        async compareSet(key, expected, value) {
            const current = store.has(key) ? store.get(key) : null;
            if (!isDeepStrictEqual(current, expected)) return false;
            store.set(key, value);
            return true;
        },
        async del(...keys: string[]) { let n = 0; for (const k of keys) if (store.delete(k)) n++; return n; },
    };
}
const passLock: InfilLock = async (_t, fn) => fn();

const SECTOR = 12;
const VILLAGE = 'Frostfang Village';
const TERRITORY_KEY = `world:territory:${SECTOR}`;

function deps(kv: InfilKv) { return { kv, lock: passLock, now }; }

function seedTerritory(kv: ReturnType<typeof fakeKv>, over: Record<string, unknown> = {}) {
    kv.store.set(TERRITORY_KEY, {
        sector: SECTOR, ownerVillage: VILLAGE, ownerClan: 'Storm Clan',
        warSupply: 4000, lastSupplyAt: NOW, updatedAt: NOW, ...over,
    });
}
function seedWarRecord(kv: ReturnType<typeof fakeKv>, warResources = 5000) {
    kv.store.set(villageWarKey(VILLAGE), { warResources });
}
function seedSave(kv: ReturnType<typeof fakeKv>, slug: string, char: Record<string, unknown> = {}) {
    kv.store.set(`save:${slug}`, {
        character: { name: slug, level: 100, ryo: 0, maxHp: 9000, maxChakra: 100, maxStamina: 100, stats: {}, ...char },
    });
}
const charOf = (kv: ReturnType<typeof fakeKv>, slug: string) =>
    (kv.store.get(`save:${slug}`) as { character: Record<string, unknown> }).character;
const stacksOf = (kv: ReturnType<typeof fakeKv>, slug: string) =>
    (charOf(kv, slug).itemStacks ?? []) as Array<{ itemId: string; count: number }>;

function makeRun(over: Partial<InfilRun> = {}): InfilRun {
    return {
        runId: 'r1', raiderSlug: 'raider', sector: SECTOR, targetVillage: VILLAGE,
        anbuSlug: 'anbu-one', anbuName: 'Anbu One', terrain: 'snow',
        createdAt: NOW,
    ...over };
}

function terminalSession(outcome: 'win' | 'loss' = 'win') {
    const session = buildInfiltrationEncounter({
        runId: 'r1', now: NOW, sector: SECTOR, targetVillage: VILLAGE, terrain: 'snow',
        raider: {
            slug: 'raider', name: 'raider', itemCharges: { potion: 1 },
            character: { level: 100, maxHp: 9000, maxChakra: 100, maxStamina: 100, stats: {}, jutsu: [], pvpItems: [], equipment: {} },
        },
        anbu: {
            slug: 'anbu-one', name: 'The Frostfang Anbu',
            character: { level: 100, maxHp: 9000, maxChakra: 100, maxStamina: 100, stats: {}, jutsu: [], pvpItems: [], equipment: {} },
        },
    });
    session.status = 'done';
    session.winner = outcome === 'win' ? 'player' : 'enemy';
    session.outcome = outcome;
    session.player.hp = outcome === 'win' ? 4321 : 0;
    session.itemsUsed = { potion: 1 };
    return session;
}

describe('settleInfiltrationWin', () => {
    it('both-roll: drains both pools, mints both caches + ryo, writes ledgers', async () => {
        const kv = fakeKv();
        seedTerritory(kv); seedWarRecord(kv); seedSave(kv, 'raider');
        const out = await settleInfiltrationWin(makeRun(), 0.05, deps(kv)); // both band
        assert.equal(out.ok, true);
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        assert.deepEqual(out.rolled, { supply: true, wr: true });
        assert.equal(out.supplySkim, 40);   // 1% of 4000
        assert.equal(out.wrSkim, 50);       // 1% of 5000
        assert.equal(out.supplyCaches, 40);
        assert.equal(out.wrCaches, 50);
        assert.equal(out.ryo, RAID_RYO_REWARD);
        assert.equal(out.overflowLost, 0);
        // pools drained
        assert.equal((kv.store.get(TERRITORY_KEY) as Record<string, unknown>).warSupply, 3960);
        assert.equal((kv.store.get(villageWarKey(VILLAGE)) as Record<string, unknown>).warResources, 4950);
        // caches + ryo credited
        const stacks = stacksOf(kv, 'raider');
        assert.equal(stacks.find(s => s.itemId === CACHE_ITEM_IDS.warSupply)?.count, 40);
        assert.equal(stacks.find(s => s.itemId === CACHE_ITEM_IDS.warResources)?.count, 50);
        assert.equal(charOf(kv, 'raider').ryo, RAID_RYO_REWARD);
        // ledgers written for today
        assert.deepEqual(kv.store.get(supplyLedgerKey(SECTOR)), { date: TODAY, openingBalance: 4000, lostToday: 40 });
        assert.deepEqual(kv.store.get(wrLedgerKey(villageSlug(VILLAGE))), { date: TODAY, openingBalance: 5000, lostToday: 50 });
        assert.ok(Array.isArray(charOf(kv, 'raider').serverSettlementReceipts));
    });

    it('materializes lazy accrual before skimming (stored 0, 10 days accrued)', async () => {
        const kv = fakeKv();
        const tenDaysAgo = NOW - 10 * 24 * 60 * 60 * 1000;
        seedTerritory(kv, { warSupply: 0, lastSupplyAt: tenDaysAgo });
        seedWarRecord(kv); seedSave(kv, 'raider');
        const out = await settleInfiltrationWin(makeRun(), 0.30, deps(kv)); // supply-only band
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        assert.equal(out.supplySkim, 10); // 1% of 100/day × 10 days
        const terr = kv.store.get(TERRITORY_KEY) as Record<string, unknown>;
        assert.equal(terr.warSupply, 990);        // materialized remainder
        assert.equal(terr.lastSupplyAt, NOW);     // accrual clock advanced (whole cycles consumed)
        assert.equal(out.wrSkim, 0);              // wr not rolled
        assert.equal((kv.store.get(villageWarKey(VILLAGE)) as Record<string, unknown>).warResources, 5000);
    });

    it('sector flipped mid-run → supply skim 0 (WR still drains)', async () => {
        const kv = fakeKv();
        seedTerritory(kv, { ownerVillage: 'Moonshadow Village' }); // no longer the target's
        seedWarRecord(kv); seedSave(kv, 'raider');
        const out = await settleInfiltrationWin(makeRun(), 0.05, deps(kv)); // both band
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        assert.equal(out.supplySkim, 0);
        assert.equal(out.supplyCaches, 0);
        assert.equal(out.wrSkim, 50);
        assert.equal((kv.store.get(TERRITORY_KEY) as Record<string, unknown>).warSupply, 4000); // untouched
    });

    it('daily-capped pool skims 0; ryo still granted', async () => {
        const kv = fakeKv();
        seedTerritory(kv); seedWarRecord(kv); seedSave(kv, 'raider');
        const tapped: DailyLossLedger = { date: TODAY, openingBalance: 4000, lostToday: 2000 };
        kv.store.set(supplyLedgerKey(SECTOR), tapped);
        const out = await settleInfiltrationWin(makeRun(), 0.30, deps(kv)); // supply-only
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        assert.equal(out.supplySkim, 0);
        assert.equal(out.supplyCaches, 0);
        assert.equal(out.ryo, RAID_RYO_REWARD);
        assert.equal(charOf(kv, 'raider').ryo, RAID_RYO_REWARD);
        assert.equal((kv.store.get(TERRITORY_KEY) as Record<string, unknown>).warSupply, 4000);
    });

    it('idempotent: a second settle for the same run is a no-op', async () => {
        const kv = fakeKv();
        seedTerritory(kv); seedWarRecord(kv); seedSave(kv, 'raider');
        const first = await settleInfiltrationWin(makeRun(), 0.05, deps(kv));
        assert.equal(first.ok && !first.alreadySettled, true);
        const second = await settleInfiltrationWin(makeRun(), 0.05, deps(kv));
        assert.equal(second.ok && (second as { alreadySettled?: boolean }).alreadySettled, true);
        // no double drain
        assert.equal((kv.store.get(TERRITORY_KEY) as Record<string, unknown>).warSupply, 3960);
        assert.equal(charOf(kv, 'raider').ryo, RAID_RYO_REWARD);
    });

    it('stack cap 9999: overflow is lost, not minted past the cap', async () => {
        const kv = fakeKv();
        seedTerritory(kv); seedWarRecord(kv);
        seedSave(kv, 'raider', { itemStacks: [{ itemId: CACHE_ITEM_IDS.warSupply, count: 9990 }] });
        const out = await settleInfiltrationWin(makeRun(), 0.30, deps(kv)); // supply-only: 40 caches
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        assert.equal(out.supplyCaches, 40);
        assert.equal(out.overflowLost, 31); // 9990 + 40 = 10030 → 9999
        assert.equal(stacksOf(kv, 'raider').find(s => s.itemId === CACHE_ITEM_IDS.warSupply)?.count, 9999);
        // the enemy still lost the full skim
        assert.equal((kv.store.get(TERRITORY_KEY) as Record<string, unknown>).warSupply, 3960);
    });

    it('missing raider save can retry later without draining either pool twice', async () => {
        const kv = fakeKv();
        seedTerritory(kv); seedWarRecord(kv); // no raider save
        const out = await settleInfiltrationWin(makeRun(), 0.05, deps(kv));
        assert.deepEqual(out, { ok: false, error: 'no-save' });
        assert.equal((kv.store.get(TERRITORY_KEY) as Record<string, unknown>).warSupply, 3960);
        assert.equal((kv.store.get(villageWarKey(VILLAGE)) as Record<string, unknown>).warResources, 4950);
        seedSave(kv, 'raider');
        const retry = await settleInfiltrationWin(makeRun(), 0.90, deps(kv));
        if (!retry.ok) throw new Error('retry should recover');
        assert.deepEqual(retry.rolled, { supply: true, wr: true }, 'original server roll stays sealed');
        assert.equal((kv.store.get(TERRITORY_KEY) as Record<string, unknown>).warSupply, 3960);
        assert.equal((kv.store.get(villageWarKey(VILLAGE)) as Record<string, unknown>).warResources, 4950);
        assert.equal(charOf(kv, 'raider').ryo, RAID_RYO_REWARD);
    });

    it('a failed save write retries the credit and combat usage exactly once', async () => {
        const kv = fakeKv();
        seedTerritory(kv); seedWarRecord(kv);
        seedSave(kv, 'raider', { inventory: ['potion'] });
        const originalSet = kv.set.bind(kv);
        let failSaveOnce = true;
        kv.set = async (key, value, opts) => {
            if (key === 'save:raider' && failSaveOnce) {
                failSaveOnce = false;
                throw new Error('injected save write failure');
            }
            return originalSet(key, value, opts);
        };
        const first = await settleInfiltrationWin(makeRun(), 0.05, deps(kv), terminalSession('win'));
        assert.deepEqual(first, { ok: false, error: 'credit-failed' });
        assert.equal((kv.store.get(TERRITORY_KEY) as Record<string, unknown>).warSupply, 3960);
        assert.equal((kv.store.get(villageWarKey(VILLAGE)) as Record<string, unknown>).warResources, 4950);
        assert.deepEqual(charOf(kv, 'raider').inventory, ['potion']);

        const retry = await settleInfiltrationWin(makeRun(), 0.90, deps(kv), terminalSession('win'));
        if (!retry.ok) throw new Error('retry should recover');
        assert.equal((kv.store.get(TERRITORY_KEY) as Record<string, unknown>).warSupply, 3960);
        assert.equal((kv.store.get(villageWarKey(VILLAGE)) as Record<string, unknown>).warResources, 4950);
        assert.deepEqual(charOf(kv, 'raider').inventory, []);
        assert.equal(charOf(kv, 'raider').ryo, RAID_RYO_REWARD);
        const replay = await settleInfiltrationWin(makeRun(), 0.90, deps(kv), terminalSession('win'));
        assert.equal(replay.ok && replay.alreadySettled, true);
        assert.deepEqual(charOf(kv, 'raider').inventory, []);
        assert.equal(charOf(kv, 'raider').ryo, RAID_RYO_REWARD);
    });
});

describe('settleInfiltrationLoss', () => {
    it('persists item usage and terminal outcome once, with replayable save receipt', async () => {
        const kv = fakeKv();
        seedSave(kv, 'raider', { inventory: ['potion'], hp: 9000 });
        const first = await settleInfiltrationLoss(makeRun(), terminalSession('loss'), deps(kv));
        assert.equal(first.ok && !first.alreadySettled, true);
        assert.deepEqual(charOf(kv, 'raider').inventory, []);
        const afterFirst = structuredClone(charOf(kv, 'raider'));
        const replay = await settleInfiltrationLoss(makeRun(), terminalSession('loss'), deps(kv));
        assert.equal(replay.ok && replay.alreadySettled, true);
        assert.deepEqual(charOf(kv, 'raider'), afterFirst);
    });
});

describe('turnInCachesForSave', () => {
    it('village: 1:1 into villageMerit, stack fully consumed and dropped', async () => {
        const kv = fakeKv();
        seedSave(kv, 'p1', { village: VILLAGE, itemStacks: [{ itemId: CACHE_ITEM_IDS.warResources, count: 5 }] });
        const out = await turnInCachesForSave({ playerName: 'p1', cache: 'warResources' }, deps(kv));
        assert.equal(out.ok, true);
        if (!out.ok) throw new Error('unexpected');
        assert.equal(out.dest, 'village');
        assert.equal(out.points, 5);
        assert.equal(out.consumed, 5);
        assert.equal(out.remaining, 0);
        assert.equal(charOf(kv, 'p1').villageMerit, 5);
        assert.equal(stacksOf(kv, 'p1').length, 0); // empty stack dropped
    });

    it('clan: 2:1 into clan points, odd cache left held', async () => {
        const kv = fakeKv();
        seedSave(kv, 'p1', { clan: 'Storm Clan', itemStacks: [{ itemId: CACHE_ITEM_IDS.warSupply, count: 5 }] });
        const out = await turnInCachesForSave({ playerName: 'p1', cache: 'warSupply' }, deps(kv));
        if (!out.ok) throw new Error('unexpected');
        assert.equal(out.dest, 'clan');
        assert.equal(out.points, 2);
        assert.equal(out.consumed, 4);
        assert.equal(out.remaining, 1);
        assert.equal(charOf(kv, 'p1').clanPoints, 2);
        assert.equal(stacksOf(kv, 'p1').find(s => s.itemId === CACHE_ITEM_IDS.warSupply)?.count, 1);
    });

    it('clan: clamps to the 250 per-award cap and only consumes what credits', async () => {
        const kv = fakeKv();
        seedSave(kv, 'p1', { clan: 'Storm Clan', itemStacks: [{ itemId: CACHE_ITEM_IDS.warSupply, count: 600 }] });
        const out = await turnInCachesForSave({ playerName: 'p1', cache: 'warSupply' }, deps(kv));
        if (!out.ok) throw new Error('unexpected');
        assert.equal(out.points, 250);      // raw 300 clamped to per-award 250
        assert.equal(out.consumed, 500);    // only 250×2 consumed
        assert.equal(out.remaining, 100);
        assert.equal(charOf(kv, 'p1').clanPoints, 250);
    });

    it('clan: respects the weekly-cap headroom', async () => {
        const kv = fakeKv();
        seedSave(kv, 'p1', {
            clan: 'Storm Clan',
            weeklyClanPoints: 950,
            weeklyClanPointsWeek: clanPointWeekKey(new Date(NOW)),
            itemStacks: [{ itemId: CACHE_ITEM_IDS.warSupply, count: 600 }],
        });
        const out = await turnInCachesForSave({ playerName: 'p1', cache: 'warSupply' }, deps(kv));
        if (!out.ok) throw new Error('unexpected');
        assert.equal(out.points, 50);   // 1000 − 950 headroom
        assert.equal(out.consumed, 100);
        assert.equal(out.remaining, 500);
    });

    it('clan at full weekly cap → cap-reached, nothing consumed', async () => {
        const kv = fakeKv();
        seedSave(kv, 'p1', {
            clan: 'Storm Clan',
            weeklyClanPoints: 1000,
            weeklyClanPointsWeek: clanPointWeekKey(new Date(NOW)),
            itemStacks: [{ itemId: CACHE_ITEM_IDS.warSupply, count: 10 }],
        });
        const out = await turnInCachesForSave({ playerName: 'p1', cache: 'warSupply' }, deps(kv));
        assert.deepEqual(out, { ok: false, error: 'cap-reached' });
        assert.equal(stacksOf(kv, 'p1').find(s => s.itemId === CACHE_ITEM_IDS.warSupply)?.count, 10); // untouched
    });

    it('clan without a clan → not-in-clan; nothing held → nothing-to-turn-in', async () => {
        const kv = fakeKv();
        seedSave(kv, 'p1', { itemStacks: [{ itemId: CACHE_ITEM_IDS.warSupply, count: 4 }] });
        assert.deepEqual(await turnInCachesForSave({ playerName: 'p1', cache: 'warSupply' }, deps(kv)), { ok: false, error: 'not-in-clan' });
        seedSave(kv, 'p2', {});
        assert.deepEqual(await turnInCachesForSave({ playerName: 'p2', cache: 'warResources' }, deps(kv)), { ok: false, error: 'nothing-to-turn-in' });
    });

    it('village: partial count only consumes that many', async () => {
        const kv = fakeKv();
        seedSave(kv, 'p1', { village: VILLAGE, itemStacks: [{ itemId: CACHE_ITEM_IDS.warResources, count: 10 }] });
        const out = await turnInCachesForSave({ playerName: 'p1', cache: 'warResources', count: 3 }, deps(kv));
        if (!out.ok) throw new Error('unexpected');
        assert.equal(out.points, 3);
        assert.equal(out.remaining, 7);
        assert.equal(charOf(kv, 'p1').villageMerit, 3);
    });
});

describe('Anbu roster + snapshot', () => {
    it('loadAnbuAppointees: safeNamed, deduped', async () => {
        const kv = fakeKv();
        // safeName lowercases (so 'Anbu-One' ≡ 'anbu-one') but a spaced display
        // name slugs differently ('Anbu Two' → 'anbutwo') — matching how
        // _war-role.ts compares appointees (lowercase-exact, not fuzzy).
        kv.store.set(villageStateKey(VILLAGE), { anbuAppointees: ['Anbu-One', 'anbu-one', 'Anbu Two', '', null] });
        const list = await loadAnbuAppointees(VILLAGE, deps(kv));
        assert.deepEqual(list, ['anbu-one', 'anbutwo']);
    });

    it('pickAnbuDefender: least-recently-defended rotation', async () => {
        const kv = fakeKv();
        const d = deps(kv);
        const first = await pickAnbuDefender(VILLAGE, ['anbu-b', 'anbu-a'], d);
        assert.equal(first, 'anbu-a'); // tie at 0 → slug order
        const second = await pickAnbuDefender(VILLAGE, ['anbu-b', 'anbu-a'], d);
        assert.equal(second, 'anbu-b'); // a now stamped, b is least-recent
        assert.equal(await pickAnbuDefender(VILLAGE, [], d), null);
    });

    it('getOrSealAnbuSnapshot: seals once per day and caches (stale save changes ignored)', async () => {
        const kv = fakeKv();
        seedSave(kv, 'anbu-one', { name: 'Anbu One', specialty: 'Ninjutsu', maxHp: 12000 });
        const d = deps(kv);
        const snap1 = await getOrSealAnbuSnapshot(VILLAGE, 'anbu-one', d);
        assert.ok(snap1);
        assert.equal(snap1!.name, 'Anbu One');
        assert.equal(snap1!.sealedAt, NOW);
        assert.ok(snap1!.character); // sealed combat character
        // mutate the save; same-day snapshot stays frozen
        seedSave(kv, 'anbu-one', { name: 'Renamed', maxHp: 1 });
        const snap2 = await getOrSealAnbuSnapshot(VILLAGE, 'anbu-one', d);
        assert.equal(snap2!.name, 'Anbu One');
        // no save at all → null
        assert.equal(await getOrSealAnbuSnapshot(VILLAGE, 'ghost', d), null);
    });

    it('daily attempt reservation replays the same prepared run without incrementing', async () => {
        const kv = fakeKv();
        const d = deps(kv);
        assert.deepEqual(await reserveInfilStartAttempt('raider', 'run-a', 2, d), { allowed: true, replayed: false, count: 1 });
        assert.deepEqual(await reserveInfilStartAttempt('raider', 'run-a', 2, d), { allowed: true, replayed: true, count: 1 });
        assert.deepEqual(await reserveInfilStartAttempt('raider', 'run-b', 2, d), { allowed: true, replayed: false, count: 2 });
        assert.deepEqual(await reserveInfilStartAttempt('raider', 'run-c', 2, d), { allowed: false, replayed: false, count: 2 });
        const stored = kv.store.get(infilStartCountKey('raider', TODAY)) as { count: number };
        assert.equal(stored.count, 2);
    });
});
