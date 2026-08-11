import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'challenge-ranked-authority-test-secret';
process.env.ENABLE_PLAYER_RANKED_V2 = '1';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const alice = 'rankedchallengealice';
const bob = 'rankedchallengebob';
const cara = 'rankedchallengecara';
const matchId = 'player-ranked-62345678-1234-4123-8123-1234567890ab';

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(statusCode: number) { out.statusCode = statusCode; return res; },
        json(body: Record<string, unknown>) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

function challengeBody(targetName: string, patch: Record<string, unknown> = {}) {
    return {
        targetName,
        challenge: {
            id: 'ranked-challenge-authority-1',
            fromName: alice,
            toName: targetName,
            challenger: { name: alice },
            createdAt: Date.now(),
            mode: 'ranked',
            ...patch,
        },
    };
}

async function post(targetName: string, patch: Record<string, unknown> = {}) {
    return sendAs(alice, challengeBody(targetName, patch));
}

async function sendAs(player: string, body: Record<string, unknown>) {
    const { out, res } = response();
    await handler({
        method: 'POST',
        body,
        query: {},
        headers: {
            'content-type': 'application/json',
            'x-player-token': issuePlayerToken(player),
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    const { startRankedSeason } = await import('../cron/_ranked-season.js');
    const { mintPlayerRankedMatchToken } = await import('../_ranked-match-token.js');
    await startRankedSeason(Date.now());
    await Promise.all([alice, bob, cara].map((name) => kv.set(`save:${name}`, {
        _saveVersion: 1,
        character: { name, level: 24, rankedRating: 1000, pets: [] },
    })));
    await mintPlayerRankedMatchToken({
        a: alice,
        b: bob,
        aLevel: 24,
        bLevel: 24,
        aRating: 1000,
        bRating: 1000,
        matchId,
    });
    handler = (await import('./challenge.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.ENABLE_PLAYER_RANKED_V2;
});

test('ranked challenge fails closed when queue authority is missing, stale, or for another pair', async () => {
    const missing = await post(bob);
    assert.equal(missing.statusCode, 409);

    const staleEpoch = await post(bob, {
        rankedMatchId: matchId,
        rankedSeasonId: 1,
        rankedSeasonEpoch: 999,
    });
    assert.equal(staleEpoch.statusCode, 409);

    const wrongPair = await post(cara, {
        rankedMatchId: matchId,
        rankedSeasonId: 1,
        rankedSeasonEpoch: 1,
    });
    assert.equal(wrongPair.statusCode, 409);
    assert.equal(await kv.get('challenges:rankedchallengebob'), null);
    assert.equal(await kv.get('challenges:rankedchallengecara'), null);
});

test('ranked challenge preserves the server-confirmed match, season, and epoch', async () => {
    const accepted = await post(bob, {
        rankedMatchId: matchId,
        rankedSeasonId: 1,
        rankedSeasonEpoch: 1,
    });
    assert.equal(accepted.statusCode, 200);

    const inbox = await kv.get<Array<Record<string, unknown>>>('challenges:rankedchallengebob');
    assert.equal(inbox?.length, 1);
    assert.equal(inbox?.[0]?.rankedMatchId, matchId);
    assert.equal(inbox?.[0]?.rankedSeasonId, 1);
    assert.equal(inbox?.[0]?.rankedSeasonEpoch, 1);
});

test('declining a still-queued ranked challenge releases its gate admission', async () => {
    const inbox = await kv.get<Array<Record<string, unknown>>>('challenges:rankedchallengebob');
    assert.ok(inbox?.[0]);
    const declined = await sendAs(bob, {
        targetName: alice,
        challenge: {
            ...inbox[0],
            fromName: bob,
            toName: alice,
            declined: true,
        },
    });
    assert.equal(declined.statusCode, 200);
    const gate = await kv.get<{ playerAdmissions?: Array<{ matchId?: string }> }>('ranked:season:authority');
    assert.equal(gate?.playerAdmissions?.some((entry) => entry.matchId === matchId), false);
});
