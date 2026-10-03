import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('../_storage.js').kv;
let startRankedSeason: typeof import('./_ranked-season.js').startRankedSeason;
let forceRankedSeasonRollover: typeof import('./_ranked-season.js').forceRankedSeasonRollover;
let SEASON_CURRENT_KEY: typeof import('./_ranked-season.js').SEASON_CURRENT_KEY;
let SEASON_PLAN_PREFIX: typeof import('./_ranked-season.js').SEASON_PLAN_PREFIX;
let SEASON_ARCHIVE_PREFIX: typeof import('./_ranked-season.js').SEASON_ARCHIVE_PREFIX;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({
        startRankedSeason,
        forceRankedSeasonRollover,
        SEASON_CURRENT_KEY,
        SEASON_PLAN_PREFIX,
        SEASON_ARCHIVE_PREFIX,
    } = await import('./_ranked-season.js'));
});

/** Reads come back as Postgres returns them: the JSON form, so an undefined field is gone. */
function readAsPostgres(): () => void {
    const originalGet = kv.get.bind(kv);
    kv.get = (async <T,>(key: string) => {
        const value = await originalGet<T>(key);
        return value === null ? null : JSON.parse(JSON.stringify(value)) as T;
    }) as typeof kv.get;
    return () => { kv.get = originalGet as typeof kv.get; };
}

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

        const originalCompareSet = kv.compareSet.bind(kv);
        let injected = false;
        kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
            if (key === `save:${runnerUp}` && !injected) {
                injected = true;
                throw new Error('injected player save failure');
            }
            return originalCompareSet(key, expected, value, options);
        }) as typeof kv.compareSet;

        const partial = await forceRankedSeasonRollover(2_000);
        kv.compareSet = originalCompareSet as typeof kv.compareSet;

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

    it('retries a partial rollover when the stored archive comes back in the JSON form', async () => {
        // These saves have no village, so the archive's standings carry
        // `village: undefined`. Postgres drops that key, so the retry's rebuilt
        // archive never deep-equalled the stored one: every later rollover threw
        // ranked-season-immutable-conflict and the season stayed closing.
        const champion = 'ranked-retry-json-champion';
        const runnerUp = 'ranked-retry-json-runner';
        await kv.set(`save:${champion}`, save(champion, 1_400));
        await kv.set(`save:${runnerUp}`, save(runnerUp, 1_200));
        await startRankedSeason(1_000);

        const restoreGet = readAsPostgres();
        const originalCompareSet = kv.compareSet.bind(kv);
        let injected = false;
        kv.compareSet = (async (key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) => {
            if (key === `save:${runnerUp}` && !injected) {
                injected = true;
                throw new Error('injected player save failure');
            }
            return originalCompareSet(key, expected, value, options);
        }) as typeof kv.compareSet;
        try {
            const partial = await forceRankedSeasonRollover(2_000);
            assert.equal(partial.ok, false);
            assert.equal(partial.action, 'skipped');
            kv.compareSet = originalCompareSet as typeof kv.compareSet;

            const completed = await forceRankedSeasonRollover(2_001);
            assert.equal(completed.ok, true, JSON.stringify(completed));
            assert.equal(completed.action, 'rolled-over');
            assert.equal((await kv.get<{ id?: number }>(SEASON_CURRENT_KEY))?.id, 2);
        } finally {
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
            restoreGet();
        }
    });

    it('completes the rollover when the archive write lands but loses its reply', async () => {
        const champion = 'ranked-retry-json-archive';
        await kv.set(`save:${champion}`, save(champion, 1_400));
        await startRankedSeason(1_000);

        const restoreGet = readAsPostgres();
        const originalSet = kv.set.bind(kv);
        let lostReplies = 0;
        kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
            const written = await originalSet(key, value, options);
            if (!key.startsWith(SEASON_ARCHIVE_PREFIX) || written !== 'OK' || lostReplies > 0) return written;
            lostReplies += 1;
            throw new Error('Connection terminated unexpectedly');
        }) as typeof kv.set;
        try {
            const rolled = await forceRankedSeasonRollover(2_000);
            assert.equal(lostReplies, 1, 'the archive landed and only its reply was lost');
            assert.equal(rolled.ok, true, JSON.stringify(rolled));
            assert.equal(rolled.action, 'rolled-over');
        } finally {
            kv.set = originalSet as typeof kv.set;
            restoreGet();
        }
    });
});
