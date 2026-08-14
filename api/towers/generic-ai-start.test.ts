import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { TowerSession } from './_tower-session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'tower-generic-ai-start-admin';
delete process.env.SESSION_SECRET;
delete process.env.TOWER_MODE_DISABLED;

type Handler = (req: never, res: never) => Promise<unknown>;

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let createTowerParty: typeof import('./_party.js').createTowerParty;
let addGenericTowerAi: typeof import('./_party.js').addGenericTowerAi;
let setTowerPartyReady: typeof import('./_party.js').setTowerPartyReady;
let setRealtimeEmitter: typeof import('../_realtime/notify.js').setRealtimeEmitter;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ createTowerParty, addGenericTowerAi, setTowerPartyReady } = await import('./_party.js'));
    ({ setRealtimeEmitter } = await import('../_realtime/notify.js'));
    handler = (await import('./start.js')).default as unknown as Handler;
});

beforeEach(async () => {
    setRealtimeEmitter(null);
    for (const prefix of ['tower:*', 'tower-party:*', 'tower-party-code:*', 'tower-party-player:*', 'battle-lock:*', 'save:*']) {
        for (const key of await kv.keys(prefix)) await kv.del(key);
    }
});

after(() => setRealtimeEmitter(null));

function response() {
    const out: { statusCode: number; body?: Record<string, unknown> } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function seedHostSave() {
    await kv.set('save:host', {
        _saveVersion: 1,
        character: {
            name: 'Host', level: 50, ryo: 100_000,
            maxHp: 2_500, maxChakra: 500, maxStamina: 500,
            specialty: 'Taijutsu', stats: {
                strength: 300, speed: 300,
                taijutsuOffense: 900, taijutsuDefense: 800,
                bukijutsuDefense: 700, genjutsuDefense: 700, ninjutsuDefense: 700,
            },
            equippedJutsuIds: [], inventory: [], equipment: {},
        },
        savedBloodlines: [], creatorJutsus: [],
    });
}

describe('Story Tower generic AI launch authority', { concurrency: false }, () => {
    it('builds an ownerless weak actor, leases only the human, and pushes only the authenticated player room', async () => {
        await seedHostSave();
        const created = await createTowerParty({
            hostSlug: 'host', displayName: 'Host', binding: { mode: 'story', floor: 1 },
        });
        assert.equal(created.ok, true);
        if (!created.ok) return;
        const added = await addGenericTowerAi({
            partyId: created.party.id, actor: 'host', requestId: 'generic-ai-add-0001',
            expectedVersion: created.party.version, fingerprint: 'add-ai',
        });
        assert.equal(added.ok, true);
        if (!added.ok) return;
        const readied = await setTowerPartyReady({
            partyId: added.party.id, actor: 'host', ready: true, requestId: 'generic-ai-ready-0001',
            expectedVersion: added.party.version, fingerprint: 'ready-host',
        });
        assert.equal(readied.ok, true);
        if (!readied.ok) return;

        const pushed: Array<{ room: string; event: string; payload: unknown }> = [];
        setRealtimeEmitter((room, event, payload) => pushed.push({ room, event, payload }));
        const { out, res } = response();
        await handler({
            method: 'POST',
            body: {
                hostName: 'host', mode: 'story', floor: 1,
                partyId: readied.party.id, requestId: 'generic-ai-launch-0001',
                expectedVersion: readied.party.version,
            },
            headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
            socket: { remoteAddress: '127.0.0.1' },
        } as never, res);
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const session = out.body?.session as TowerSession;
        const host = session.actors.find(actor => actor.ownerSlug === 'host');
        const recruit = session.actors.find(actor => actor.character.towerGenericAiProfile === 'story-recruit-v1');
        assert.equal(host?.ai, false);
        assert.equal(recruit?.ai, true);
        assert.equal(recruit?.ownerSlug, null);
        assert.equal(recruit?.character.towerRewardEligibility, 'none');
        assert.deepEqual(await kv.get('battle-lock:tower-ai1'), null);
        assert.notEqual(await kv.get('battle-lock:host'), null);
        assert.ok(pushed.some(event => event.room === 'user:host' && event.event === 'tower:kick'));
        assert.equal(pushed.some(event => event.room.includes('tower-ai')), false, 'AI never receives a player-room push');
    });

    it('rejects borrowed-player AI input and keeps empty-field legacy clients host-only', async () => {
        await seedHostSave();

        const rejected = response();
        await handler({
            method: 'POST',
            body: { hostName: 'host', mode: 'story', floor: 1, allies: ['borrowed-player'] },
            headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
            socket: { remoteAddress: '127.0.0.1' },
        } as never, rejected.res);
        assert.equal(rejected.out.statusCode, 400);
        assert.equal(rejected.out.body?.errorCode, 'borrowed-allies-disabled');
        assert.match(String(rejected.out.body?.error), /Story Ready Room.*Novice Tower Recruit/i);
        assert.equal(await kv.get('battle-lock:host'), null, 'rejected roster input cannot lease the host');
        assert.deepEqual(await kv.keys('tower:*'), [], 'rejected roster input cannot publish a session');

        const solo = response();
        await handler({
            method: 'POST',
            body: { hostName: 'host', mode: 'story', floor: 1, allies: [] },
            headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
            socket: { remoteAddress: '127.0.0.1' },
        } as never, solo.res);
        assert.equal(solo.out.statusCode, 200, JSON.stringify(solo.out.body));
        const session = solo.out.body?.session as TowerSession;
        const squad = session.actors.filter(actor => actor.side === 'squad');
        assert.equal(squad.length, 1);
        assert.equal(squad[0]?.ownerSlug, 'host');
        assert.equal(squad[0]?.ai, false);
        assert.equal(squad.some(actor => actor.character.towerGenericAiProfile === 'story-recruit-v1'), false);
    });
});
