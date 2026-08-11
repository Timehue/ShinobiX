import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pet-ranked-queue-authority-secret-32-bytes';
process.env.ENABLE_PET_RANKED_SERVER_V1 = '1';
process.env.ENABLE_PET_RANKED_PUBLIC_PRESENTATION_V1 = '1';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, any> };

const A = 'rankedqueuealpha';
const B = 'rankedqueuebravo';
const C = 'rankedqueuecharlie';
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let tokenA = '';
let tokenB = '';
let tokenC = '';

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

function request(name: string, token: string, action: 'join' | 'leave' | 'poll', patch: Record<string, unknown> = {}) {
    return {
        method: 'POST',
        body: { name, action, ...patch },
        headers: { 'content-type': 'application/json', 'x-player-token': token },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

async function call(name: string, token: string, action: 'join' | 'leave' | 'poll', patch: Record<string, unknown> = {}) {
    const reply = response();
    await handler(request(name, token, action, patch), reply.res);
    return reply.out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const auth = await import('../_auth.js');
    tokenA = auth.issuePlayerToken(A)!;
    tokenB = auth.issuePlayerToken(B)!;
    tokenC = auth.issuePlayerToken(C)!;
    handler = (await import('./pet-ranked-queue.js')).default as unknown as Handler;
    await Promise.all([
        kv.set(`save:${A}`, { character: { name: A, level: 20, petRankedRating: 980 } }),
        kv.set(`save:${B}`, { character: { name: B, level: 23, petRankedRating: 1020 } }),
    ]);
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.ENABLE_PET_RANKED_SERVER_V1;
    delete process.env.ENABLE_PET_RANKED_PUBLIC_PRESENTATION_V1;
});

test('queue mints one reciprocal server pairing and ignores client level/rating', async () => {
    assert.equal((await call(A, tokenA, 'join', { level: 100, elo: 999_999 })).statusCode, 200);
    assert.equal((await call(B, tokenB, 'join', { level: 1, elo: 0 })).statusCode, 200);
    const matched = await call(A, tokenA, 'poll');
    assert.equal(matched.statusCode, 200);
    assert.match(String(matched.body?.match?.matchId), /^[a-f0-9]{32}$/);
    assert.equal(matched.body?.match?.opponent, B);
    assert.equal(matched.body?.match?.opponentElo, 1020);
    assert.equal(matched.body?.match?.opponentLevel, 23);

    const mine = await kv.get<Record<string, any>>(`pvp:pet-ranked-queue:match:${A}`);
    const theirs = await kv.get<Record<string, any>>(`pvp:pet-ranked-queue:match:${B}`);
    assert.equal(theirs?.matchId, mine?.matchId);
    assert.equal(theirs?.opponent, A);
    assert.equal(theirs?.opponentElo, 980);
    assert.equal(theirs?.opponentLevel, 20);
    assert.notEqual(theirs?.initiator, mine?.initiator);
    assert.equal(theirs?.createdAt, mine?.createdAt);
});

test('queue is fail-closed by default and rejects an already-active player', async () => {
    await kv.set(`pet:battle-active:${A}`, 'existing-casual-token', { ex: 60 });
    const active = await call(A, tokenA, 'join');
    assert.equal(active.statusCode, 409);
    assert.match(String(active.body?.error), /active pet battle/i);
    await kv.delIfEqual(`pet:battle-active:${A}`, 'existing-casual-token');

    delete process.env.ENABLE_PET_RANKED_SERVER_V1;
    const disabled = await call(A, tokenA, 'join');
    assert.equal(disabled.statusCode, 503);
    assert.equal(disabled.body?.error, 'ranked-pet-public-presentation-required');
    process.env.ENABLE_PET_RANKED_SERVER_V1 = '1';
});

test('public queue needs the separate presentation gate while leave remains available', async () => {
    delete process.env.ENABLE_PET_RANKED_PUBLIC_PRESENTATION_V1;
    const getReply = response();
    await handler({ method: 'GET', query: { name: A }, headers: {} } as never, getReply.res);
    assert.equal(getReply.out.statusCode, 200);
    assert.deepEqual(getReply.out.body, { enabled: false, inQueue: false, queueSize: 0, match: null });

    const blocked = await call(A, tokenA, 'poll');
    assert.equal(blocked.statusCode, 503);
    assert.equal(blocked.body?.error, 'ranked-pet-public-presentation-required');
    const leave = await call(A, tokenA, 'leave');
    assert.equal(leave.statusCode, 200);
    process.env.ENABLE_PET_RANKED_PUBLIC_PRESENTATION_V1 = '1';
});

test('queue refuses to substitute client matchmaking claims for a missing authoritative profile', async () => {
    const missing = await call(C, tokenC, 'join', { level: 77, elo: 5000 });
    assert.equal(missing.statusCode, 404);
    assert.match(String(missing.body?.error), /character not found/i);
});
