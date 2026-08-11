import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { playerRankedV2AdmissionsEnabled } from './_player-ranked-rollout.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'player-ranked-rollout-test-secret';
delete process.env.ENABLE_PLAYER_RANKED_V2;
delete process.env.DISABLE_PLAYER_RANKED_V2;

type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

function response() {
    const out: { statusCode: number; body?: Record<string, unknown> } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Record<string, unknown>) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

function request(action: 'join' | 'leave' | 'poll', name = 'rolloutalice') {
    return {
        method: 'POST',
        body: { name, action },
        query: {},
        headers: {
            'x-player-token': issuePlayerToken(name),
            'x-forwarded-for': '127.0.0.1',
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./ranked-queue.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.ENABLE_PLAYER_RANKED_V2;
    delete process.env.DISABLE_PLAYER_RANKED_V2;
});

test('rollout helper is default-off, exact-enable, and kill-switch dominant', () => {
    assert.equal(playerRankedV2AdmissionsEnabled({}), false);
    assert.equal(playerRankedV2AdmissionsEnabled({ ENABLE_PLAYER_RANKED_V2: 'true' }), false);
    assert.equal(playerRankedV2AdmissionsEnabled({ ENABLE_PLAYER_RANKED_V2: '1' }), true);
    assert.equal(playerRankedV2AdmissionsEnabled({
        ENABLE_PLAYER_RANKED_V2: '1',
        DISABLE_PLAYER_RANKED_V2: '1',
    }), false);
});

test('disabled join fails before rate-limit, queue, token, gate, or session writes', async () => {
    delete process.env.ENABLE_PLAYER_RANKED_V2;
    const originals = {
        set: kv.set.bind(kv),
        compareSet: kv.compareSet.bind(kv),
        incr: kv.incr.bind(kv),
        del: kv.del.bind(kv),
    };
    let writes = 0;
    kv.set = (async (...args: Parameters<typeof kv.set>) => { writes += 1; return originals.set(...args); }) as typeof kv.set;
    kv.compareSet = (async (...args: Parameters<typeof kv.compareSet>) => { writes += 1; return originals.compareSet(...args); }) as typeof kv.compareSet;
    kv.incr = (async (...args: Parameters<typeof kv.incr>) => { writes += 1; return originals.incr(...args); }) as typeof kv.incr;
    kv.del = (async (...args: Parameters<typeof kv.del>) => { writes += 1; return originals.del(...args); }) as typeof kv.del;
    try {
        const { out, res } = response();
        await handler(request('join'), res);
        assert.equal(out.statusCode, 503);
        assert.equal(out.body?.enabled, false);
        assert.equal(writes, 0);
    } finally {
        kv.set = originals.set as typeof kv.set;
        kv.compareSet = originals.compareSet as typeof kv.compareSet;
        kv.incr = originals.incr as typeof kv.incr;
        kv.del = originals.del as typeof kv.del;
    }
});

test('kill switch still finishes an in-flight terminal but creates no new queue work', async () => {
    process.env.ENABLE_PLAYER_RANKED_V2 = '1';
    process.env.DISABLE_PLAYER_RANKED_V2 = '1';
    const { startRankedSeason } = await import('../cron/_ranked-season.js');
    const {
        activatePlayerRankedAdmission,
        getPlayerRankedAdmission,
        readPetRankedSeasonGateFresh,
    } = await import('../pet/_ranked-preparation.js');
    const { mintPlayerRankedMatchTokenWithStore } = await import('../_ranked-match-token.js');
    const { getPlayerRankedJournal } = await import('./_player-ranked-journal.js');
    const now = Date.now();
    await startRankedSeason(now);
    const gate = await readPetRankedSeasonGateFresh(kv);
    assert.ok(gate?.state === 'open');
    const matchId = 'player-ranked-32345678-1234-4123-8123-1234567890ab';
    const battleId = 'pvp-32345678-1234-4123-8123-1234567890ab';
    for (const name of ['killalice', 'killbob']) {
        await kv.set(`save:${name}`, {
            _saveVersion: 1,
            character: {
                name,
                level: 25,
                profession: 'ninja',
                rankedRating: 1000,
                rankedWins: 0,
                rankedLosses: 0,
                serverSettlementReceipts: [],
            },
        });
    }
    const proof = await mintPlayerRankedMatchTokenWithStore(kv, {
        a: 'killalice', b: 'killbob', aLevel: 25, bLevel: 25,
        aRating: 1000, bRating: 1000, now: now + 1, matchId,
    });
    await activatePlayerRankedAdmission(kv, proof.matchId, battleId, now + 2);
    await kv.set(`pvp:${battleId}`, {
        battleId,
        p1: { name: 'killalice' }, p2: { name: 'killbob' },
        status: 'done', winner: 'draw', ranked: false, rankedKind: 'player',
        playerRankedAuthorityVersion: 2, rankedMatchId: matchId,
        rankedSeasonId: gate.seasonId, rankedSeasonEpoch: gate.epoch,
        p1Rating: 1000, p2Rating: 1000, rewardAuthority: 'ranked',
        joined: { p1: true, p2: true }, baseRewards: false,
        realFighters: { p1: true, p2: true }, itemCharges: { p1: {}, p2: {} },
        itemsUsed: { p1: {}, p2: {} }, log: [], createdAt: now,
    });

    const { out, res } = response();
    await handler(request('poll', 'killalice'), res);
    assert.equal(out.statusCode, 503);
    assert.equal(out.body?.enabled, false);
    assert.equal(await getPlayerRankedAdmission(kv, matchId), null);
    assert.equal((await getPlayerRankedJournal(kv, matchId))?.state, 'completed');
    const queue = await kv.get<Array<{ name?: string }>>('pvp:ranked-queue') ?? [];
    assert.equal(queue.some((entry) => entry.name === 'killalice'), false);
    delete process.env.DISABLE_PLAYER_RANKED_V2;
});

test('kill switch retires a never-joined admission after its bounded deadline', async () => {
    process.env.ENABLE_PLAYER_RANKED_V2 = '1';
    process.env.DISABLE_PLAYER_RANKED_V2 = '1';
    const { startRankedSeason } = await import('../cron/_ranked-season.js');
    const {
        activatePlayerRankedAdmission,
        getPlayerRankedAdmission,
        makePlayerRankedAdmission,
        PLAYER_RANKED_JOIN_DEADLINE_MS,
        readPetRankedSeasonGateFresh,
        reservePlayerRankedAdmission,
    } = await import('../pet/_ranked-preparation.js');
    const now = Date.now();
    await startRankedSeason(now);
    const gate = await readPetRankedSeasonGateFresh(kv);
    assert.ok(gate?.state === 'open');
    const matchId = 'player-ranked-42345678-1234-4123-8123-1234567890ab';
    const battleId = 'pvp-42345678-1234-4123-8123-1234567890ab';
    const createdAt = now - PLAYER_RANKED_JOIN_DEADLINE_MS - 1;
    const admission = makePlayerRankedAdmission({
        matchId,
        a: 'timeoutalice', b: 'timeoutbob', aLevel: 25, bLevel: 25,
        aRating: 1000, bRating: 1000, createdAt: createdAt - 2,
        seasonId: gate.seasonId, seasonEpoch: gate.epoch,
    });
    await reservePlayerRankedAdmission(kv, admission);
    await activatePlayerRankedAdmission(kv, matchId, battleId, createdAt - 1);
    await kv.set(`pvp:${battleId}`, {
        battleId,
        p1: { name: 'timeoutalice' }, p2: { name: 'timeoutbob' },
        status: 'active', ranked: false, rankedKind: 'player',
        playerRankedAuthorityVersion: 2, rankedMatchId: matchId,
        rankedSeasonId: gate.seasonId, rankedSeasonEpoch: gate.epoch,
        p1Rating: 1000, p2Rating: 1000, rewardAuthority: 'ranked',
        joined: { p1: true, p2: false }, baseRewards: false, createdAt,
    });

    const { out, res } = response();
    await handler(request('poll', 'timeoutalice'), res);
    assert.equal(out.statusCode, 503);
    assert.equal(await getPlayerRankedAdmission(kv, matchId), null);
    assert.equal((await kv.get<Record<string, unknown>>(`pvp:${battleId}`))?.version,
        'player-ranked-session-orphan-tombstone-v1');
    const queue = await kv.get<Array<{ name?: string }>>('pvp:ranked-queue') ?? [];
    assert.equal(queue.some((entry) => entry.name === 'timeoutalice'), false);
    delete process.env.DISABLE_PLAYER_RANKED_V2;
});

test('enabled POST success and UI/runbook contracts advertise the same state', async () => {
    process.env.ENABLE_PLAYER_RANKED_V2 = '1';
    delete process.env.DISABLE_PLAYER_RANKED_V2;
    const { startRankedSeason } = await import('../cron/_ranked-season.js');
    await startRankedSeason(Date.now());
    const { out, res } = response();
    await handler(request('poll'), res);
    assert.equal(out.statusCode, 200);
    assert.equal(out.body?.enabled, true);

    const [envExample, runbook, arena] = await Promise.all([
        readFile(resolve(process.cwd(), '.env.example'), 'utf8'),
        readFile(resolve(process.cwd(), 'docs/PLAYER_RANKED_V2_ROLLOUT.md'), 'utf8'),
        readFile(resolve(process.cwd(), 'shinobij.client/src/screens/Arena.tsx'), 'utf8'),
    ]);
    assert.match(envExample, /ENABLE_PLAYER_RANKED_V2=1/);
    assert.match(envExample, /DISABLE_PLAYER_RANKED_V2=1/);
    assert.match(runbook, /deploy and drain/i);
    assert.match(runbook, /Do not roll worker code back to d76a/i);
    assert.match(arena, /playerRankedEnabled/);
});
