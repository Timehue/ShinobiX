import { beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyClanBossRewardToRecord, runClanBossWeekly } from './_clan-boss-weekly.js';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { ANNOUNCEMENTS_KEY, type Announcement } from '../_announce.js';
import { dissolveClanUnderLock } from '../clan/_dissolve.js';
import {
    CB_REWARDS, CB_WEEK_MS, clanBossArchiveKey, clanBossMemberRewards, clanBossProgressKey,
    clanBossWeekKey, type ClanBossProgress,
} from '../clan-boss/_storage.js';

// The enabled-path tests run the real cron against the isolated in-memory QA
// store. The backend is picked on the first KV call, not at import, so setting
// these after the hoisted imports still takes effect.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

describe('Clan Boss weekly reward record', () => {
    const reward = { ryo: 30_000, fateShards: 3, boneCharms: 5, clanXp: 1_500 };

    it('commits treasury values and the weekly receipt in one record mutation', () => {
        const initial = {
            level: 1,
            xp: 0,
            members: Array.from({ length: 10 }, (_, i) => ({ name: `member-${i}` })),
            treasury: { ryo: 200, fateShards: 1, boneCharms: 2 },
        };
        const result = applyClanBossRewardToRecord(initial, reward, '2026-W29');
        assert.equal(result.applied, true);
        assert.deepEqual(result.record.treasury, { ryo: 30_200, fateShards: 4, boneCharms: 7 });
        assert.deepEqual(result.record.clanBossRewardReceipts, ['2026-W29']);
        assert.ok(Number(result.record.xp) > 0);
    });

    it('replays the same week without adding currency or XP twice', () => {
        const first = applyClanBossRewardToRecord({
            level: 1,
            xp: 0,
            members: Array.from({ length: 10 }, (_, i) => ({ name: `member-${i}` })),
            treasury: { ryo: 0, fateShards: 0, boneCharms: 0 },
        }, reward, '2026-W29');
        const replay = applyClanBossRewardToRecord(first.record, reward, '2026-W29');
        assert.equal(replay.applied, false);
        assert.deepEqual(replay.record, first.record);
    });

    it('keeps distinct weeks independently payable', () => {
        const first = applyClanBossRewardToRecord({ members: [], treasury: {} }, reward, '2026-W29');
        const second = applyClanBossRewardToRecord(first.record, reward, '2026-W30');
        assert.equal(second.applied, true);
        assert.deepEqual(second.record.clanBossRewardReceipts, ['2026-W29', '2026-W30']);
        assert.equal((second.record.treasury as Record<string, unknown>).ryo, 60_000);
    });
});

describe('Clan Boss weekly release gate', () => {
    it('preserves the disabled no-op response under the exact core kill switch', async () => {
        const previous = process.env.DISABLE_CLAN_BOSS;
        process.env.DISABLE_CLAN_BOSS = '1';
        try {
            assert.deepEqual(await runClanBossWeekly(), { enabled: false, spawned: null, settled: [] });
        } finally {
            if (previous === undefined) delete process.env.DISABLE_CLAN_BOSS;
            else process.env.DISABLE_CLAN_BOSS = previous;
        }
    });
});

