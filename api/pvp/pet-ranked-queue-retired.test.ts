import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'pet-ranked-retired-test-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

const PLAYER = 'rankedretired';
const QUEUE_KEY = 'pvp:pet-ranked-queue';
const MATCH_KEY = `pvp:pet-ranked-queue:match:${PLAYER}`;

let handler: Handler;
let kv: typeof import('../_storage.js').kv;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./pet-ranked-queue.js')).default as unknown as Handler;
});

beforeEach(async () => {
    await Promise.all([kv.del(QUEUE_KEY), kv.del(MATCH_KEY)]);
});

after(async () => {
    await Promise.all([kv.del(QUEUE_KEY), kv.del(MATCH_KEY)]);
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeRes() {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function request(method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    const req = {
        method,
        query: method === 'GET' ? { name: PLAYER } : {},
        body,
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res);
    return out;
}

describe('retired public Pet Ranked admission', { concurrency: false }, () => {
    it('returns Gone and cannot create or consume queue pairing state', async () => {
        const queue = [{ name: PLAYER, level: 20, elo: 1000, joinedAt: Date.now() }];
        const match = { opponent: 'rival', pairId: '11111111-1111-1111-1111-111111111111', initiator: true };
        await Promise.all([kv.set(QUEUE_KEY, queue), kv.set(MATCH_KEY, match)]);

        const joined = await request('POST', { name: PLAYER, action: 'join' });
        assert.equal(joined.statusCode, 410);
        assert.equal(joined.body?.available, false);
        assert.match(String(joined.body?.error), /authoritative combat and rating lifecycle/i);
        assert.deepEqual(await kv.get(QUEUE_KEY), queue);
        assert.deepEqual(await kv.get(MATCH_KEY), match);

        const status = await request('GET');
        assert.equal(status.statusCode, 410);
        assert.equal(status.body?.inQueue, false);
        assert.equal(status.body?.match, null);
    });

    it('contains no matchmaking, pairing, or ordinary-duel authority', () => {
        const source = readFileSync(join(process.cwd(), 'api', 'pvp', 'pet-ranked-queue.ts'), 'utf8');
        assert.doesNotMatch(source, /withKvLock|randomUUID|petRankedQueueMatchKey|PET_RANKED_ACTIVE_REGISTRY_KEY/);
        assert.match(source, /res\.status\(410\)/);
        assert.match(source, /already-minted[\s\S]*legacy ranked tokens may still settle/);
    });
});
