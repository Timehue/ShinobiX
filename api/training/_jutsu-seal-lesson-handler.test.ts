import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { status: number; body: Record<string, unknown> };

const PLAYER = 'seallessontester';
const JUTSU_ID = 'starter-nin-earth-1';

let kv: typeof import('../_storage.js').kv;
let lesson: Handler;
let instant: Handler;
let token: string;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const { issuePlayerToken } = await import('../_auth.js');
    token = String(issuePlayerToken(PLAYER));
    lesson = (await import('./jutsu-ryo.js')).default as unknown as Handler;
    instant = (await import('../jutsu/train-with-seals.js')).default as unknown as Handler;
    await kv.set(`save:${PLAYER}`, {
        character: { name: PLAYER, level: 50, ryo: 1_000, honorSeals: 100, village: 'Moonshadow Village',
            jutsuMastery: [{ jutsuId: JUTSU_ID, level: 30, xp: 0 }] },
        activeJutsuTraining: null,
        _saveVersion: 1,
    });
});

after(async () => { await kv.del(`save:${PLAYER}`); });

async function post(handler: Handler, body: Record<string, unknown>): Promise<Reply> {
    const reply: Reply = { status: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (status: number) => { reply.status = status; return res; },
        json: (payload: Record<string, unknown>) => { reply.body = payload; return res; },
        end: () => res,
    };
    await handler({ method: 'POST', body: { playerName: PLAYER, ...body },
        headers: { 'content-type': 'application/json', 'x-player-name': PLAYER, 'x-player-token': token },
        socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return reply;
}

const requestId = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

describe('Honor Seal training through the real endpoints', () => {
    it('starts a 30-minute Seal lesson, and the old instant path can no longer skip it', async () => {
        const started = await post(lesson, { action: 'start', payWith: 'honorSeals', jutsuId: JUTSU_ID, label: 'Stone Needle Volley', requestId: requestId('start') });
        assert.equal(started.status, 200, JSON.stringify(started.body));
        const active = started.body.activeJutsuTraining as { currency: string; fromLevel: number; toLevel: number; startedAt: number; endsAt: number; sealCost: number };
        assert.equal(active.currency, 'honorSeals');
        assert.deepEqual([active.fromLevel, active.toLevel, active.sealCost], [30, 31, 20]);
        assert.equal(active.endsAt - active.startedAt, 30 * 60_000);
        const character = started.body.character as { honorSeals: number; ryo: number; jutsuMastery: Array<{ level: number }> };
        assert.equal(character.honorSeals, 80);
        assert.equal(character.ryo, 1_000);
        assert.equal(character.jutsuMastery[0].level, 30, 'no instant level');

        const queued = await post(lesson, { action: 'queue', payWith: 'honorSeals', jutsuId: JUTSU_ID, label: 'Stone Needle Volley',
            serverToken: (started.body.activeJutsuTraining as { serverToken: string }).serverToken, requestId: requestId('queue') });
        assert.equal(queued.status, 200, JSON.stringify(queued.body));
        assert.equal((queued.body.activeJutsuTraining as { next: { fromLevel: number } }).next.fromLevel, 31);

        const skipped = await post(instant, { jutsuId: JUTSU_ID });
        assert.equal(skipped.status, 410);
        const stored = await kv.get<{ character: { honorSeals: number; jutsuMastery: Array<{ level: number }> } }>(`save:${PLAYER}`);
        assert.equal(stored?.character.jutsuMastery[0].level, 30, 'the retired endpoint did not level the jutsu');
        assert.equal(stored?.character.honorSeals, 55, 'and did not spend Seals (100 - 20 - 25)');
    });

    it('lets the Seal speed-up buy the last partial 10-minute block, so "Finish now" can finish', async () => {
        const record = await kv.get<Record<string, unknown> & { activeJutsuTraining: { endsAt: number } }>(`save:${PLAYER}`);
        assert.ok(record?.activeJutsuTraining);
        const twentyFiveMinutesLeft = Date.now() + 25 * 60_000;
        await kv.set(`save:${PLAYER}`, { ...record, activeJutsuTraining: { ...record.activeJutsuTraining, endsAt: twentyFiveMinutesLeft } });
        const speedup = (await import('../jutsu/speedup.js')).default as unknown as Handler;

        const tooMany = await post(speedup, { seals: 4 });
        assert.equal(tooMany.status, 400, 'still no selling more blocks than remain');
        assert.equal(tooMany.body.maxSeals, 3);
        const finish = await post(speedup, { seals: 3 });
        assert.equal(finish.status, 200, JSON.stringify(finish.body));
        const after = await kv.get<{ _saveVersion: number; activeJutsuTraining: { endsAt: number }; character: { honorSeals: number } }>(`save:${PLAYER}`);
        assert.ok((after?.activeJutsuTraining.endsAt ?? Infinity) <= Date.now(), 'the lesson is now due');
        assert.equal(after?.character.honorSeals, 52);
        assert.equal(finish.body._saveVersion, after?._saveVersion, 'the reply acknowledges the version it actually stored');
    });

    it('applies the Quartermaster "Stockpile" discount to Seal speed-ups', async () => {
        const record = await kv.get<Record<string, unknown> & { character: Record<string, unknown>; activeJutsuTraining: Record<string, unknown> }>(`save:${PLAYER}`);
        assert.ok(record);
        await kv.set(`save:${PLAYER}`, {
            ...record,
            character: { ...record.character, honorSeals: 100, profession: 'vanguard', professionRank: 1, masterySpec: { 'seal-speedup': 3 } },
            activeJutsuTraining: { ...record.activeJutsuTraining, endsAt: Date.now() + 100 * 60_000 },
        });
        const { effectiveSpeedupCost } = await import('../jutsu/speedup.js');
        assert.equal(effectiveSpeedupCost(10, { profession: 'vanguard', professionRank: 1, masterySpec: { 'seal-speedup': 3 } }), 9, '10 x 0.85');
        assert.equal(effectiveSpeedupCost(10, { profession: 'vanguard', professionRank: 8, masterySpec: { 'seal-speedup': 3 } }), 8, 'stacks with the rank-8 cut: ceil(10 x 0.9 x 0.85)');
        assert.equal(effectiveSpeedupCost(1, { profession: 'vanguard', professionRank: 8, masterySpec: { 'seal-speedup': 3 } }), 1, 'never free');
        const speedup = (await import('../jutsu/speedup.js')).default as unknown as Handler;
        const reply = await post(speedup, { seals: 10 });
        assert.equal(reply.status, 200, JSON.stringify(reply.body));
        assert.equal(reply.body.sealsSpent, 9);
        assert.equal(reply.body.honorSealsRemaining, 91);
    });

    it('Logistician: one free Finish-now per week, only with the capstone', async () => {
        const speedup = (await import('../jutsu/speedup.js')).default as unknown as Handler;
        const { logisticianKey } = await import('../jutsu/speedup.js');
        const setLesson = async (spec: Record<string, number>) => {
            const record = await kv.get<Record<string, unknown> & { character: Record<string, unknown>; activeJutsuTraining: Record<string, unknown> }>(`save:${PLAYER}`);
            assert.ok(record);
            await kv.set(`save:${PLAYER}`, {
                ...record,
                character: { ...record.character, honorSeals: 40, profession: 'vanguard', professionRank: 1, masterySpec: spec },
                activeJutsuTraining: { ...record.activeJutsuTraining, endsAt: Date.now() + 30 * 60_000 },
            });
        };
        await kv.del(logisticianKey(PLAYER, Date.now()));
        const status = async () => {
            const reply: Reply = { status: 200, body: {} };
            const res = { setHeader: () => res, status: (s: number) => { reply.status = s; return res; }, json: (b: Record<string, unknown>) => { reply.body = b; return res; }, end: () => res };
            await speedup({ method: 'GET', query: { playerName: PLAYER }, headers: { 'x-player-name': PLAYER, 'x-player-token': token },
                socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
            return reply.body.logistician as { owned: boolean; available: boolean };
        };

        await setLesson({ 'seal-train-cost': 2, 'seal-speedup': 2 });
        assert.equal((await post(speedup, { free: true })).status, 403, 'needs the capstone');
        assert.deepEqual(await status(), { owned: false, available: false, resetsAt: (await status() as { resetsAt?: number }).resetsAt });

        await setLesson({ 'seal-train-cost': 2, 'seal-speedup': 2, logistician: 1 });
        assert.equal((await status()).available, true);
        const free = await post(speedup, { free: true });
        assert.equal(free.status, 200, JSON.stringify(free.body));
        assert.equal(free.body.sealsSpent, 0);
        const stored = await kv.get<{ _saveVersion: number; activeJutsuTraining: { endsAt: number }; character: { honorSeals: number } }>(`save:${PLAYER}`);
        assert.ok((stored?.activeJutsuTraining.endsAt ?? Infinity) <= Date.now(), 'the lesson is finished');
        assert.equal(stored?.character.honorSeals, 40, 'no Seals spent');
        assert.equal(free.body._saveVersion, stored?._saveVersion);

        await setLesson({ 'seal-train-cost': 2, 'seal-speedup': 2, logistician: 1 });
        const again = await post(speedup, { free: true });
        assert.equal(again.status, 409, 'once per week');
        assert.equal((await status()).available, false);
        await kv.del(logisticianKey(PLAYER, Date.now()));
    });

    it('Logistician is not spent on a lesson with under a minute left', async () => {
        const speedup = (await import('../jutsu/speedup.js')).default as unknown as Handler;
        const { logisticianKey } = await import('../jutsu/speedup.js');
        await kv.del(logisticianKey(PLAYER, Date.now()));
        const record = await kv.get<Record<string, unknown> & { character: Record<string, unknown>; activeJutsuTraining: Record<string, unknown> }>(`save:${PLAYER}`);
        assert.ok(record);
        await kv.set(`save:${PLAYER}`, { ...record,
            character: { ...record.character, profession: 'vanguard', masterySpec: { 'seal-train-cost': 2, 'seal-speedup': 2, logistician: 1 } },
            activeJutsuTraining: { ...record.activeJutsuTraining, endsAt: Date.now() + 30_000 } });
        assert.equal((await post(speedup, { free: true })).status, 400);
        assert.equal(await kv.get(logisticianKey(PLAYER, Date.now())), null, 'the weekly claim is untouched');
    });

    it('hands the Logistician claim back when the save write fails', async () => {
        const speedup = (await import('../jutsu/speedup.js')).default as unknown as Handler;
        const { logisticianKey } = await import('../jutsu/speedup.js');
        await kv.del(logisticianKey(PLAYER, Date.now()));
        const record = await kv.get<Record<string, unknown> & { character: Record<string, unknown>; activeJutsuTraining: Record<string, unknown> }>(`save:${PLAYER}`);
        assert.ok(record);
        await kv.set(`save:${PLAYER}`, { ...record,
            character: { ...record.character, profession: 'vanguard', masterySpec: { 'seal-train-cost': 2, 'seal-speedup': 2, logistician: 1 } },
            activeJutsuTraining: { ...record.activeJutsuTraining, endsAt: Date.now() + 30 * 60_000 } });
        const store = kv as unknown as { compareSet: (...args: unknown[]) => Promise<unknown> };
        const original = store.compareSet;
        store.compareSet = async () => { throw new Error('simulated storage failure'); };
        try {
            assert.equal((await post(speedup, { free: true })).status, 500);
        } finally { store.compareSet = original; }
        assert.equal(await kv.get(logisticianKey(PLAYER, Date.now())), null, 'the free speedup is still this week\'s to use');
        assert.equal((await post(speedup, { free: true })).status, 200);
        await kv.del(logisticianKey(PLAYER, Date.now()));
    });
});
