import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pvp-session-publication-readback-test';

import { PVP_SESSION_PUBLICATION_TOMBSTONE_VERSION } from './_session-publication-tombstone.js';

type Handler = (req: never, res: never) => Promise<unknown>;

/**
 * A session against an opponent without a save keeps the client's vitals, so
 * `maxChakra: "x"` makes that fighter's chakra NaN. Postgres stores NaN as
 * null, so the stored row no longer deep-equals the in-memory session.
 */
function body(creator: string, battleId: string) {
    return {
        battleId,
        p1Character: { name: creator },
        p2Character: { name: 'readbackrival', level: 20, maxHp: 500, maxChakra: 'x', maxStamina: 500 },
    };
}

async function setup(t: TestContext, creator: string) {
    const { kv } = await import('../_storage.js');
    const { issuePlayerToken } = await import('../_auth.js');
    const handler = (await import('./session.js')).default as unknown as Handler;
    await kv.set(`save:${creator}`, {
        _saveVersion: 1,
        character: {
            name: creator, level: 20, village: 'Leaf',
            maxHp: 500, maxChakra: 500, maxStamina: 500, hp: 500, chakra: 500, stamina: 500,
            stats: {}, equipment: {}, inventory: [], itemStacks: [], jutsu: [], jutsuMastery: [],
        },
    });
    // Production reads come back from Postgres in the JSON form.
    const realGet = kv.get.bind(kv);
    t.mock.method(kv, 'get', async (key: string) => {
        const value = await realGet(key);
        return value === null ? null : JSON.parse(JSON.stringify(value));
    });
    const post = async (battleId: string) => {
        const out: { statusCode: number; body?: Record<string, any> } = { statusCode: 200 };
        const res = {
            setHeader: () => res,
            status(code: number) { out.statusCode = code; return res; },
            json(response: Record<string, any>) { out.body = response; return res; },
            end: () => res,
        };
        await handler({
            method: 'POST',
            body: body(creator, battleId),
            query: {},
            headers: { 'x-player-token': issuePlayerToken(creator), 'x-forwarded-for': '127.0.0.7' },
            socket: { remoteAddress: '127.0.0.7' },
        } as never, res as never);
        return out;
    };
    return { kv, post };
}

test('a failed pointer activation still fences a session that is not JSON-stable', async (t) => {
    // The rollback compares the stored row with the in-memory session before it
    // fences the battle id. A plain deep-equal saw a conflict, answered 500 and
    // left the unpublished row live instead of fencing it for the 503 retry.
    const creator = 'readbackfence';
    const { kv, post } = await setup(t, creator);
    const battleId = 'pvp-88888888-8888-4888-8888-888888888888';
    const realCompareSet = kv.compareSet.bind(kv);
    let failActivation = true;
    t.mock.method(kv, 'compareSet', async (key: string, expected: unknown, next: unknown, options?: { ex?: number }) => {
        if (failActivation && key === `pvp:pending-session:${creator}` && typeof next === 'string'
            && (JSON.parse(next) as { phase?: string }).phase === 'active') {
            failActivation = false;
            throw new Error('forced-pointer-activation-precommit');
        }
        return realCompareSet(key, expected, next, options);
    });

    const rolledBack = await post(battleId);
    assert.equal(failActivation, false, 'the pointer activation failed');
    assert.equal(rolledBack.statusCode, 503, JSON.stringify(rolledBack.body));
    assert.equal((await kv.get<Record<string, unknown>>(`pvp:${battleId}`))?.version,
        PVP_SESSION_PUBLICATION_TOMBSTONE_VERSION, 'the battle id is fenced for the retry');
});

test('a session write that landed but lost its reply is published, not torn down', async (t) => {
    // The create path reads the row back and compares it with the in-memory
    // session. A plain deep-equal judged the landed write lost, cleared the
    // creator's pointer and answered 500 while the row stayed live.
    const { kv, post } = await setup(t, 'readbackcreate');
    const battleId = 'pvp-99999999-9999-4999-8999-999999999999';
    const realSet = kv.set.bind(kv);
    let lostReplies = 0;
    t.mock.method(kv, 'set', async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        const written = await realSet(key, value, options);
        if (key !== `pvp:${battleId}` || written !== 'OK' || lostReplies > 0) return written;
        lostReplies += 1;
        throw new Error('Connection terminated unexpectedly');
    });

    const created = await post(battleId);
    assert.equal(lostReplies, 1, 'the session row landed and only its reply was lost');
    assert.equal(created.statusCode, 200, JSON.stringify(created.body));
    assert.equal((await kv.get<Record<string, unknown>>(`pvp:${battleId}`))?.status, 'active');
});
