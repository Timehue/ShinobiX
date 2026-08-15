import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'weekly-boss-recovery-test-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const PLAYER = 'weeklyrecoveryplayer';
const WEEK_KEY = 'recovery-test-week';
const STARTED_AT = 1_900_000_000_000;
const RUN_ID = 'weekly-recovery-existing-run';
const BOSS_KEY = 'game:weekly-boss-state';
const SAVE_KEY = `save:${PLAYER}`;
const ACTIVE_KEY = `weekly-boss-active:${STARTED_AT}:${encodeURIComponent(PLAYER)}`;
const RUN_KEY = `weekly-boss-run:${RUN_ID}`;
const SESSION_KEY = `solo-pve:${RUN_ID}`;

let kv: typeof import('./_storage.js').kv;
let handler: Handler;
let issuePlayerToken: (name: string) => string | null;

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

function request(method: 'GET' | 'POST', options: {
    query?: Record<string, string>;
    body?: Record<string, unknown>;
} = {}) {
    return {
        method,
        query: options.query ?? {},
        body: options.body ?? {},
        headers: { 'x-player-token': issuePlayerToken(PLAYER) ?? '' },
        socket: { remoteAddress: '127.0.0.81' },
    } as never;
}

async function invoke(req: never): Promise<Out> {
    const out = response();
    await handler(req, out.res);
    return out.out;
}

function bossState() {
    return {
        weekKey: WEEK_KEY,
        aiId: 'ashen-dragon',
        bossName: 'Ashen Dragon',
        hpMax: 100_000,
        hpRemaining: 100_000,
        scaleFactor: 1,
        damageByPlayer: {},
        attemptsByPlayer: { [PLAYER]: 2 },
        startedAt: STARTED_AT,
        expiresAt: Date.now() + 60 * 60_000,
    };
}

function playerSave() {
    return { _saveVersion: 7, character: { name: PLAYER, level: 50, stamina: 100, maxStamina: 100 } };
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
    handler = (await import('./weekly-boss.js')).default as unknown as Handler;
});

beforeEach(async () => {
    await kv.del(BOSS_KEY, SAVE_KEY, ACTIVE_KEY, RUN_KEY, SESSION_KEY);
    await kv.set(BOSS_KEY, bossState());
    await kv.set(SAVE_KEY, playerSave());
});

