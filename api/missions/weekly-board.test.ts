import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

/*
 * The weekly claim records itself BEFORE it pays, so a failed claim write can
 * never pay twice. The payout commits with an exact compare-and-set; when that
 * loses to a concurrent save write nothing is paid, and the claim it recorded
 * has to come back off the record — otherwise the retry finds the mission
 * claimed and the player never gets the reward.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'weekly-board-claim-admin';
delete process.env.SESSION_SECRET;

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

const NAME = 'weeklyboardclaimqa';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let recordKey: string;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./weekly-board.js')).default as unknown as Handler;
    const { weekKey } = await import('./_weekly-board.js');
    recordKey = `weekly-board:${NAME}:${weekKey(Date.now())}`;
});

after(async () => {
    for (const key of await kv.keys(`*${NAME}*`)) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

async function call(body: Json, method = 'POST'): Promise<{ statusCode: number; body?: Json }> {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(payload: Json) { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method,
        body,
        query: method === 'GET' ? body : {},
        headers: { 'content-type': 'application/json', 'x-admin-password': ADMIN_PASSWORD, 'x-forwarded-for': '127.0.0.92' },
        socket: { remoteAddress: '127.0.0.92' },
    } as never, res as never);
    return out;
}

describe('weekly board claim', { concurrency: false }, () => {
    it('takes the claim back when the payout loses its compare-and-set, so the retry pays once', async () => {
        await kv.set(`save:${NAME}`, {
            _saveVersion: 1,
            _saveAt: Date.now(),
            character: { name: NAME, level: 20, ryo: 100, fateShards: 0, boneCharms: 0, totalMissionsCompleted: 500, rankedWins: 500, hollowGateWardenKills: 500 },
        });
        const board = await call({ playerName: NAME }, 'GET');
        const missionId = String(((board.body?.missions as Json[]) ?? [])[0]?.id ?? '');
        assert.ok(missionId);
        await kv.set(recordKey, { baseline: { totalMissionsCompleted: 0, rankedWins: 0, hollowGateWardenKills: 0 }, claimed: [] });

        const original = kv.compareSet;
        kv.compareSet = async (key, expected, value, options) => {
            if (key === `save:${NAME}`) return false;
            return original.call(kv, key, expected, value, options);
        };
        let lost: { statusCode: number; body?: Json };
        try {
            lost = await call({ playerName: NAME, missionId });
        } finally {
            kv.compareSet = original;
        }
        assert.equal(lost.statusCode, 503);
        assert.equal(lost.body?.errorCode, 'save-version-conflict');
        assert.equal(lost.body?.retryable, true);
        assert.deepEqual((await kv.get<Json>(recordKey))?.claimed, [], 'the unpaid claim came back off the record');
        assert.equal(((await kv.get<Json>(`save:${NAME}`))?.character as Json).ryo, 100, 'nothing was paid');

        const paid = await call({ playerName: NAME, missionId });
        assert.equal(paid.statusCode, 200, JSON.stringify(paid.body));
        assert.equal(paid.body?.missionId, missionId);
        const reward = paid.body?.reward as Json;
        const afterPay = (await kv.get<Json>(`save:${NAME}`))?.character as Json;
        assert.equal(afterPay.ryo, 100 + Number(reward.ryo ?? 0));

        const replay = await call({ playerName: NAME, missionId });
        assert.equal(replay.statusCode, 200);
        assert.equal(replay.body?.alreadyClaimed, true);
        assert.equal(((await kv.get<Json>(`save:${NAME}`))?.character as Json).ryo, afterPay.ryo, 'paid exactly once');
        assert.deepEqual((await kv.get<Json>(recordKey))?.claimed, [missionId]);
    });
});
