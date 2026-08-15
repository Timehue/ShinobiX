import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'weekly-boss-full-admin-password';
process.env.ADMIN_CONTENT_PASSWORD = 'weekly-boss-content-admin-password';
process.env.ADMIN_SESSION_SECRET = 'weekly-boss-admin-session-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Json = Record<string, unknown>;
type Out = { statusCode: number; body?: Json };

const BOSS_KEY = 'game:weekly-boss-state';
const OVERRIDE_KEY = 'game:weekly-boss-override';
const ANNOUNCEMENT_KEYS = [
    'game:announcements',
    'game:announcements-seq',
    'chat:village:stormveil-village',
    'chat:village:ashen-leaf-village',
    'chat:village:frostfang-village',
    'chat:village:moonshadow-village',
];

let kv: typeof import('./_storage.js').kv;
let weeklyBossHandler: Handler;
let gameStateHandler: Handler;
let contentToken: string;

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(statusCode: number) { out.statusCode = statusCode; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function post(handler: Handler, body: Json, headers: Record<string, string>): Promise<Out> {
    const { out, res } = response();
    await handler({
        method: 'POST',
        query: {},
        headers: { 'content-type': 'application/json', ...headers },
        body,
        socket: { remoteAddress: '127.0.0.84' },
    } as never, res);
    return out;
}

function existingBossState(): Json {
    return {
        spawnId: 'authority-existing-spawn',
        weekKey: 'authority-test-week',
        aiId: 'moonshadow-oni',
        bossName: 'Moonshadow Oni',
        hpMax: 90_000,
        hpRemaining: 65_000,
        scaleFactor: 2,
        damageByPlayer: { alpha: 12_345, bravo: 6_789 },
        attemptsByPlayer: { alpha: 2, bravo: 1 },
        startedAt: 1_900_000_000_000,
        expiresAt: 1_900_259_200_000,
    };
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    const auth = await import('./_auth.js');
    contentToken = auth.issueAdminToken('content') ?? '';
    assert.ok(contentToken, 'content token must be issued for authority coverage');
    weeklyBossHandler = (await import('./weekly-boss.js')).default as unknown as Handler;
    gameStateHandler = (await import('./game-state.js')).default as unknown as Handler;
});

beforeEach(async () => {
    await kv.del(BOSS_KEY, OVERRIDE_KEY, ...ANNOUNCEMENT_KEYS);
});

after(async () => {
    await kv.del(BOSS_KEY, OVERRIDE_KEY, ...ANNOUNCEMENT_KEYS);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_CONTENT_PASSWORD;
    delete process.env.ADMIN_SESSION_SECRET;
});

test('content admin password/token cannot reset Weekly Boss state or leaderboard; full admin can', async () => {
    const original = existingBossState();
    await kv.set(BOSS_KEY, original);
    const beforeBytes = JSON.stringify(await kv.get(BOSS_KEY));

    const contentCredentials: Array<Record<string, string>> = [
        { 'x-admin-password': process.env.ADMIN_CONTENT_PASSWORD! },
        { 'x-admin-token': contentToken },
    ];
    for (const headers of contentCredentials) {
        const rejected = await post(weeklyBossHandler, {
            kind: 'reset',
            expectedSpawnId: 'authority-existing-spawn',
            requestedSpawnId: '30000000-0000-4000-8000-000000000001',
        }, headers);
        assert.equal(rejected.statusCode, 403);
        assert.match(String(rejected.body?.error), /full admin/i);
        const after = await kv.get<Json>(BOSS_KEY);
        assert.equal(JSON.stringify(after), beforeBytes, 'state and embedded leaderboard must remain byte-identical');
        assert.deepEqual(after?.damageByPlayer, original.damageByPlayer);
        assert.equal(await kv.get('game:announcements'), null, 'rejected reset must not herald a spawn');
    }

    const accepted = await post(
        weeklyBossHandler,
        {
            kind: 'reset',
            expectedSpawnId: 'authority-existing-spawn',
            requestedSpawnId: '30000000-0000-4000-8000-000000000002',
        },
        { 'x-admin-password': process.env.ADMIN_PASSWORD! },
    );
    assert.equal(accepted.statusCode, 200);
    assert.ok(accepted.body?.boss);
    assert.notEqual(JSON.stringify(await kv.get(BOSS_KEY)), beforeBytes);
    assert.deepEqual((await kv.get<Json>(BOSS_KEY))?.damageByPlayer, {});
    assert.equal(typeof (await kv.get<Json>(BOSS_KEY))?.spawnId, 'string');
});

test('Weekly Boss override remains full-admin-only on /api/game-state', async () => {
    await kv.set(OVERRIDE_KEY, 'moonshadow-oni');

    const contentCredentials: Array<Record<string, string>> = [
        { 'x-admin-password': process.env.ADMIN_CONTENT_PASSWORD! },
        { 'x-admin-token': contentToken },
    ];
    for (const headers of contentCredentials) {
        const rejected = await post(
            gameStateHandler,
            { kind: 'weeklyBossOverride', aiId: 'ashen-dragon' },
            headers,
        );
        assert.equal(rejected.statusCode, 403);
        assert.equal(await kv.get(OVERRIDE_KEY), 'moonshadow-oni');
    }

    const accepted = await post(
        gameStateHandler,
        { kind: 'weeklyBossOverride', aiId: 'ashen-dragon' },
        { 'x-admin-password': process.env.ADMIN_PASSWORD! },
    );
    assert.equal(accepted.statusCode, 200);
    assert.equal(await kv.get(OVERRIDE_KEY), 'ashen-dragon');

    const cleared = await post(
        gameStateHandler,
        { kind: 'weeklyBossOverride', aiId: null },
        { 'x-admin-password': process.env.ADMIN_PASSWORD! },
    );
    assert.equal(cleared.statusCode, 200);
    assert.equal(await kv.get(OVERRIDE_KEY), null);
});
