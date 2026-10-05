import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

/*
 * A completed pet expedition pays Pet Tamer profession XP. The expedition's
 * currency, its log entry and its single-use receipt (redeemedPetExpeditionTokens)
 * commit in one save write, and the XP used to follow in a SECOND save write
 * (awardProfessionXp). When that second write did not land (an autosave held the
 * save lock past the fail-closed acquire, about 0.5 s; the process died; the
 * reply was lost), the request failed. The client's retry then found the receipt
 * spent and replayed the logged result, which reports the XP but never pays it.
 *
 * The XP now commits in the expedition's own write. Each case breaks the step
 * that used to pay it, retries, and shows the XP lands exactly once.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'expedition-tamer-xp-once-secret-32-bytes';

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Json };

const PREFIX = 'tamerxponce';
const TOKEN = 'tamerxponceexpedition001';
// A 45-minute Scout route earns 45 x 5 = 225 Tamer XP, doubled for the day's
// first expedition (tamerXpForExpedition). 450 XP is profession rank 3.
const EXPEDITION_TAMER_XP = 450;
const RANK_AFTER_EXPEDITION = 3;

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let resetRateLimits: typeof import('../_ratelimit.js').__resetRateLimitsForTest;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    handler = (await import('./report-pet-event.js')).default as unknown as Handler;
});

beforeEach(async () => {
    resetRateLimits();
    const keys = await kv.keys(`*${PREFIX}*`);
    if (keys.length) await kv.del(...keys);
});

after(async () => {
    const keys = await kv.keys(`*${PREFIX}*`);
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

const SEAL = {
    petLevel: 20, expRewardMult: 1, expMaterialMult: 1, rewardScale: 1, tamer: true,
    risk: 'safe', provision: 'none', sector: 23, place: 'Moongrotto', region: 'Moonshadow Wilds', biome: 'shadow',
    choiceVersion: 1,
};

/** A player whose pet came home a minute ago from a sealed 45-minute Scout route. */
async function seedReturnedExpedition(name: string, profession = 'petTamer'): Promise<void> {
    const endsAt = Date.now() - 60_000;
    const startedAt = endsAt - 45 * 60_000;
    await kv.set(`save:${name}`, {
        _saveVersion: 1,
        character: {
            name, level: 30, profession, professionXp: 0, professionRank: 1,
            ryo: 0, boneCharms: 0, auraStones: 0, fateShards: 0,
            pets: [{
                id: 'pet-1', name: 'Kumo', rarity: 'standard', level: 20, maxLevel: 100, xp: 0,
                hp: 300, attack: 60, defense: 40, speed: 35, happiness: 50, jutsus: [],
                expedition: {
                    type: 'scout', token: TOKEN, startedAt, endsAt, durationMs: 45 * 60_000,
                    risk: 'safe', provision: 'none', sector: 23, place: 'Moongrotto', region: 'Moonshadow Wilds', biome: 'shadow',
                    choiceVersion: 1, serverSeal: SEAL,
                },
            }],
        },
    });
    // The token cache expedition-start writes beside the lease.
    await kv.set(`pet-exp-token:${name}:${TOKEN}`, {
        playerName: name, petId: 'pet-1', expType: 'scout', durationMinutes: 45, mintedAt: startedAt, endsAt, ...SEAL,
    }, { ex: 3600 });
    // Today's board holds no mission, so the expedition completes none and its
    // own Tamer XP is the only profession XP in play.
    await kv.set(`missions:daily:${name}`, {
        date: new Date().toISOString().slice(0, 10),
        profession: 'petTamer',
        missions: [],
    }, { ex: 3600 });
}

async function collect(name: string, address: string): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Json) => { out.body = body; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { playerName: name, event: 'expedition', petId: 'pet-1', expeditionToken: TOKEN, returnChoice: 'secure' },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(name) ?? '' },
        socket: { remoteAddress: address },
    } as never, res as never);
    return out;
}

