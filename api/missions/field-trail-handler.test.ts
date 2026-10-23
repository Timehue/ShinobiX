import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'field-trail-handler-test-secret-32-bytes';
delete process.env.ENABLE_LEGACY;

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const MISSION_ID = 'fetch-d-supply-trail';
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let trailHandler: Handler;
let progressHandler: Handler;
let claimHandler: Handler;
let raidStartHandler: Handler;
let settleRaidProgression: typeof import('./_raid-progression.js').settleRaidProgression;
// fetch-d at an unboosted L1 player pays its catalog ryo (framework #18 re-anchor).
let fetchDRyo: number;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ settleRaidProgression } = await import('./_raid-progression.js'));
    fetchDRyo = (await import('./_mission-catalog.js')).fieldMissionById(MISSION_ID)!.ryoReward;
    trailHandler = (await import('./field-trail.js')).default as unknown as Handler;
    progressHandler = (await import('./record-progress.js')).default as unknown as Handler;
    claimHandler = (await import('./claim-mission.js')).default as unknown as Handler;
    raidStartHandler = (await import('./raid-start.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of [
        'save:fieldtrail*',
        'missions:progress:fieldtrail*',
        'missions:newbie-daily:fieldtrail*',
        'legacy:stats:fieldtrail*',
        'ratelimit:*fieldtrail*',
        'lock:*fieldtrail*',
        'combat-stat-count:fieldtrail*',
    ]) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
    for (const player of onlineStore.list()) {
        if (player.name.startsWith('fieldtrail')) onlineStore.remove(player.name);
    }
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

function request(playerName: string, body: Record<string, unknown>) {
    return {
        method: 'POST',
        body: { playerName, ...body },
        headers: {
            'content-type': 'application/json',
            'x-player-token': issuePlayerToken(playerName) ?? '',
        },
        socket: { remoteAddress: `127.0.0.${playerName.length + 10}` },
    } as never;
}

async function post(handler: Handler, playerName: string, body: Record<string, unknown>): Promise<Out> {
    const out = response();
    await handler(request(playerName, body), out.res);
    return out.out;
}

async function seedPlayer(playerName: string, overrides: Record<string, unknown> = {}) {
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        currentSector: 18,
        acceptedMissionIds: [],
        missionProgress: {},
        character: {
            name: playerName,
            level: 10,
            rankTitle: 'Genin',
            profession: 'healer',
            village: 'Stormveil Village',
            hp: 100,
            maxHp: 100,
            stamina: 10,
            maxStamina: 100,
            ryo: 50,
            inventory: [],
            unspentStats: 0,
            ...overrides,
        },
    });
}

function stateFrom(out: Out) {
    return out.body?.state as { missionId: string; runId: string; acceptedAt: number };
}

async function addExploreReceipt(playerName: string, id: string, at: number) {
    const key = `save:${playerName}`;
    const save = await kv.get<Record<string, unknown>>(key);
    const character = save?.character as Record<string, unknown>;
    const receipts = Array.isArray(character.redeemedSectorExplorations)
        ? character.redeemedSectorExplorations as unknown[]
        : [];
    await kv.set(key, {
        ...save,
        character: {
            ...character,
            redeemedSectorExplorations: [...receipts, {
                id,
                sector: 18,
                reward: { sector: 18, ryo: 0 },
                outcome: { kind: 'none' },
                at,
            }],
        },
    });
}

