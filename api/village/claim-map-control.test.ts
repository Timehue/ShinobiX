import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
delete process.env.ADMIN_PASSWORD;

/*
 * The personal Map Control daily reward, on the real handler and storage
 * adapter. The day marker used to be placed BEFORE the reward's save write,
 * so a save write that failed left the day claimed and the reward unpaid:
 * the retry answered "already claimed" with nothing granted.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { status: number; body?: Record<string, unknown> };

const PLAYER = 'mapclaimer';
const SAVE_KEY = `save:${PLAYER}`;
const VILLAGE = 'Frostfang Village';

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let resetRateLimits: () => void;
let handler: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    handler = (await import('./claim-map-control.js')).default as unknown as Handler;
});

beforeEach(async () => {
    resetRateLimits();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (let sector = 1; sector <= 3; sector += 1) await kv.set(`world:territory:${sector}`, { ownerVillage: VILLAGE });
    await kv.set(SAVE_KEY, { _saveVersion: 1, character: { name: PLAYER, village: VILLAGE, ryo: 1_000, honorSeals: 0, boneCharms: 0, fateShards: 0, villageMerit: 0 } });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

async function claim(tokenOwner = PLAYER, playerName = PLAYER): Promise<Out> {
    const out: Out = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { out.status = status; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { playerName, village: VILLAGE },
        headers: { 'x-player-name': tokenOwner, 'x-player-token': issuePlayerToken(tokenOwner) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

const ryo = async () => Number((await kv.get<{ character: { ryo: number } }>(SAVE_KEY))!.character.ryo);

/** The next save write fails; `landed` makes it commit first, with a failed readback. */
function failSaveWriteOnce(landed: boolean): () => void {
    const originalCompareSet = kv.compareSet.bind(kv);
    const originalSet = kv.set.bind(kv);
    const originalGet = kv.get.bind(kv);
    let armed = true;
    let blind = false;
    const fail = () => {
        armed = false;
        blind = landed;
        throw new Error('injected: save write failed');
    };
    kv.compareSet = (async (key: string, expected: unknown, next: unknown) => {
        if (!armed || key !== SAVE_KEY) return originalCompareSet(key, expected, next);
        if (landed) await originalCompareSet(key, expected, next);
        return fail();
    }) as typeof kv.compareSet;
    // The handler before this fix wrote the save with a plain set.
    kv.set = (async (key: string, value: unknown, options?: unknown) => {
        if (!armed || key !== SAVE_KEY) return originalSet(key, value, options as never);
        if (landed) await originalSet(key, value, options as never);
        return fail();
    }) as typeof kv.set;
    kv.get = (async (key: string) => {
        if (blind && key === SAVE_KEY) {
            blind = false;
            throw new Error('injected: readback failed');
        }
        return originalGet(key);
    }) as typeof kv.get;
    return () => {
        kv.compareSet = originalCompareSet;
        kv.set = originalSet;
        kv.get = originalGet;
    };
}

describe('the personal Map Control reward is paid once per day', { concurrency: false }, () => {
    test('a claim pays once, and a repeat that day pays nothing', async () => {
        const first = await claim();
        assert.equal(first.status, 200, JSON.stringify(first.body));
        assert.equal(first.body?.alreadyClaimed, false);
        const paid = await ryo();
        assert.ok(paid > 1_000);
        const again = await claim();
        assert.equal(again.body?.alreadyClaimed, true);
        assert.equal(await ryo(), paid);
    });

    test('concurrent claims pay once', async () => {
        const answers = await Promise.all(Array.from({ length: 5 }, () => claim()));
        assert.equal(answers.filter((a) => a.status === 200 && a.body?.alreadyClaimed === false).length, 1, JSON.stringify(answers.map((a) => a.status)));
        const once = await ryo();
        resetRateLimits();
        assert.equal((await claim()).body?.alreadyClaimed, true);
        assert.equal(await ryo(), once);
    });

    test('a save write that fails leaves the day unclaimed, and the retry pays', async () => {
        const restore = failSaveWriteOnce(false);
        try {
            assert.equal((await claim()).status, 503);
        } finally {
            restore();
        }
        assert.equal(await ryo(), 1_000);
        const retry = await claim();
        assert.equal(retry.body?.alreadyClaimed, false, 'before the fix: "already claimed", with nothing paid');
        assert.ok(await ryo() > 1_000);
    });

    test('a save write that committed but reported an error is not paid twice', async () => {
        const restore = failSaveWriteOnce(true);
        try {
            assert.equal((await claim()).status, 503);
        } finally {
            restore();
        }
        const paid = await ryo();
        assert.ok(paid > 1_000, 'the reward landed');
        assert.equal((await claim()).body?.alreadyClaimed, true);
        assert.equal(await ryo(), paid);
    });

    test("a claim made by the previous build's day marker still counts that day", async () => {
        const date = new Date().toISOString().slice(0, 10);
        await kv.set(`map-control-personal:${PLAYER}:${date}`, { ts: Date.now() });
        assert.equal((await claim()).body?.alreadyClaimed, true);
        assert.equal(await ryo(), 1_000);
    });

    test('a forged identity is refused and moves nothing', async () => {
        await kv.set('save:mapforger', { _saveVersion: 1, character: { name: 'mapforger', village: VILLAGE, ryo: 0 } });
        assert.equal((await claim('mapforger', PLAYER)).status, 403);
        assert.equal(await ryo(), 1_000);
    });
});
