import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, test, type TestContext } from 'node:test';

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
let computeMapControlReward: typeof import('../_map-control-reward.js').computeMapControlReward;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    ({ computeMapControlReward } = await import('../_map-control-reward.js'));
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

/*
 * The handler reads its UTC day from a no-argument `new Date()` on every claim.
 * A run that straddles UTC midnight between two claims, or between the seeded
 * day marker and a claim, would put them on different days, so the repeat
 * would pay again. The tests that compare two moments hold Date (Date.now and
 * new Date alike) for their whole check. The idle-recovery test does not: it
 * needs real elapsed time to tell a carried regen cursor from a fenced one.
 */
function holdUtcDay(t: TestContext): void {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
}

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
    test('a claim pays once, and a repeat that day pays nothing', async (t) => {
        holdUtcDay(t);
        const first = await claim();
        assert.equal(first.status, 200, JSON.stringify(first.body));
        assert.equal(first.body?.alreadyClaimed, false);
        const paid = await ryo();
        assert.ok(paid > 1_000);
        const again = await claim();
        assert.equal(again.body?.alreadyClaimed, true);
        assert.equal(await ryo(), paid);
    });

    test('concurrent claims pay once', async (t) => {
        holdUtcDay(t);
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

    test('a save write that committed but reported an error is not paid twice', async (t) => {
        holdUtcDay(t);
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

    test("a claim made by the previous build's day marker still counts that day", async (t) => {
        holdUtcDay(t);
        const date = new Date().toISOString().slice(0, 10);
        await kv.set(`map-control-personal:${PLAYER}:${date}`, { ts: Date.now() });
        assert.equal((await claim()).body?.alreadyClaimed, true);
        assert.equal(await ryo(), 1_000);
    });

    test('a claim keeps the idle recovery earned since the last save', async () => {
        // The reward write moves no vital, so the HP, chakra and stamina
        // recovered since the last save settle into it and the cursor carries.
        const tiredAt = Date.now() - 30_000;
        const stored = (await kv.get<Record<string, any>>(SAVE_KEY))!;
        await kv.set(SAVE_KEY, {
            ...stored,
            _saveAt: tiredAt,
            _regenAt: tiredAt,
            character: { ...stored.character, hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100 },
        });

        const reply = await claim();
        assert.equal(reply.status, 200, JSON.stringify(reply.body));
        assert.equal(reply.body?.alreadyClaimed, false);
        const saved = (await kv.get<Record<string, any>>(SAVE_KEY))!;
        assert.ok(saved.character.ryo > 1_000, 'the reward was still paid');
        assert.equal(reply.body?._saveVersion, saved._saveVersion, 'the reply echoes the committed version');
        assert.ok(saved.character.hp >= 40, `hp ${saved.character.hp} lost the idle recovery`);
        assert.ok(saved.character.chakra >= 50, `chakra ${saved.character.chakra} lost the idle recovery`);
        assert.ok(saved.character.stamina >= 30, `stamina ${saved.character.stamina} lost the idle recovery`);
        assert.ok(Number(saved._regenAt) >= tiredAt + 30_000 - 1_000, `cursor ${saved._regenAt} fell behind the recovery`);
        assert.equal((Number(saved._regenAt) - tiredAt) % 1_000, 0, `cursor ${saved._regenAt} was fenced to the write, not carried`);
    });

    test('a forged identity is refused and moves nothing', async () => {
        await kv.set('save:mapforger', { _saveVersion: 1, character: { name: 'mapforger', village: VILLAGE, ryo: 0 } });
        assert.equal((await claim('mapforger', PLAYER)).status, 403);
        assert.equal(await ryo(), 1_000);
    });
});

// 2026-10 rebalance, I-10: map control pays on the WAR sectors the village holds
// (api/_war-held-sectors.ts), the count the War Map, the WR faucet and the tax
// tier use. A released clan capture leaves its ownerVillage stamp on a
// non-war sector, and counting every stamped row paid +100 ryo a member a day
// for it, forever.
describe('map control counts held WAR sectors only', { concurrency: false }, () => {
    test('a wilderness sector stamped with the village does not count', async (t) => {
        holdUtcDay(t);
        await kv.set('world:territory:70', { ownerVillage: VILLAGE });
        const out = await claim();
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal(out.body?.sectors, 3, 'sector 70 is not a war sector');
        assert.deepEqual(out.body?.granted, computeMapControlReward(3, false));
    });

    test('a suspended war sector does not count', async (t) => {
        holdUtcDay(t);
        await kv.set('world:territory:3', { ownerVillage: VILLAGE, rewardSuspendedAt: Date.now() - 1_000 });
        const out = await claim();
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal(out.body?.sectors, 2);
        assert.deepEqual(out.body?.granted, computeMapControlReward(2, false));
    });

    test('a failed territory scan answers 503 and stamps nothing', async (t) => {
        holdUtcDay(t);
        const keys = kv.keys.bind(kv);
        t.mock.method(kv, 'keys', async (pattern: string) => {
            if (pattern === 'world:territory:*') throw new Error('injected: territory scan failed');
            return keys(pattern);
        });
        const out = await claim();
        assert.equal(out.status, 503);
        const saved = (await kv.get<Record<string, any>>(SAVE_KEY))!;
        assert.equal(saved.character.ryo, 1_000);
        assert.equal(saved.character.claimedMapControlDate, undefined);
        assert.equal(saved._saveVersion, 1, 'nothing was written');
    });
});

// 2026-10 rebalance, I-11: the occupation tax used to run only when the client
// POSTed /api/village/tax, so a modded client that never did was never taxed.
describe('the daily claim assesses the occupation tax on the server', { concurrency: false }, () => {
    async function seedConqueror() {
        // The eight Frostfang home sectors plus sector 1: nine held war sectors (1%).
        await kv.set('world:territory:2', { ownerVillage: 'Stormveil Village' });
        await kv.set('world:territory:3', { ownerVillage: 'Stormveil Village' });
        for (const sector of [26, 27, 28, 29, 30, 31, 32, 33]) await kv.set(`world:territory:${sector}`, { ownerVillage: VILLAGE });
        await kv.set('village:kage:frostfang-village', { seatedKage: 'frostkage' });
        await kv.set(SAVE_KEY, { _saveVersion: 1, character: { name: PLAYER, village: VILLAGE, level: 40, ryo: 500_000, bankRyo: 0, honorSeals: 0, boneCharms: 0, fateShards: 0, villageMerit: 0 } });
    }

    test('a conqueror who never called /api/village/tax is taxed once by the first claim', async (t) => {
        holdUtcDay(t);
        await seedConqueror();
        const out = await claim();
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal(out.body?.sectors, 9);
        const tax = out.body?.villageTax as Record<string, unknown> | undefined;
        assert.equal(tax?.applied, true);
        assert.equal(tax?.taxed, 4_950, '1% of (500,000 - 5,000)');
        const reward = computeMapControlReward(9, false).ryo;
        assert.equal(await ryo(), 500_000 - 4_950 + reward, 'the reward lands on the post-tax balance');
        const saved = (await kv.get<Record<string, any>>(SAVE_KEY))!;
        assert.equal(saved.character.lastTaxDate, new Date().toISOString().slice(0, 10));
        const treasury = await kv.get<Record<string, any>>('game:village-state:frostfangvillage');
        assert.equal(treasury?.treasury?.ryo, 2_475, 'half to the treasury, half burned');

        // A second hooked call the same day charges nothing.
        const again = await claim();
        assert.equal(again.body?.alreadyClaimed, true);
        assert.equal(again.body?.villageTax, undefined, 'nothing was assessed again');
        assert.equal(await ryo(), 500_000 - 4_950 + reward);
    });

    test('a peace-time village is charged nothing, and the day is stamped once', async (t) => {
        holdUtcDay(t);
        await kv.set('village:kage:frostfang-village', { seatedKage: 'frostkage' });
        await kv.set(SAVE_KEY, { _saveVersion: 1, character: { name: PLAYER, village: VILLAGE, level: 40, ryo: 500_000, bankRyo: 0, honorSeals: 0, boneCharms: 0, fateShards: 0, villageMerit: 0 } });
        const out = await claim();
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal((out.body?.villageTax as Record<string, unknown> | undefined)?.applied, false);
        assert.equal(await ryo(), 500_000 + computeMapControlReward(3, false).ryo, 'no ryo was taxed');
        const saved = (await kv.get<Record<string, any>>(SAVE_KEY))!;
        assert.equal(saved.character.lastTaxDate, new Date().toISOString().slice(0, 10));
    });
});
