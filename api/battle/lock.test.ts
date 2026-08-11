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

    it('reserves Battle Towers lock creation and refuses client overwrite or resolve', async () => {
        const playerName = 'battle-lock-tower-owned';
        const rejected = await post({
            action: 'start', playerName, battleId: 'tower-client-forged', kind: 'battleTowers', screen: 'battleTowers',
        });
        assert.equal(rejected.statusCode, 403);
        assert.equal(rejected.body?.errorCode, 'server-owned-lock');

        const serverLock = {
            battleId: 'tower-server-run',
            kind: 'battleTowers',
            screen: 'battleTowers',
            startedAt: 123,
            meta: { runId: 'tower-server-run' },
        };
        await kv.set(`battle-lock:${playerName}`, serverLock);
        const overwrite = await post({
            action: 'start', playerName, battleId: 'tower-server-run', kind: 'arena', screen: 'arena',
        });
        assert.equal(overwrite.statusCode, 200);
        assert.equal(overwrite.body?.alreadyLocked, true);
        assert.deepEqual(await kv.get(`battle-lock:${playerName}`), serverLock);

        const resolved = await post({ action: 'resolve', playerName, battleId: 'tower-server-run', outcome: 'loss' });
        assert.equal(resolved.statusCode, 409);
        assert.equal(resolved.body?.errorCode, 'server-owned-lock');
        assert.deepEqual(await kv.get(`battle-lock:${playerName}`), serverLock);
    });
});
