import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildingSharedKey } from '../../shared/sector-buildings.js';
import { applyRuinBattleDamage, readSharedBuilding } from '../../shared/sector-building-state.js';
import { BUILDING_RUIN_BATTLE_DAMAGE } from '../../shared/sector-building-rules.js';
import type { KvCasOp, KvLike } from '../_storage.js';
import { reduceBuildingAction } from './_building-actions.js';
import { BUILDING_REPAIR_INGREDIENTS } from '../../shared/sector-building-content.js';

// The building lock runs against the isolated in-memory store.
process.env.SHINOBIX_QA_MEMORY_KV = '1'; process.env.NODE_ENV = 'test';
let damageRuinsForWorldBattle: typeof import('./_ruin-battle-damage.js').damageRuinsForWorldBattle;
let kv: KvLike;
before(async () => {
    ({ damageRuinsForWorldBattle } = await import('./_ruin-battle-damage.js'));
    ({ kv } = await import('../_storage.js'));
});
beforeEach(async () => {
    for (const key of await kv.keys('world:building:*')) await kv.del(key);
});
const now = Date.parse('2026-11-07T12:00:00Z'), hour = 3_600_000, day = 24 * hour;

test('a world battle takes twelve hours off a standing ruin and can bring it down early',()=>{
    const standing = { repairs: 30, cycleRepairs: 24, intactUntil: now + 3 * day, updatedAt: now };
    const hit = applyRuinBattleDamage(standing, 'battle-1', now)!;
    assert.equal(hit.intactUntil, now + 3 * day - BUILDING_RUIN_BATTLE_DAMAGE.standingMs);assert.equal(hit.stage, 3);
    assert.equal(applyRuinBattleDamage(hit, 'battle-1', now), undefined, 'a replayed battle counts once');
    const nearlyDone = applyRuinBattleDamage({ ...standing, intactUntil: now + 2 * hour }, 'battle-2', now)!;
    assert.equal(nearlyDone.stage, 0, 'a restoration with less than the damage left falls at once');
    assert.equal(nearlyDone.intactUntil, undefined);assert.equal(nearlyDone.cycleRepairs, 0);assert.equal(nearlyDone.repairs, 30, 'lifetime work is kept');
});

test('a battle sets unfinished work back, a bare ruin has nothing to lose, and each day allows four damaging battles',()=>{
    const building = applyRuinBattleDamage({ repairs: 13, cycleRepairs: 13, cycleAt: now }, 'battle-a', now)!;
    assert.equal(building.cycleRepairs, 13 - BUILDING_RUIN_BATTLE_DAMAGE.cycleRepairs);assert.equal(building.stage, 1);
    assert.equal(building.cycleAt, now, 'damage does not restart the idle-fade clock');
    assert.equal(applyRuinBattleDamage({ repairs: 40, cycleRepairs: 0 }, 'battle-b', now + 30 * day), undefined, 'a bare ruin is not damaged further');
    let row: unknown = { repairs: 30, cycleRepairs: 24, intactUntil: now + 6 * day, updatedAt: now };
    for (let i = 0; i < BUILDING_RUIN_BATTLE_DAMAGE.dailyLimit; i++) row = applyRuinBattleDamage(row, `battle-day-${i}`, now)!;
    assert.equal(applyRuinBattleDamage(row, 'battle-day-extra', now), undefined, 'the fifth battle in a day does nothing');
    // A battle the limit skipped stays skipped when settlement replays after midnight.
    assert.equal(applyRuinBattleDamage(row, 'battle-day-extra', now + day, now), undefined, 'the cap is keyed to the day the battle ended');
    const nextDay = applyRuinBattleDamage(row, 'battle-next-day', now + day);
    assert.ok(nextDay);
    assert.equal(applyRuinBattleDamage(nextDay, 'battle-from-yesterday', now + day, now), undefined, 'a battle older than the last damage day is ignored');
    assert.ok(nextDay, 'the limit resets the next UTC day');
    // The bookkeeping survives an ordinary read-and-write by the repair counter.
    const reread = readSharedBuilding(JSON.parse(JSON.stringify(nextDay)));
    assert.ok(reread.damagedBy?.includes('battle-next-day'));
});

