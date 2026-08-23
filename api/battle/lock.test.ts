import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'battle-lock-handler-test-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown>; headers: Record<string, string> };

let handler: Handler;
let kv: typeof import('../_storage.js').kv;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./lock.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('battle-lock:*')) await kv.del(key);
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeRes() {
    const out: ResponseOut = { statusCode: 200, headers: {} };
    const res = {
        setHeader: (name: string, value: string) => { out.headers[name] = value; return res; },
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function post(body: Record<string, unknown>): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    const req = {
        method: 'POST',
        body,
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res);
    return out;
}

describe('battle lock concurrency', { concurrency: false }, () => {
    it('keeps exactly one authoritative fight across concurrent different starts', async () => {
        const playerName = 'battle-lock-race';
        const attempts = await Promise.all(Array.from({ length: 6 }, (_, index) => post({
            action: 'start',
            playerName,
            battleId: `battle-${index}`,
            kind: 'arena',
            screen: 'arena',
        })));

        assert.ok(attempts.every((attempt) => attempt.statusCode === 200));
        const ids = attempts.map((attempt) => ((attempt.body?.lock as { battleId?: string })?.battleId));
        assert.equal(new Set(ids).size, 1, 'every contender receives the same first-writer lock');
        assert.equal(attempts.filter((attempt) => attempt.body?.alreadyLocked === false).length, 1);
        assert.equal((await kv.get<{ battleId?: string }>(`battle-lock:${playerName}`))?.battleId, ids[0]);
    });

    it('a stale resolve cannot clear a newer battle', async () => {
        const playerName = 'battle-lock-stale';
        await post({ action: 'start', playerName, battleId: 'current', kind: 'arena', screen: 'arena' });
        const stale = await post({ action: 'resolve', playerName, battleId: 'old' });
        assert.equal(stale.statusCode, 200);
        assert.equal((await kv.get<{ battleId?: string }>(`battle-lock:${playerName}`))?.battleId, 'current');
    });

    it('applies cleared-state loss and unlocks under fail-closed nested locks', async () => {
        const playerName = 'battle-lock-loss';
        await kv.set(`save:${playerName}`, {
            _saveVersion: 4,
            character: { name: playerName, hp: 500, hospitalized: false },
        });
        await post({ action: 'start', playerName, battleId: 'loss-battle', kind: 'arena', screen: 'arena' });

        const result = await post({ action: 'resolve', playerName, battleId: 'loss-battle', outcome: 'loss' });
        assert.equal(result.statusCode, 200);
        assert.equal(result.body?._saveVersion, 5);
        assert.equal(await kv.get(`battle-lock:${playerName}`), null);
        const saved = await kv.get<{ character?: { hp?: number; hospitalized?: boolean } }>(`save:${playerName}`);
        assert.equal(saved?.character?.hp, 0);
        assert.equal(saved?.character?.hospitalized, true);
    });

    // A Battle Towers lease shares the `battle-lock:<slug>` key but is owned by
    // towers/_battle-lease.ts, which releases it only through an exact-run
    // compare-delete. The run ID is known to that run's own client, so this
    // compatibility endpoint must refuse both ways of dropping it — otherwise
    // findTowerBattleStartConflict() stops blocking a concurrent second fight.
    describe('Battle Towers lease isolation', () => {
        const towerLease = (runId: string) => ({
            battleId: runId,
            kind: 'battleTowers',
            screen: 'battleTowers',
            startedAt: Date.now(),
            meta: { runId },
        });

        it('refuses to release a Tower lease through a matching-runId resolve', async () => {
            const playerName = 'battle-lock-tower-resolve';
            const runId = 'tower-abcdef0123456789';
            await kv.set(`battle-lock:${playerName}`, towerLease(runId));

            const attempt = await post({ action: 'resolve', playerName, battleId: runId });
            assert.equal(attempt.statusCode, 409);
            assert.equal(attempt.body?.errorCode, 'tower-battle-active');
            const stored = await kv.get<{ kind?: string; meta?: { runId?: string } }>(`battle-lock:${playerName}`);
            assert.equal(stored?.kind, 'battleTowers', 'the lease survives the refused resolve');
            assert.equal(stored?.meta?.runId, runId);
        });

        it('never hospitalizes the save while refusing a Tower-lease loss report', async () => {
            const playerName = 'battle-lock-tower-loss';
            const runId = 'tower-fedcba9876543210';
            await kv.set(`save:${playerName}`, {
                _saveVersion: 2,
                character: { name: playerName, hp: 420, hospitalized: false },
            });
            await kv.set(`battle-lock:${playerName}`, towerLease(runId));

            const attempt = await post({ action: 'resolve', playerName, battleId: runId, outcome: 'loss' });
            assert.equal(attempt.statusCode, 409);
            const saved = await kv.get<{ _saveVersion?: number; character?: { hp?: number; hospitalized?: boolean } }>(`save:${playerName}`);
            assert.equal(saved?.character?.hp, 420, 'a refused report must not apply a defeat');
            assert.equal(saved?.character?.hospitalized, false);
            assert.equal(saved?._saveVersion, 2);
            assert.equal((await kv.get<{ kind?: string }>(`battle-lock:${playerName}`))?.kind, 'battleTowers');
        });

        it('refuses to overwrite a Tower lease with a same-runId start', async () => {
            const playerName = 'battle-lock-tower-start';
            const runId = 'tower-0f1e2d3c4b5a6978';
            await kv.set(`battle-lock:${playerName}`, towerLease(runId));

            const attempt = await post({
                action: 'start',
                playerName,
                battleId: runId,
                kind: 'arena',
                screen: 'arena',
            });
            assert.equal(attempt.statusCode, 409);
            assert.equal(attempt.body?.errorCode, 'tower-battle-active');
            const stored = await kv.get<{ kind?: string; meta?: { runId?: string } }>(`battle-lock:${playerName}`);
            assert.equal(stored?.kind, 'battleTowers', 'the lease keeps its Tower shape');
            assert.equal(stored?.meta?.runId, runId, 'meta.runId still identifies the lease to isTowerBattleLock');
        });

        it('leaves every legacy non-Tower lock path working', async () => {
            const playerName = 'battle-lock-legacy-untouched';
            await post({ action: 'start', playerName, battleId: 'legacy-1', kind: 'storyBoss', screen: 'storyHall' });
            const resolved = await post({ action: 'resolve', playerName, battleId: 'legacy-1' });
            assert.equal(resolved.statusCode, 200);
            assert.equal(await kv.get(`battle-lock:${playerName}`), null);
        });
    });
});
