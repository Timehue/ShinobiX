import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

/*
 * A collected pet training counts toward the Pet Tamer "trained a pet" daily
 * missions (Coach: claim 2 sessions). The session settles in the save, and the
 * mission report followed as a second write, to the daily row. When that report
 * failed (the missions:daily:<player> lock contended past its fail-closed
 * acquire, about 0.5 s, as when several sessions are collected at once; or the
 * row write failing), the collect answered 500. The session was already
 * collected, so the retry only answered "Training is not complete." and the
 * progress was lost for good.
 *
 * The settle now lists the event beside the save the moment it commits, and the
 * next training action reports what is still listed, under a receipt the day's
 * row matches. Each case breaks the first report and shows the session counts
 * exactly once, with no completion toasted twice.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pet-training-mission-secret-32-bytes';

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { status: number; body: Json };
type BoardMission = { templateId: string; kind: string; progress: number; completedAt: number | null };

const PREFIX = 'pettrainmission';
const DAY_MS = 86_400_000;
const BOARD = ['tamer-coach', 'tamer-short-walk', 'tamer-routine-patrol'];
// Coach pays 60 profession XP; a Pet Tamer's XP has no rank multiplier.
const COACH_XP = 60;

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let prodigyKey: (playerName: string, now: number) => string;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let getMissionTemplateById: typeof import('../missions/_pool.js').getMissionTemplateById;
let migration: number;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ getMissionTemplateById } = await import('../missions/_pool.js'));
    const progress = await import('./progress.js');
    handler = progress.default as unknown as Handler;
    prodigyKey = progress.prodigyKey;
    migration = (await import('./_owned-pet.js')).PET_BREEDING_MIGRATION_VERSION;
});

beforeEach(async () => {
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

function boardMission(templateId: string, date: string, progress = 0): Json {
    const template = getMissionTemplateById(templateId);
    assert.ok(template, `mission template ${templateId}`);
    return {
        id: `${template.templateId}:${date}`,
        templateId: template.templateId,
        kind: template.kind,
        name: template.name,
        description: template.description,
        target: template.target,
        progress,
        xpReward: template.xpReward,
        eligibility: template.eligibility,
        completedAt: null,
        claimed: false,
    };
}

/** A Pet Tamer whose pet finished a 15-minute training a minute ago, with a fresh board for today. */
async function seed(name: string, opts: { coachProgress?: number; masterySpec?: Json } = {}): Promise<void> {
    const now = Date.now();
    await kv.set(`save:${name}`, {
        _saveVersion: 1,
        character: {
            name, level: 30, profession: 'petTamer', professionXp: 0, professionRank: 1,
            professionChosenAt: now - 3 * DAY_MS, petBreedingMigrationVersion: migration,
            ...(opts.masterySpec ? { masterySpec: opts.masterySpec } : {}),
            pets: [{
                id: 'pet-1', name: 'Fang', rarity: 'standard', level: 20, maxLevel: 100, xp: 0,
                happiness: 100, happinessDay: Math.floor(now / DAY_MS), hp: 500, attack: 40, defense: 40, speed: 40, jutsus: [],
                training: { type: 'bond', startedAt: now - 16 * 60_000, endsAt: now - 60_000, durationMs: 900_000, sealedXp: 30 },
            }],
            activePetId: 'pet-1',
        },
    });
    await kv.set(`missions:daily:${name}`, {
        date: today(),
        profession: 'petTamer',
        missions: BOARD.map((templateId) => boardMission(templateId, today(), templateId === 'tamer-coach' ? opts.coachProgress ?? 0 : 0)),
    }, { ex: 3600 });
}

async function post(name: string, action: string, extra: Json = {}): Promise<Out> {
    const out: Out = { status: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (status: number) => { out.status = status; return res; },
        json: (body: Json) => { out.body = body; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { playerName: name, petId: 'pet-1', action, ...extra },
        query: {},
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(name) ?? '' },
        socket: { remoteAddress: '127.0.0.94' },
    } as never, res as never);
    return out;
}

const collect = (name: string) => post(name, 'complete-training');
const start = (name: string, extra: Json = {}) => post(name, 'start-training', { focus: 'bond', durationMs: 900_000, ...extra });

async function savedCharacter(name: string): Promise<Json> {
    return ((await kv.get<Json>(`save:${name}`))?.character ?? {}) as Json;
}

async function board(name: string): Promise<Json> {
    return (await kv.get<Json>(`missions:daily:${name}`)) ?? {};
}

