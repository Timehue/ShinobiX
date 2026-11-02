import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'jutsu-ryo-handler-test';
delete process.env.SESSION_SECRET;

type ResponseOut = { statusCode: number; body: Record<string, unknown> | undefined };
type Handler = (req: never, res: never) => Promise<unknown>;

const PLAYER = 'jutsuflowtester';
const SAVE_KEY = `save:${PLAYER}`;
const ACTIVE_TOKEN = 'active-training-token';
const JUTSU_ID = 'starter-nin-earth-1';

let handler: Handler;
let kv: typeof import('../_storage.js').kv;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./jutsu-ryo.js')).default as unknown as Handler;
});

beforeEach(async () => {
    await kv.set(SAVE_KEY, {
        character: {
            name: PLAYER,
            level: 30,
            ryo: 50_000,
            village: 'Emberfall',
            jutsuMastery: [{ jutsuId: JUTSU_ID, level: 8, xp: 0 }],
        },
        activeJutsuTraining: {
            serverToken: ACTIVE_TOKEN,
            jutsuId: JUTSU_ID,
            label: 'Stone Needle Volley',
            fromLevel: 8,
            toLevel: 9,
            ryoCost: 6_500,
            startedAt: 1,
            endsAt: 2,
        },
        _saveVersion: 1,
    });
});

