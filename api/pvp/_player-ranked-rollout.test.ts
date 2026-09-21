import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { playerRankedV2AdmissionsEnabled } from './_player-ranked-rollout.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let startRankedSeason: typeof import('../cron/_ranked-season.js').startRankedSeason;
let stopRankedSeason: typeof import('../cron/_ranked-season.js').stopRankedSeason;

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

async function status() {
    const { out, res } = response();
    await handler({ method: 'GET', query: { name: 'rolloutalice' }, headers: {}, body: {} } as never, res);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ startRankedSeason, stopRankedSeason } = await import('../cron/_ranked-season.js'));
    handler = (await import('./ranked-queue.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('ranked:*')) await kv.del(key);
    for (const key of await kv.keys('pvp:ranked-queue*')) await kv.del(key);
});

after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });

test('deployment environment flags no longer block player-ranked admissions', () => {
    assert.equal(playerRankedV2AdmissionsEnabled({}), true);
    assert.equal(playerRankedV2AdmissionsEnabled({ DISABLE_PLAYER_RANKED_V2: '1' }), true);
});

test('ranked queue availability follows the Admin Panel start and stop controls', async () => {
    assert.equal((await status()).body?.enabled, false, 'no season means no entries');

    await startRankedSeason(Date.now());
    assert.equal((await status()).body?.enabled, true, 'Start opens ranked entries');

    await stopRankedSeason();
    assert.equal((await status()).body?.enabled, false, 'Stop pauses new ranked entries');

    await startRankedSeason(Date.now());
    assert.equal((await status()).body?.enabled, true, 'Start resumes the stopped season');
});