async function savedCharacter(name: string): Promise<Json> {
    return ((await kv.get<Json>(`save:${name}`))?.character ?? {}) as Json;
}

function redeemed(character: unknown): boolean {
    const receipts = (character as Json | null | undefined)?.redeemedPetExpeditionTokens;
    return Array.isArray(receipts) && receipts.includes(TOKEN);
}

/** The character a save write is about to store, whichever write path carries it. */
function writtenCharacter(value: unknown): Json {
    return ((value as Json | null)?.character ?? {}) as Json;
}

/**
 * Let the expedition settle, then take the save lock the moment the settle
 * releases it, the way an autosave queued right behind it would, and hold it
 * for the rest of the request.
 */
async function withSaveLockTakenAfterSettle(name: string, fn: () => Promise<Out>): Promise<{ out: Out; taken: boolean }> {
    const lockKey = `lock:save:${name}`;
    const originalDelIfEqual = kv.delIfEqual.bind(kv);
    let taken = false;
    kv.delIfEqual = (async (key: string, expected: unknown) => {
        const released = await originalDelIfEqual(key, expected);
        if (!taken && key === lockKey && redeemed(await savedCharacter(name))) {
            taken = Boolean(await kv.set(lockKey, 'held-by-a-slow-autosave', { nx: true, ex: 60 }));
        }
        return released;
    }) as typeof kv.delIfEqual;
    try {
        return { out: await fn(), taken };
    } finally {
        kv.delIfEqual = originalDelIfEqual as typeof kv.delIfEqual;
        await kv.del(lockKey);
    }
}

/**
 * Run `fn` with both save write paths (the compare-and-set mutatePlayerSave
 * commits through, and a raw set) routed through `intercept` for `save:<name>`.
 */
async function withSaveWritesIntercepted<T>(
    name: string,
    intercept: (value: unknown, commit: () => Promise<unknown>) => Promise<unknown>,
    fn: () => Promise<T>,
): Promise<T> {
    const saveKey = `save:${name}`;
    const originalSet = kv.set.bind(kv);
    const originalCompareSet = kv.compareSet.bind(kv);
    kv.set = (async (key: string, value: unknown, options?: Parameters<typeof kv.set>[2]) => key === saveKey
        ? intercept(value, () => originalSet(key, value, options))
        : originalSet(key, value, options)) as typeof kv.set;
    kv.compareSet = (async (key: string, expected: unknown, value: unknown, options?: Parameters<typeof kv.compareSet>[3]) => key === saveKey
        ? intercept(value, () => originalCompareSet(key, expected, value, options))
        : originalCompareSet(key, expected, value, options)) as typeof kv.compareSet;
    try {
        return await fn();
    } finally {
        kv.set = originalSet as typeof kv.set;
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }
}

