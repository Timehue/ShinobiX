import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../_storage.js').kv;
let startRankedSeason: typeof import('./_ranked-season.js').startRankedSeason;
let forceRankedSeasonRollover: typeof import('./_ranked-season.js').forceRankedSeasonRollover;
let SEASON_CURRENT_KEY: typeof import('./_ranked-season.js').SEASON_CURRENT_KEY;
let SEASON_PLAN_PREFIX: typeof import('./_ranked-season.js').SEASON_PLAN_PREFIX;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({
        startRankedSeason,
        forceRankedSeasonRollover,
        SEASON_CURRENT_KEY,
        SEASON_PLAN_PREFIX,
    } = await import('./_ranked-season.js'));
});

beforeEach(async () => {
    for (const key of await kv.keys('ranked:*')) await kv.del(key);
    for (const key of await kv.keys('save:ranked-retry-*')) await kv.del(key);
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function save(name: string, rating: number) {
    return {
        _saveVersion: 1,
        character: {
            name,
            rankedRating: rating,
            petRankedRating: 1_000,
            auraStones: 0,
            inventory: [],
            rankedSeasonsWon: 0,
        },
    };
}

describe('ranked rollover durable retry', { concurrency: false }, () => {
    it('reuses the original podium plan and never double-resets successful players', async () => {
        const champion = 'ranked-retry-champion';
        const runnerUp = 'ranked-retry-runner';
        await kv.set(`save:${champion}`, save(champion, 1_400));
        await kv.set(`save:${runnerUp}`, save(runnerUp, 1_200));
        await startRankedSeason(1_000);

        const originalSet = kv.set.bind(kv);
        let injected = false;
        kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
            if (key === `save:${runnerUp}` && !injected) {
                injected = true;
                throw new Error('injected player save failure');
            }
            return originalSet(key, value, options);
        }) as typeof kv.set;

        const partial = await forceRankedSeasonRollover(2_000);
        kv.set = originalSet as typeof kv.set;

        assert.equal(partial.ok, false);
        assert.equal(partial.action, 'skipped');
        assert.equal((await kv.get<{ id?: number }>(SEASON_CURRENT_KEY))?.id, 1, 'partial work does not advance the clock');
        assert.ok(await kv.get(`${SEASON_PLAN_PREFIX}1`), 'the original podium plan remains durable for retry');

        const championAfterPartial = await kv.get<{ character?: Record<string, unknown> }>(`save:${champion}`);
        assert.equal(championAfterPartial?.character?.rankedRating, 1_200);
        assert.equal(championAfterPartial?.character?.auraStones, 10);

        const completed = await forceRankedSeasonRollover(2_001);
        assert.equal(completed.ok, true);
        assert.equal(completed.action, 'rolled-over');
        assert.equal(completed.resetCount, 2);
        assert.equal(completed.rewardedCount, 2);
        assert.equal((await kv.get<{ id?: number }>(SEASON_CURRENT_KEY))?.id, 2);
        assert.equal(await kv.get(`${SEASON_PLAN_PREFIX}1`), null);

        const finalChampion = await kv.get<{ character?: Record<string, unknown> }>(`save:${champion}`);
        const finalRunner = await kv.get<{ character?: Record<string, unknown> }>(`save:${runnerUp}`);
        assert.equal(finalChampion?.character?.rankedRating, 1_200, 'successful first-pass reset is not applied twice');
        assert.equal(finalChampion?.character?.auraStones, 10, 'successful first-pass reward is not duplicated');
        assert.equal(finalChampion?.character?.rankedSeasonsWon, 1);
        assert.deepEqual(finalChampion?.character?.rankedSeasonSettlementReceipts, [1]);
        assert.equal(finalRunner?.character?.rankedRating, 1_100);
        assert.equal(finalRunner?.character?.auraStones, 6);
        assert.deepEqual(finalRunner?.character?.rankedSeasonSettlementReceipts, [1]);
    });
});
