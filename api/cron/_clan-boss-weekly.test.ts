import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyClanBossRewardToRecord, runClanBossWeekly } from './_clan-boss-weekly.js';

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