test('only the ruins of the battle sector are damaged, once, under their own row',async()=>{
    const rows = new Map<string, unknown>([
        [buildingSharedKey('festival-welcome'), { repairs: 30, cycleRepairs: 24, intactUntil: now + 3 * day, updatedAt: now }],
        [buildingSharedKey('festival-steps-house'), { repairs: 5, cycleRepairs: 5, cycleAt: now }],
        [buildingSharedKey('gorgewatch'), { repairs: 30, cycleRepairs: 24, intactUntil: now + 3 * day, updatedAt: now }],
    ]);
    for (const [key, row] of rows) await kv.set(key, row);
    assert.deepEqual((await damageRuinsForWorldBattle(kv, 'raid-52', 52, now)).sort(), ['festival-steps-house', 'festival-welcome']);
    assert.deepEqual(await damageRuinsForWorldBattle(kv, 'raid-52', 52, now), [], 'a replayed terminal saga damages nothing more');
    assert.equal((await kv.get<{ intactUntil: number }>(buildingSharedKey('gorgewatch')))!.intactUntil, now + 3 * day, 'other sectors are untouched');
    assert.deepEqual(await damageRuinsForWorldBattle(kv, 'raid-x', 0, now), [], 'no sector, no damage');
});

const key = buildingSharedKey('gorgewatch');
const receiptKey = (id: string) => `${key}:battle:${encodeURIComponent(id)}`;
const work = (cycleRepairs = 10) => ({ repairs: 30, cycleRepairs, cycleAt: now, updatedAt: now });

async function repairTwice() {
    const picks = ['gather-iron-sand', 'hunt-torn-hide', 'gather-river-fish', 'gather-binding-fiber'];
    const materials = BUILDING_REPAIR_INGREDIENTS.map((row, i) => ({ [picks[i]]: row.count }));
    let character: Record<string, unknown> = { name: 'Builder', level: 100, ryo: 0,
        itemStacks: BUILDING_REPAIR_INGREDIENTS.map((row, i) => ({ itemId: picks[i], count: row.count * 2 })) };
    let row: unknown = await kv.get(key);
    for (let repair = 0; repair < 2; repair++) {
        const at = now + (repair + 1) * 60_000, orderId = `repair-${repair}`;
        const context = { now: at, orderId, displayName: 'Builder' };
        let result = reduceBuildingAction(character, { action: 'begin', service: 'repair', buildingId: 'gorgewatch', materials, requestId: `${orderId}-begin` }, row, context);
        assert.ok(result.ok); character = result.character;
        for (let step = 0; step < 3; step++) {
            result = reduceBuildingAction(character, { action: 'step', buildingId: 'gorgewatch', orderId, step, requestId: `${orderId}-${step}` }, row, { ...context, now: at + (step + 1) * 6000 });
            assert.ok(result.ok); character = result.character; row = result.shared;
        }
        await kv.set(key, row);
    }
    return row;
}

test('a bare or missing ruin receipts a battle before repairs; replay cannot damage the two new repairs', async () => {
    for (const initial of [null, work(0)]) {
        await kv.del(key); await kv.del(receiptKey('bare-battle'));
        if (initial) await kv.set(key, initial);
        assert.deepEqual(await damageRuinsForWorldBattle(kv, 'bare-battle', 38, now), []);
        assert.deepEqual(await kv.get(key), initial, 'a no-op does not rewrite or create the building');
        assert.deepEqual(await kv.get(receiptKey('bare-battle')), { battleAt: now });
        const repaired = await repairTwice();
        assert.equal(readSharedBuilding(repaired, { now: now + hour }).cycleRepairs, 2);
        assert.deepEqual(await damageRuinsForWorldBattle(kv, 'bare-battle', 38, now + hour, now), []);
        assert.deepEqual(await kv.get(key), repaired, 'ordinary repair writes cannot reopen a no-op');
        assert.deepEqual(await damageRuinsForWorldBattle(kv, 'fresh-battle', 38, now + hour), ['gorgewatch']);
        assert.equal(readSharedBuilding(await kv.get(key), { now: now + hour }).cycleRepairs, 0);
        await kv.del(receiptKey('fresh-battle'));
    }
});

test('no-op receipts do not consume the cap or suppress an unprocessed, delayed same-day battle', async () => {
    await damageRuinsForWorldBattle(kv, 'later-noop', 38, now + hour);
    await kv.set(key, work());
    assert.deepEqual(await damageRuinsForWorldBattle(kv, 'delayed-first-settlement', 38, now + 2 * hour, now), ['gorgewatch']);
    for (let i = 0; i < 3; i++) assert.deepEqual(await damageRuinsForWorldBattle(kv, `hit-${i}`, 38, now + 2 * hour), ['gorgewatch']);
    const capped = await kv.get(key);
    assert.deepEqual(await damageRuinsForWorldBattle(kv, 'capped', 38, now + 2 * hour), []);
    assert.deepEqual(await kv.get(key), capped);
    assert.ok(await kv.get(receiptKey('capped')), 'capped battles get durable no-op receipts too');
    assert.deepEqual(await damageRuinsForWorldBattle(kv, 'capped', 38, now + day, now), []);
    assert.deepEqual(await damageRuinsForWorldBattle(kv, 'tomorrow', 38, now + day), ['gorgewatch']);
});

