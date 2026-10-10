import { beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
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
} from './_anbu-infiltration-store.js';
import { buildInfiltrationEncounter } from './_anbu-infiltration-encounter.js';
import { kv } from './_storage.js';
import { villageWarKey } from './_war-state.js';
import { clanPointWeekKey } from './_clan-points.js';
import { CACHE_ITEM_IDS, RAID_RYO_REWARD, type DailyLossLedger } from './_anbu-infiltration.js';

// Player saves commit through mutatePlayerSave on the GLOBAL kv, and sealing a
// defender snapshot loads the admin combat catalog from it too, so the whole
// suite runs on its in-memory backend: the pools, ledgers and journal as well,
// through the store's default deps. The global backend is chosen lazily on
// first use, so setting the flag here is in time despite the hoisted imports.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Json = Record<string, unknown>;

const NOW = Date.UTC(2026, 6, 10, 12, 0, 0);
const TODAY = '2026-07-10';
const now = () => NOW;
const deps = { now };

const SECTOR = 12;
const VILLAGE = 'Frostfang Village';
const TERRITORY_KEY = `world:territory:${SECTOR}`;

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

async function seedTerritory(over: Json = {}) {
    await kv.set(TERRITORY_KEY, {
        sector: SECTOR, ownerVillage: VILLAGE, ownerClan: 'Storm Clan',
        warSupply: 4000, lastSupplyAt: NOW, updatedAt: NOW, ...over,
    });
}
async function seedWarRecord(warResources = 5000) {
    await kv.set(villageWarKey(VILLAGE), { warResources });
}
async function seedSave(slug: string, char: Json = {}, record: Json = {}) {
    await kv.set(`save:${slug}`, {
        ...record,
        character: { name: slug, level: 100, ryo: 0, maxHp: 9000, maxChakra: 100, maxStamina: 100, stats: {}, ...char },
    });
}
/** A save whose regeneration cursor is 30 s old: one point per second in each 100-point pool. */
async function seedTiredSave(slug: string, char: Json = {}) {
    const at = Date.now() - 30_000;
    await seedSave(slug, { hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100, ...char }, { _saveAt: at, _regenAt: at });
}
const read = async (key: string) => (await kv.get<Json>(key))!;
const charOf = async (slug: string) => (await read(`save:${slug}`)).character as Json;
const stacksOf = async (slug: string) => ((await charOf(slug)).itemStacks ?? []) as Array<{ itemId: string; count: number }>;

function assertRecovered(character: Json, where: string, pools: Array<'hp' | 'chakra' | 'stamina'>) {
    const floor = { hp: 40, chakra: 50, stamina: 30 };
    for (const pool of pools) {
        assert.ok(Number(character[pool]) >= floor[pool], `${where}: ${pool} ${character[pool]} lost the idle recovery`);
    }
}

/** Let another writer commit to `saveKey` between the next settle's read and its write. */
async function racing<T>(saveKey: string, edit: (character: Json) => Json, run: () => Promise<T>): Promise<T> {
    const original = kv.compareSet;
    let raced = false;
    kv.compareSet = async (key, expected, value, options) => {
        if (!raced && key === saveKey) {
            raced = true;
            const current = await read(saveKey);
            await kv.set(saveKey, { ...current, _saveVersion: Number(current._saveVersion ?? 0) + 1, character: edit(current.character as Json) });
        }
        return original.call(kv, key, expected, value, options);
    };
    try {
        return await run();
    } finally {
        kv.compareSet = original;
        assert.ok(raced, 'the race was injected');
    }
}

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

