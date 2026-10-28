import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';

/*
 * Weekly claim markers, player balances and the currency ledger commit in one
 * exact compare-and-set transaction. Faults, retries and baseline-upgrade races
 * must never pay twice or consume an unpaid claim.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'weekly-board-claim-admin';
delete process.env.SESSION_SECRET;

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

const NAME = 'weeklyboardclaimqa';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SEASON_KEY = 'ranked:season:current';
const SEASON_GATE_KEY = 'ranked:season:authority';
const SEASON_PAUSE_KEY = 'ranked:season:admissions-paused';
const VILLAGE_KEY = 'game:village-state:frostfangvillage';

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let recordKey: string;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./weekly-board.js')).default as unknown as Handler;
    const { weekKey } = await import('./_weekly-board.js');
    // The record key below takes its week from Date.now(), and the handler
    // reads its own week from Date.now() on every call. A run that straddles
    // Monday 00:00 UTC between them would seed one week's record while the
    // handler claims against the next, which has no progress, so the claim
    // would be refused as incomplete. Hold Date (Date.now and new Date alike)
    // at one instant for the file. It is enabled after the imports, so no
    // module captures the mock clock.
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 24) });
    recordKey = `weekly-board:${NAME}:${weekKey(Date.now())}`;
    const { ensurePetRankedSeasonGate } = await import('../pet/_ranked-preparation.js');
    await kv.set(SEASON_KEY, { id: 1 });
    await ensurePetRankedSeasonGate(kv, 1, Date.now());
});

after(async () => {
    mock.timers.reset();
    for (const key of await kv.keys(`*${NAME}*`)) await kv.del(key);
    await kv.del(SEASON_KEY, SEASON_GATE_KEY, SEASON_PAUSE_KEY, VILLAGE_KEY);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

async function call(body: Json, method = 'POST'): Promise<{ statusCode: number; body?: Json }> {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(payload: Json) { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method,
        body,
        query: method === 'GET' ? body : {},
        headers: { 'content-type': 'application/json', 'x-admin-password': ADMIN_PASSWORD, 'x-forwarded-for': '127.0.0.92' },
        socket: { remoteAddress: '127.0.0.92' },
    } as never, res as never);
    return out;
}

describe('weekly board claim', { concurrency: false }, () => {
    it('assigns and pays Alpha only at level 100 with active village access', async () => {
        for (const scenario of [
            { level: 99, village: 'Frostfang Village', until: Date.now() + 86400000 },
            { level: 100, village: 'Frostfang Village', until: 0 },
            { level: 100, village: 'Frostfang Village', until: Date.now() - 1 },
            { level: 100, village: '', until: Date.now() + 86400000 },
        ]) {
            await kv.set(`save:${NAME}`, { _saveVersion: 1, character: { name: NAME, ryo: 100, level: scenario.level, village: scenario.village, hollowGateWardenKills: 500 } });
            await kv.set(recordKey, { baseline: { totalMissionsCompleted: 0, rankedWins: 0, hollowGateWardenKills: 0, fishingXp: 0, miningXp: 0 }, claimed: [] });
            await kv.set(VILLAGE_KEY, { hollowGateUnlockedUntil: scenario.until });
            const board = await call({ playerName: NAME }, 'GET');
            assert.equal((board.body!.missions as Json[]).length, 4);
            assert.equal((board.body!.missions as Json[]).some((m) => m.id === 'wk-hollow-warden'), false);
            assert.equal((await call({ playerName: NAME, missionId: 'wk-hollow-warden' })).statusCode, 403);
            assert.equal(((await kv.get<Json>(`save:${NAME}`))!.character as Json).ryo, 100);
        }
        const save = (await kv.get<Json>(`save:${NAME}`))!;
        await kv.set(`save:${NAME}`, { ...save, character: { ...(save.character as Json), village: 'Frostfang Village', hollowGateWardenKills: 0 } });
        await kv.del(recordKey);
        const available = await call({ playerName: NAME }, 'GET');
        assert.equal((available.body!.missions as Json[]).some((m) => m.id === 'wk-hollow-warden'), true);
        const started = (await kv.get<Json>(`save:${NAME}`))!;
        const target = Number((available.body!.missions as Json[]).find((m) => m.id === 'wk-hollow-warden')!.target);
        await kv.set(`save:${NAME}`, { ...started, character: { ...(started.character as Json), hollowGateWardenKills: target } });
        await kv.set(VILLAGE_KEY, { hollowGateUnlockedUntil: 0 });
        const completed = await call({ playerName: NAME }, 'GET');
        assert.equal((completed.body!.missions as Json[]).find((m) => m.id === 'wk-hollow-warden')!.complete, true);
        const paid = await call({ playerName: NAME, missionId: 'wk-hollow-warden' });
        assert.equal(paid.statusCode, 200);
        assert.equal(paid.body!.alreadyClaimed, undefined);
        await kv.set(VILLAGE_KEY, { hollowGateUnlockedUntil: 0 });
        const expired = await call({ playerName: NAME }, 'GET');
        assert.equal((expired.body!.missions as Json[]).find((m) => m.id === 'wk-hollow-warden')!.claimed, true);
        assert.equal((await call({ playerName: NAME, missionId: 'wk-hollow-warden' })).body!.alreadyClaimed, true);
        await kv.del(VILLAGE_KEY);
    });

    it('persists the four IDs and lets a player finish the same mission after unlocking ranked', async () => {
        await kv.del(recordKey);
        await kv.set(`save:${NAME}`, { _saveVersion: 1, character: { name: NAME, level: 10, ryo: 100, totalMissionsCompleted: 0 } });
        const initial = await call({ playerName: NAME }, 'GET');
        const missions = initial.body!.missions as Json[];
        const ids = missions.map((m) => m.id);
        assert.equal(ids.length, 4);
        assert.deepEqual((await kv.get<Json>(recordKey))!.missionIds, ids);
        const oldGoal = missions.find((m) => m.id === 'wk-safe-missions-20')!;
        assert.ok(oldGoal, 'fixture covers the fallback that previously vanished on level-up');
        const save = (await kv.get<Json>(`save:${NAME}`))!;
        await kv.set(`save:${NAME}`, { ...save, character: { ...(save.character as Json), level: 11, totalMissionsCompleted: Number(oldGoal.target) } });
        const after = await call({ playerName: NAME }, 'GET');
        assert.deepEqual((after.body!.missions as Json[]).map((m) => m.id), ids);
        const paid = await call({ playerName: NAME, missionId: oldGoal.id });
        assert.equal(paid.statusCode, 200);
        assert.equal(paid.body!.alreadyClaimed, undefined);
        assert.deepEqual((await kv.get<Json>(recordKey))!.missionIds, ids);
        assert.equal((await call({ playerName: NAME, missionId: 'wk-ranked-3' })).statusCode, 400);
    });

    it('availability read failures preserve unfinished assignments and progress', async () => {
        await kv.del(recordKey);
        await kv.set(VILLAGE_KEY, { hollowGateUnlockedUntil: Date.now() + 86400000 });
        await kv.set(`save:${NAME}`, { _saveVersion: 1, character: { name: NAME, level: 100, village: 'Frostfang Village', ryo: 100 } });
        const first = await call({ playerName: NAME }, 'GET');
        const ids = (first.body!.missions as Json[]).map((mission) => mission.id);
        assert.ok(ids.includes('wk-hollow-warden') && ids.includes('wk-ranked-3'));
        const save = (await kv.get<Json>(`save:${NAME}`))!;
        await kv.set(`save:${NAME}`, { ...save, character: { ...(save.character as Json), rankedWins: 2, hollowGateWardenKills: 1 } });
        const record = await kv.get<Json>(recordKey);
        for (const failedKey of [VILLAGE_KEY, SEASON_KEY]) {
            const original = kv.get;
            kv.get = async (key) => {
                if (key === failedKey) throw new Error('injected availability read failure');
                return original.call(kv, key) as never;
            };
            try {
                assert.equal((await call({ playerName: NAME }, 'GET')).statusCode, 500);
                assert.equal((await call({ playerName: NAME, missionId: 'wk-ranked-3' })).statusCode, 500);
            } finally {
                kv.get = original;
            }
            assert.deepEqual(await kv.get<Json>(recordKey), record);
            const recovered = await call({ playerName: NAME }, 'GET');
            const missions = recovered.body!.missions as Json[];
            assert.deepEqual(missions.map((mission) => mission.id), ids);
            assert.equal(missions.find((mission) => mission.id === 'wk-ranked-3')!.progress, 2);
            assert.equal(missions.find((mission) => mission.id === 'wk-hollow-warden')!.progress, 1);
            assert.equal(((await kv.get<Json>(`save:${NAME}`))!.character as Json).ryo, 100);
        }
        await kv.del(VILLAGE_KEY);
    });

    it('ranked goals require level 11 and a live unpaused season, with four replacements when unavailable', async () => {
        try {
            for (const scenario of [
                { level: 10, seasonId: 1, paused: false, available: false },
                { level: 11, seasonId: 1, paused: true, available: false },
                { level: 11, seasonId: 2, paused: false, available: false },
                { level: 11, seasonId: 1, paused: false, available: true },
            ]) {
                await kv.del(recordKey);
                await kv.set(`save:${NAME}`, { _saveVersion: 1, character: { name: NAME, ryo: 100, level: scenario.level, rankedWins: 500 } });
                await kv.set(SEASON_KEY, { id: scenario.seasonId });
                if (scenario.paused) await kv.set(SEASON_PAUSE_KEY, 1); else await kv.del(SEASON_PAUSE_KEY);
                const board = await call({ playerName: NAME }, 'GET');
                const missions = board.body!.missions as Json[];
                assert.equal(missions.length, 4);
                assert.equal(missions.some((m) => m.counter === 'rankedWins'), scenario.available);
                if (!scenario.available) assert.equal((await call({ playerName: NAME, missionId: 'wk-ranked-3' })).statusCode, 403);
            }
        } finally {
            await kv.set(SEASON_KEY, { id: 1 });
            await kv.del(SEASON_PAUSE_KEY);
        }
    });

    it('unlocking ranked cannot open a fifth payout after four completed weekly missions', async () => {
        const { pickWeeklyBoardForPlayer, weekKey } = await import('./_weekly-board.js');
        const completed = pickWeeklyBoardForPlayer(weekKey(Date.now()), { level: 1 }).map((m) => m.id);
        assert.equal(completed.length, 4);
        assert.equal(completed.includes('wk-ranked-3'), false);
        await kv.set(`save:${NAME}`, { _saveVersion: 1, character: { name: NAME, level: 11, ryo: 100,
            rankedWins: 500, totalMissionsCompleted: 500, resourceGathering: { fishingXp: 5000, miningXp: 5000 } } });
        await kv.set(recordKey, { baseline: { totalMissionsCompleted: 0, rankedWins: 0, hollowGateWardenKills: 0, fishingXp: 0, miningXp: 0 }, claimed: completed });
        const board = await call({ playerName: NAME }, 'GET');
        const missions = board.body!.missions as Json[];
        assert.equal(missions.length, 4);
        assert.ok(missions.every((m) => m.claimed));
        assert.deepEqual(new Set(missions.map((m) => m.id)), new Set(completed));
        assert.equal((await call({ playerName: NAME, missionId: 'wk-ranked-3' })).statusCode, 400);
        assert.equal(((await kv.get<Json>(`save:${NAME}`))!.character as Json).ryo, 100);
    });
    it('the current week retains its original objectives and refuses next-week resource claims', async () => {
        const future = Date.now();
        mock.timers.setTime(Date.UTC(2026, 9, 27));
        const { weekKey } = await import('./_weekly-board.js');
        const legacyKey = `weekly-board:${NAME}:${weekKey(Date.now())}`;
        try {
            await kv.set(`save:${NAME}`, { _saveVersion: 1, character: { name: NAME, level: 20, ryo: 100, totalMissionsCompleted: 0,
                resourceGathering: { fishingXp: 5000, miningXp: 5000 } } });
            const board = await call({ playerName: NAME }, 'GET');
            const missions = board.body!.missions as Json[];
            assert.deepEqual(missions.map((m) => m.target), [25, 10, 3, 15]);
            assert.equal((await call({ playerName: NAME, missionId: 'wk-fishing-500' })).statusCode, 400);
            const save = (await kv.get<Json>(`save:${NAME}`))!;
            await kv.set(`save:${NAME}`, { ...save, character: { ...(save.character as Json), totalMissionsCompleted: 10 } });
            assert.equal((await call({ playerName: NAME, missionId: 'wk-missions-10' })).statusCode, 200, 'the old 10-mission target remains claimable');
        } finally {
            await kv.del(legacyKey);
            mock.timers.setTime(future);
        }
    });
    it('a failed payout leaves both the balance and claim untouched, so retry still pays', async () => {
        await kv.del(recordKey);
        await kv.set(`save:${NAME}`, { _saveVersion: 1, character: { name: NAME, level: 20, ryo: 100,
            resourceGathering: { fishingXp: 0, miningXp: 0 } } });
        const board = await call({ playerName: NAME }, 'GET');
        const mission = (board.body!.missions as Json[]).find((m) => m.counter === 'fishingXp')!;
        const missionId = String(mission.id);
        const save = (await kv.get<Json>(`save:${NAME}`))!;
        await kv.set(`save:${NAME}`, { ...save, character: { ...(save.character as Json), resourceGathering: { fishingXp: Number(mission.target), miningXp: 0 } } });
        const original = kv.compareSet;
        kv.compareSet = async (key, expected, value, options) => {
            if (key === `save:${NAME}`) throw new Error('injected weekly payout failure');
            return original.call(kv, key, expected, value, options);
        };
        let failed;
        try { failed = await call({ playerName: NAME, missionId }); }
        finally { kv.compareSet = original; }
        assert.equal(failed.statusCode, 500);
        assert.equal(((await kv.get<Json>(`save:${NAME}`))!.character as Json).ryo, 100);
        assert.deepEqual((await kv.get<Json>(recordKey))!.claimed, []);
        const paid = await call({ playerName: NAME, missionId });
        assert.equal(paid.statusCode, 200);
        assert.equal(paid.body!.alreadyClaimed, undefined);
        const after = await kv.get<Json>(`save:${NAME}`);
        assert.equal((await call({ playerName: NAME, missionId })).body!.alreadyClaimed, true);
        assert.deepEqual(await kv.get<Json>(`save:${NAME}`), after);
    });
    it('a refused save compare-and-set leaves the claim unpaid and retryable', async () => {
        await kv.set(`save:${NAME}`, {
            _saveVersion: 1,
            _saveAt: Date.now(),
            character: { name: NAME, level: 20, ryo: 100, fateShards: 0, boneCharms: 0, totalMissionsCompleted: 500, rankedWins: 500, hollowGateWardenKills: 500,
                resourceGathering: { fishingXp: 5000, miningXp: 5000 } },
        });
        const board = await call({ playerName: NAME }, 'GET');
        const missionId = String(((board.body?.missions as Json[]) ?? [])[0]?.id ?? '');
        assert.ok(missionId);
        await kv.set(recordKey, { baseline: { totalMissionsCompleted: 0, rankedWins: 0, hollowGateWardenKills: 0, fishingXp: 0, miningXp: 0 }, claimed: [] });

        const original = kv.compareSet;
        kv.compareSet = async (key, expected, value, options) => {
            if (key === `save:${NAME}`) return false;
            return original.call(kv, key, expected, value, options);
        };
        let lost: { statusCode: number; body?: Json };
        try {
            lost = await call({ playerName: NAME, missionId });
        } finally {
            kv.compareSet = original;
        }
        assert.equal(lost.statusCode, 503);
        assert.equal(lost.body?.errorCode, 'save-version-conflict');
        assert.equal(lost.body?.retryable, true);
        assert.deepEqual((await kv.get<Json>(recordKey))?.claimed, [], 'the unpaid claim remains unconsumed');
        assert.equal(((await kv.get<Json>(`save:${NAME}`))?.character as Json).ryo, 100, 'nothing was paid');

        const paid = await call({ playerName: NAME, missionId });
        assert.equal(paid.statusCode, 200, JSON.stringify(paid.body));
        assert.equal(paid.body?.missionId, missionId);
        const reward = paid.body?.reward as Json;
        const afterPay = (await kv.get<Json>(`save:${NAME}`))?.character as Json;
        assert.equal(afterPay.ryo, 100 + Number(reward.ryo ?? 0));

        const replay = await call({ playerName: NAME, missionId });
        assert.equal(replay.statusCode, 200);
        assert.equal(replay.body?.alreadyClaimed, true);
        assert.equal(((await kv.get<Json>(`save:${NAME}`))?.character as Json).ryo, afterPay.ryo, 'paid exactly once');
        assert.deepEqual((await kv.get<Json>(recordKey))?.claimed, [missionId]);
    });

    it('initializes new activity baselines on existing boards without granting historical XP or dropping claims', async () => {
        await kv.set(`save:${NAME}`, { _saveVersion: 1, character: { name: NAME, level: 20,
            resourceGathering: { fishingXp: 3200, miningXp: 5000 } } });
        await kv.set(recordKey, { baseline: { totalMissionsCompleted: 4, rankedWins: 2, hollowGateWardenKills: 0 }, claimed: ['wk-missions-10'] });
        const first = await call({ playerName: NAME }, 'GET');
        assert.equal(first.statusCode, 200);
        const stored = (await kv.get<Json>(recordKey))!;
        assert.deepEqual(stored.claimed, ['wk-missions-10']);
        assert.equal((stored.baseline as Json).totalMissionsCompleted, 4);
        assert.equal((stored.baseline as Json).fishingXp, 3200);
        assert.equal((stored.baseline as Json).miningXp, 5000);
        for (const mission of first.body!.missions as Json[]) {
            if (mission.counter === 'fishingXp' || mission.counter === 'miningXp') assert.equal(mission.progress, 0);
        }
    });

    it('fishing and mining pay only for new skill XP and each weekly reward pays once', async () => {
        await kv.del(recordKey);
        await kv.set(`save:${NAME}`, { _saveVersion: 1, character: { name: NAME, level: 20,
            ryo: 100, resourceGathering: { fishingXp: 3200, miningXp: 5000 } } });
        const first = await call({ playerName: NAME }, 'GET');
        const activities = (first.body!.missions as Json[]).filter((m) => m.counter === 'fishingXp' || m.counter === 'miningXp');
        assert.ok(activities.some((m) => m.counter === 'fishingXp'));
        assert.ok(activities.some((m) => m.counter === 'miningXp'));
        for (const mission of activities) {
            const incomplete = await call({ playerName: NAME, missionId: mission.id });
            assert.equal(incomplete.statusCode, 400);
        }
        const save = (await kv.get<Json>(`save:${NAME}`))!;
        await kv.set(`save:${NAME}`, { ...save, character: { ...(save.character as Json), resourceGathering: {
            fishingXp: 3200 + Math.max(...activities.filter((m) => m.counter === 'fishingXp').map((m) => Number(m.target))),
            miningXp: 5000 + Math.max(...activities.filter((m) => m.counter === 'miningXp').map((m) => Number(m.target))),
        } } });
        const progress = await call({ playerName: NAME }, 'GET');
        for (const mission of (progress.body!.missions as Json[]).filter((m) => activities.some((a) => a.id === m.id))) {
            assert.equal(mission.progress, mission.target);
            const paid = await call({ playerName: NAME, missionId: mission.id });
            assert.equal(paid.statusCode, 200);
            assert.deepEqual(paid.body!.reward, mission.reward);
            const afterPay = await kv.get<Json>(`save:${NAME}`);
            const replay = await call({ playerName: NAME, missionId: mission.id });
            assert.equal(replay.body!.alreadyClaimed, true);
            assert.deepEqual(await kv.get<Json>(`save:${NAME}`), afterPay);
        }
    });

    it('a concurrent baseline upgrade refuses the whole payout, preserving progress and a retryable claim', async () => {
        await kv.set(`save:${NAME}`, { _saveVersion: 1, character: { name: NAME, level: 20, ryo: 100, rankedWins: 500,
            resourceGathering: { fishingXp: 3200, miningXp: 5000 } } });
        await kv.set(recordKey, { baseline: { totalMissionsCompleted: 0, rankedWins: 0, hollowGateWardenKills: 0 }, claimed: [] });
        const { pickWeeklyBoardForPlayer, weekKey } = await import('./_weekly-board.js');
        const missionId = pickWeeklyBoardForPlayer(weekKey(Date.now()), { level: 20 }).find((m) => m.counter === 'rankedWins')!.id;
        const original = kv.compareSetMany!;
        let upgraded = false;
        kv.compareSetMany = async (ops) => {
            if (!upgraded && ops.some((op) => op.key === recordKey)) {
                upgraded = true;
                assert.equal((await call({ playerName: NAME }, 'GET')).statusCode, 200);
            }
            return original.call(kv, ops);
        };
        let raced;
        try { raced = await call({ playerName: NAME, missionId }); }
        finally { kv.compareSetMany = original; }
        assert.equal(upgraded, true);
        assert.equal(raced.statusCode, 503);
        assert.equal(((await kv.get<Json>(`save:${NAME}`))!.character as Json).ryo, 100);
        const record = (await kv.get<Json>(recordKey))!;
        assert.deepEqual(record.claimed, []);
        assert.equal((record.baseline as Json).fishingXp, 3200);
        assert.equal((record.baseline as Json).miningXp, 5000);
        const paid = await call({ playerName: NAME, missionId });
        assert.equal(paid.statusCode, 200);
        assert.equal(paid.body!.alreadyClaimed, undefined);
        assert.equal((await call({ playerName: NAME, missionId })).body!.alreadyClaimed, true);
    });

    it('a lost payout acknowledgement commits the claim with its money and never pays a second time', async () => {
        await kv.del(recordKey);
        await kv.set(`save:${NAME}`, { _saveVersion: 1, character: { name: NAME, level: 20, ryo: 100,
            resourceGathering: { fishingXp: 0, miningXp: 0 } } });
        const board = await call({ playerName: NAME }, 'GET');
        const mission = (board.body!.missions as Json[]).find((m) => m.counter === 'miningXp')!;
        const save = (await kv.get<Json>(`save:${NAME}`))!;
        await kv.set(`save:${NAME}`, { ...save, character: { ...(save.character as Json), resourceGathering: { fishingXp: 0, miningXp: Number(mission.target) } } });
        const original = kv.compareSet;
        kv.compareSet = async (key, expected, value, options) => {
            const committed = await original.call(kv, key, expected, value, options);
            if (key === `save:${NAME}` && committed) throw new Error('injected lost weekly payout reply');
            return committed;
        };
        let paid;
        try { paid = await call({ playerName: NAME, missionId: mission.id }); }
        finally { kv.compareSet = original; }
        assert.equal(paid.statusCode, 200);
        assert.deepEqual((await kv.get<Json>(recordKey))!.claimed, [mission.id]);
        const after = await kv.get<Json>(`save:${NAME}`);
        assert.equal((after!.character as Json).ryo, 100 + Number((mission.reward as Json).ryo));
        assert.equal((await call({ playerName: NAME, missionId: mission.id })).body!.alreadyClaimed, true);
        assert.deepEqual(await kv.get<Json>(`save:${NAME}`), after);
    });
});