describe('authoritative field mission lifecycle', () => {
    it('keeps state-read throttling from blocking a contract abandonment', async () => {
        const player = 'fieldtrailratelimit';
        await seedPlayer(player);
        const accepted = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        assert.equal(accepted.statusCode, 200);
        const abandonedRun = stateFrom(accepted);
        const receiptKey = `missions:progress:${player}:${MISSION_ID}`;
        await kv.set(receiptKey, {
            playerName: player,
            missionId: MISSION_ID,
            missionType: 'field',
            runId: abandonedRun.runId,
            exploreCount: 2,
            raidCount: 1,
            huntKill: false,
            evidenceIds: ['fieldabandonproof001'],
            updatedAt: Date.now(),
        });

        // Rate-limit windows are aligned to the wall clock (floor(now / 60 s)),
        // so reads that straddle a minute boundary start a fresh window and the
        // 31st is allowed. Hold the clock still while the bucket fills.
        const realNow = Date.now;
        const heldAt = realNow();
        Date.now = () => heldAt;
        try {
            for (let index = 0; index < 30; index += 1) {
                const state = await post(trailHandler, player, { missionId: MISSION_ID, action: 'state' });
                assert.equal(state.statusCode, 200);
            }
            const throttledRead = await post(trailHandler, player, { missionId: MISSION_ID, action: 'state' });
            assert.equal(throttledRead.statusCode, 429);
        } finally {
            Date.now = realNow;
        }

        const abandoned = await post(trailHandler, player, { missionId: MISSION_ID, action: 'abandon' });
        assert.equal(abandoned.statusCode, 200, 'the state-read bucket must not consume the mutation allowance');
        assert.deepEqual(abandoned.body?.acceptedMissionIds, []);
        assert.deepEqual(abandoned.body?.missionProgress, { [MISSION_ID]: 0, [`${MISSION_ID}:raids`]: 0 });
        assert.equal(await kv.get(receiptKey), null, 'abandon removes durable progress from the ended run');
        const saved = await kv.get<Record<string, unknown>>(`save:${player}`);
        const character = saved?.character as Record<string, unknown>;
        assert.deepEqual(character.serverFieldMissionRuns, {}, 'abandon removes the active server run');

        const reaccepted = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        assert.notEqual(stateFrom(reaccepted).runId, abandonedRun.runId);
        assert.equal((reaccepted.body?.missionProgress as Record<string, unknown>)[MISSION_ID], 0);
        assert.equal((reaccepted.body?.missionProgress as Record<string, unknown>)[`${MISSION_ID}:raids`], 0);
    });

    it('accepts exactly once and legacy state recovery starts a neutral server run', async () => {
        const player = 'fieldtrailaccept';
        await seedPlayer(player);

        const first = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        const replay = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        assert.equal(first.statusCode, 200);
        assert.equal(replay.statusCode, 200);
        assert.match(stateFrom(first).runId, /^[A-Za-z0-9_-]{16,96}$/);
        assert.equal(stateFrom(replay).runId, stateFrom(first).runId);
        assert.equal(replay.body?.replayed, true);
        assert.equal(replay.body?._saveVersion, first.body?._saveVersion);

        const legacy = 'fieldtraillegacy';
        await seedPlayer(legacy);
        const saved = await kv.get<Record<string, unknown>>(`save:${legacy}`);
        await kv.set(`save:${legacy}`, {
            ...saved,
            acceptedMissionIds: [MISSION_ID],
            missionProgress: { [MISSION_ID]: 999, [`${MISSION_ID}:raids`]: 999 },
        });
        const recovered = await post(trailHandler, legacy, { missionId: MISSION_ID, action: 'state' });
        assert.equal(recovered.statusCode, 200);
        assert.equal(recovered.body?.migrated, true);
        assert.equal((recovered.body?.missionProgress as Record<string, unknown>)[MISSION_ID], 0);
        assert.equal((recovered.body?.missionProgress as Record<string, unknown>)[`${MISSION_ID}:raids`], 0);
    });

    it('allows field mission acceptance through 19 daily claims and blocks new work at 20', async (t) => {
        // The seeded lastDailyReset and the handler's own day both come from a
        // no-argument `new Date()`. A run that straddles UTC midnight would
        // seed a day the handler no longer counts, so the cap would not bite.
        // Freeze Date (Date.now and new Date alike) for the whole check.
        t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
        const today = new Date().toISOString().slice(0, 10);
        const player = 'fieldtraildailycap';
        await seedPlayer(player, { lastDailyReset: today, dailyMissionsCompleted: 19 });
        const accepted = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        assert.equal(accepted.statusCode, 200, 'the twentieth daily mission may be started');

        await post(trailHandler, player, { missionId: MISSION_ID, action: 'abandon' });
        const save = await kv.get<Record<string, unknown>>(`save:${player}`);
        const character = save?.character as Record<string, unknown>;
        await kv.set(`save:${player}`, {
            ...save,
            character: { ...character, dailyMissionsCompleted: 20 },
        });
        const capped = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        assert.equal(capped.statusCode, 409);
        assert.equal(capped.body?.reason, 'daily-cap');
    });

    it('binds explore evidence to the exact run and replays the final ACK', async () => {
        const player = 'fieldtrailproof';
        await seedPlayer(player);
        const accepted = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        const run = stateFrom(accepted);

        const proofIds = ['fieldexploreproof01', 'fieldexploreproof02', 'fieldexploreproof03'];
        for (const id of proofIds) await addExploreReceipt(player, id, run.acceptedAt + 1);

        const missingRun = await post(progressHandler, player, {
            missionId: MISSION_ID,
            kind: 'field-explore',
            worldExploreRequestId: proofIds[0],
        });
        assert.equal(missingRun.body?.recorded, false);
        assert.equal(missingRun.body?.reason, 'field-run-required');

        for (let index = 0; index < proofIds.length; index += 1) {
            const recorded = await post(progressHandler, player, {
                missionId: MISSION_ID,
                kind: 'field-explore',
                runId: run.runId,
                worldExploreRequestId: proofIds[index],
            });
            assert.equal(recorded.statusCode, 200);
            assert.equal(recorded.body?.recorded, true);
            assert.equal((recorded.body?.progress as Record<string, unknown>).exploreCount, index + 1);
        }
        const replay = await post(progressHandler, player, {
            missionId: MISSION_ID,
            kind: 'field-explore',
            runId: run.runId,
            worldExploreRequestId: proofIds[2],
        });
        assert.equal(replay.body?.recorded, true);
        assert.equal(replay.body?.replayed, true);
        assert.equal((replay.body?.progress as Record<string, unknown>).exploreCount, 3);
    });

    it('credits rival-village raids, allows distinct runs up to the shared daily cap, and rejects stale proofs', async (t) => {
        // Each field claim takes its UTC day from a no-argument `new Date()`,
        // and the daily count only grows while that day matches the one the
        // previous claim stamped. A run that straddles UTC midnight between
        // the first and second claims would restart the count, so the second
        // claim would report 1 instead of 2. Freeze Date (Date.now and new
        // Date alike) for the whole check.
        t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
        const player = 'fieldtrailclaim';
        await seedPlayer(player, { level: 1, village: 'Stormveil Village' });
        const accepted = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        const firstRun = stateFrom(accepted);
        for (const [index, id] of ['fieldclaimexplore01', 'fieldclaimexplore02', 'fieldclaimexplore03'].entries()) {
            await addExploreReceipt(player, id, firstRun.acceptedAt + index + 1);
            const recorded = await post(progressHandler, player, {
                missionId: MISSION_ID,
                kind: 'field-explore',
                runId: firstRun.runId,
                worldExploreRequestId: id,
            });
            assert.equal(recorded.body?.recorded, true);
        }
        onlineStore.upsert({ name: player, sector: 13, character: { name: player, hp: 100, maxHp: 100 } });
        const launched = await post(raidStartHandler, player, {
            requestId: 'fieldtrailclaimraidstart01', sector: 13,
        });
        assert.equal(launched.statusCode, 200);
        assert.equal(launched.body?.source, 'field-raid');
        assert.equal(launched.body?.opponentId, 'story-ai-ashen-leaf-village-4');
        const sealed = await kv.get<Record<string, unknown>>(`raid-token:${player}:${launched.body?.token}`);
        assert.equal(sealed?.sector, 13);
        const victory = await settleRaidProgression({
            playerName: player,
            proofId: 'sealed-field-raid-proof-01',
            proofAt: firstRun.acceptedAt + 10,
            sector: 13,
        });
        assert.deepEqual(victory.settlement.fetchMissionsCredited, [MISSION_ID]);

        const recoveredState = await post(trailHandler, player, { missionId: MISSION_ID, action: 'state' });
        const recoveredProgress = recoveredState.body?.missionProgress as Record<string, unknown>;
        assert.equal(recoveredProgress[MISSION_ID], 3);
        assert.equal(recoveredProgress[`${MISSION_ID}:raids`], 1, 'reload projects the durable ACK-lost raid receipt');

        const claim = await post(claimHandler, player, { missionType: 'field', missionId: MISSION_ID });
        assert.equal(claim.statusCode, 200, JSON.stringify(claim.body));
        assert.equal(claim.body?.applied, true);
        assert.equal((claim.body?.reward as Record<string, unknown>).ryo, fetchDRyo);
        const paid = claim.body?.character as Record<string, unknown>;
        assert.equal(paid.ryo, 50 + fetchDRyo);
        assert.deepEqual(paid.serverFieldMissionRuns, {});

        const replay = await post(claimHandler, player, { missionType: 'field', missionId: MISSION_ID });
        assert.equal(replay.body?.applied, false, JSON.stringify(replay.body));
        assert.match(String(replay.body?.reason), /already-claimed|not-accepted/);
        const afterReplay = await kv.get<Record<string, unknown>>(`save:${player}`);
        assert.equal((afterReplay?.character as Record<string, unknown>).ryo, 50 + fetchDRyo);

        const reaccepted = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        assert.equal(reaccepted.statusCode, 200);
        assert.equal(reaccepted.body?.state && stateFrom(reaccepted).runId !== firstRun.runId, true, 'a field mission can start another distinct run on the same UTC day');
        assert.equal((reaccepted.body?.acceptedMissionIds as string[]).includes(MISSION_ID), true);

        const secondRun = stateFrom(reaccepted);
        for (const [index, id] of ['fieldclaimexplore04', 'fieldclaimexplore05', 'fieldclaimexplore06'].entries()) {
            await addExploreReceipt(player, id, secondRun.acceptedAt + index + 1);
            const recorded = await post(progressHandler, player, {
                missionId: MISSION_ID,
                kind: 'field-explore',
                runId: secondRun.runId,
                worldExploreRequestId: id,
            });
            assert.equal(recorded.body?.recorded, true);
        }
        // The live 30-second launch throttle is independent from the daily
        // mission allowance; expire it here to model the player returning later.
        const { __resetRateLimitsForTest } = await import('../_ratelimit.js');
        __resetRateLimitsForTest();
        const secondLaunched = await post(raidStartHandler, player, {
            requestId: 'fieldtrailclaimraidstart02', sector: 13,
        });
        assert.equal(secondLaunched.statusCode, 200);
        assert.equal(secondLaunched.body?.source, 'field-raid');
        const secondVictory = await settleRaidProgression({
            playerName: player,
            proofId: 'sealed-field-raid-proof-02',
            proofAt: secondRun.acceptedAt + 10,
            sector: 13,
        });
        assert.deepEqual(secondVictory.settlement.fetchMissionsCredited, [MISSION_ID]);
        const secondClaim = await post(claimHandler, player, { missionType: 'field', missionId: MISSION_ID });
        assert.equal(secondClaim.statusCode, 200);
        assert.equal(secondClaim.body?.applied, true);
        assert.equal((secondClaim.body?.character as Record<string, unknown>).ryo, 50 + 2 * fetchDRyo);
        assert.equal((secondClaim.body?.character as Record<string, unknown>).dailyMissionsCompleted, 2);

        const replaySecond = await post(claimHandler, player, { missionType: 'field', missionId: MISSION_ID });
        assert.equal(replaySecond.body?.applied, false, 'retries of one run remain idempotent');
        assert.match(String(replaySecond.body?.reason), /already-claimed|not-accepted/);

        const abandoned = await post(trailHandler, player, { missionId: MISSION_ID, action: 'abandon' });
        assert.equal(abandoned.body?.state, null);
        // Simulate the next UTC day by expiring today's bounded claim markers;
        // an old exploration proof must still be older than the new run nonce.
        const claimedSave = await kv.get<Record<string, unknown>>(`save:${player}`);
        const claimedCharacter = claimedSave?.character as Record<string, unknown>;
        await kv.set(`save:${player}`, {
            ...claimedSave,
            character: { ...claimedCharacter, claimedServerMissions: [] },
        });
        // The held clock never moves on its own, so every run so far was
        // accepted at the same instant. Step it 1 ms forward, so this run's
        // acceptedAt is later than the first run's: the old exploration proof
        // below is then stamped before this run began, and must be refused.
        t.mock.timers.tick(1);
        const nextDayAccept = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        const thirdRun = stateFrom(nextDayAccept);
        assert.notEqual(thirdRun.runId, secondRun.runId);
        await addExploreReceipt(player, 'fieldclaimoldproof01', firstRun.acceptedAt);
        const stale = await post(progressHandler, player, {
            missionId: MISSION_ID,
            kind: 'field-explore',
            runId: thirdRun.runId,
            worldExploreRequestId: 'fieldclaimoldproof01',
        });
        assert.equal(stale.body?.recorded, false);
        assert.equal(stale.body?.reason, 'explore-proof-mismatch');

        await post(trailHandler, player, { missionId: MISSION_ID, action: 'abandon' });
        const staleClaim = await post(claimHandler, player, { missionType: 'field', missionId: MISSION_ID });
        assert.equal(staleClaim.body?.applied, false);
        assert.match(String(staleClaim.body?.reason), /already-claimed|not-accepted/);
    });

    it('pays field stat points from the one shared daily budget, never past it, with no first-N rule', async (t) => {
        // The budget row is combat-stat-count:<player>:<UTC day>, so hold one day.
        t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 17, 12, 0, 0) });
        const today = new Date().toISOString().slice(0, 10);
        const { __resetRateLimitsForTest } = await import('../_ratelimit.js');
        const { reserveDailyStatPoints } = await import('../_daily-stat-budget.js');
        // Five of today's field receipts already on the save: the retired rule
        // paid a sixth claim nothing; the shared budget pays it while it lasts.
        const seeded = Array.from({ length: 5 }, (_, i) => `${today}:field:${MISSION_ID}:seededrun${i}`);
        const claimSixth = async (player: string, budgetSpent: number) => {
            await seedPlayer(player, { level: 1, village: 'Stormveil Village', claimedServerMissions: seeded, unspentStats: 7 });
            // Earlier hunts, fights and claims today already spent `budgetSpent`.
            for (let i = 0; budgetSpent - 3 * i > 0; i += 1) {
                await reserveDailyStatPoints(kv, {
                    playerName: player, receiptId: `mission:${today}:hunt:hunt-wild-boar:earlier${i}`, eventAt: Date.now(),
                    requested: Math.min(3, budgetSpent - 3 * i),
                });
            }
            const run = stateFrom(await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' }));
            for (const [index, id] of [`${player}ex01`, `${player}ex02`, `${player}ex03`].entries()) {
                await addExploreReceipt(player, id, run.acceptedAt + index + 1);
                const recorded = await post(progressHandler, player, {
                    missionId: MISSION_ID, kind: 'field-explore', runId: run.runId, worldExploreRequestId: id,
                });
                assert.equal(recorded.body?.recorded, true, JSON.stringify(recorded.body));
            }
            onlineStore.upsert({ name: player, sector: 13, character: { name: player, hp: 100, maxHp: 100 } });
            __resetRateLimitsForTest();
            const launched = await post(raidStartHandler, player, { requestId: `${player}raidstart01`, sector: 13 });
            assert.equal(launched.statusCode, 200, JSON.stringify(launched.body));
            await settleRaidProgression({ playerName: player, proofId: `sealed-${player}-raid`, proofAt: run.acceptedAt + 10, sector: 13 });
            const claim = await post(claimHandler, player, { missionType: 'field', missionId: MISSION_ID });
            assert.equal(claim.statusCode, 200, JSON.stringify(claim.body));
            assert.equal(claim.body?.applied, true, JSON.stringify(claim.body));
            assert.equal((claim.body?.reward as Record<string, unknown>).ryo, fetchDRyo, 'ryo still pays on every claim');
            return claim;
        };

        const open = await claimSixth('fieldtrailopen', 0);
        assert.equal((open.body?.reward as Record<string, unknown>).statPoints, 3, 'a sixth field claim pays while the budget lasts');
        assert.equal((open.body?.character as Record<string, unknown>).unspentStats, 10);
        assert.deepEqual(open.body?.statBudget, { day: today, spent: 3, cap: 60 }, 'the reply carries the day\'s budget');

        const last = await claimSixth('fieldtraillast', 58);
        assert.equal((last.body?.reward as Record<string, unknown>).statPoints, 2, 'the claim pays what is left of the budget');
        assert.equal((last.body?.character as Record<string, unknown>).unspentStats, 9);
        assert.deepEqual(last.body?.statBudget, { day: today, spent: 60, cap: 60 });

        const spent = await claimSixth('fieldtrailspent', 60);
        assert.equal((spent.body?.reward as Record<string, unknown>).statPoints, 0, 'a spent budget pays no stat points');
        assert.equal((spent.body?.character as Record<string, unknown>).unspentStats, 7);
        assert.deepEqual(spent.body?.statBudget, { day: today, spent: 60, cap: 60 });
    });
});
