import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import type { KvCasOp } from '../_storage.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import type { SoloPveSession } from '../solo-pve/_session.js';
import type { EndlessRun } from './_run.js';

// All imports which can open storage happen after these isolated QA settings.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
const ADMIN_PASSWORD = 'endless-publication-integration-only-password';
process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<unknown>;
type Response = { status: number; body?: Record<string, any> };
let kv: typeof import('../_storage.js').kv;
let waveStart: Handler;
let runAction: Handler;
let waves: typeof import('./_wave-session.js');
let sessions: typeof import('../solo-pve/_store.js');
let endlessWaveReward: typeof import('./_run.js').endlessWaveReward;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    waves = await import('./_wave-session.js');
    sessions = await import('../solo-pve/_store.js');
    ({ endlessWaveReward } = await import('./_run.js'));
    waveStart = (await import('./wave-start.js')).default as unknown as Handler;
    runAction = (await import('./run.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

async function post(handler: Handler, playerName: string, body: Record<string, unknown>): Promise<Response> {
    const out: Response = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { out.status = status; return res; },
        json: (value: Record<string, unknown>) => { out.body = value; return res; },
        end: () => res,
    };
    await handler({ method: 'POST', body: { playerName, ...body }, query: {},
        headers: { 'x-admin-password': ADMIN_PASSWORD, 'x-forwarded-for': '127.0.30.1' },
        socket: { remoteAddress: '127.0.30.1' },
    } as never, res as never);
    return out;
}

async function seedRun(playerName: string) {
    const now = Date.now();
    const run: EndlessRun = { runToken: `publication${playerName}Token`, wave: 7, bankedRyo: 6400,
        bankedXp: 0, startedAt: now - 60_000, highestMilestoneClaimed: 5 };
    const character = {
        name: playerName, level: 50, ryo: 15_000, xp: 0,
        hp: 1000, maxHp: 1000, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500,
        stats: { strength: 100, speed: 100, intelligence: 100, willpower: 100,
            ninjutsuOffense: 100, ninjutsuDefense: 100, taijutsuOffense: 100, taijutsuDefense: 100,
            bukijutsuOffense: 100, bukijutsuDefense: 100, genjutsuOffense: 100, genjutsuDefense: 100 },
        jutsu: [], inventory: [], itemStacks: [], equipment: {}, pets: [],
        endlessTowerRun: run, boneCharms: 0, fateShards: 0,
    };
    const save = { _saveVersion: 1, _saveAt: now, _regenAt: now, character, creatorItems: [] };
    await kv.set(`save:${playerName}`, save);
    return { playerName, run, save };
}

type Fixture = Awaited<ReturnType<typeof seedRun>>;

async function seedLegacyWave(playerName: string) {
    const fixture = await seedRun(playerName);
    const runId = waves.endlessWaveRunId();
    const now = Date.now();
    const built = waves.buildEndlessWaveEncounter({ playerName, save: fixture.save, runToken: fixture.run.runToken,
        wave: fixture.run.wave, playerLevel: 50, runId, now });
    assert.ok(built, 'fixture must build a real run-bound Endless encounter');
    await sessions.writeSoloPveSession(built.session);
    await kv.set(waves.endlessWaveBindingKey(runId), waves.createEndlessWaveBinding({
        playerName, runId, runToken: fixture.run.runToken, wave: fixture.run.wave, opponentId: built.opponentId, now,
    }));
    await kv.set(waves.endlessActiveWaveKey(playerName, fixture.run.runToken), { runId, wave: fixture.run.wave });
    assert.equal(await kv.get(waves.endlessSealedWaveKey(playerName, fixture.run.runToken)), null,
        'a pre-deploy active wave has no durable sealed marker');
    return { ...fixture, runId, session: built.session };
}

function terminal(session: SoloPveSession, outcome: 'win' | 'loss'): SoloPveSession {
    const winner = outcome === 'win' ? 'player' : 'enemy';
    return { ...session, version: session.version + 1, status: 'done', winner, outcome,
        player: { ...session.player, hp: outcome === 'loss' ? 0 : 700 },
        enemy: { ...session.enemy, hp: outcome === 'win' ? 0 : session.enemy.hp },
        terminalEvidence: { finishedAt: Date.now(), finalMoveToken: 'publication-terminal',
            finalVersion: session.version + 1, finalEventSeq: session.eventSeq,
            winner, outcome, itemsUsed: {}, settlementState: 'pending' } };
}

const start = (fixture: Fixture) => post(waveStart, fixture.playerName, { runToken: fixture.run.runToken });
const cashout = (fixture: Fixture) => post(runAction, fixture.playerName, { action: 'cashout', runToken: fixture.run.runToken });

async function assertBankUnchanged(fixture: Fixture) {
    const stored = await kv.get<typeof fixture.save>(`save:${fixture.playerName}`);
    assert.equal(stored?.character.ryo, fixture.save.character.ryo);
    assert.deepEqual(stored?.character.endlessTowerRun, fixture.run);
}

function isPublication(ops: readonly KvCasOp[]): boolean {
    return ops.some((op) => op.op === 'cas' && op.key.startsWith('solo-pve:endlesswave-'));
}

test('resuming a pre-deploy active wave repairs its marker and projection, so a later loss forfeits its bank', async () => {
    const fixture = await seedLegacyWave('legacyresumeloss');
    await kv.del(`battle-state:${fixture.playerName}`, `pve-held-fights:${fixture.playerName}`);
    const resumed = await start(fixture);
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body?.runId, fixture.runId);
    assert.equal(resumed.body?.resumed, true);
    assert.deepEqual(await kv.get(waves.endlessSealedWaveKey(fixture.playerName, fixture.run.runToken)),
        { runId: fixture.runId, wave: fixture.run.wave });
    assert.equal((await kv.get<{ sessionId: string }>(`battle-state:${fixture.playerName}`))?.sessionId, fixture.runId);
    assert.equal((await kv.hgetall<Record<string, number>>(`pve-held-fights:${fixture.playerName}`))?.[fixture.runId], fixture.session.createdAt);
    await assertBankUnchanged(fixture);

    await sessions.writeSoloPveSession(terminal(fixture.session, 'loss'));
    const paid = await cashout(fixture);
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body?.creditedRyo, 0);
    assert.equal(paid.body?.creditedXp, 0);
    assert.equal(paid.body?.character.ryo, fixture.save.character.ryo);
    assert.equal(paid.body?.character.endlessTowerRun, null);
});

