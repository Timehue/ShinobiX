import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

/*
 * A collected pet expedition counts toward the Pet Tamer daily missions. The
 * expedition's currency, log entry and single-use receipt
 * (redeemedPetExpeditionTokens) commit in one save write, and the mission
 * report runs AFTER that commit. When the report failed (the
 * missions:daily:<player> lock contended past its fail-closed acquire, about
 * 0.5 s, as when several pets are collected at once; or the row write failing),
 * the collect answered 500. The client's retry found the receipt spent and
 * replayed the logged result, which never reported the mission event, so the
 * expedition's mission progress was lost for good.
 *
 * The report is now receipted under the expedition token, and a replay of an
 * expedition settled today reports it again: the receipt counts only what never
 * landed. Each case breaks the first report, retries, and shows the expedition
 * counts exactly once, with no completion toasted twice.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'expedition-mission-replay-secret-32-bytes';

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Json };
type BoardMission = { templateId: string; kind: string; progress: number; completedAt: number | null };

const PREFIX = 'expmissionreplay';
const TOKEN = 'expmissionreplayexpedition01';
const DAY_MS = 86_400_000;
// The board: two expedition missions (1 and 2 expeditions) and one 4-hour one.
const BOARD = ['tamer-short-walk', 'tamer-routine-patrol', 'tamer-long-haul'];
// The seeded Pet Tamer is rank 2 with 100 profession XP, so every board mission
// is eligible. A 45-minute Scout pays 225 Tamer XP, doubled as the day's first
// expedition; a 4-hour Ruins pays 1,200, doubled for the length and again as
// the first. Short Walk pays 30 profession XP, Long Haul 100.
const SCOUT_PROFESSION_XP = 100 + 450 + 30;
const RUINS_PROFESSION_XP = 100 + 4_800 + 100 + 30;

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let resetRateLimits: typeof import('../_ratelimit.js').__resetRateLimitsForTest;
let getMissionTemplateById: typeof import('./_pool.js').getMissionTemplateById;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    ({ getMissionTemplateById } = await import('./_pool.js'));
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

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

function boardMission(templateId: string, date: string): Json {
    const template = getMissionTemplateById(templateId);
    assert.ok(template, `mission template ${templateId}`);
    return {
        id: `${template.templateId}:${date}`,
        templateId: template.templateId,
        kind: template.kind,
        name: template.name,
        description: template.description,
        target: template.target,
        progress: 0,
        xpReward: template.xpReward,
        eligibility: template.eligibility,
        completedAt: null,
        claimed: false,
    };
}

/** A Pet Tamer whose pet came home a minute ago from a sealed route, with a fresh board for today. */
async function seedReturnedExpedition(name: string, route: 'scout' | 'ruins' = 'scout'): Promise<void> {
    const minutes = route === 'ruins' ? 240 : 45;
    const endsAt = Date.now() - 60_000;
    const startedAt = endsAt - minutes * 60_000;
    const seal = {
        petLevel: 20, expRewardMult: 1, expMaterialMult: 1, rewardScale: 1, tamer: true,
        risk: 'safe', provision: 'none', sector: 23, place: 'Moongrotto', region: 'Moonshadow Wilds', biome: 'shadow',
        choiceVersion: 1,
    };
    await kv.set(`save:${name}`, {
        _saveVersion: 1,
        character: {
            name, level: 30, profession: 'petTamer', professionXp: 100, professionRank: 2,
            professionChosenAt: Date.now() - 3 * DAY_MS,
            ryo: 0, boneCharms: 0, auraStones: 0, fateShards: 0,
            pets: [{
                id: 'pet-1', name: 'Kumo', rarity: 'standard', level: 20, maxLevel: 100, xp: 0,
                hp: 300, attack: 60, defense: 40, speed: 35, happiness: 50, jutsus: [],
                expedition: {
                    type: route, token: TOKEN, startedAt, endsAt, durationMs: minutes * 60_000,
                    risk: 'safe', provision: 'none', sector: 23, place: 'Moongrotto', region: 'Moonshadow Wilds', biome: 'shadow',
                    choiceVersion: 1, serverSeal: seal,
                },
            }],
        },
    });
    // The token cache expedition-start writes beside the lease.
    await kv.set(`pet-exp-token:${name}:${TOKEN}`, {
        playerName: name, petId: 'pet-1', expType: route, durationMinutes: minutes, mintedAt: startedAt, endsAt, ...seal,
    }, { ex: 3600 });
    await kv.set(`missions:daily:${name}`, {
        date: today(),
        profession: 'petTamer',
        missions: BOARD.map((templateId) => boardMission(templateId, today())),
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

async function savedRecord(name: string): Promise<Json> {
    return (await kv.get<Json>(`save:${name}`)) ?? {};
}

async function savedCharacter(name: string): Promise<Json> {
    return ((await savedRecord(name)).character ?? {}) as Json;
}

async function board(name: string): Promise<Json> {
    return (await kv.get<Json>(`missions:daily:${name}`)) ?? {};
}

async function progress(name: string): Promise<Record<string, BoardMission>> {
    const missions = ((await board(name)).missions ?? []) as BoardMission[];
    return Object.fromEntries(missions.map((mission) => [mission.templateId, mission]));
}

function completedNames(out: Out): string[] {
    return ((out.body?.missionsCompleted ?? []) as Array<{ name: string }>).map((mission) => mission.name);
}

function redeemed(character: Json): boolean {
    const receipts = character.redeemedPetExpeditionTokens;
    return Array.isArray(receipts) && receipts.includes(TOKEN);
}

/**
 * Hold the player's daily-mission lock for the whole call, as concurrent
 * collects holding the row would, so the report's fail-closed acquire gives up.
 */
async function withDailyMissionLockHeld(name: string, fn: () => Promise<Out>): Promise<Out> {
    const lockKey = `lock:missions:daily:${name}`;
    assert.ok(await kv.set(lockKey, 'held-by-another-collect', { nx: true, ex: 60 }), 'the daily-mission lock was free');
    try {
        return await fn();
    } finally {
        await kv.del(lockKey);
    }
}

/**
 * Refuse the first write of the daily row that counts an expedition toward a
 * `pet-tamer-expeditions` mission, through either write path.
 */
async function withExpeditionCountWriteFailing(name: string, fn: () => Promise<Out>): Promise<{ out: Out; refused: boolean }> {
    const dailyKey = `missions:daily:${name}`;
    const originalSet = kv.set.bind(kv);
    const originalCompareSet = kv.compareSet.bind(kv);
    let refused = false;
    const refuse = (key: string, value: unknown): boolean => {
        if (refused || key !== dailyKey) return false;
        const missions = ((value as Json | null)?.missions ?? []) as BoardMission[];
        refused = missions.some((mission) => mission.kind === 'pet-tamer-expeditions' && mission.progress > 0);
        return refused;
    };
    kv.set = (async (key: string, value: unknown, options?: Parameters<typeof kv.set>[2]) => {
        if (refuse(key, value)) throw new Error('simulated daily-mission row write failure');
        return originalSet(key, value, options);
    }) as typeof kv.set;
    kv.compareSet = (async (key: string, expected: unknown, value: unknown, options?: Parameters<typeof kv.compareSet>[3]) => {
        if (refuse(key, value)) throw new Error('simulated daily-mission row write failure');
        return originalCompareSet(key, expected, value, options);
    }) as typeof kv.compareSet;
    try {
        return { out: await fn(), refused };
    } finally {
        kv.set = originalSet as typeof kv.set;
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
    }
}

/** Rewrite the logged expedition, as if it had settled at another time. */
async function editExpeditionLog(name: string, edit: (entry: Json) => Json): Promise<void> {
    const record = await savedRecord(name);
    const character = record.character as Json;
    const log = (character.petExpeditionLog as Json[]).map((entry) => entry.id === TOKEN ? edit(entry) : entry);
    await kv.set(`save:${name}`, { ...record, character: { ...character, petExpeditionLog: log } });
}

describe('a collected pet expedition counts toward the daily missions exactly once', { concurrency: false }, () => {
    it('counts it on the retry when the daily-mission lock was contended after the settle', async () => {
        const name = `${PREFIX}contended`;
        await seedReturnedExpedition(name);

        const first = await withDailyMissionLockHeld(name, () => collect(name, '127.0.0.71'));
        assert.equal(first.statusCode, 500, 'the mission report could not take the daily-mission lock');
        assert.ok(redeemed(await savedCharacter(name)), 'the expedition itself settled before the report');
        assert.equal((await progress(name))['tamer-short-walk'].progress, 0);

        // The client keeps the expedition ready and retries; a settled one replays.
        const retry = await collect(name, '127.0.0.72');
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(retry.body?.replayed, true);
        const counted = await progress(name);
        assert.equal(counted['tamer-short-walk'].progress, 1, 'the retry left the expedition\'s mission progress uncounted');
        assert.equal(counted['tamer-routine-patrol'].progress, 1);
        assert.equal(counted['tamer-long-haul'].progress, 0, 'a 45-minute route is not a long expedition');
        assert.deepEqual(completedNames(retry), ['Short Walk'], 'the completion the failed attempt never sent');
        const character = retry.body?.character as Json;
        assert.equal(character.professionXp, SCOUT_PROFESSION_XP, 'the mission\'s profession XP was paid');
        assert.equal(retry.body?._saveVersion, (await savedRecord(name))._saveVersion, 'the reply carries the version that paid it');

        const again = await collect(name, '127.0.0.73');
        assert.equal(again.statusCode, 200, JSON.stringify(again.body));
        assert.equal(again.body?.replayed, true);
        assert.deepEqual(completedNames(again), [], 'a later replay toasts nothing twice');
        assert.equal((await progress(name))['tamer-routine-patrol'].progress, 1, 'and counts nothing twice');
        const final = await savedCharacter(name);
        assert.equal(final.professionXp, SCOUT_PROFESSION_XP, 'and pays no profession XP twice');
        assert.equal(final.ryo, retry.body?.ryoEarned, 'and the expedition\'s ryo was paid once');
    });

    it('counts it on the retry when the daily-mission row write failed', async () => {
        const name = `${PREFIX}failedwrite`;
        await seedReturnedExpedition(name);

        const { out: first, refused } = await withExpeditionCountWriteFailing(name, () => collect(name, '127.0.0.74'));
        assert.equal(refused, true, 'the write counting the expedition was refused');
        assert.equal(first.statusCode, 500);
        assert.ok(redeemed(await savedCharacter(name)), 'the expedition itself settled before the report');

        const retry = await collect(name, '127.0.0.75');
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal((await progress(name))['tamer-short-walk'].progress, 1, 'the retry left the expedition\'s mission progress uncounted');
        assert.deepEqual(completedNames(retry), ['Short Walk']);

        const again = await collect(name, '127.0.0.76');
        assert.deepEqual(completedNames(again), []);
        assert.equal((await progress(name))['tamer-routine-patrol'].progress, 1, 'a later replay counts nothing twice');
        assert.equal((await savedCharacter(name)).professionXp, SCOUT_PROFESSION_XP);
    });

    it('counts only the missing kind when a long expedition\'s second report failed', async () => {
        const name = `${PREFIX}longpartial`;
        await seedReturnedExpedition(name, 'ruins');

        // The 4-hour kind lands first; the plain expedition count is refused.
        const { out: first, refused } = await withExpeditionCountWriteFailing(name, () => collect(name, '127.0.0.77'));
        assert.equal(refused, true, 'the write counting the plain expedition was refused');
        assert.equal(first.statusCode, 500);
        const landed = await progress(name);
        assert.ok(landed['tamer-long-haul'].completedAt, 'the long-expedition kind landed before the failure');
        assert.equal(landed['tamer-short-walk'].progress, 0);

        const retry = await collect(name, '127.0.0.78');
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        const counted = await progress(name);
        assert.equal(counted['tamer-short-walk'].progress, 1, 'the retry left the plain expedition count missing');
        assert.equal(counted['tamer-routine-patrol'].progress, 1);
        assert.equal(counted['tamer-long-haul'].completedAt, landed['tamer-long-haul'].completedAt, 'the landed kind was not completed again');
        assert.deepEqual(completedNames(retry), ['Short Walk'], 'only the kind this retry counted is toasted');
        assert.equal((retry.body?.character as Json).professionXp, RUINS_PROFESSION_XP, 'each completion paid its profession XP once');

        const again = await collect(name, '127.0.0.79');
        assert.deepEqual(completedNames(again), []);
        assert.equal((await progress(name))['tamer-routine-patrol'].progress, 1, 'a later replay counts nothing twice');
        assert.equal((await savedCharacter(name)).professionXp, RUINS_PROFESSION_XP);
    });

    it('counts it when the retry still finds the token cache and replays under the save lock', async () => {
        const name = `${PREFIX}inlock`;
        await seedReturnedExpedition(name);
        const tokenKey = `pet-exp-token:${name}:${TOKEN}`;
        const tokenCache = await kv.get<Json>(tokenKey);

        const first = await withDailyMissionLockHeld(name, () => collect(name, '127.0.0.80'));
        assert.equal(first.statusCode, 500);
        // The settle deletes the cache after its commit; this one survived.
        await kv.set(tokenKey, tokenCache, { ex: 3600 });

        const retry = await collect(name, '127.0.0.81');
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(retry.body?.replayed, true);
        assert.equal((await progress(name))['tamer-short-walk'].progress, 1, 'the retry left the expedition\'s mission progress uncounted');
        assert.deepEqual(completedNames(retry), ['Short Walk']);
        assert.equal((await savedCharacter(name)).professionXp, SCOUT_PROFESSION_XP);
    });

    it('leaves an expedition settled on an earlier UTC day uncounted rather than count it twice', async () => {
        const name = `${PREFIX}crossday`;
        await seedReturnedExpedition(name);

        const first = await withDailyMissionLockHeld(name, () => collect(name, '127.0.0.82'));
        assert.equal(first.statusCode, 500);
        // The retry comes after midnight. Any receipt the first report left
        // would sit in yesterday's row, which today's has replaced, so the
        // replay cannot tell whether the expedition already counted.
        await editExpeditionLog(name, (entry) => ({ ...entry, settledAt: Number(entry.settledAt) - DAY_MS }));
        const before = await board(name);

        const retry = await collect(name, '127.0.0.83');
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(retry.body?.replayed, true);
        assert.deepEqual(completedNames(retry), []);
        assert.deepEqual(await board(name), before, 'today\'s board is untouched');
    });

    it('leaves it uncounted when the player chose their profession again after the settle', async () => {
        const name = `${PREFIX}rechosen`;
        await seedReturnedExpedition(name);

        const first = await withDailyMissionLockHeld(name, () => collect(name, '127.0.0.84'));
        assert.equal(first.statusCode, 500);
        // Switching away and back starts a fresh board the expedition never belonged to.
        const record = await savedRecord(name);
        const character = record.character as Json;
        const settledAt = Number((character.petExpeditionLog as Json[]).find((entry) => entry.id === TOKEN)?.settledAt);
        await kv.set(`save:${name}`, { ...record, character: { ...character, professionChosenAt: settledAt + 1 } });
        const before = await board(name);

        const retry = await collect(name, '127.0.0.85');
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.deepEqual(completedNames(retry), []);
        assert.deepEqual(await board(name), before, 'the fresh board is untouched');
    });
});