after(async () => {
    await kv.del(SAVE_KEY);
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeReq(body: Record<string, unknown>) {
    return {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

function fakeRes() {
    const out: ResponseOut = { statusCode: 200, body: undefined };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function mutate(body: Record<string, unknown>) {
    const { res, out } = fakeRes();
    await handler(fakeReq({ playerName: PLAYER, ...body }), res);
    return out;
}

function masteryLevel(character: unknown, jutsuId: string): number | undefined {
    const rows = (character as { jutsuMastery?: Array<{ jutsuId: string; level: number }> })?.jutsuMastery ?? [];
    return rows.find((row) => row.jutsuId === jutsuId)?.level;
}

describe('jutsu ryo training handler lifecycle', () => {
    it('recognizes and freely learns all 45 new catalog entries through the real handler', async () => {
        const { JUTSU_CATALOG } = await import('../pvp/_jutsu-catalog.js');
        const additions = Object.values(JUTSU_CATALOG).filter(j =>
            /^starter-(?:nin|gen|tai|buki)-[a-z]+-[56]$/.test(j.id) || j.id.startsWith('starter-any-'));
        assert.equal(additions.length, 45);
        const initial = (await kv.get<Record<string, unknown>>(SAVE_KEY))!;
        await kv.set(SAVE_KEY, { ...initial, activeJutsuTraining: null,
            character: { ...(initial.character as object), elements: ['Earth', 'Wind', 'Lightning', 'Fire', 'Water'] } });
        for (const [index, jutsu] of additions.entries()) {
            const result = await mutate({ action: 'start', jutsuId: jutsu.id, label: jutsu.name,
                requestId: `global-audit-learn-${index}` });
            assert.equal(result.statusCode, 200, `${jutsu.id}: ${JSON.stringify(result.body)}`);
            assert.equal(masteryLevel(result.body?.character, jutsu.id), 1);
            assert.equal(result.body?.cost, 0);
            assert.equal(result.body?.activeJutsuTraining, null);
        }
        const reloaded = await kv.get<Record<string, unknown>>(SAVE_KEY);
        for (const jutsu of additions) assert.equal(masteryLevel(reloaded?.character, jutsu.id), 1);
    });

    it('learns a new global attack and shared elemental utility through queued lessons', async () => {
        const initial = (await kv.get<Record<string, unknown>>(SAVE_KEY))!;
        await kv.set(SAVE_KEY, { ...initial, activeJutsuTraining: null,
            character: { ...(initial.character as object), element: 'Wind', elements: ['Wind'], specialty: 'Bukijutsu' } });
        const attackId = 'starter-buki-wind-5';
        const utilityId = 'starter-any-wind-1';
        for (const [index, jutsuId] of [attackId, utilityId].entries()) {
            const learned = await mutate({ action: 'start', jutsuId, requestId: `global-expansion-learn-${index}` });
            assert.equal(learned.statusCode, 200, JSON.stringify(learned.body));
            assert.equal(masteryLevel(learned.body?.character, jutsuId), 1);
            assert.equal(learned.body?.cost, 0, 'the first level keeps the existing free-learning behavior');
            assert.equal(learned.body?.activeJutsuTraining, null);
        }
        const start = await mutate({ action: 'start', jutsuId: attackId, requestId: 'global-expansion-start-001' });
        assert.equal(start.statusCode, 200, JSON.stringify(start.body));
        const active = start.body?.activeJutsuTraining as { serverToken: string; jutsuId: string };
        assert.equal(active.jutsuId, attackId);
        const queue = await mutate({ action: 'queue', jutsuId: utilityId, serverToken: active.serverToken, requestId: 'global-expansion-queue-001' });
        assert.equal(queue.statusCode, 200, JSON.stringify(queue.body));
        for (const [index, jutsuId] of [attackId, utilityId].entries()) {
            const saved = (await kv.get<Record<string, unknown>>(SAVE_KEY))!;
            const lesson = saved.activeJutsuTraining as { serverToken: string; jutsuId: string };
            assert.equal(lesson.jutsuId, jutsuId);
            await kv.set(SAVE_KEY, { ...saved, activeJutsuTraining: { ...lesson, endsAt: Date.now() - 1 } });
            const completed = await mutate({ action: 'complete', serverToken: lesson.serverToken, requestId: `global-expansion-complete-${index}` });
            assert.equal(completed.statusCode, 200, JSON.stringify(completed.body));
            assert.equal(masteryLevel(completed.body?.character, jutsuId), 2);
        }
        const reloaded = await kv.get<Record<string, unknown>>(SAVE_KEY);
        assert.equal(masteryLevel(reloaded?.character, attackId), 2);
        assert.equal(masteryLevel(reloaded?.character, utilityId), 2);
        assert.equal(reloaded?.activeJutsuTraining, null);
    });

    it('claims a completed legacy-shaped active session and clears the record', async () => {
        const out = await mutate({
            action: 'complete',
            requestId: 'claim-jutsu-level-001',
            serverToken: ACTIVE_TOKEN,
        });

        assert.equal(out.statusCode, 200, `expected 200, got ${out.statusCode} ${JSON.stringify(out.body)}`);
        assert.equal(masteryLevel(out.body?.character, JUTSU_ID), 9);
        assert.equal(out.body?.activeJutsuTraining, null);
        assert.equal(typeof out.body?._saveVersion, 'number');

        const saved = await kv.get<Record<string, unknown>>(SAVE_KEY);
        assert.equal(saved?.activeJutsuTraining, null);
        assert.equal(masteryLevel(saved?.character, JUTSU_ID), 9);
    });

    // The 2026-07 jutsu leases carry no serverToken at all, so token matching could
    // never admit them: `complete` AND `cancel` were both refused while the lease
    // kept blocking any new jutsu training — with the ryo already spent. Settlement
    // reads only the record's own sealed fields, so those two are safe to admit;
    // queue/advance/finish still need a real token because they mint the next one.
    it('settles a tokenless legacy jutsu lease, and still gates queue behind a real token', async () => {
        await kv.set(SAVE_KEY, {
            character: {
                name: PLAYER, level: 30, ryo: 50_000, village: 'Emberfall',
                jutsuMastery: [{ jutsuId: JUTSU_ID, level: 3, xp: 0 }],
            },
            activeJutsuTraining: {
                jutsuId: JUTSU_ID, label: 'Stone Needle Volley',
                fromLevel: 3, toLevel: 4, ryoCost: 4_000, startedAt: 1, endsAt: 2,
            },
            _saveVersion: 1,
        });

        const queued = await mutate({ action: 'queue', requestId: 'legacy-queue-001', jutsuId: JUTSU_ID });
        assert.equal(queued.statusCode, 409, `queue must still require a token, got ${JSON.stringify(queued.body)}`);
        assert.equal(queued.body?.error, 'invalid-or-legacy-jutsu-training');

        const out = await mutate({ action: 'complete', requestId: 'legacy-jutsu-claim-001' });
        assert.equal(out.statusCode, 200, `expected 200, got ${out.statusCode} ${JSON.stringify(out.body)}`);
        assert.equal(masteryLevel(out.body?.character, JUTSU_ID), 4);
        assert.equal(out.body?.activeJutsuTraining, null);

        const saved = await kv.get<Record<string, unknown>>(SAVE_KEY);
        assert.equal(saved?.activeJutsuTraining, null);

        // The cleared lease — not the token — is what stops a second settlement.
        const again = await mutate({ action: 'complete', requestId: 'legacy-jutsu-claim-002' });
        assert.equal(again.statusCode, 409, JSON.stringify(again.body));
        assert.equal(masteryLevel((await kv.get<Record<string, unknown>>(SAVE_KEY))?.character, JUTSU_ID), 4);
    });

    it('replays the same claim without double-granting or returning a server error', async () => {
        const request = {
            action: 'complete',
            requestId: 'claim-jutsu-level-002',
            serverToken: ACTIVE_TOKEN,
        };
        const first = await mutate(request);
        const replay = await mutate(request);

        assert.equal(first.statusCode, 200);
        assert.equal(replay.statusCode, 200, `expected replay 200, got ${replay.statusCode} ${JSON.stringify(replay.body)}`);
        assert.equal(masteryLevel(replay.body?.character, JUTSU_ID), 9);
        assert.equal(replay.body?.replayed, true);
    });

    it('reports save-lock contention as retryable instead of a generic 500', async () => {
        const lockKey = `lock:${SAVE_KEY}`;
        await kv.set(lockKey, 'another-writer', { ex: 5 });
        try {
            const out = await mutate({
                action: 'complete',
                requestId: 'claim-jutsu-level-003',
                serverToken: ACTIVE_TOKEN,
            });
            assert.equal(out.statusCode, 503, `expected 503, got ${out.statusCode} ${JSON.stringify(out.body)}`);
            assert.match(String(out.body?.error ?? ''), /save is being updated/i);
        } finally {
            await kv.del(lockKey);
        }
    });
});