test('cashout directly recognizes a lost legacy active binding without requiring a resume first', async () => {
    const fixture = await seedLegacyWave('legacydirectloss');
    await sessions.writeSoloPveSession(terminal(fixture.session, 'loss'));
    const result = await cashout(fixture);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body?.creditedRyo, 0);
    assert.equal(result.body?.character.ryo, fixture.save.character.ryo);
    assert.equal(result.body?.character.endlessTowerRun, null);
});

test('a live or won legacy wave resumes unchanged and a legitimate win can still settle and bank once', async () => {
    const fixture = await seedLegacyWave('legacyresumewin');
    const live = await start(fixture);
    assert.equal(live.status, 200, JSON.stringify(live.body));
    assert.equal(live.body?.runId, fixture.runId);
    assert.equal(live.body?.session.status, 'active');
    assert.equal((await cashout(fixture)).status, 409, 'a live wave must finish before banking');
    await assertBankUnchanged(fixture);

    // Repeat the pre-deploy condition for an already-won, still-unsettled wave.
    await kv.del(waves.endlessSealedWaveKey(fixture.playerName, fixture.run.runToken));
    await sessions.writeSoloPveSession(terminal(fixture.session, 'win'));
    const won = await start(fixture);
    assert.equal(won.status, 200, JSON.stringify(won.body));
    assert.equal(won.body?.runId, fixture.runId);
    assert.equal(won.body?.session.outcome, 'win');
    assert.equal((await cashout(fixture)).status, 409, 'a won wave must settle before banking');
    const settled = await post(runAction, fixture.playerName, { action: 'settle', runToken: fixture.run.runToken, waveRunId: fixture.runId });
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    assert.equal(settled.body?.outcome, 'win');
    assert.equal(settled.body?.run.wave, fixture.run.wave + 1);
    const expected = fixture.run.bankedRyo + endlessWaveReward(fixture.run.wave, fixture.save.character.level).ryo;
    const paid = await cashout(fixture);
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body?.creditedRyo, expected);
    assert.equal(paid.body?.character.ryo, fixture.save.character.ryo + expected);
    const retry = await cashout(fixture);
    assert.equal(retry.status, 200);
    assert.equal(retry.body?.replayed, true);
    assert.equal(retry.body?.character.ryo, paid.body?.character.ryo);
});

for (const failure of ['refused', 'thrown'] as const) {
    test(`a ${failure} atomic publication leaves no playable wave or partial marker and preserves the bank`, async () => {
        const fixture = await seedRun(`batch${failure}`);
        const original = kv.compareSetMany!;
        let attempted: readonly KvCasOp[] | undefined;
        kv.compareSetMany = async (ops) => {
            if (!isPublication(ops)) return original.call(kv, ops);
            attempted = ops;
            if (failure === 'thrown') throw new Error('publication transaction unavailable');
            return false;
        };
        try {
            const result = await start(fixture);
            assert.ok(result.status >= 400, JSON.stringify(result));
            assert.ok(attempted, 'wave publication must use the atomic store batch');
            assert.ok(attempted.some((op) => op.op === 'assert' && op.key === `save:${fixture.playerName}`),
                'the batch must assert the saved run from which the encounter was sealed');
            for (const op of attempted.filter((op) => op.op !== 'assert')) assert.equal(await kv.get(op.key), null, op.key);
            assert.equal(await kv.get(waves.endlessActiveWaveKey(fixture.playerName, fixture.run.runToken)), null);
            assert.equal(await kv.get(waves.endlessSealedWaveKey(fixture.playerName, fixture.run.runToken)), null);
            assert.equal(await kv.get(`battle-state:${fixture.playerName}`), null);
            await assertBankUnchanged(fixture);
        } finally {
            kv.compareSetMany = original;
        }
        const paid = await cashout(fixture);
        assert.equal(paid.status, 200, JSON.stringify(paid.body));
        assert.equal(paid.body?.creditedRyo, fixture.run.bankedRyo,
            'an aborted publication must not mark an unplayed wave lost');
        const retry = await cashout(fixture);
        assert.equal(retry.status, 200);
        assert.equal(retry.body?.replayed, true);
        assert.equal(retry.body?.character.ryo, fixture.save.character.ryo + fixture.run.bankedRyo);
    });
}