async function coach(name: string): Promise<BoardMission> {
    const missions = ((await board(name)).missions ?? []) as BoardMission[];
    const found = missions.find((mission) => mission.templateId === 'tamer-coach');
    assert.ok(found, 'Coach is on the board');
    return found;
}

function completedNames(out: Out): string[] {
    return ((out.body.missionsCompleted ?? []) as Array<{ name: string }>).map((mission) => mission.name);
}

function listedKey(name: string): string {
    return `pet-train-missions:${name}`;
}

async function listed(name: string): Promise<Json[]> {
    return (((await kv.get<Json>(listedKey(name)))?.events ?? []) as Json[]);
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

/** Route `key`'s writes through `refuse`, on every write path; true throws. */
async function withWritesRefused<T>(
    key: string,
    refuse: (value: unknown) => boolean,
    fn: () => Promise<T>,
): Promise<T> {
    const originalSet = kv.set.bind(kv);
    const originalCompareSet = kv.compareSet.bind(kv);
    const originalDelIfEqual = kv.delIfEqual.bind(kv);
    kv.set = (async (target: string, value: unknown, options?: Parameters<typeof kv.set>[2]) => {
        if (target === key && refuse(value)) throw new Error(`simulated ${key} write failure`);
        return originalSet(target, value, options);
    }) as typeof kv.set;
    kv.compareSet = (async (target: string, expected: unknown, value: unknown, options?: Parameters<typeof kv.compareSet>[3]) => {
        if (target === key && refuse(value)) throw new Error(`simulated ${key} write failure`);
        return originalCompareSet(target, expected, value, options);
    }) as typeof kv.compareSet;
    kv.delIfEqual = (async (target: string, expected: unknown) => {
        if (target === key && refuse(null)) throw new Error(`simulated ${key} delete failure`);
        return originalDelIfEqual(target, expected);
    }) as typeof kv.delIfEqual;
    try {
        return await fn();
    } finally {
        kv.set = originalSet as typeof kv.set;
        kv.compareSet = originalCompareSet as typeof kv.compareSet;
        kv.delIfEqual = originalDelIfEqual as typeof kv.delIfEqual;
    }
}

describe('a collected pet training counts toward the daily missions exactly once', { concurrency: false }, () => {
    it('counts a collect whose report could not take the daily-mission lock at the next start', async () => {
        const name = `${PREFIX}nextstart`;
        await seed(name);

        const first = await withDailyMissionLockHeld(name, () => collect(name));
        assert.equal((await savedCharacter(name) as { pets: Json[] }).pets[0].training, undefined, 'the session settled');
        assert.equal((await coach(name)).progress, 0, 'its report could not take the daily-mission lock');

        // The Tamer starts the pet's next session right away.
        const next = await start(name);
        assert.equal(next.status, 200, JSON.stringify(next.body));
        assert.equal((await coach(name)).progress, 1, 'the failed report\'s progress was never counted');
        assert.equal(first.status, 200, 'a collect whose session settled no longer answers an error');
        assert.deepEqual(await listed(name), [], 'nothing is left owed');

        // The running session refuses a collect; nothing counts twice.
        assert.equal((await collect(name)).status, 409);
        assert.equal((await coach(name)).progress, 1, 'a later action counts nothing twice');
    });

    it('counts it when the client retries the collect', async () => {
        const name = `${PREFIX}retry`;
        await seed(name);

        await withDailyMissionLockHeld(name, () => collect(name));
        const retry = await collect(name);
        assert.equal(retry.status, 409, 'the session was already collected');
        assert.equal((await coach(name)).progress, 1, 'the failed report\'s progress was never counted');

        assert.equal((await collect(name)).status, 409);
        assert.equal((await coach(name)).progress, 1, 'a later retry counts nothing twice');
    });

    it('counts it when the daily-mission row write failed', async () => {
        const name = `${PREFIX}failedwrite`;
        await seed(name);

        let refused = false;
        const first = await withWritesRefused(`missions:daily:${name}`, (value) => {
            const missions = ((value as Json | null)?.missions ?? []) as BoardMission[];
            if (refused || !missions.some((mission) => mission.templateId === 'tamer-coach' && mission.progress > 0)) return false;
            refused = true;
            return true;
        }, () => collect(name));
        assert.equal(refused, true, 'the write counting the session was refused');
        assert.equal((await coach(name)).progress, 0);

        const next = await start(name);
        assert.equal(next.status, 200, JSON.stringify(next.body));
        assert.equal((await coach(name)).progress, 1, 'the failed report\'s progress was never counted');
        assert.equal(first.status, 200);
    });

    it('toasts the completion the recovered report earned, once, and pays its XP once', async () => {
        const name = `${PREFIX}toast`;
        await seed(name, { coachProgress: 1 });

        const first = await withDailyMissionLockHeld(name, () => collect(name));
        assert.deepEqual(completedNames(first), []);

        const next = await start(name);
        assert.equal(next.status, 200, JSON.stringify(next.body));
        assert.deepEqual(completedNames(next), ['Coach'], 'the failed report\'s completion was never counted');
        assert.ok((await coach(name)).completedAt, 'Coach completed');
        const character = next.body.character as Json;
        assert.equal(character.professionXp, COACH_XP, 'the reply carries the save that paid Coach');
        assert.equal(next.body._saveVersion, (await kv.get<Json>(`save:${name}`))?._saveVersion, 'and its version');

        assert.equal((await collect(name)).status, 409);
        assert.equal((await savedCharacter(name)).professionXp, COACH_XP, 'no profession XP is paid twice');
    });

    it('counts nothing twice when a landed report\'s event could not be cleared', async () => {
        const name = `${PREFIX}uncleared`;
        await seed(name, { coachProgress: 1 });

        // The report lands and completes Coach, but clearing the listed event fails.
        const first = await withWritesRefused(listedKey(name), (value) => value === null || pendingCount(value) === 0, () => collect(name));
        assert.equal(first.status, 200, JSON.stringify(first.body));
        assert.deepEqual(completedNames(first), ['Coach']);
        assert.equal((await listed(name)).length, 1, 'the event is still listed');

        const next = await start(name);
        assert.equal(next.status, 200, JSON.stringify(next.body));
        assert.deepEqual(completedNames(next), [], 'the replayed report toasts nothing twice');
        assert.equal((await savedCharacter(name)).professionXp, COACH_XP, 'and pays nothing twice');
        assert.deepEqual(await listed(name), [], 'and it is cleared');
    });

    it('drops an event settled on an earlier UTC day rather than count it twice', async () => {
        const name = `${PREFIX}crossday`;
        await seed(name);

        await withDailyMissionLockHeld(name, () => collect(name));
        // The next action comes after midnight. Any receipt the first report left
        // would sit in yesterday's row, which today's has replaced.
        const events = await listed(name);
        assert.equal(events.length, 1, 'the failed report left its event listed');
        await kv.set(listedKey(name), { version: 1, events: events.map((event) => ({ ...event, settledAt: Number(event.settledAt) - DAY_MS })) }, { ex: 3600 });
        const before = await board(name);

        const next = await start(name);
        assert.equal(next.status, 200, JSON.stringify(next.body));
        assert.deepEqual(await board(name), before, 'today\'s board is untouched');
        assert.deepEqual(await listed(name), [], 'and the stale event is dropped');
    });

    it('drops an event from before the player chose their profession again', async () => {
        const name = `${PREFIX}rechosen`;
        await seed(name);

        await withDailyMissionLockHeld(name, () => collect(name));
        const [event] = await listed(name);
        assert.ok(event, 'the failed report left its event listed');
        // Switching away and back starts a fresh board the session never belonged to.
        const record = (await kv.get<Json>(`save:${name}`))!;
        await kv.set(`save:${name}`, { ...record, character: { ...(record.character as Json), professionChosenAt: Number(event.settledAt) + 1 } });
        const before = await board(name);

        const next = await start(name);
        assert.equal(next.status, 200, JSON.stringify(next.body));
        assert.deepEqual(await board(name), before, 'the fresh board is untouched');
        assert.deepEqual(await listed(name), []);
    });

    it('reports a session it could not list, and never hands back a committed Prodigy claim', async () => {
        const name = `${PREFIX}prodigy`;
        await kv.del(prodigyKey(name, Date.now()));
        // The Trainer path's capstone: today's start can seal an instant session.
        await seed(name, { masterySpec: { 'train-time': 2, 'train-xp': 2, prodigy: 1 } });

        // Starting heals the finished session first, and listing its event fails.
        const started = await withWritesRefused(listedKey(name), () => true, () => start(name, { durationMs: 14_400_000, prodigy: true }));
        assert.equal(started.status, 200, JSON.stringify(started.body));
        assert.equal(started.body.settledTraining, 'bond', 'the finished session was collected first');
        assert.equal((await coach(name)).progress, 1, 'the unlisted session was still reported');
        assert.ok(await kv.get(prodigyKey(name, Date.now())), 'today\'s Prodigy stays spent');
        await kv.del(prodigyKey(name, Date.now()));
    });
});

function pendingCount(value: unknown): number {
    const events = (value as Json | null)?.events;
    return Array.isArray(events) ? events.length : 0;
}
