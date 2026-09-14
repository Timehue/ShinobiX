import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import { getFloor } from './_floor-catalog.js';
import { sealTowerCatalogFloor } from './_session-floor.js';
import type { TowerActor, TowerSession } from './_tower-session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'tower-my-run-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let store: typeof import('./_tower-store.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    store = await import('./_tower-store.js');
    handler = (await import('./my-run.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

function actor(slug: string): TowerActor {
    return {
        id: 'sq-0', side: 'squad', name: slug, ownerSlug: slug, ai: false,
        hp: 1000, maxHp: 1000, chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100, shield: 0, statuses: [], cooldowns: {},
        pos: 0, character: {},
    };
}

function session(runId: string, floor: number, status: TowerSession['status']): TowerSession {
    const now = Date.now();
    return {
        towerId: 'celestial', runId, floor, seed: 1, partySize: 1,
        map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [actor('host')],
        turnQueue: ['sq-0'], activeIndex: 0, round: 1, activeAp: 0, actionsThisTurn: 0,
        groundEffects: [], objectiveState: { kind: 'defeat-all', completed: false, failed: false },
        phaseState: { pendingPhases: [], triggeredPhases: [] },
        status, winner: status === 'done' ? 'enemy' : null, recentMoveTokens: [], rewardSettlementState: 'pending',
        log: [], createdAt: now, lastActionAt: now, expiresAt: now + 10 * 60 * 1000,
    } as TowerSession;
}

async function myRun(): Promise<ResponseOut> {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    await handler({
        method: 'GET',
        query: { playerName: 'host' },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

describe('Tower my-run discovery', { concurrency: false }, () => {
    // Clan Boss assaults share the Tower session and the tower-invite pointer,
    // but they never own the account-wide battle-lock. Leasing one here left a
    // battleTowers lock that the assault's own state/action refresh then refused,
    // so a my-run poll that landed before the fight's first state poll broke the
    // fight for the lease's whole TTL.
    for (const status of ['active', 'done'] as const) {
        it(`discovers a ${status} Clan Boss assault without leasing it`, async () => {
            const runId = `cboss-${status}-${'a'.repeat(24)}`;
            await kv.set(store.sessionKey(runId), session(runId, 9001, status));
            await store.setTowerInvite('host', runId);

            const out = await myRun();
            assert.equal(out.statusCode, 200);
            assert.equal(out.body?.runId, runId);
            assert.equal((out.body?.session as TowerSession | undefined)?.runId, runId);
            assert.equal(out.body?.leaseConflict, undefined);
            assert.equal(await kv.get('battle-lock:host'), null);
        });
    }

    it('still repairs the lease of a Battle Towers run it discovers', async () => {
        const runId = 'tower-my-run-story';
        const story = session(runId, 1, 'active');
        sealTowerCatalogFloor(story, getFloor(1)!, 'story');
        await kv.set(store.sessionKey(runId), story);
        await store.setTowerInvite('host', runId);

        const out = await myRun();
        assert.equal(out.statusCode, 200);
        assert.equal(out.body?.runId, runId);
        assert.equal((await kv.get<{ battleId?: string }>('battle-lock:host'))?.battleId, runId);
    });
});