test('a later-day no-op does not fence out a delayed first settlement from an earlier day', async () => {
    assert.deepEqual(await damageRuinsForWorldBattle(kv, 'tomorrow-noop', 38, now + day), []);
    await kv.set(key, work());
    assert.deepEqual(await damageRuinsForWorldBattle(kv, 'yesterday-delayed', 38, now + day + hour, now), ['gorgewatch']);
    const damaged = readSharedBuilding(await kv.get(key), { now: now + day + hour });
    assert.equal(damaged.cycleRepairs, 8);
    assert.equal(damaged.damageDay, '2026-11-07');
    assert.equal(damaged.damageToday, 1);
});

test('a receipt survives recent-id eviction, serialization, and subsequent restoration cycles', async (t) => {
    await kv.set(key, work());
    await damageRuinsForWorldBattle(kv, 'original', 38, now);
    // Other building writers parse and serialize communal rows. Even loss of
    // the bounded display/history list cannot reopen the durable receipt.
    await kv.set(key, JSON.parse(JSON.stringify({ ...readSharedBuilding(await kv.get(key)), damagedBy: [], damageDay: undefined, damageToday: undefined, ...work() })));
    const repaired = await kv.get(key);
    const future = Date.now() + 31 * day;
    t.mock.method(Date, 'now', () => future);
    assert.deepEqual(await damageRuinsForWorldBattle(kv, 'original', 38, now + 30 * day, now), []);
    assert.deepEqual(await kv.get(key), repaired);
});

test('building conflicts leave no receipt and retry against the new repair state', async () => {
    for (const initial of [null, work()]) {
        await kv.del(key); await kv.del(receiptKey('conflict'));
        if (initial) await kv.set(key, initial);
        const racing = { get: kv.get.bind(kv), compareSetMany: async (ops: readonly KvCasOp[]) => {
            await kv.set(key, work(12));
            return kv.compareSetMany!(ops);
        } };
        assert.deepEqual(await damageRuinsForWorldBattle(racing, 'conflict', 38, now), []);
        assert.equal(await kv.get(receiptKey('conflict')), null);
        assert.deepEqual(await damageRuinsForWorldBattle(kv, 'conflict', 38, now), ['gorgewatch']);
        assert.equal(readSharedBuilding(await kv.get(key), { now }).cycleRepairs, 10);
    }
});

test('a failed receipt write rolls back damage; a lost commit reply is safe to replay', async (t) => {
    await kv.set(key, work());
    const compareSet = kv.compareSet.bind(kv);
    t.after(() => { kv.compareSet = compareSet; });
    kv.compareSet = async (name, expected, value, options) => name === receiptKey('refused') ? false : compareSet(name, expected, value, options);
    assert.deepEqual(await damageRuinsForWorldBattle(kv, 'refused', 38, now), []);
    assert.deepEqual(await kv.get(key), work(), 'a refused receipt rolls back its paired building damage');
    assert.equal(await kv.get(receiptKey('refused')), null);
    kv.compareSet = compareSet;
    assert.deepEqual(await damageRuinsForWorldBattle(kv, 'refused', 38, now), ['gorgewatch']);
    const lostReply = { get: kv.get.bind(kv), compareSetMany: async (ops: readonly KvCasOp[]) => {
        await kv.compareSetMany!(ops); throw new Error('lost COMMIT acknowledgement');
    } };
    t.mock.method(console, 'error', () => {});
    await damageRuinsForWorldBattle(lostReply, 'lost-reply', 38, now);
    const committed = await kv.get(key);
    assert.equal(readSharedBuilding(committed, { now }).cycleRepairs, 6);
    assert.deepEqual(await damageRuinsForWorldBattle(kv, 'lost-reply', 38, now), []);
    assert.deepEqual(await kv.get(key), committed);
});

test('an adapter without atomic multi-key support fails closed without damage or a receipt', async (t) => {
    await kv.set(key, work());
    t.mock.method(console, 'error', () => {});
    assert.deepEqual(await damageRuinsForWorldBattle({ get: kv.get.bind(kv) }, 'no-atomic', 38, now), []);
    assert.deepEqual(await kv.get(key), work());
    assert.equal(await kv.get(receiptKey('no-atomic')), null);
});

test('simultaneous duplicate and distinct battles cannot overwrite repairs or exceed the daily cap', async () => {
    await kv.set(key, work(20));
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => damageRuinsForWorldBattle(kv, `concurrent-${Math.floor(i / 2)}`, 38, now)));
    assert.equal(results.flat().length, 3, 'duplicates commit exactly once');
    assert.equal(readSharedBuilding(await kv.get(key), { now }).cycleRepairs, 14);
    const last = await Promise.all(['fourth', 'fifth'].map(id => damageRuinsForWorldBattle(kv, id, 38, now)));
    assert.equal(last.flat().length, 1);
    assert.equal(readSharedBuilding(await kv.get(key), { now }).damageToday, 4);
});
