import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'warfront-single-flight-test-admin';

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

const PLAYER = 'single-flight-tester';
const ACTIVE_KEY = `pet:warfront-active:${PLAYER}`;
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let roster: Array<Record<string, unknown>>;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./warfront-start.js')).default as unknown as Handler;
    const { GAUNTLET_POOL } = await import('../_pet-sim/_gauntlet-pool.js');
    roster = GAUNTLET_POOL.slice(0, 4).map((pet) => ({
        ...pet,
        element: pet.element ?? 'None',
        level: 1,
        maxLevel: 100,
        xp: 0,
        jutsus: pet.jutsus.map((jutsu) => ({ ...jutsu, currentCooldown: 0 })),
    }));
});

beforeEach(async () => {
    for (const pattern of [
        `pet:warfront-active:${PLAYER}`,
        `pet:warfront-prepared:${PLAYER}`,
        `pet:warfront-authorization:${PLAYER}:*`,
        `pet:battle-token:${PLAYER}:*`,
    ]) {
        for (const key of await kv.keys(pattern)) await kv.del(key);
    }
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        character: { name: PLAYER, patreon: { active: true }, pets: roster },
    });
});

after(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fakeRes() {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function post(body: Record<string, unknown>): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    await handler({
        method: 'POST',
        body: { playerName: PLAYER, ...body },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res);
    return out;
}

function autoStartBody(prepareToken: string): Record<string, unknown> {
    return {
        action: 'start',
        prepareToken,
        playerPetIds: roster.map((pet) => pet.id),
        stance: 'balanced',
        doctrine: 'vanguard',
        buyPolicy: 'balanced',
        deployment: ['top', 'mid', 'bottom', 'flex'],
        buildPackage: 'hold-line',
        coachOrder: 'contest',
        objectiveTechnique: 'zone',
        counterstrike: 'fortify',
    };
}

describe('Warfront Auto start single-flight and recovery', { concurrency: false }, () => {
    it('returns a bounded retry to followers, then recovers one lost mint response exactly', async () => {
        const prepared = await post({ action: 'prepare' });
        assert.equal(prepared.statusCode, 200);
        const prepareToken = String(prepared.body?.prepareToken ?? '');
        assert.match(prepareToken, /^[A-Za-z0-9]{16,128}$/);

        const startBody = autoStartBody(prepareToken);

        // Exact follower interleaving: the winning request has atomically
        // reserved the active slot but has not yet completed the simulation.
        const winningReservation = 'start-0000000000000000000000000001';
        await kv.set(ACTIVE_KEY, winningReservation);
        const follower = await post(startBody);
        assert.equal(follower.statusCode, 425);
        assert.equal(follower.body?.code, 'warfront-start-in-flight');
        assert.equal(follower.body?.retryAfterMs, 500);
        assert.equal(await kv.get(ACTIVE_KEY), winningReservation,
            'a follower must never clear the winner reservation');

        await kv.delIfEqual(ACTIVE_KEY, winningReservation);
        const first = await post(startBody);
        assert.equal(first.statusCode, 200);
        assert.equal(first.body?.idempotentReplay, false);
        const token = String(first.body?.token ?? '');
        assert.match(token, /^[A-Za-z0-9]{16,128}$/);

        // Model a dropped HTTP response: the identical request must recover
        // the durable authorization without re-running/minting another match.
        const recovered = await post(startBody);
        assert.equal(recovered.statusCode, 200);
        assert.equal(recovered.body?.idempotentReplay, true);
        assert.equal(recovered.body?.token, token);
        assert.equal(recovered.body?.reportKey, first.body?.reportKey);
        assert.deepEqual(recovered.body?.difficulty, first.body?.difficulty);
        assert.deepEqual(recovered.body?.rewardModel, first.body?.rewardModel);

        assert.deepEqual(await kv.keys(`pet:battle-token:${PLAYER}:*`), [
            `pet:battle-token:${PLAYER}:${token}`,
        ], 'the winning scouting contract can mint only one payout token');
        assert.equal(await kv.get(ACTIVE_KEY), token);
        assert.equal(await kv.get(`pet:warfront-prepared:${PLAYER}`), null);
    });

    it('rejects an expedition roster before reserving or simulating and preserves the prepared grant', async () => {
        const prepared = await post({ action: 'prepare' });
        assert.equal(prepared.statusCode, 200);
        const prepareToken = String(prepared.body?.prepareToken ?? '');
        const busyRoster = roster.map((pet, index) => index === 0
            ? { ...pet, expedition: { expeditionId: 'busy', endsAt: Date.now() + 60_000 } }
            : pet);
        await kv.set(`save:${PLAYER}`, {
            _saveVersion: 2,
            character: { name: PLAYER, patreon: { active: true }, pets: busyRoster },
        });

        const rejected = await post(autoStartBody(prepareToken));
        assert.equal(rejected.statusCode, 409);
        assert.match(String(rejected.body?.error), /expedition/i);
        assert.equal(await kv.get(ACTIVE_KEY), null);
        assert.deepEqual(await kv.keys(`pet:battle-token:${PLAYER}:*`), []);
        assert.deepEqual(await kv.keys(`pet:warfront-authorization:${PLAYER}:*`), []);
        assert.ok(await kv.get(`pet:warfront-prepared:${PLAYER}`),
            'availability failure must not consume the opaque scouting grant');

        await kv.set(`save:${PLAYER}`, {
            _saveVersion: 3,
            character: { name: PLAYER, patreon: { active: true }, pets: roster },
        });
        const idle = await post(autoStartBody(prepareToken));
        assert.equal(idle.statusCode, 200);
        assert.equal(idle.body?.idempotentReplay, false);
    });
});