after(async () => {
    await kv.del(BOSS_KEY, SAVE_KEY, ACTIVE_KEY, RUN_KEY, SESSION_KEY);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('the read-only recovery probe cannot mint a run, reserve an attempt, or debit stamina', async () => {
    const beforeBoss = await kv.get(BOSS_KEY);
    const beforeSave = await kv.get(SAVE_KEY);

    const out = await invoke(request('GET', {
        query: { recoverFight: '1', weekKey: WEEK_KEY },
    }));

    assert.equal(out.statusCode, 404);
    assert.equal(out.body?.code, 'weekly-boss-recovery-not-found');
    assert.deepEqual(await kv.get(BOSS_KEY), beforeBoss);
    assert.deepEqual(await kv.get(SAVE_KEY), beforeSave);
    assert.equal(await kv.get(ACTIVE_KEY), null);
    assert.equal(await kv.get(RUN_KEY), null);
    assert.equal(await kv.get(SESSION_KEY), null);
});

test('resumeFight refuses a missing accepted run without falling through to creation', async () => {
    const beforeBoss = await kv.get(BOSS_KEY);
    const beforeSave = await kv.get(SAVE_KEY);

    const out = await invoke(request('POST', {
        body: { kind: 'resumeFight', weekKey: WEEK_KEY, runId: RUN_ID },
    }));

    assert.equal(out.statusCode, 404);
    assert.equal(out.body?.code, 'weekly-boss-recovery-not-found');
    assert.deepEqual(await kv.get(BOSS_KEY), beforeBoss);
    assert.deepEqual(await kv.get(SAVE_KEY), beforeSave);
    assert.equal(await kv.get(ACTIVE_KEY), null);
    assert.equal(await kv.get(RUN_KEY), null);
    assert.equal(await kv.get(SESSION_KEY), null);
});

test('the probe replays an owned ready run without changing its durable records', async () => {
    const run = {
        runId: RUN_ID,
        playerName: PLAYER,
        weekKey: WEEK_KEY,
        aiId: 'ashen-dragon',
        bossStartedAt: STARTED_AT,
        initialBossHp: 100_000,
        createdAt: STARTED_AT + 1,
        startState: 'ready',
    };
    const session = {
        runtime: 'solo-pve',
        schemaVersion: 1,
        sessionId: RUN_ID,
        ownerSlug: PLAYER,
        version: 1,
        status: 'active',
        encounter: {
            kind: 'weekly-boss',
            id: WEEK_KEY,
            sourceId: 'ashen-dragon',
            bindingId: RUN_ID,
            metadata: { weekKey: WEEK_KEY, bossStartedAt: STARTED_AT },
        },
    };
    await kv.set(ACTIVE_KEY, RUN_ID);
    await kv.set(RUN_KEY, run);
    await kv.set(SESSION_KEY, session);

    const beforeBoss = await kv.get(BOSS_KEY);
    const beforeSave = await kv.get(SAVE_KEY);
    const out = await invoke(request('GET', {
        query: { recoverFight: '1', weekKey: WEEK_KEY },
    }));

    assert.equal(out.statusCode, 200);
    assert.equal(out.body?.replayed, true);
    assert.equal(out.body?.runId, RUN_ID);
    assert.deepEqual(out.body?.session, session);
    assert.deepEqual(await kv.get(BOSS_KEY), beforeBoss);
    assert.deepEqual(await kv.get(SAVE_KEY), beforeSave);
    assert.deepEqual(await kv.get(RUN_KEY), run);
    assert.deepEqual(await kv.get(SESSION_KEY), session);
});

test('a prepared accepted run is discovered read-only, then finalized exactly once by resumeFight', async () => {
    const run = {
        runId: RUN_ID,
        playerName: PLAYER,
        weekKey: WEEK_KEY,
        aiId: 'ashen-dragon',
        bossStartedAt: STARTED_AT,
        initialBossHp: 100_000,
        createdAt: STARTED_AT + 1,
        startState: 'prepared',
    };
    const session = {
        runtime: 'solo-pve',
        schemaVersion: 1,
        sessionId: RUN_ID,
        ownerSlug: PLAYER,
        version: 1,
        status: 'active',
        player: { stamina: 100 },
        encounter: {
            kind: 'weekly-boss',
            id: WEEK_KEY,
            sourceId: 'ashen-dragon',
            bindingId: RUN_ID,
            metadata: { weekKey: WEEK_KEY, bossStartedAt: STARTED_AT },
        },
    };
    await kv.set(ACTIVE_KEY, RUN_ID);
    await kv.set(RUN_KEY, run);
    await kv.set(SESSION_KEY, session);

    const beforeBoss = await kv.get(BOSS_KEY);
    const beforeSave = await kv.get(SAVE_KEY);
    const probe = await invoke(request('GET', {
        query: { recoverFight: '1', weekKey: WEEK_KEY },
    }));
    assert.equal(probe.statusCode, 409);
    assert.equal(probe.body?.code, 'weekly-boss-recovery-needs-finalization');
    assert.equal(probe.body?.runId, RUN_ID);
    assert.deepEqual(await kv.get(BOSS_KEY), beforeBoss, 'discovery cannot reserve the pending attempt');
    assert.deepEqual(await kv.get(SAVE_KEY), beforeSave, 'discovery cannot debit the pending stamina');
    assert.deepEqual(await kv.get(RUN_KEY), run);
    assert.deepEqual(await kv.get(SESSION_KEY), session);

    const resumed = await invoke(request('POST', {
        body: { kind: 'resumeFight', weekKey: WEEK_KEY, runId: RUN_ID },
    }));
    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.body?.runId, RUN_ID);
    assert.equal((resumed.body?.character as Record<string, unknown>)?.stamina, 80);
    const storedBoss = await kv.get<{ attemptsByPlayer?: Record<string, number>; attemptRunReceipts?: Record<string, string> }>(BOSS_KEY);
    const storedSave = await kv.get<{ character?: Record<string, unknown> }>(SAVE_KEY);
    assert.equal(storedBoss?.attemptsByPlayer?.[PLAYER], 3);
    assert.equal(storedBoss?.attemptRunReceipts?.[RUN_ID], PLAYER);
    assert.equal(storedSave?.character?.stamina, 80);
    assert.equal((await kv.get<Record<string, unknown>>(RUN_KEY))?.startState, 'ready');
    assert.deepEqual(await kv.keys('weekly-boss-run:*'), [RUN_KEY], 'resume must not mint a replacement run ID');

    const afterFirstBoss = await kv.get(BOSS_KEY);
    const afterFirstSave = await kv.get(SAVE_KEY);
    const replay = await invoke(request('POST', {
        body: { kind: 'resumeFight', weekKey: WEEK_KEY, runId: RUN_ID },
    }));
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body?.replayed, true);
    assert.deepEqual(await kv.get(BOSS_KEY), afterFirstBoss, 'resume replay cannot reserve another attempt');
    assert.deepEqual(await kv.get(SAVE_KEY), afterFirstSave, 'resume replay cannot debit stamina twice');
});
