import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import { getFloor } from './_floor-catalog.js';
import { sealTowerCatalogFloor } from './_session-floor.js';
import type { TowerActor, TowerSession } from './_tower-session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'tower-settle-lifecycle-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let writeSession: typeof import('./_tower-store.js').writeSession;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ writeSession } = await import('./_tower-store.js'));
    handler = (await import('./settle.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const prefix of ['tower:*', 'tower-party:*', 'tower-party-player:*', 'battle-lock:*', 'save:*']) {
        for (const key of await kv.keys(prefix)) await kv.del(key);
    }
});

function actor(slug: string, index: number): TowerActor {
    return {
        id: `sq-${index}`, side: 'squad', name: slug, ownerSlug: slug, ai: false,
        hp: 1000, maxHp: 1000, chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100, shield: 0, statuses: [], cooldowns: {},
        pos: index, character: {},
    };
}

function completedSession(runId: string, partyId: string): TowerSession {
    const session = {
        towerId: 'celestial', runId, floor: 1, seed: 1, partySize: 2,
        map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [actor('host', 0), actor('alice', 1)],
        turnQueue: [], activeIndex: 0, round: 3, activeAp: 0, actionsThisTurn: 0,
        groundEffects: [], objectiveState: { kind: 'defeat-all', completed: true, failed: false },
        phaseState: { pendingPhases: [], triggeredPhases: [] },
        status: 'done', winner: 'squad', recentMoveTokens: [], rewardSettlementState: 'pending',
        log: [], createdAt: Date.now(), lastActionAt: Date.now(), towerPartyId: partyId,
    } as TowerSession & { towerPartyId: string };
    sealTowerCatalogFloor(session, getFloor(1)!, 'story');
    return session;
}

function save(slug: string) {
    return {
        _saveVersion: 1,
        character: {
            name: slug, level: 30, xp: 0, ryo: 0, fateShards: 0, boneCharms: 0,
            maxHp: 1000, maxChakra: 100, maxStamina: 100, stats: {}, unspentStats: 0,
        },
    };
}

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

async function settle(runId: string): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    const req = {
        method: 'POST',
        body: { runId, playerName: 'host' },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res);
    return out;
}

describe('Tower party settlement lifecycle', { concurrency: false }, () => {
    it('keeps discovery/indexes through a partial member failure, then closes only after stable retry', async () => {
        const partyId = `tparty-${'d'.repeat(32)}`;
        const runId = 'tower-settle-retry';
        const now = Date.now();
        await kv.set('save:host', save('host'));
        await kv.set(`tower-party:${partyId}`, {
            id: partyId, inviteCode: 'ABCDEFGH', hostSlug: 'host', binding: { mode: 'story', floor: 1 },
            status: 'active',
            members: [
                { slug: 'host', displayName: 'Host', joinedAt: now, ready: true },
                { slug: 'alice', displayName: 'Alice', joinedAt: now, ready: true },
            ],
            invitedSlugs: [], version: 5, createdAt: now, updatedAt: now,
            expiresAt: now + 2 * 60 * 60 * 1_000,
            launch: { requestId: 'settle-request-0001', runId, seed: 1, state: 'active', preparedAt: now },
            receipts: [],
        }, { ex: 2 * 60 * 60 });
        await kv.set('tower-party-player:host', partyId, { ex: 2 * 60 * 60 });
        await kv.set('tower-party-player:alice', partyId, { ex: 2 * 60 * 60 });
        await writeSession(completedSession(runId, partyId));

        const partial = await settle(runId);
        assert.equal(partial.statusCode, 200);
        assert.equal(partial.body?.settled, false);
        assert.equal((await kv.get<{ status: string }>(`tower-party:${partyId}`))?.status, 'active');
        assert.equal(await kv.get('tower-party-player:host'), partyId);
        assert.equal(await kv.get('tower-party-player:alice'), partyId);
        assert.notEqual(await kv.get('battle-lock:host'), null);

        await kv.set('save:alice', save('alice'));
        const stable = await settle(runId);
        assert.equal(stable.statusCode, 200);
        assert.equal(stable.body?.settled, true);
        assert.equal((await kv.get<{ status: string }>(`tower-party:${partyId}`))?.status, 'closed');
        assert.equal(await kv.get('tower-party-player:host'), null);
        assert.equal(await kv.get('tower-party-player:alice'), null);
        assert.equal(await kv.get('battle-lock:host'), null);
        assert.equal(await kv.get('battle-lock:alice'), null);
    });
});
