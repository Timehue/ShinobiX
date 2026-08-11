import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pet-ranked-entrypoint-test-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const RANKED_PLAYER = 'rankedentryprobe';
const CASUAL_PLAYER = 'casualentryprobe';
let rankedStart: Handler;
let battleResult: Handler;
let rankedToken = '';
let casualToken = '';
let kv: typeof import('../_storage.js').kv;

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

function request(playerName: string, token: string, body: Record<string, unknown>) {
    return {
        method: 'POST',
        body: { playerName, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': token },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const auth = await import('../_auth.js');
    rankedToken = auth.issuePlayerToken(RANKED_PLAYER)!;
    casualToken = auth.issuePlayerToken(CASUAL_PLAYER)!;
    rankedStart = (await import('./ranked-start.js')).default as unknown as Handler;
    battleResult = (await import('./battle-result.js')).default as unknown as Handler;
    await Promise.all([
        kv.set(`save:${RANKED_PLAYER}`, {
            _saveVersion: 1,
            character: { name: RANKED_PLAYER, petRankedRating: 1000, pets: [] },
        }),
        kv.set(`save:${CASUAL_PLAYER}`, {
            _saveVersion: 1,
            character: { name: CASUAL_PLAYER, ryo: 0, pets: [] },
        }),
    ]);
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('direct ranked start fails closed and mints no private match token', async () => {
    const reply = response();
    await rankedStart(request(RANKED_PLAYER, rankedToken, { opponentName: 'offlinevictim' }), reply.res);

    assert.equal(reply.out.statusCode, 503);
    assert.equal(reply.out.body?.error, 'ranked-pet-server-authority-required');
    assert.deepEqual(await kv.keys('pet:ranked-token:*'), []);
});

test('direct ranked result fails closed before reading a legacy token or mutating rating', async () => {
    const legacyToken = '12345678-1234-1234-1234-123456789abc';
    await kv.set(`pet:ranked-token:${legacyToken}`, {
        a: RANKED_PLAYER,
        b: 'offlinevictim',
        aRating: 1000,
        bRating: 1000,
        aPet: { id: 'old-a', hp: 100, attack: 100, defense: 100, speed: 100 },
        bPet: { id: 'old-b', hp: 1, attack: 1, defense: 1, speed: 1 },
        seed: 1,
        createdAt: Date.now(),
    });
    const beforeSave = await kv.get<Record<string, unknown>>(`save:${RANKED_PLAYER}`);
    const reply = response();
    await battleResult(request(RANKED_PLAYER, rankedToken, {
        ranked: true,
        matchToken: legacyToken,
        outcome: 'win',
        reportKey: 'legacy-ranked-report',
    }), reply.res);

    assert.equal(reply.out.statusCode, 503);
    assert.equal(reply.out.body?.error, 'ranked-pet-server-authority-required');
    assert.deepEqual(await kv.get(`save:${RANKED_PLAYER}`), beforeSave);
    assert.equal(await kv.get(`pet:ranked-settled:${RANKED_PLAYER}:${legacyToken}`), null);
});

test('the ranked gate does not replace the ordinary casual token contract', async () => {
    const reply = response();
    await battleResult(request(CASUAL_PLAYER, casualToken, {
        ranked: false,
        outcome: 'win',
        reportKey: 'casual-still-sealed',
    }), reply.res);

    assert.equal(reply.out.statusCode, 400);
    assert.match(String(reply.out.body?.error ?? ''), /pet battle start token/i);
});
