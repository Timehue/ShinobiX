import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'field-trail-handler-test-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const MISSION_ID = 'fetch-d-supply-trail';
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let trailHandler: Handler;
let progressHandler: Handler;
let claimHandler: Handler;
let creditFieldRaidProgress: typeof import('./_field-raid-progress.js').creditFieldRaidProgress;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ creditFieldRaidProgress } = await import('./_field-raid-progress.js'));
    trailHandler = (await import('./field-trail.js')).default as unknown as Handler;
    progressHandler = (await import('./record-progress.js')).default as unknown as Handler;
    claimHandler = (await import('./claim-mission.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of [
        'save:fieldtrail*',
        'missions:progress:fieldtrail*',
        'missions:newbie-daily:fieldtrail*',
        'legacy:stats:fieldtrail*',
        'ratelimit:*fieldtrail*',
        'lock:*fieldtrail*',
    ]) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
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

    it('rejects stale runs, pays a completed run once, and clears acceptance authority', async () => {
        const player = 'fieldtrailclaim';
        await seedPlayer(player);
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
        const saveBeforeRaid = await kv.get<Record<string, unknown>>(`save:${player}`);
        assert.deepEqual(await creditFieldRaidProgress({
            playerName: player,
            save: saveBeforeRaid,
            proofId: 'sealed-field-raid-proof-01',
            proofAt: firstRun.acceptedAt + 10,
            raidSector: 18,
        }), [MISSION_ID]);

        const recoveredState = await post(trailHandler, player, { missionId: MISSION_ID, action: 'state' });
        const recoveredProgress = recoveredState.body?.missionProgress as Record<string, unknown>;
        assert.equal(recoveredProgress[MISSION_ID], 3);
        assert.equal(recoveredProgress[`${MISSION_ID}:raids`], 1, 'reload projects the durable ACK-lost raid receipt');

        const claim = await post(claimHandler, player, { missionType: 'field', missionId: MISSION_ID });
        assert.equal(claim.statusCode, 200);
        assert.equal(claim.body?.applied, true);
        assert.equal((claim.body?.reward as Record<string, unknown>).ryo, 75);
        const paid = claim.body?.character as Record<string, unknown>;
        assert.equal(paid.ryo, 125);
        assert.deepEqual(paid.serverFieldMissionRuns, {});

        const replay = await post(claimHandler, player, { missionType: 'field', missionId: MISSION_ID });
        assert.equal(replay.body?.applied, false);
        assert.match(String(replay.body?.reason), /already-claimed|not-accepted/);
        const afterReplay = await kv.get<Record<string, unknown>>(`save:${player}`);
        assert.equal((afterReplay?.character as Record<string, unknown>).ryo, 125);

        const reaccepted = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        assert.equal(reaccepted.statusCode, 200);
        assert.equal(reaccepted.body?.claimedToday, true);
        assert.equal(reaccepted.body?.state, null, 'same-day claim self-heals instead of creating a dead run');
        assert.equal((reaccepted.body?.acceptedMissionIds as string[]).includes(MISSION_ID), false);

        // Simulate the next UTC day by expiring today's bounded claim marker;
        // an old exploration proof must still be older than the new run nonce.
        const claimedSave = await kv.get<Record<string, unknown>>(`save:${player}`);
        const claimedCharacter = claimedSave?.character as Record<string, unknown>;
        await kv.set(`save:${player}`, {
            ...claimedSave,
            character: { ...claimedCharacter, claimedServerMissions: [] },
        });
        const nextDayAccept = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        const secondRun = stateFrom(nextDayAccept);
        assert.notEqual(secondRun.runId, firstRun.runId);
        await addExploreReceipt(player, 'fieldclaimoldproof01', firstRun.acceptedAt);
        const stale = await post(progressHandler, player, {
            missionId: MISSION_ID,
            kind: 'field-explore',
            runId: secondRun.runId,
            worldExploreRequestId: 'fieldclaimoldproof01',
        });
        assert.equal(stale.body?.recorded, false);
        assert.equal(stale.body?.reason, 'explore-proof-mismatch');

        const abandoned = await post(trailHandler, player, { missionId: MISSION_ID, action: 'abandon' });
        assert.equal(abandoned.body?.state, null);
        const staleClaim = await post(claimHandler, player, { missionType: 'field', missionId: MISSION_ID });
        assert.equal(staleClaim.body?.applied, false);
        assert.match(String(staleClaim.body?.reason), /already-claimed|not-accepted/);
    });
});
