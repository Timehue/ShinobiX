import { after, beforeEach, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { runClanBossWeekly } from './_clan-boss-weekly.js';
import { kv } from '../_storage.js';
import { drainBackgroundWork } from '../_background-work.js';
import { ECON_TXN_LIST_KEY } from '../_economy.js';
import {
    CB_REWARDS, CB_WEEK_MS, clanBossMemberRewards, clanBossProgressKey, clanBossWeekKey, type ClanBossProgress,
} from '../clan-boss/_storage.js';

// I-19 (2026-10 economy rebalance): the clan boss member pay and the podium
// treasury pay are recorded in the economy ledger by their committed credits
// only, so a second settlement pass logs nothing new. The in-memory QA backend
// is picked on the first KV call, so setting the flag here is in time.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

const WEEK = '2026-W30';
const NOW = Date.UTC(2026, 6, 27, 3, 0, 0);
const SPAWNED_AT = NOW - CB_WEEK_MS;
const MEMBERS = ['ledgerlead', 'ledgerblade'];

beforeEach(async () => {
    await drainBackgroundWork();
    for (const key of await kv.keys('*')) await kv.del(key);
});
after(drainBackgroundWork);

it('records each member payout and the podium treasury once', async () => {
    const killedAt = SPAWNED_AT + 50 * 60 * 60 * 1000;
    const progress: ClanBossProgress = {
        clanName: 'Ledger Root', weekId: WEEK, bossId: 'oni-warlord', weekStartedAt: SPAWNED_AT,
        poolMax: 100_000, pool: 0, killedAt, totalRounds: 200, participants: MEMBERS,
        memberAttempts: Object.fromEntries(MEMBERS.map((slug) => [slug, 1])),
        assaults: [{ runId: 'cboss-ledger', by: MEMBERS[0]!, party: MEMBERS, damage: 100_000, rounds: 200, wiped: false, clean: false, at: killedAt }],
        updatedAt: killedAt,
    };
    await kv.set(clanBossWeekKey(WEEK), { weekId: WEEK, bossId: 'oni-warlord', spawnedAt: SPAWNED_AT, endsAt: NOW - 60_000 });
    await kv.set(clanBossProgressKey(WEEK, progress.clanName), progress);
    await kv.set('save:clan-ledgerroot', {
        name: progress.clanName, founderName: MEMBERS[0], createdAt: 1, level: 1, xp: 0,
        members: MEMBERS.map((name) => ({ name })), treasury: { ryo: 0, fateShards: 0, boneCharms: 0 },
    });
    for (const slug of MEMBERS) await kv.set(`save:${slug}`, { character: { name: slug, clan: progress.clanName, ryo: 0, fateShards: 0 }, _saveVersion: 1 });

    assert.deepEqual((await runClanBossWeekly(NOW)).settled, [WEEK]);
    await runClanBossWeekly(NOW + 24 * 60 * 60 * 1000);
    await drainBackgroundWork();

    const txns = (await kv.get<Array<Record<string, unknown>>>(ECON_TXN_LIST_KEY)) ?? [];
    const rows = (source: string) => txns.filter((txn) => txn.source === source)
        .map((txn) => `${txn.player}:${txn.currency}:${txn.delta}`).sort();
    const expectedMembers = clanBossMemberRewards(progress).flatMap((reward) => [
        ...(reward.ryo > 0 ? [`${reward.slug}:ryo:${reward.ryo}`] : []),
        ...(reward.fateShards > 0 ? [`${reward.slug}:fateShards:${reward.fateShards}`] : []),
    ]).sort();
    assert.ok(expectedMembers.length >= 2);
    assert.deepEqual(rows('clanboss.member'), expectedMembers);
    const podium = CB_REWARDS[1];
    assert.deepEqual(rows('clanboss.treasury'), [
        `clan:ledgerroot:boneCharms:${podium.boneCharms}`,
        `clan:ledgerroot:fateShards:${podium.fateShards}`,
        `clan:ledgerroot:ryo:${podium.ryo}`,
    ].sort());
});
