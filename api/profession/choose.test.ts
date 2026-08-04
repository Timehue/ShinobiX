import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'profession-handler-test-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
const SAVE_KEY = 'save:professiontester';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./choose.js')).default as unknown as Handler;
});

beforeEach(async () => {
    await kv.set(SAVE_KEY, { _saveVersion: 1, character: { name: 'professiontester', level: 13 } });
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeReq(body: Record<string, unknown>) {
    return { method: 'POST', body, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! }, socket: { remoteAddress: '127.0.0.1' } } as never;
}
function fakeRes() {
    const out: ResponseOut = { statusCode: 200, body: undefined };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}
async function post(body: Record<string, unknown>): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    await handler(fakeReq(body), res);
    return out;
}

describe('profession choice settlement', () => {
    it('is deterministic and idempotent under repeated choice requests', { concurrency: false }, async () => {
        assert.equal((await post({ playerName: 'professiontester', profession: 'vanguard' })).statusCode, 200);
        const replay = await post({ playerName: 'professiontester', profession: 'vanguard' });
        assert.equal(replay.statusCode, 200);
        assert.equal(replay.body?.idempotent, true);
        const conflict = await post({ playerName: 'professiontester', profession: 'healer' });
        assert.equal(conflict.statusCode, 409);
        assert.equal((await kv.get<{ character?: { profession?: string } }>(SAVE_KEY))?.character?.profession, 'vanguard');
    });
});
