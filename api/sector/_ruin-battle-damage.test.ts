import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { buildingSharedKey } from '../../shared/sector-buildings.js';
import { applyRuinBattleDamage, readSharedBuilding } from '../../shared/sector-building-state.js';
import { BUILDING_RUIN_BATTLE_DAMAGE } from '../../shared/sector-building-rules.js';

// The building lock runs against the isolated in-memory store.
process.env.SHINOBIX_QA_MEMORY_KV = '1'; process.env.NODE_ENV = 'test';
let damageRuinsForWorldBattle: typeof import('./_ruin-battle-damage.js').damageRuinsForWorldBattle;
before(async () => { ({ damageRuinsForWorldBattle } = await import('./_ruin-battle-damage.js')); });
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
    const kv = { get: async <T>(key: string) => (rows.get(key) ?? null) as T | null,
        compareSet: async (key: string, expected: unknown, value: unknown) => {
            if (JSON.stringify(rows.get(key) ?? null) !== JSON.stringify(expected)) return false;rows.set(key, value);return true;
        } };
    assert.deepEqual((await damageRuinsForWorldBattle(kv, 'raid-52', 52, now)).sort(), ['festival-steps-house', 'festival-welcome']);
    assert.deepEqual(await damageRuinsForWorldBattle(kv, 'raid-52', 52, now), [], 'a replayed terminal saga damages nothing more');
    assert.equal((rows.get(buildingSharedKey('gorgewatch')) as { intactUntil: number }).intactUntil, now + 3 * day, 'other sectors are untouched');
    assert.deepEqual(await damageRuinsForWorldBattle(kv, 'raid-x', 0, now), [], 'no sector, no damage');
});
