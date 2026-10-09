import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'village-state-test-secret-32-bytes-long';
process.env.ADMIN_PASSWORD = 'village-state-test-admin';

/*
 * A village's internals are for its members (owner ruling 2026-10-08).
 *
 * The public /api/game-state frame needs no login and Cloudflare caches it, yet
 * it used to carry every village's whole record: treasury and Village Stores,
 * upgrade levels, the orders board with its raid targets, the activity log of
 * who donated or was gifted what, and the settlement journals. It now carries
 * the public fields only (api/_village-state-view.ts), and GET /api/village/state
 * serves the rest to the village's own members.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, any>; headers: Record<string, string> };

const VILLAGE = 'Frostfang Village';
const RIVAL = 'Moonshadow Village';
const MEMBER_FIELDS = ['treasury', 'upgrades', 'contributionPoints', 'notices', 'noticePosts', 'dailyAgenda'];
const JOURNALS = ['settlementReceipts', 'agendaClaimReceipts', 'warSpoilsReceipts'];

const ROW = {
    treasury: { ryo: 125_000, honorSeals: 640, fateShards: 3, boneCharms: 0, auraStones: 0, mythicSeals: 0, provisions: 30, materialPoints: 210, items: [{ itemId: 'hunt-ash-scale', count: 3 }] },
    upgrades: { training: 4 },
    contributionPoints: 900,
    notices: ['frostrunner donated 1,000 ryo to the village treasury.'],
    noticePosts: [{ id: 'order-1', type: 'raid', title: 'Raid Sector 33', body: 'Move at dusk.', author: 'frostkage', sector: 33, pinned: false, createdAt: 1 }],
    dailyAgenda: { date: '2026-10-09', tasks: [] },
    settlementReceipts: [{ transactionId: 'tx-secret-1', fingerprint: 'f', resource: 'ryo', amount: 1000, appliedAt: 1 }],
    agendaClaimReceipts: ['2026-10-09:frostrunner'],
    warSpoilsReceipts: { 'spoils-secret': { side: 'winner', spoils: { ryo: 5 }, at: 1 } },
    warRecords: [{ opponent: RIVAL, winner: VILLAGE, finalScore: '3 - 1', topDefender: 'a', topAttacker: 'b', mvpClan: 'c', rewards: 'd', date: 'e' }],
    kageHistory: [{ name: 'frostkage', village: VILLAGE, seatedAt: 1 }],
    hollowGateUnlockedUntil: 4_000_000_000_000,
};
const RIVAL_ROW = { treasury: { ryo: 7, honorSeals: 1, items: [] }, contributionPoints: 12 };

let stateHandler: Handler;
let gameState: Handler;
let kv: typeof import('../_storage.js').kv;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let issuePlayerToken: (name: string) => string | null;
let resetRateLimits: () => void;
let clearProcCache: () => void;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    ({ __clearProcCache: clearProcCache } = await import('../_proc-cache.js'));
    stateHandler = (await import('./state.js')).default as unknown as Handler;
    gameState = (await import('../game-state.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const p of onlineStore.list()) onlineStore.remove(p.name);
    resetRateLimits();
    clearProcCache();
    await kv.set('game:village-state:frostfangvillage', ROW);
    await kv.set('game:village-state:moonshadowvillage', RIVAL_ROW);
    await seedSave('frostrunner', VILLAGE);
    await seedSave('moonrunner', RIVAL);
    await seedSave('drifter', '');
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const p of onlineStore.list()) onlineStore.remove(p.name);
    clearProcCache();
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_PASSWORD;
});

async function seedSave(name: string, village: string) {
    await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, village, level: 30 } });
}

function fakeRes() {
    const out: ResponseOut = { statusCode: 200, headers: {} };
    const res = {
        setHeader: (k: string, v: string) => { out.headers[String(k).toLowerCase()] = String(v); return res; },
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function readState(as: string | null, query: Record<string, string> = {}, method = 'GET'): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    const headers: Record<string, string> = as === 'admin'
        ? { 'x-admin-password': String(process.env.ADMIN_PASSWORD) }
        : as ? { 'x-player-name': as, 'x-player-token': issuePlayerToken(as) ?? '' } : {};
    await stateHandler({ method, query, headers, socket: { remoteAddress: '127.0.0.1' } } as never, res);
    return out;
}

async function publicFrame(): Promise<Record<string, any>> {
    const { res, out } = fakeRes();
    await gameState({ method: 'GET', query: {}, headers: {} } as never, res);
    assert.equal(out.statusCode, 200);
    return out.body!;
}

describe('the public /api/game-state frame', { concurrency: false }, () => {
    it('carries a village\'s public record only: no treasury, upgrades, orders, logs or journals', async () => {
        const frame = await publicFrame();
        const frost = frame.villageStates.frostfangvillage as Record<string, unknown>;
        for (const field of [...MEMBER_FIELDS, ...JOURNALS]) assert.equal(field in frost, false, `${field} is not public`);
        assert.deepEqual(frost.warRecords, ROW.warRecords, 'war history stays public');
        assert.deepEqual(frost.kageHistory, ROW.kageHistory);
        assert.equal(frost.hollowGateUnlockedUntil, ROW.hollowGateUnlockedUntil);
        assert.ok(Array.isArray(frost.anbuMembers), 'leadership stays public');
        const text = JSON.stringify(frame);
        for (const secret of ['Raid Sector 33', '125000', 'tx-secret-1', 'spoils-secret', 'donated 1,000 ryo']) {
            assert.equal(text.includes(secret), false, `"${secret}" must not be public`);
        }
    });
});

describe('GET /api/village/state', { concurrency: false }, () => {
    it('serves a member their own village\'s internals, privately', async () => {
        const out = await readState('frostrunner');
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.headers['cache-control'], 'private, no-store');
        assert.equal(out.body?.village, VILLAGE);
        assert.deepEqual(out.body?.state, Object.fromEntries(MEMBER_FIELDS.map((field) => [field, (ROW as Record<string, unknown>)[field]])));
        for (const journal of JOURNALS) assert.equal(journal in out.body!.state, false, `${journal} is bookkeeping, served to nobody`);
    });

    it('requires a login, refuses non-GET, and keeps even the refusal out of shared caches', async () => {
        const anonymous = await readState(null);
        assert.equal(anonymous.statusCode, 401);
        assert.equal(anonymous.headers['cache-control'], 'private, no-store');
        assert.equal((await readState('frostrunner', {}, 'POST')).statusCode, 405);
    });

    it('never answers for another village', async () => {
        const named = await readState('frostrunner', { village: VILLAGE });
        assert.equal(named.statusCode, 200);
        const other = await readState('frostrunner', { village: RIVAL });
        assert.equal(other.statusCode, 403);
        assert.equal(other.body?.state, undefined);
        const rival = await readState('moonrunner');
        assert.equal(rival.body?.village, RIVAL);
        assert.equal(rival.body?.state.treasury.ryo, 7, 'each member reads their own village');
    });

    it('takes the village from the save, never from the client-supplied presence row', async () => {
        onlineStore.upsert({ name: 'frostrunner', sector: 12, character: { name: 'frostrunner', village: RIVAL, level: 30 } });
        const out = await readState('frostrunner');
        assert.equal(out.body?.village, VILLAGE);
        assert.equal((await readState('frostrunner', { village: RIVAL })).statusCode, 403);
    });

    it('answers every member field, null where the record has none', async () => {
        const rival = await readState('moonrunner');
        assert.deepEqual(Object.keys(rival.body?.state).sort(), [...MEMBER_FIELDS].sort());
        assert.equal(rival.body?.state.upgrades, null);
        assert.equal(rival.body?.state.noticePosts, null);
    });

    it('a player with no village gets no record', async () => {
        const out = await readState('drifter');
        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body, { ok: true, village: '', state: null });
    });

    it('an admin names the village to read', async () => {
        const out = await readState('admin', { village: RIVAL });
        assert.equal(out.statusCode, 200);
        assert.equal(out.body?.state.contributionPoints, 12);
        assert.equal((await readState('admin')).statusCode, 400);
    });
});

describe('the field lists', () => {
    it('the client merges exactly the fields the server serves to members', async () => {
        // The client keeps its own copy (shinobij.client/src/lib/world-state.ts):
        // it decides which fields survive a public poll and which a write may
        // send. A field only one side lists would either be wiped by every
        // public poll or written back as a default.
        const { MEMBER_VILLAGE_STATE_FIELDS, PUBLIC_VILLAGE_STATE_FIELDS } = await import('../_village-state-view.js');
        // process.cwd(), not import.meta.url: this build root compiles to CommonJS.
        const source = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'lib', 'world-state.ts'), 'utf8');
        const list = source.match(/const VILLAGE_MEMBER_FIELDS = \[([^\]]*)\] as const;/);
        assert.ok(list, 'the client list is still declared where this test reads it');
        assert.deepEqual([...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]), [...MEMBER_VILLAGE_STATE_FIELDS]);
        assert.deepEqual(MEMBER_FIELDS, [...MEMBER_VILLAGE_STATE_FIELDS], 'and this file\'s own expectation');
        for (const field of PUBLIC_VILLAGE_STATE_FIELDS) {
            assert.equal((MEMBER_VILLAGE_STATE_FIELDS as readonly string[]).includes(field), false, `${field} is listed once`);
        }
    });
});

describe('a village write that leaves the member fields out', { concurrency: false }, () => {
    it('keeps the stored ones: a client that has not read them yet sends none', async () => {
        // The client no longer gets these from the public frame. Until its first
        // /api/village/state read lands it holds only defaults, so it must leave
        // them out of the villageState POST, and the server must keep the stored
        // values for anything left out.
        const { res, out } = fakeRes();
        await gameState({
            method: 'POST',
            headers: { 'x-player-name': 'frostrunner', 'x-player-token': issuePlayerToken('frostrunner') ?? '' },
            body: { kind: 'villageState', village: VILLAGE, state: { warRecords: ROW.warRecords, kageHistory: ROW.kageHistory } },
            socket: { remoteAddress: '127.0.0.1' },
        } as never, res);
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const stored = await kv.get<Record<string, unknown>>('game:village-state:frostfangvillage');
        for (const field of MEMBER_FIELDS) {
            assert.deepEqual(stored?.[field], (ROW as Record<string, unknown>)[field], `${field} is untouched`);
        }
    });
});