describe('settleInfiltrationWin', { concurrency: false }, () => {
    it('both-roll: drains both pools, mints both caches + ryo, writes ledgers', async () => {
        await seedTerritory(); await seedWarRecord(); await seedSave('raider');
        const out = await settleInfiltrationWin(makeRun(), 0.05, deps); // both band
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
        assert.equal((await read(TERRITORY_KEY)).warSupply, 3960);
        assert.equal((await read(villageWarKey(VILLAGE))).warResources, 4950);
        // caches + ryo credited
        const stacks = await stacksOf('raider');
        assert.equal(stacks.find(s => s.itemId === CACHE_ITEM_IDS.warSupply)?.count, 40);
        assert.equal(stacks.find(s => s.itemId === CACHE_ITEM_IDS.warResources)?.count, 50);
        assert.equal((await charOf('raider')).ryo, RAID_RYO_REWARD);
        // ledgers written for today
        assert.deepEqual(await kv.get(supplyLedgerKey(SECTOR)), { date: TODAY, openingBalance: 4000, lostToday: 40 });
        assert.deepEqual(await kv.get(wrLedgerKey(villageSlug(VILLAGE))), { date: TODAY, openingBalance: 5000, lostToday: 50 });
        assert.ok(Array.isArray((await charOf('raider')).serverSettlementReceipts));
        assert.equal((await read('save:raider'))._saveVersion, out.saveVersion, 'the reply echoes the committed version');
    });

    it('materializes lazy accrual before skimming (stored 0, 10 days accrued)', async () => {
        const tenDaysAgo = NOW - 10 * 24 * 60 * 60 * 1000;
        await seedTerritory({ warSupply: 0, lastSupplyAt: tenDaysAgo });
        await seedWarRecord(); await seedSave('raider');
        const out = await settleInfiltrationWin(makeRun(), 0.30, deps); // supply-only band
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        assert.equal(out.supplySkim, 10); // 1% of 100/day × 10 days
        const terr = await read(TERRITORY_KEY);
        assert.equal(terr.warSupply, 990);        // materialized remainder
        assert.equal(terr.lastSupplyAt, NOW);     // accrual clock advanced (whole cycles consumed)
        assert.equal(out.wrSkim, 0);              // wr not rolled
        assert.equal((await read(villageWarKey(VILLAGE))).warResources, 5000);
    });

    it('sector flipped mid-run → supply skim 0 (WR still drains)', async () => {
        await seedTerritory({ ownerVillage: 'Moonshadow Village' }); // no longer the target's
        await seedWarRecord(); await seedSave('raider');
        const out = await settleInfiltrationWin(makeRun(), 0.05, deps); // both band
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        assert.equal(out.supplySkim, 0);
        assert.equal(out.supplyCaches, 0);
        assert.equal(out.wrSkim, 50);
        assert.equal((await read(TERRITORY_KEY)).warSupply, 4000); // untouched
    });

    it('daily-capped pool skims 0; ryo still granted', async () => {
        await seedTerritory(); await seedWarRecord(); await seedSave('raider');
        const tapped: DailyLossLedger = { date: TODAY, openingBalance: 4000, lostToday: 2000 };
        await kv.set(supplyLedgerKey(SECTOR), tapped);
        const out = await settleInfiltrationWin(makeRun(), 0.30, deps); // supply-only
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        assert.equal(out.supplySkim, 0);
        assert.equal(out.supplyCaches, 0);
        assert.equal(out.ryo, RAID_RYO_REWARD);
        assert.equal((await charOf('raider')).ryo, RAID_RYO_REWARD);
        assert.equal((await read(TERRITORY_KEY)).warSupply, 4000);
    });

    it('idempotent: a second settle for the same run is a no-op', async () => {
        await seedTerritory(); await seedWarRecord(); await seedSave('raider');
        const first = await settleInfiltrationWin(makeRun(), 0.05, deps);
        assert.equal(first.ok && !first.alreadySettled, true);
        const second = await settleInfiltrationWin(makeRun(), 0.05, deps);
        assert.equal(second.ok && (second as { alreadySettled?: boolean }).alreadySettled, true);
        // no double drain
        assert.equal((await read(TERRITORY_KEY)).warSupply, 3960);
        assert.equal((await charOf('raider')).ryo, RAID_RYO_REWARD);
    });

    it('stack cap 9999: overflow is lost, not minted past the cap', async () => {
        await seedTerritory(); await seedWarRecord();
        await seedSave('raider', { itemStacks: [{ itemId: CACHE_ITEM_IDS.warSupply, count: 9990 }] });
        const out = await settleInfiltrationWin(makeRun(), 0.30, deps); // supply-only: 40 caches
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        assert.equal(out.supplyCaches, 40);
        assert.equal(out.overflowLost, 31); // 9990 + 40 = 10030 → 9999
        assert.equal((await stacksOf('raider')).find(s => s.itemId === CACHE_ITEM_IDS.warSupply)?.count, 9999);
        // the enemy still lost the full skim
        assert.equal((await read(TERRITORY_KEY)).warSupply, 3960);
    });

    it('missing raider save can retry later without draining either pool twice', async () => {
        await seedTerritory(); await seedWarRecord(); // no raider save
        const out = await settleInfiltrationWin(makeRun(), 0.05, deps);
        assert.deepEqual(out, { ok: false, error: 'no-save' });
        assert.equal((await read(TERRITORY_KEY)).warSupply, 3960);
        assert.equal((await read(villageWarKey(VILLAGE))).warResources, 4950);
        await seedSave('raider');
        const retry = await settleInfiltrationWin(makeRun(), 0.90, deps);
        if (!retry.ok) throw new Error('retry should recover');
        assert.deepEqual(retry.rolled, { supply: true, wr: true }, 'original server roll stays sealed');
        assert.equal((await read(TERRITORY_KEY)).warSupply, 3960);
        assert.equal((await read(villageWarKey(VILLAGE))).warResources, 4950);
        assert.equal((await charOf('raider')).ryo, RAID_RYO_REWARD);
    });

    it('a failed save write retries the credit and combat usage exactly once', async () => {
        await seedTerritory(); await seedWarRecord();
        await seedSave('raider', { inventory: ['potion'] });
        const original = kv.compareSet;
        let failSaveOnce = true;
        kv.compareSet = async (key, expected, value, options) => {
            if (key === 'save:raider' && failSaveOnce) {
                failSaveOnce = false;
                throw new Error('injected save write failure');
            }
            return original.call(kv, key, expected, value, options);
        };
        let first: Awaited<ReturnType<typeof settleInfiltrationWin>>;
        try {
            first = await settleInfiltrationWin(makeRun(), 0.05, deps, terminalSession('win'));
        } finally {
            kv.compareSet = original;
        }
        assert.deepEqual(first, { ok: false, error: 'credit-failed' });
        assert.equal((await read(TERRITORY_KEY)).warSupply, 3960);
        assert.equal((await read(villageWarKey(VILLAGE))).warResources, 4950);
        assert.deepEqual((await charOf('raider')).inventory, ['potion']);

        const retry = await settleInfiltrationWin(makeRun(), 0.90, deps, terminalSession('win'));
        if (!retry.ok) throw new Error('retry should recover');
        assert.equal((await read(TERRITORY_KEY)).warSupply, 3960);
        assert.equal((await read(villageWarKey(VILLAGE))).warResources, 4950);
        assert.deepEqual((await charOf('raider')).inventory, []);
        assert.equal((await charOf('raider')).ryo, RAID_RYO_REWARD);
        const replay = await settleInfiltrationWin(makeRun(), 0.90, deps, terminalSession('win'));
        assert.equal(replay.ok && replay.alreadySettled, true);
        assert.deepEqual((await charOf('raider')).inventory, []);
        assert.equal((await charOf('raider')).ryo, RAID_RYO_REWARD);
    });

    it('a lost compare-and-set credits the fresh save once and drains each pool once', async () => {
        await seedTerritory(); await seedWarRecord(); await seedSave('raider');
        const out = await racing('save:raider', (character) => ({ ...character, ryo: 777 }),
            () => settleInfiltrationWin(makeRun(), 0.05, deps, terminalSession('win')));
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        const raider = await charOf('raider');
        assert.equal(raider.ryo, 777 + RAID_RYO_REWARD, "the other writer's commit survives and the raid pays once");
        assert.equal((await stacksOf('raider')).find(s => s.itemId === CACHE_ITEM_IDS.warSupply)?.count, 40);
        // The raid's own receipt, plus the generic fight-outcome receipt it
        // stamps so a later /api/pve/fight-outcome call is a replay.
        assert.equal((raider.serverSettlementReceipts as unknown[]).length, 2);
        assert.equal((await read(TERRITORY_KEY)).warSupply, 3960);
        assert.equal((await read(villageWarKey(VILLAGE))).warResources, 4950);
    });

    it('keeps the chakra and stamina the raider recovered while the raid ran', async () => {
        // The fight writes HP only. A raw version bump fenced the regeneration
        // cursor to the write and threw away every point recovered since the
        // last save.
        await seedTerritory(); await seedWarRecord(); await seedTiredSave('raider');
        const out = await settleInfiltrationWin(makeRun(), 0.05, deps, terminalSession('win'));
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        assertRecovered(out.character, 'reply', ['chakra', 'stamina']);
        assertRecovered(await charOf('raider'), 'committed save', ['chakra', 'stamina']);
    });
});

