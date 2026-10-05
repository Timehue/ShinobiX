import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, type TestContext } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'clan-territory-assign-scrolls-test-secret';

let kv: typeof import('../../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let issuePlayerToken: typeof import('../../_auth.js').issuePlayerToken;

const SECTOR = 59;
const TERRITORY_KEY = `world:territory:${SECTOR}`;
const CLAN_KEY = 'save:clan-stormclan';
const MEMBERS = ['Alice', 'Bob', 'Cara', 'Dov', 'Eli', 'Fen', 'Gus', 'Hana', 'Ivo', 'Jun'];

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ issuePlayerToken } = await import('../../_auth.js'));
    handler = (await import('./assign-scrolls.js')).default as unknown as typeof handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(CLAN_KEY, {
        name: 'Storm Clan',
        village: 'Stormveil Village',
        founderName: 'Alice',
        members: MEMBERS.map((name) => ({ name })),
        roleOverrides: {},
        treasury: { items: [{ itemId: 'territory-control-scroll', count: 75 }] },
    });
    await kv.set('save:alice', { character: { name: 'Alice', clan: 'Storm Clan', village: 'Stormveil Village' } });
});

async function capture(requestId: string) {
    const out: { statusCode: number; body?: Record<string, any> } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Record<string, any>) { out.body = body; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: {
            playerName: 'alice',
            clan: 'Storm Clan',
            sector: SECTOR,
            count: 75,
            weather: 'clear',
            terrainBuffStat: 'ninjutsuOffense',
            requestId,
        },
        query: {},
        headers: { 'x-player-token': issuePlayerToken('alice'), 'x-forwarded-for': '127.0.0.1' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

/**
 * Reads come back the way production returns them. Uncached prefixes (saves and
 * territory rows) come from Postgres in the JSON form. The receipt prefix is
 * cached, so within its 10 s TTL this process reads back the object it wrote.
 */
function readLikeProduction(t: TestContext, failTerritoryReadAfterLostReply = false): { lost: () => number } {
    const realGet = kv.get.bind(kv);
    const realCompareSet = kv.compareSet.bind(kv);
    let lostReplies = 0;
    let failNextTerritoryRead = false;
    t.mock.method(kv, 'get', async (key: string) => {
        if (key === TERRITORY_KEY && failNextTerritoryRead) {
            failNextTerritoryRead = false;
            throw new Error('Connection terminated unexpectedly');
        }
        const value = await realGet(key);
        if (key.startsWith('clan-territory-assign:') || value === null) return value;
        return JSON.parse(JSON.stringify(value));
    });
    t.mock.method(kv, 'compareSet', async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => {
        const landed = await realCompareSet(key, expected, value, options);
        if (key !== TERRITORY_KEY || !landed || lostReplies > 0) return landed;
        lostReplies += 1;
        failNextTerritoryRead = failTerritoryReadAfterLostReply;
        throw new Error('Connection terminated unexpectedly');
    });
    return { lost: () => lostReplies };
}

async function scrollsLeft(): Promise<number> {
    const clan = await kv.get<{ treasury?: { items?: Array<{ itemId: string; count: number }> } }>(CLAN_KEY);
    return clan?.treasury?.items?.find((stack) => stack.itemId === 'territory-control-scroll')?.count ?? 0;
}

describe('clan territory capture with lost replies', { concurrency: false }, () => {
    it('captures once when the territory write lands but loses its reply', async (t) => {
        // A capture writes six lifecycle fields as explicit undefined. A
        // deep-equal read-back of the JSON row judged the landed write lost, so
        // the handler refunded the clan and answered 500 on a sector it now owned.
        const { lost } = readLikeProduction(t);
        const first = await capture('capture-lost-reply-1');
        assert.equal(lost(), 1, 'the territory write landed and only its reply was lost');
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.equal(first.body?.captured, true);
        assert.equal(await scrollsLeft(), 0, 'the clan pays the 75 scrolls exactly once');
        assert.equal((await kv.get<Record<string, unknown>>(TERRITORY_KEY))?.ownerClan, 'Storm Clan');
    });

    it('a retry finishes a capture whose first attempt failed after the write landed', async (t) => {
        // The first attempt cannot read the row back, so it refunds and fails.
        // The retry then compares the landed row with the cached receipt, whose
        // territory still holds those explicit undefined fields. A deep-equal saw
        // a conflict, refunded again and left the clan with a free sector.
        const { lost } = readLikeProduction(t, true);
        const first = await capture('capture-lost-reply-2');
        assert.equal(lost(), 1, 'the territory write landed and only its reply was lost');
        assert.notEqual(first.statusCode, 200, 'the first attempt cannot confirm its write');
        assert.equal(await scrollsLeft(), 75, 'and refunds the clan');

        const retry = await capture('capture-lost-reply-2');
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(await scrollsLeft(), 0, 'the retry charges the capture it completes');
        assert.equal((await kv.get<Record<string, unknown>>(TERRITORY_KEY))?.ownerClan, 'Storm Clan');
    });
});