describe('Clan Boss weekly settlement with a dissolved participant', () => {
    const WEEK = '2026-W30';
    const DAY = 24 * 60 * 60 * 1000;
    // Monday 03:00 UTC, the daily cron slot, just after WEEK ended.
    const NOW = Date.UTC(2026, 6, 27, 3, 0, 0);
    const SPAWNED_AT = NOW - CB_WEEK_MS;
    const START_RYO = 100;

    type Clan = { name: string; slug: string; members: string[]; poolMax: number; pool: number; killedAfterHours?: number };
    // Scores put the dissolved clan at #2, between two live clans, so the test
    // sees both that the loop runs past it and that nobody moves up a rank.
    const IRON_ROOT: Clan = { name: 'Iron Root', slug: 'ironroot', members: ['ironlead', 'ironblade'], poolMax: 100_000, pool: 0, killedAfterHours: 50 };
    const FALLEN_LEAF: Clan = { name: 'Fallen Leaf', slug: 'fallenleaf', members: ['leafwisp', 'leafgale'], poolMax: 60_000, pool: 0, killedAfterHours: 60 };
    const EMBER_PACT: Clan = { name: 'Ember Pact', slug: 'emberpact', members: ['embercoal'], poolMax: 30_000, pool: 10_000 };
    const CLANS = [IRON_ROOT, FALLEN_LEAF, EMBER_PACT];

    function progressFor(clan: Clan): ClanBossProgress {
        const killedAt = clan.killedAfterHours === undefined ? undefined : SPAWNED_AT + clan.killedAfterHours * 60 * 60 * 1000;
        const at = killedAt ?? SPAWNED_AT + 70 * 60 * 60 * 1000;
        return {
            clanName: clan.name,
            weekId: WEEK,
            bossId: 'oni-warlord',
            weekStartedAt: SPAWNED_AT,
            poolMax: clan.poolMax,
            pool: clan.pool,
            ...(killedAt === undefined ? {} : { killedAt }),
            totalRounds: 200,
            participants: clan.members,
            memberAttempts: Object.fromEntries(clan.members.map((slug) => [slug, 1])),
            assaults: [{
                runId: `cboss-${clan.slug}`, by: clan.members[0]!, party: clan.members,
                damage: clan.poolMax - clan.pool, rounds: 200, wiped: killedAt === undefined, clean: false, at,
            }],
            updatedAt: at,
        };
    }

    /** Seed an ended week with three ranked clans, then dissolve Fallen Leaf the real way. */
    async function seedWeekWithDissolvedParticipant(): Promise<Map<string, { ryo: number; fateShards: number }>> {
        await kv.set(clanBossWeekKey(WEEK), { weekId: WEEK, bossId: 'oni-warlord', spawnedAt: SPAWNED_AT, endsAt: NOW - 60_000 });
        const memberRewards = new Map<string, { ryo: number; fateShards: number }>();
        for (const clan of CLANS) {
            const progress = progressFor(clan);
            await kv.set(clanBossProgressKey(WEEK, clan.name), progress);
            for (const reward of clanBossMemberRewards(progress)) memberRewards.set(reward.slug, { ryo: reward.ryo, fateShards: reward.fateShards });
            await kv.set(`save:clan-${clan.slug}`, {
                name: clan.name,
                founderName: clan.members[0],
                createdAt: 1,
                level: 1,
                xp: 0,
                members: clan.members.map((name) => ({ name })),
                treasury: { ryo: 500, fateShards: 1, boneCharms: 0 },
            });
            for (const slug of clan.members) {
                await kv.set(`save:${slug}`, { character: { name: slug, clan: clan.name, ryo: START_RYO, fateShards: 0 }, _saveVersion: 1 });
            }
        }

        const dissolvedKey = `save:clan-${FALLEN_LEAF.slug}`;
        await withKvLock(dissolvedKey, async () => {
            const record = await kv.get<Record<string, unknown>>(dissolvedKey);
            await dissolveClanUnderLock(dissolvedKey, record, FALLEN_LEAF.members[0]);
        }, { failClosed: true });
        // The shape that used to wedge settlement: no clan record, but the week's
        // progress survives the dissolution and still earns a podium reward.
        assert.equal(await kv.get(dissolvedKey), null);
        assert.notEqual(await kv.get(clanBossProgressKey(WEEK, FALLEN_LEAF.name)), null);
        return memberRewards;
    }

    async function assertPaidExactlyOnce(memberRewards: Map<string, { ryo: number; fateShards: number }>): Promise<void> {
        for (const [clan, rank] of [[IRON_ROOT, 1], [EMBER_PACT, 3]] as const) {
            const record = await kv.get<Record<string, unknown>>(`save:clan-${clan.slug}`);
            const reward = CB_REWARDS[rank];
            assert.deepEqual(record?.treasury, {
                ryo: 500 + reward.ryo,
                fateShards: 1 + reward.fateShards,
                boneCharms: reward.boneCharms,
            }, `${clan.name} is paid its own rank-${rank} reward exactly once`);
            assert.deepEqual(record?.clanBossRewardReceipts, [WEEK]);
        }
        // The dropped share is not written anywhere, and the clan is not resurrected.
        assert.equal(await kv.get(`save:clan-${FALLEN_LEAF.slug}`), null);

        assert.equal(memberRewards.size, 5);
        for (const [slug, reward] of memberRewards) {
            assert.ok(reward.ryo > 0, `${slug} earned a personal payout`);
            const character = (await kv.get<{ character: Record<string, unknown> }>(`save:${slug}`))?.character;
            assert.equal(character?.ryo, START_RYO + reward.ryo, `${slug} is paid exactly once`);
            assert.equal(character?.fateShards, reward.fateShards, `${slug} gets its Fate Shards exactly once`);
            assert.deepEqual(character?.clanBossWeeksPaid, [WEEK]);
        }
    }

    beforeEach(async () => {
        for (const key of await kv.keys('*')) await kv.del(key);
    });

    it('drops the dissolved clan\'s share and settles the week for everyone else', async (t) => {
        const warn = t.mock.method(console, 'warn', () => undefined);
        const memberRewards = await seedWeekWithDissolvedParticipant();

        const first = await runClanBossWeekly(NOW);
        assert.deepEqual(first.settled, [WEEK]);
        const second = await runClanBossWeekly(NOW + DAY);
        assert.deepEqual(second.settled, [], 'the next daily run finds nothing left to settle');

        assert.equal((await kv.get<{ settled?: boolean }>(clanBossWeekKey(WEEK)))?.settled, true);
        const archive = await kv.get<{ standings: Array<{ clanName: string; rank: number }> }>(clanBossArchiveKey(WEEK));
        assert.deepEqual(
            archive?.standings.map(({ clanName, rank }) => [clanName, rank]),
            [['Iron Root', 1], ['Fallen Leaf', 2], ['Ember Pact', 3]],
            'ranks are kept as earned; nobody is promoted into the dropped slot',
        );
        await assertPaidExactlyOnce(memberRewards);

        const dropLogs = warn.mock.calls.map((call) => String(call.arguments[0])).filter((line) => line.startsWith('[clan-boss-weekly]'));
        assert.equal(dropLogs.length, 1, 'the drop is logged once, by the run that settled the week');
        assert.match(dropLogs[0]!, /Fallen Leaf/);
    });

    it('resumes a run that failed after paying out without paying anyone twice', async (t) => {
        t.mock.method(console, 'warn', () => undefined);
        const memberRewards = await seedWeekWithDissolvedParticipant();
        const set = kv.set.bind(kv);
        let failSettledFlag = true;
        // Fail the LAST write, so the retry replays every payout, the archive and
        // the announcement.
        t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
            const [key, value] = args;
            if (failSettledFlag && key === clanBossWeekKey(WEEK) && (value as { settled?: boolean }).settled === true) {
                failSettledFlag = false;
                throw new Error('simulated storage failure');
            }
            return set(...args);
        });

        await assert.rejects(() => runClanBossWeekly(NOW), /simulated storage failure/);
        assert.equal((await kv.get<{ settled?: boolean }>(clanBossWeekKey(WEEK)))?.settled, undefined);
        await assertPaidExactlyOnce(memberRewards);

        const resumed = await runClanBossWeekly(NOW + DAY);
        assert.deepEqual(resumed.settled, [WEEK]);
        assert.equal((await kv.get<{ settled?: boolean }>(clanBossWeekKey(WEEK)))?.settled, true);
        assert.notEqual(await kv.get(clanBossArchiveKey(WEEK)), null);
        await assertPaidExactlyOnce(memberRewards);
        const results = ((await kv.get<Announcement[]>(ANNOUNCEMENTS_KEY)) ?? []).filter((entry) => entry.type === 'clan-boss-results');
        assert.equal(results.length, 1, 'the resumed run does not announce the week twice');
    });
});
