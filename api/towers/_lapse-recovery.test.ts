import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import { makePveEngineTestSession } from './_pve-engine-test-fixture.js';
import { getFloor } from './_floor-catalog.js';
import { sealTowerCatalogFloor } from './_session-floor.js';
import type { TowerSession } from './_tower-session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'tower-lapse-recovery-test';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('../_storage.js').kv;
let claim: typeof import('./_battle-lease.js').claimTowerBattleLeases;
let handlers: Record<string, Handler>;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ claimTowerBattleLeases: claim } = await import('./_battle-lease.js'));
    handlers = {
        state: (await import('./state.js')).default as unknown as Handler,
        'my-run': (await import('./my-run.js')).default as unknown as Handler,
        action: (await import('./action.js')).default as unknown as Handler,
        settle: (await import('./settle.js')).default as unknown as Handler,
        join: (await import('./join.js')).default as unknown as Handler,
    };
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

async function request(endpoint: string, runId: string) {
    const out = { status: 200, body: {} as Record<string, unknown> };
    const res = {
        setHeader: () => res,
        status: (code: number) => { out.status = code; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    await handlers[endpoint]({
        method: ['state', 'my-run'].includes(endpoint) ? 'GET' : 'POST',
        query: { playerName: 'rill', runId },
        body: { playerName: 'rill', runId, type: 'wait' },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

describe('Tower lapse recovery across real endpoints', { concurrency: false }, () => {
    for (const partyBound of [false, true]) for (const endpoint of ['state', 'my-run', 'action', 'settle', 'join']) {
        it(`${partyBound ? 'co-op' : 'solo'} ${endpoint} retries a saved forfeit before discarding recovery or acknowledging completion`, async () => {
            const runId = `tower-lapse-${endpoint}`;
            const session = makePveEngineTestSession({ enemyLevel: 10, runId });
            session.towerId = 'celestial';
            session.floor = 1;
            delete session.encounterFloor;
            sealTowerCatalogFloor(session, getFloor(1)!, 'story');
            session.actors[0].ownerSlug = 'rill';
            session.actors[0].hp = 120;
            session.expiresAt = Date.now() - 1_000;
            const partyId = `tparty-${'a'.repeat(32)}`;
            if (partyBound) {
                Object.assign(session, { towerPartyId: partyId });
                session.partySize = 2;
                session.actors.push({ ...session.actors[0], id: 'ally', ownerSlug: 'alice', name: 'Alice', hp: 230 });
                await kv.set('save:alice', {
                    _saveVersion: 1,
                    character: { name: 'Alice', level: 30, hp: 800, maxHp: 800, stats: {}, inventory: [] },
                });
                const now = Date.now();
                await kv.set(`tower-party:${partyId}`, {
                    id: partyId, inviteCode: 'ABCDEFGH', hostSlug: 'rill', binding: { mode: 'story', floor: 1 },
                    status: 'active', members: ['rill', 'alice'].map(slug => ({ slug, displayName: slug, joinedAt: now, ready: true })),
                    invitedSlugs: [], version: 5, createdAt: now, updatedAt: now, expiresAt: now + 3_600_000,
                    launch: { requestId: 'lapse-request-001', runId, seed: 1, state: 'active', preparedAt: now }, receipts: [],
                });
                await kv.set('tower-party-player:rill', partyId);
                await kv.set('tower-party-player:alice', partyId);
            }
            await kv.set(`tower:${runId}`, session);
            assert.equal((await claim({ runId, members: partyBound ? ['rill', 'alice'] : ['rill'], ...(partyBound ? { partyId } : {}) })).ok, true);

            // A temporarily unavailable player save prevents physical settlement.
            const failed = await request(endpoint, runId);
            assert.equal(failed.status, 503);
            assert.equal(failed.body.errorCode, 'run-recovery-pending');
            assert.ok(await kv.get('battle-lock:rill'), 'do not discard the recovery lease');
            assert.ok(await kv.get('battle-state:rill'), 'the sweep can still retry');
            const terminal = await kv.get<TowerSession>(`tower:${runId}`);
            assert.equal(terminal?.status, 'done');
            assert.ok(terminal?.lapsedAt);

            // Discovery also repairs parties. It must not clear a lapsed run's
            // recovery pointers while physical settlement still needs a retry.
            const discovery = await request('my-run', runId);
            assert.equal(discovery.status, 503);
            assert.ok(await kv.get('battle-lock:rill'));

            await kv.set('save:rill', {
                _saveVersion: 1,
                character: { name: 'Rill', level: 30, hp: 800, maxHp: 800, stats: {}, inventory: [] },
            });
            const recovered = await request(endpoint, runId);
            assert.equal(recovered.status, endpoint === 'join' ? 410 : 200);
            assert.equal(await kv.get('battle-lock:rill'), null);
            assert.equal(await kv.get('battle-state:rill'), null);
            if (partyBound) {
                assert.equal(await kv.get('tower-party-player:rill'), null);
                assert.equal(await kv.get('tower-party-player:alice'), null);
                assert.equal(await kv.get('battle-lock:alice'), null);
                assert.equal((await kv.get<{ character: { hp: number } }>('save:alice'))?.character.hp, 230);
                assert.equal((await kv.get<{ status: string }>(`tower-party:${partyId}`))?.status, 'closed');
            }
            const save = await kv.get<{ _saveVersion: number; character: { hp: number } }>('save:rill');
            assert.equal(save?.character.hp, 120, 'the recorded outcome was applied before releasing the run');
            if (endpoint === 'my-run') assert.equal(recovered.body.runId, null);
            if (endpoint === 'action') assert.equal(recovered.body.reason, 'session-done');
            if (endpoint === 'settle') assert.equal(recovered.body.settled, true);

            await request(endpoint, runId);
            assert.deepEqual(await kv.get('save:rill'), save, 'repeat recovery cannot charge the player twice');
        });
    }
});