describe('a pet expedition pays its Tamer XP exactly once', { concurrency: false }, () => {
    it('pays it when an autosave takes the save lock right after the expedition settles', async () => {
        const name = `${PREFIX}contended`;
        await seedReturnedExpedition(name);

        const { out: first, taken } = await withSaveLockTakenAfterSettle(name, () => collect(name, '127.0.0.61'));
        assert.equal(taken, true, 'the save lock was taken as soon as the settle released it');

        // The client retries a failed collect; a settled one replays.
        const retry = await collect(name, '127.0.0.62');
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        const saved = await savedCharacter(name);
        assert.equal(saved.professionXp, EXPEDITION_TAMER_XP, 'the retry left the expedition\'s Tamer XP unpaid');
        assert.equal(saved.professionRank, RANK_AFTER_EXPEDITION);

        // Nothing after the settle needs the save lock to pay the XP any more.
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.equal(first.body?.expeditionXp, EXPEDITION_TAMER_XP);
        assert.equal(first.body?.professionXp, EXPEDITION_TAMER_XP, 'the reply reports the credited XP');
        assert.equal(first.body?.professionRank, RANK_AFTER_EXPEDITION);
        assert.equal(retry.body?.replayed, true);
        assert.equal(retry.body?.expeditionXp, EXPEDITION_TAMER_XP, 'the replay reports what was paid');

        const again = await collect(name, '127.0.0.63');
        assert.equal(again.body?.replayed, true);
        const final = await savedCharacter(name);
        assert.equal(final.professionXp, EXPEDITION_TAMER_XP, 'a later replay pays nothing twice');
        assert.equal(final.ryo, retry.body?.ryoEarned, 'and the expedition\'s ryo was paid once');
    });

    it('pays it once on the retry when the write that pays it fails', async () => {
        const name = `${PREFIX}failedwrite`;
        await seedReturnedExpedition(name);

        let failed = false;
        const first = await withSaveWritesIntercepted(name, async (value, commit) => {
            if (!failed && Number(writtenCharacter(value).professionXp ?? 0) > 0) {
                failed = true;
                throw new Error('simulated save write failure');
            }
            return commit();
        }, () => collect(name, '127.0.0.64'));
        assert.equal(failed, true, 'the write carrying the Tamer XP was refused');
        assert.equal(first.statusCode, 500);

        const retry = await collect(name, '127.0.0.65');
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal((await savedCharacter(name)).professionXp, EXPEDITION_TAMER_XP, 'the retry left the expedition\'s Tamer XP unpaid');
        assert.equal(retry.body?.expeditionXp, EXPEDITION_TAMER_XP);

        const again = await collect(name, '127.0.0.66');
        assert.equal(again.body?.replayed, true);
        const final = await savedCharacter(name);
        assert.equal(final.professionXp, EXPEDITION_TAMER_XP, 'a later replay pays nothing twice');
        assert.equal(final.ryo, retry.body?.ryoEarned, 'and the expedition\'s ryo was paid once');
    });

    it('pays it once when the expedition\'s write lands but its reply is lost', async () => {
        const name = `${PREFIX}lostreply`;
        await seedReturnedExpedition(name);

        const saveKey = `save:${name}`;
        const originalGet = kv.get.bind(kv);
        let committed = false;
        let readbackFailed = false;
        kv.get = (async <T>(key: string) => {
            if (committed && !readbackFailed && key === saveKey) {
                readbackFailed = true;
                throw new Error('simulated read-back failure');
            }
            return originalGet<T>(key);
        }) as typeof kv.get;
        let first: Out;
        try {
            first = await withSaveWritesIntercepted(name, async (value, commit) => {
                if (!committed && redeemed(writtenCharacter(value))) {
                    await commit();
                    committed = true;
                    throw new Error('simulated lost reply after the expedition committed');
                }
                return commit();
            }, () => collect(name, '127.0.0.67'));
        } finally {
            kv.get = originalGet as typeof kv.get;
        }
        assert.equal(committed, true, 'the expedition reached the save');
        assert.equal(first.statusCode, 500, 'and its writer could not confirm it');

        const retry = await collect(name, '127.0.0.68');
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(retry.body?.replayed, true, 'the retry finds the receipt');
        const saved = await savedCharacter(name);
        assert.equal(saved.professionXp, EXPEDITION_TAMER_XP, 'the XP committed with the receipt, once');
        assert.equal(saved.ryo, retry.body?.ryoEarned, 'and the expedition\'s ryo was paid once');
    });

    it('credits no Tamer XP to a player who stopped being a Pet Tamer before collecting', async () => {
        const name = `${PREFIX}switched`;
        await seedReturnedExpedition(name, 'healer');

        const out = await collect(name, '127.0.0.69');
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.petTamer, false);
        const saved = await savedCharacter(name);
        assert.equal(saved.professionXp, 0, 'Tamer XP is never credited to another profession');
        assert.equal(saved.professionRank, 1);
        assert.ok(redeemed(saved), 'the expedition itself still settled');
    });
});
