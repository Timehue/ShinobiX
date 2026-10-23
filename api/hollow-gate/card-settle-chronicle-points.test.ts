/* A won Hollow Gate (Rift) card ambush pays CARD_PVE_GATE_CP Chronicle Points
 * beside its ryo and Aura Dust (owner request 2026-10-22), exactly once, in the
 * same receipted write. Through the real card-settle and run settle handlers. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import { cardClashAiTokenKey } from '../card-clash/_ai-reward.js';
import { hollowGateRunKey, type HollowGateRunToken } from './_run-token.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { status: number; body?: Record<string, unknown> };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let drainBackgroundWork: () => Promise<void>;
let settle: Handler;
let endRun: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ drainBackgroundWork } = await import('../_background-work.js'));
    settle = (await import('./card-settle.js')).default as unknown as Handler;
    endRun = (await import('./settle.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

async function call(handler: Handler, body: Record<string, unknown>): Promise<Reply> {
    const result: Reply = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { result.status = status; return res; },
        json: (data: Record<string, unknown>) => { result.body = data; return res; },
        end: () => res,
    };
    await handler({ method: 'POST', body: { ...body, playerName: 'riftplayer' }, query: {},
        headers: { 'x-player-name': 'riftplayer', 'x-player-token': issuePlayerToken('riftplayer') },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return result;
}

const digestOf = (token: string) => createHash('sha256').update(token).digest('hex');

async function terminalMatch(token: string, nodeId: string, winner: 'player' | 'opponent', matchId = randomUUID()) {
    await kv.set(cardClashAiTokenKey(matchId), { matchId, playerName: 'riftplayer',
        status: 'done', winner, settledAt: Date.now(), settlementMode: 'external',
        hollowGateCard: { tokenDigest: digestOf(token), nodeId } });
    return matchId;
}

async function sealedCardAmbush(token: string, nodeId: string, matchId: string) {
    const run: HollowGateRunToken = {
        playerName: 'riftplayer', mintedAt: Date.now() - 600_000, floorDepth: 2, currentFloor: 1,
        seed: 'seed', entryCurrencies: { ryo: 100, auraDust: 2 }, entryItems: {}, offeredAugmentIds: ['keen-edge'],
        chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1, variantId: 'rift-hollow-stalker',
        pendingAmbush: { nodeId, kind: 'card' }, cardAmbushMatchId: matchId,
    };
    await kv.set(hollowGateRunKey('riftplayer', token), run);
    await kv.set('save:riftplayer', { character: { name: 'riftplayer', hp: 80, maxHp: 100, chroniclePoints: 30,
        ryo: 100, auraDust: 2, itemStacks: [], hollowGateRun: { runToken: token, floor: 1, threat: 100 } }, _saveVersion: 1 });
    return run;
}

async function points(): Promise<number> {
    return Number((await kv.get<{ character: { chroniclePoints?: number } }>('save:riftplayer'))?.character.chroniclePoints ?? 0);
}

describe('Hollow Gate card ambushes pay Chronicle Points', { concurrency: false }, () => {
    it('a won ambush pays 10 beside its ryo, once, and the replay shows the same reward', async () => {
        const token = 'card-cp-win-token';
        const nodeId = 'floor:1:ambush:threat-v40';
        const matchId = await terminalMatch(token, nodeId, 'player');
        await sealedCardAmbush(token, nodeId, matchId);
        const first = await call(settle, { token, matchId });
        assert.equal(first.status, 200, JSON.stringify(first.body));
        assert.equal((first.body?.reward as { chroniclePoints: number }).chroniclePoints, 10);
        assert.equal(await points(), 30 + 10);
        const replay = await call(settle, { token, matchId });
        assert.equal(replay.status, 200, JSON.stringify(replay.body));
        assert.equal((replay.body?.reward as { chroniclePoints: number }).chroniclePoints, 10);
        assert.equal(await points(), 40, 'the replay pays nothing');

        await drainBackgroundWork();
        const txns = (await kv.get<Array<{ txnId: string; source: string; delta: number }>>('econ:txns')) ?? [];
        assert.deepEqual(txns.filter((txn) => txn.source === 'card.pve.gate').map((txn) => txn.delta), [10]);
    });

    it('a lost ambush pays no Chronicle Points', async () => {
        const token = 'card-cp-loss-token';
        const nodeId = 'floor:1:ambush:threat-v41';
        const matchId = await terminalMatch(token, nodeId, 'opponent');
        await sealedCardAmbush(token, nodeId, matchId);
        const lost = await call(settle, { token, matchId });
        assert.equal(lost.status, 200, JSON.stringify(lost.body));
        assert.deepEqual(lost.body?.reward, { ryo: 0, auraDust: 0, chroniclePoints: 0 });
        assert.equal(await points(), 30);
    });

    it('the points are not run loot: dying keeps all of them', async () => {
        const token = 'card-cp-death-token';
        const nodeId = 'floor:1:ambush:threat-v42';
        const matchId = await terminalMatch(token, nodeId, 'player');
        await sealedCardAmbush(token, nodeId, matchId);
        assert.equal((await call(settle, { token, matchId })).status, 200);
        const died = await call(endRun, { token, action: 'abandon' });
        assert.equal(died.status, 200, JSON.stringify(died.body));
        assert.equal(await points(), 40);
    });

    it('a second match for an already-settled ambush pays nothing more', async () => {
        const token = 'card-cp-double-token';
        const nodeId = 'floor:1:ambush:threat-v43';
        const oldMatch = await terminalMatch(token, nodeId, 'player');
        const newMatch = await terminalMatch(token, nodeId, 'player');
        await sealedCardAmbush(token, nodeId, newMatch);
        assert.equal((await call(settle, { token, matchId: newMatch })).status, 200);
        assert.equal((await call(settle, { token, matchId: oldMatch })).status, 409);
        assert.equal(await points(), 40);
    });
});
