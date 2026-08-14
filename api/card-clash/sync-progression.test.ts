import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'chronicle-sync-handler-test-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseBody = Record<string, unknown>;
type StoredSave = {
    _saveVersion: number;
    _saveAt?: number;
    character: Record<string, unknown>;
};

const OWNER = 'chroniclesyncowner';
const ATTACKER = 'chroniclesyncattacker';
const LOCKED = 'chroniclesynclocked';
const STORY_CARD = 'story-story-ai-stormveil-village-4';

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;

function response() {
    const out: { statusCode: number; body?: ResponseBody } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => {
            out.statusCode = statusCode;
            return res;
        },
        json: (body: ResponseBody) => {
            out.body = body;
            return res;
        },
        end: () => res,
    };
    return { res: res as never, out };
}

function request(
    playerName: string,
    authenticatedAs?: string,
    headers: Record<string, string> = {},
) {
    return {
        method: 'POST',
        body: { playerName },
        headers: {
            'content-type': 'application/json',
            'x-forwarded-for': '198.51.100.42',
            ...(authenticatedAs
                ? {
                    'x-player-name': authenticatedAs,
                    'x-player-token': issuePlayerToken(authenticatedAs)!,
                }
                : {}),
            ...headers,
        },
        socket: { remoteAddress: '198.51.100.42' },
    } as never;
}

async function call(playerName: string, authenticatedAs?: string, headers?: Record<string, string>) {
    const { res, out } = response();
    await handler(request(playerName, authenticatedAs, headers), res);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./sync-progression.js')).default as unknown as Handler;

    await kv.set(`save:${OWNER}`, {
        _saveVersion: 7,
        _saveAt: 1_700_000_000_000,
        character: {
            name: OWNER,
            level: 17,
            ryo: 0,
            starterCardsClaimed: true,
            village: 'Stormveil Village',
            storyProgress: 1,
            tileCards: ['tc-01'],
        },
    });
    await kv.set(`save:${LOCKED}`, {
        _saveVersion: 4,
        _saveAt: 1_700_000_000_000,
        character: {
            name: LOCKED,
            level: 17,
            ryo: 0,
            starterCardsClaimed: false,
            village: 'Stormveil Village',
            storyProgress: 1,
            tileCards: ['tc-01'],
        },
    });
});

after(async () => {
    const rateLimitKeys = await kv.keys('ratelimit:chronicle-sync-progression:*');
    await kv.del(`save:${OWNER}`, `save:${LOCKED}`, ...rateLimitKeys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('real sync-progression handler enforces authentication, ownership, and the Chronicle unlock', async () => {
    const ownerBefore = await kv.get<StoredSave>(`save:${OWNER}`);
    const lockedBefore = await kv.get<StoredSave>(`save:${LOCKED}`);

    const unauthenticated = await call(OWNER);
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(unauthenticated.body?.error, 'Authentication required.');

    const wrongOwner = await call(OWNER, ATTACKER);
    assert.equal(wrongOwner.statusCode, 403);
    assert.equal(wrongOwner.body?.error, 'Not your Chronicle.');

    const locked = await call(LOCKED, LOCKED);
    assert.equal(locked.statusCode, 409);
    assert.equal(locked.body?.error, 'chronicle-locked');

    assert.deepEqual(await kv.get(`save:${OWNER}`), ownerBefore, 'auth failures must not touch the target save');
    assert.deepEqual(await kv.get(`save:${LOCKED}`), lockedBefore, 'a locked Chronicle must not backfill or bump its save');
});

test('real sync-progression handler grants once and replays without another save-version bump', async () => {
    const first = await call(OWNER, OWNER);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body?.ok, true);
    assert.deepEqual(first.body?.granted, [STORY_CARD]);
    assert.equal(first.body?._saveVersion, 8);

    const firstCharacter = first.body?.character as Record<string, unknown>;
    assert.deepEqual(firstCharacter.tileCards, ['tc-01', STORY_CARD]);

    const storedAfterFirst = await kv.get<StoredSave>(`save:${OWNER}`);
    assert.equal(storedAfterFirst?._saveVersion, 8);
    assert.deepEqual(storedAfterFirst?.character, firstCharacter, 'the response must be the persisted authoritative character');

    const replay = await call(OWNER, OWNER);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body?.ok, true);
    assert.deepEqual(replay.body?.granted, []);
    assert.equal(replay.body?._saveVersion, 8);
    assert.deepEqual(replay.body?.character, firstCharacter);
    assert.deepEqual(
        await kv.get(`save:${OWNER}`),
        storedAfterFirst,
        'an idempotent replay must not rewrite the save or advance _saveVersion/_saveAt',
    );
});