describe('settleInfiltrationLoss', { concurrency: false }, () => {
    it('persists item usage and terminal outcome once, with replayable save receipt', async () => {
        await seedSave('raider', { inventory: ['potion'], hp: 9000 });
        const first = await settleInfiltrationLoss(makeRun(), terminalSession('loss'), deps);
        assert.equal(first.ok && !first.alreadySettled, true);
        assert.deepEqual((await charOf('raider')).inventory, []);
        const afterFirst = structuredClone(await charOf('raider'));
        const replay = await settleInfiltrationLoss(makeRun(), terminalSession('loss'), deps);
        assert.equal(replay.ok && replay.alreadySettled, true);
        assert.deepEqual(await charOf('raider'), afterFirst);
    });

    it('keeps the chakra and stamina recovered before the knockout', async () => {
        await seedTiredSave('raider');
        const out = await settleInfiltrationLoss(makeRun(), terminalSession('loss'), deps);
        if (!out.ok || out.alreadySettled) throw new Error('unexpected');
        assert.equal(out.character.hp, 0);
        assert.equal(out.character.hospitalized, true);
        assertRecovered(out.character, 'reply', ['chakra', 'stamina']);
        assertRecovered(await charOf('raider'), 'committed save', ['chakra', 'stamina']);
    });
});

