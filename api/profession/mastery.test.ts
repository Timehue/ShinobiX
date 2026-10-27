import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'profession-mastery-test-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
const SAVE_KEY = 'save:masterytester';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./mastery.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function post(body: Record<string, unknown>): Promise<ResponseOut> {
    const out: ResponseOut = { statusCode: 200, body: undefined };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    const req = { method: 'POST', body, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! }, socket: { remoteAddress: '127.0.0.1' } };
    await handler(req as never, res as never);
    return out;
}

describe('profession mastery respec', () => {
    it('charges once: a repeated respec with nothing invested refuses and keeps the ryo', async () => {
        await kv.set(SAVE_KEY, { _saveVersion: 1, character: {
            name: 'masterytester', level: 50, profession: 'healer', ryo: 120_000, masterySpec: { 'heal-xp': 2 },
        } });
        const first = await post({ playerName: 'masterytester', action: 'respec' });
        assert.equal(first.statusCode, 200);
        const afterFirst = (await kv.get<{ character: Record<string, unknown> }>(SAVE_KEY))!.character;
        assert.equal(afterFirst.ryo, 70_000);
        assert.deepEqual(afterFirst.masterySpec, {});

        const repeat = await post({ playerName: 'masterytester', action: 'respec' });
        assert.equal(repeat.statusCode, 409);
        assert.equal((await kv.get<{ character: Record<string, unknown> }>(SAVE_KEY))!.character.ryo, 70_000);
    });

    it('never bills a respec for a character with no mastery spec at all', async () => {
        await kv.set(SAVE_KEY, { _saveVersion: 1, character: { name: 'masterytester', level: 50, profession: 'healer', ryo: 80_000 } });
        const result = await post({ playerName: 'masterytester', action: 'respec' });
        assert.equal(result.statusCode, 409);
        assert.equal((await kv.get<{ character: Record<string, unknown> }>(SAVE_KEY))!.character.ryo, 80_000);
    });
});