test('publication refuses a changed source save without publishing a wave or overwriting the newer save', async () => {
    const fixture = await seedRun('publicationsourcecas');
    const original = kv.compareSetMany!;
    const replacement = { ...fixture.save, _saveVersion: 2,
        character: { ...fixture.save.character, ryo: 9876, endlessTowerRun: null } };
    let attempted: readonly KvCasOp[] | undefined;
    kv.compareSetMany = async (ops) => {
        if (isPublication(ops)) {
            attempted = ops;
            // A non-cooperating/expired-lease writer changes the source after
            // wave-start read it; the batch's raw-save assertion must catch it.
            await kv.set(`save:${fixture.playerName}`, replacement);
        }
        return original.call(kv, ops);
    };
    try {
        const result = await start(fixture);
        assert.equal(result.status, 409, JSON.stringify(result.body));
        assert.ok(attempted, 'the stale publication must reach its source assertion');
        for (const op of attempted.filter((op) => op.op !== 'assert')) assert.equal(await kv.get(op.key), null, op.key);
        assert.deepEqual(await kv.get(`save:${fixture.playerName}`), replacement);
        assert.equal(await kv.get(`battle-state:${fixture.playerName}`), null);
    } finally {
        kv.compareSetMany = original;
    }
});

test('a committed publication whose acknowledgement is lost resumes the same wave and repairs its projection', async () => {
    const fixture = await seedRun('lostpublicationreply');
    const original = kv.compareSetMany!;
    let publishedId = '';
    kv.compareSetMany = async (ops) => {
        const committed = await original.call(kv, ops);
        if (committed && isPublication(ops)) {
            publishedId = ops.find((op) => op.key.startsWith('solo-pve:endlesswave-'))!.key.slice('solo-pve:'.length);
            throw new Error('publication committed; connection lost before acknowledgement');
        }
        return committed;
    };
    try {
        await start(fixture); // The caller did not receive a usable acknowledgement.
    } finally {
        kv.compareSetMany = original;
    }
    assert.ok(publishedId, 'the transaction committed before its acknowledgement was lost');
    await kv.del(`battle-state:${fixture.playerName}`, `pve-held-fights:${fixture.playerName}`);
    const resumed = await start(fixture);
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body?.resumed, true);
    assert.equal(resumed.body?.runId, publishedId);
    assert.equal((await kv.get<{ sessionId: string }>(`battle-state:${fixture.playerName}`))?.sessionId, publishedId);
    assert.deepEqual(await kv.keys('solo-pve:endlesswave-*'), [`solo-pve:${publishedId}`]);
    await assertBankUnchanged(fixture);
});

test('cashout racing a fresh publication cannot bank the run and leave a playable wave behind', { timeout: 5000 }, async () => {
    const fixture = await seedRun('publicationcashoutrace');
    const originalBatch = kv.compareSetMany!;
    const originalSet = kv.set;
    let releasePublication!: () => void;
    const publicationGate = new Promise<void>((resolve) => { releasePublication = resolve; });
    let publicationEntered!: () => void;
    const publicationReady = new Promise<void>((resolve) => { publicationEntered = resolve; });
    let cashoutLockAttempted!: () => void;
    const cashoutQueued = new Promise<void>((resolve) => { cashoutLockAttempted = resolve; });
    let awaitingCashout = false;
    kv.compareSetMany = async (ops) => {
        if (isPublication(ops)) {
            publicationEntered();
            await publicationGate;
        }
        return originalBatch.call(kv, ops);
    };
    kv.set = async (key, value, options) => {
        if (awaitingCashout && key === `lock:save:${fixture.playerName}`) cashoutLockAttempted();
        return originalSet.call(kv, key, value, options);
    };
    let starting: Promise<Response> | undefined;
    let banking: Promise<Response> | undefined;
    try {
        starting = start(fixture);
        await publicationReady;
        awaitingCashout = true;
        banking = cashout(fixture);
        await cashoutQueued;
        releasePublication();
        const [started, banked] = await Promise.all([starting, banking]);
        assert.equal(started.status, 200, JSON.stringify(started.body));
        assert.equal(banked.status, 409, JSON.stringify(banked.body));
        assert.equal((await sessions.readSoloPveSession(started.body!.runId))?.status, 'active');
        assert.deepEqual(await kv.get(waves.endlessSealedWaveKey(fixture.playerName, fixture.run.runToken)),
            { runId: started.body?.runId, wave: fixture.run.wave });
        await assertBankUnchanged(fixture);
    } finally {
        releasePublication();
        if (starting) await starting;
        if (banking) await banking;
        kv.compareSetMany = originalBatch;
        kv.set = originalSet;
    }
});