// The raid's HP and hospital stay are written by this settlement AND by the
// client's generic /api/pve/fight-outcome, from the same sealed session under
// different receipts. The generic call used to write them again, later: HP went
// back UP to the raid's end value after the raider had lost HP elsewhere, and a
// lost raid re-ran its hospital stay.
describe('a raid\'s physical consequence lands once across both settle paths', { concurrency: false }, () => {
    it('a later generic outcome call after a won raid is a replay, not a heal', async () => {
        const { settlePveFightOutcome } = await import('./pve/_fight-outcome-settlement.js');
        await seedTerritory(); await seedWarRecord();
        await seedSave('raider', { hp: 9000 });
        const session = terminalSession('win');
        const won = await settleInfiltrationWin(makeRun(), 0.05, deps, session);
        assert.equal(won.ok, true);
        assert.equal((await charOf('raider')).hp, 4321, 'the raid wrote its end HP');

        const save = await read('save:raider');
        await kv.set('save:raider', { ...save, character: { ...(save.character as Json), hp: 100 } }); // hurt elsewhere
        const late = await settlePveFightOutcome(session, 'raider');
        assert.equal(late.ok && late.applied, false, 'the generic call is a replay');
        assert.equal((await charOf('raider')).hp, 100, 'and heals nothing');
    });

    it('a generic outcome call that lands first is not doubled by the raid settlement', async () => {
        const { settlePveFightOutcome } = await import('./pve/_fight-outcome-settlement.js');
        await seedSave('raider', { inventory: ['potion'], hp: 9000 });
        const session = terminalSession('loss');
        const first = await settlePveFightOutcome(session, 'raider');
        assert.equal(first.ok && first.applied, true);
        const hospitalizedUntil = (await charOf('raider')).hospitalizedUntil;

        const loss = await settleInfiltrationLoss(makeRun(), session, deps);
        assert.equal(loss.ok && !loss.alreadySettled, true);
        assert.equal((await charOf('raider')).hospitalizedUntil, hospitalizedUntil, 'the hospital stay is not run again');
        assert.deepEqual((await charOf('raider')).inventory, [], 'the raid still charges the items it used');
    });
});

