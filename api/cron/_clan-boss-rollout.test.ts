import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureCurrentWeek } from './_clan-boss-weekly.js';
import { kv } from '../_storage.js';
import { clanBossWeekId, clanBossWeekKey, clanBossProgressKey } from '../clan-boss/_storage.js';
import { CLAN_BOSS_V2_START } from '../../shared/clan-boss-rules.js';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
delete process.env.DISABLE_CLAN_BOSS;

test('cron preserves this week and its earned damage, attempts, rewards and expiry', async () => {
    const now = CLAN_BOSS_V2_START - 86400000, weekId = clanBossWeekId(now), key = clanBossWeekKey(weekId);
    const week = { weekId, bossId: 'fallen-kage', spawnedAt: now - 12345, endsAt: now + 9876543 };
    const progress = { clanName: 'Preserved', weekId, poolMax: 174000, pool: 120987,
        memberAttempts: { a: 3 }, participants: ['a'], assaults: [{ runId: 'old-paid', damage: 53013 }], rewardReceipts: ['earned'] };
    const reward = { ryo: 17299, clanBossRewardReceipts: [weekId] };
    await kv.set(key, week); await kv.set(clanBossProgressKey(weekId, 'Preserved'), progress);
    await kv.set('save:clan-preserved', reward);
    assert.equal(await ensureCurrentWeek(now), null);
    assert.deepEqual(await kv.get(key), week);
    assert.deepEqual(await kv.get(clanBossProgressKey(weekId, 'Preserved')), progress);
    assert.deepEqual(await kv.get('save:clan-preserved'), reward);
});
test('missing pre-cutover week created late remains legacy', async () => {
    const now = CLAN_BOSS_V2_START - 1, key = clanBossWeekKey(clanBossWeekId(now));
    await kv.del(key);
    assert.equal(await ensureCurrentWeek(now), clanBossWeekId(now));
    const week = await kv.get<Record<string, unknown>>(key);
    assert.equal(week!.rulesVersion, undefined); assert.equal(week!.endsAt, now + 604800000);
});
test('late cron seals v2 once, using Monday start and following Monday expiry', async () => {
    const now = CLAN_BOSS_V2_START + 2 * 86400000, weekId = clanBossWeekId(now), key = clanBossWeekKey(weekId);
    await kv.del(key);
    const results = await Promise.all([ensureCurrentWeek(now), ensureCurrentWeek(now)]);
    assert.equal(results.filter(Boolean).length, 1);
    const week = await kv.get<Record<string, unknown>>(key);
    assert.equal(week!.rulesVersion, 2); assert.equal(week!.spawnedAt, CLAN_BOSS_V2_START);
    assert.equal(week!.endsAt, CLAN_BOSS_V2_START + 604800000);
});
test('existing future week without version is preserved rather than silently upgraded', async () => {
    const now = CLAN_BOSS_V2_START + 8 * 86400000, weekId = clanBossWeekId(now), key = clanBossWeekKey(weekId);
    const week = { weekId, bossId: 'oni-warlord', spawnedAt: now - 1000, endsAt: now + 12345 };
    await kv.set(key, week);
    assert.equal(await ensureCurrentWeek(now), null);
    assert.deepEqual(await kv.get(key), week);
});