describe('turnInCachesForSave', { concurrency: false }, () => {
    it('village: 1:1 into villageMerit, stack fully consumed and dropped', async () => {
        await seedSave('p1', { village: VILLAGE, itemStacks: [{ itemId: CACHE_ITEM_IDS.warResources, count: 5 }] });
        const out = await turnInCachesForSave({ playerName: 'p1', cache: 'warResources' }, deps);
        assert.equal(out.ok, true);
        if (!out.ok) throw new Error('unexpected');
        assert.equal(out.dest, 'village');
        assert.equal(out.points, 5);
        assert.equal(out.consumed, 5);
        assert.equal(out.remaining, 0);
        assert.equal((await charOf('p1')).villageMerit, 5);
        assert.equal((await stacksOf('p1')).length, 0); // empty stack dropped
        assert.equal((await read('save:p1'))._saveVersion, out.saveVersion, 'the reply echoes the committed version');
    });

    it('clan: 2:1 into clan points, odd cache left held', async () => {
        await seedSave('p1', { clan: 'Storm Clan', itemStacks: [{ itemId: CACHE_ITEM_IDS.warSupply, count: 5 }] });
        const out = await turnInCachesForSave({ playerName: 'p1', cache: 'warSupply' }, deps);
        if (!out.ok) throw new Error('unexpected');
        assert.equal(out.dest, 'clan');
        assert.equal(out.points, 2);
        assert.equal(out.consumed, 4);
        assert.equal(out.remaining, 1);
        assert.equal((await charOf('p1')).clanPoints, 2);
        assert.equal((await stacksOf('p1')).find(s => s.itemId === CACHE_ITEM_IDS.warSupply)?.count, 1);
    });

    it('clan: clamps to the 250 per-award cap and only consumes what credits', async () => {
        await seedSave('p1', { clan: 'Storm Clan', itemStacks: [{ itemId: CACHE_ITEM_IDS.warSupply, count: 600 }] });
        const out = await turnInCachesForSave({ playerName: 'p1', cache: 'warSupply' }, deps);
        if (!out.ok) throw new Error('unexpected');
        assert.equal(out.points, 250);      // raw 300 clamped to per-award 250
        assert.equal(out.consumed, 500);    // only 250×2 consumed
        assert.equal(out.remaining, 100);
        assert.equal((await charOf('p1')).clanPoints, 250);
    });

    it('clan: respects the weekly-cap headroom', async () => {
        await seedSave('p1', {
            clan: 'Storm Clan',
            weeklyClanPoints: 950,
            weeklyClanPointsWeek: clanPointWeekKey(new Date(NOW)),
            itemStacks: [{ itemId: CACHE_ITEM_IDS.warSupply, count: 600 }],
        });
        const out = await turnInCachesForSave({ playerName: 'p1', cache: 'warSupply' }, deps);
        if (!out.ok) throw new Error('unexpected');
        assert.equal(out.points, 50);   // 1000 − 950 headroom
        assert.equal(out.consumed, 100);
        assert.equal(out.remaining, 500);
    });

    it('clan at full weekly cap → cap-reached, nothing consumed', async () => {
        await seedSave('p1', {
            clan: 'Storm Clan',
            weeklyClanPoints: 1000,
            weeklyClanPointsWeek: clanPointWeekKey(new Date(NOW)),
            itemStacks: [{ itemId: CACHE_ITEM_IDS.warSupply, count: 10 }],
        });
        const out = await turnInCachesForSave({ playerName: 'p1', cache: 'warSupply' }, deps);
        assert.deepEqual(out, { ok: false, error: 'cap-reached' });
        assert.equal((await stacksOf('p1')).find(s => s.itemId === CACHE_ITEM_IDS.warSupply)?.count, 10); // untouched
    });

    it('clan without a clan → not-in-clan; nothing held → nothing-to-turn-in', async () => {
        await seedSave('p1', { itemStacks: [{ itemId: CACHE_ITEM_IDS.warSupply, count: 4 }] });
        assert.deepEqual(await turnInCachesForSave({ playerName: 'p1', cache: 'warSupply' }, deps), { ok: false, error: 'not-in-clan' });
        await seedSave('p2', {});
        assert.deepEqual(await turnInCachesForSave({ playerName: 'p2', cache: 'warResources' }, deps), { ok: false, error: 'nothing-to-turn-in' });
    });

    it('a missing save → no-save', async () => {
        assert.deepEqual(await turnInCachesForSave({ playerName: 'ghost', cache: 'warResources' }, deps), { ok: false, error: 'no-save' });
    });

    it('village: partial count only consumes that many', async () => {
        await seedSave('p1', { village: VILLAGE, itemStacks: [{ itemId: CACHE_ITEM_IDS.warResources, count: 10 }] });
        const out = await turnInCachesForSave({ playerName: 'p1', cache: 'warResources', count: 3 }, deps);
        if (!out.ok) throw new Error('unexpected');
        assert.equal(out.points, 3);
        assert.equal(out.remaining, 7);
        assert.equal((await charOf('p1')).villageMerit, 3);
    });

    it('a lost compare-and-set re-runs on the fresh save and consumes the count once', async () => {
        await seedSave('p1', { village: VILLAGE, itemStacks: [{ itemId: CACHE_ITEM_IDS.warResources, count: 10 }] });
        const out = await racing('save:p1', (character) => ({ ...character, ryo: 777 }),
            () => turnInCachesForSave({ playerName: 'p1', cache: 'warResources', count: 3 }, deps));
        if (!out.ok) throw new Error('unexpected');
        const p1 = await charOf('p1');
        assert.equal(p1.ryo, 777, "the other writer's commit survives");
        assert.equal(p1.villageMerit, 3);
        assert.equal((await stacksOf('p1')).find(s => s.itemId === CACHE_ITEM_IDS.warResources)?.count, 7);
    });

    it('keeps the HP, chakra and stamina recovered since the last save', async () => {
        // A turn-in touches no vital, so all three pools keep their recovery.
        await seedTiredSave('p1', { village: VILLAGE, itemStacks: [{ itemId: CACHE_ITEM_IDS.warResources, count: 5 }] });
        const out = await turnInCachesForSave({ playerName: 'p1', cache: 'warResources' }, deps);
        if (!out.ok) throw new Error('unexpected');
        assertRecovered(await charOf('p1'), 'committed save', ['hp', 'chakra', 'stamina']);
    });
});

describe('Anbu roster + snapshot', { concurrency: false }, () => {
    it('loadAnbuAppointees: safeNamed, deduped', async () => {
        // safeName lowercases (so 'Anbu-One' ≡ 'anbu-one') but a spaced display
        // name slugs differently ('Anbu Two' → 'anbutwo') — matching how
        // _war-role.ts compares appointees (lowercase-exact, not fuzzy).
        await kv.set(villageStateKey(VILLAGE), { anbuAppointees: ['Anbu-One', 'anbu-one', 'Anbu Two', '', null] });
        await seedSave('anbu-one', { village: VILLAGE });
        await seedSave('anbutwo', { village: VILLAGE });
        const list = await loadAnbuAppointees(VILLAGE, deps);
        assert.deepEqual(list, ['anbu-one', 'anbutwo']);
    });

    it('pickAnbuDefender: least-recently-defended rotation', async () => {
        const first = await pickAnbuDefender(VILLAGE, ['anbu-b', 'anbu-a'], deps);
        assert.equal(first, 'anbu-a'); // tie at 0 → slug order
        const second = await pickAnbuDefender(VILLAGE, ['anbu-b', 'anbu-a'], deps);
        assert.equal(second, 'anbu-b'); // a now stamped, b is least-recent
        assert.equal(await pickAnbuDefender(VILLAGE, [], deps), null);
    });

    it('getOrSealAnbuSnapshot: seals once per day and caches (stale save changes ignored)', async () => {
        await seedSave('anbu-one', { name: 'Anbu One', specialty: 'Ninjutsu', maxHp: 12000 });
        const snap1 = await getOrSealAnbuSnapshot(VILLAGE, 'anbu-one', deps);
        assert.ok(snap1);
        assert.equal(snap1!.name, 'Anbu One');
        assert.equal(snap1!.sealedAt, NOW);
        assert.ok(snap1!.character); // sealed combat character
        // mutate the save; same-day snapshot stays frozen
        await seedSave('anbu-one', { name: 'Renamed', maxHp: 1 });
        const snap2 = await getOrSealAnbuSnapshot(VILLAGE, 'anbu-one', deps);
        assert.equal(snap2!.name, 'Anbu One');
        // no save at all → null
        assert.equal(await getOrSealAnbuSnapshot(VILLAGE, 'ghost', deps), null);
    });

    it('daily attempt reservation replays the same prepared run without incrementing', async () => {
        assert.deepEqual(await reserveInfilStartAttempt('raider', 'run-a', 2, deps), { allowed: true, replayed: false, count: 1 });
        assert.deepEqual(await reserveInfilStartAttempt('raider', 'run-a', 2, deps), { allowed: true, replayed: true, count: 1 });
        assert.deepEqual(await reserveInfilStartAttempt('raider', 'run-b', 2, deps), { allowed: true, replayed: false, count: 2 });
        assert.deepEqual(await reserveInfilStartAttempt('raider', 'run-c', 2, deps), { allowed: false, replayed: false, count: 2 });
        const stored = (await kv.get<{ count: number }>(infilStartCountKey('raider', TODAY)))!;
        assert.equal(stored.count, 2);
    });
});
